import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { expect, test } from 'vitest'

import { createFsRuntime } from '../src/runtime/fs-runtime'

const execFileAsync = promisify(execFile)

async function git(root: string, args: string[]) {
  const result = await execFileAsync('git', args, { cwd: root })
  return result.stdout.trim()
}

async function createWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'while-fs-runtime-'))
  const featureDir = path.join(root, 'specs', '001-demo')
  await mkdir(featureDir, { recursive: true })
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'existing.ts'), 'export const value = 1\n')
  await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  await writeFile(path.join(featureDir, 'tasks.md'), `
# Tasks

## Phase 1: Core

- [ ] T001 Do work in src/existing.ts
  - Paths: src/existing.ts, src/missing.ts
  - Depends:
  - Acceptance:
    - works
  - Verify:
    - node -e "process.exit(0)"
  - Review Rubric:
    - clear
  - Max Iterations: 1
`)
  return { featureDir, root }
}

test('FsRuntime returns null when persisted graph, state and report are absent', async () => {
  const { featureDir, root } = await createWorkspace()
  const runtime = createFsRuntime({
    featureDir,
    workspaceRoot: root,
  })

  await expect(runtime.store.loadGraph()).resolves.toBeNull()
  await expect(runtime.store.loadState()).resolves.toBeNull()
  await expect(runtime.store.readReport()).resolves.toBeNull()
})

test('FsRuntime clean-worktree check ignores runtime files under .while', async () => {
  const { featureDir, root } = await createWorkspace()
  await git(root, ['init'])
  await git(root, ['config', 'user.name', 'While Test'])
  await git(root, ['config', 'user.email', 'while@example.com'])
  await git(root, ['add', '.'])
  await git(root, ['commit', '-m', 'Initial commit'])
  const runtime = createFsRuntime({
    featureDir,
    workspaceRoot: root,
  })

  await runtime.store.saveState({
    currentTaskId: null,
    featureId: '001-demo',
    tasks: {},
  })

  await expect(runtime.git.requireCleanWorktree()).resolves.toBeUndefined()
})

test('FsRuntime exposes git helpers, requires a fully clean worktree, and keeps .while out of task commits', async () => {
  const { featureDir, root } = await createWorkspace()
  await git(root, ['init'])
  await git(root, ['config', 'user.name', 'While Test'])
  await git(root, ['config', 'user.email', 'while@example.com'])
  await writeFile(path.join(root, '.gitignore'), '.while\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-m', 'Initial commit'])
  const runtime = createFsRuntime({
    featureDir,
    workspaceRoot: root,
  })

  await writeFile(path.join(root, 'notes.txt'), 'keep me untracked\n')
  await expect(runtime.git.requireCleanWorktree()).rejects.toThrow(/worktree must be clean/i)
  await git(root, ['add', 'notes.txt'])
  await git(root, ['commit', '-m', 'Add notes'])

  await writeFile(path.join(root, 'src', 'existing.ts'), 'export const value = 2\n')
  await runtime.workspace.updateTaskChecks([{ checked: true, taskId: 'T001' }])

  expect(await runtime.git.getChangedFilesSinceHead()).toEqual(['specs/001-demo/tasks.md', 'src/existing.ts'])

  const { commitSha } = await runtime.git.commitTask({
    message: 'Task T001: Do work',
  })
  const files = await git(root, ['show', '--name-only', '--format=', commitSha])

  expect(commitSha).toBeTruthy()
  expect(files.split('\n')).toContain('specs/001-demo/tasks.md')
  expect(files.split('\n')).toContain('src/existing.ts')
  expect(files).not.toContain('.while')
})

test('FsRuntime loads task context, marks missing code, updates checkboxes and appends events', async () => {
  const { featureDir, root } = await createWorkspace()
  const runtime = createFsRuntime({
    featureDir,
    workspaceRoot: root,
  })

  const context = await runtime.workspace.loadTaskContext({
    id: 'T001',
    acceptance: ['works'],
    dependsOn: [],
    maxAttempts: 1,
    parallelizable: false,
    paths: ['src/existing.ts', 'src/missing.ts'],
    phase: 'Core',
    reviewRubric: ['clear'],
    title: 'Do work',
    verifyCommands: ['node -e "process.exit(0)"'],
  })

  expect(context.codeContext).toMatch(/## src\/existing\.ts/)
  expect(context.codeContext).toMatch(/## src\/missing\.ts\n<missing>/)
  expect(context.tasksSnippet).toMatch(/T001/)

  await runtime.workspace.updateTaskChecks([{ checked: true, taskId: 'T001' }])
  const tasksMd = await readFile(path.join(featureDir, 'tasks.md'), 'utf8')
  expect(tasksMd).toMatch(/- \[X\] T001/)

  await runtime.store.appendEvent({
    attempt: 1,
    detail: 'done',
    generation: 1,
    taskId: 'T001',
    timestamp: '2026-03-22T00:00:00.000Z',
    type: 'attempt_started',
  })
  const events = await readFile(path.join(featureDir, '.while', 'events.jsonl'), 'utf8')
  expect(events).toContain('"type":"attempt_started"')
})

test('FsRuntime persists graph, state, report and per-attempt artifacts with separated paths', async () => {
  const { featureDir, root } = await createWorkspace()
  const runtime = createFsRuntime({
    featureDir,
    workspaceRoot: root,
  })

  const graph = {
    featureId: '001-demo',
    tasks: [
      {
        id: 'T001',
        acceptance: ['works'],
        dependsOn: [],
        maxAttempts: 2,
        parallelizable: false,
        paths: ['src/existing.ts'],
        phase: 'Core',
        reviewRubric: ['clear'],
        title: 'Do work',
        verifyCommands: ['node -e "process.exit(0)"'],
      },
    ],
  }
  const state = {
    currentTaskId: null,
    featureId: '001-demo',
    tasks: {
      T001: {
        attempt: 1,
        commitSha: 'commit-1',
        generation: 2,
        invalidatedBy: null,
        lastFindings: [],
        lastReviewVerdict: 'pass' as const,
        lastVerifyPassed: true,
        status: 'done' as const,
      },
    },
  }
  const report = {
    featureId: '001-demo',
    generatedAt: '2026-03-22T00:00:00.000Z',
    summary: {
      blockedTasks: 0,
      completedTasks: 1,
      finalStatus: 'completed' as const,
      replanTasks: 0,
      totalTasks: 1,
    },
    tasks: [
      {
        id: 'T001',
        attempt: 1,
        commitSha: 'commit-1',
        generation: 2,
        lastReviewVerdict: 'pass' as const,
        lastVerifyPassed: true,
        status: 'done' as const,
      },
    ],
  }

  await runtime.store.saveGraph(graph)
  await runtime.store.saveState(state)
  await runtime.store.saveReport(report)
  await runtime.store.saveImplementArtifact({
    attempt: 1,
    commitSha: 'commit-1',
    createdAt: '2026-03-22T00:00:00.000Z',
    generation: 2,
    taskId: 'T001',
    result: {
      assumptions: [],
      changedFiles: ['src/existing.ts'],
      needsHumanAttention: false,
      notes: [],
      requestedAdditionalPaths: [],
      status: 'implemented',
      summary: 'implemented',
      taskId: 'T001',
      unresolvedItems: [],
    },
  })
  await runtime.store.saveVerifyArtifact({
    attempt: 1,
    commitSha: 'commit-1',
    createdAt: '2026-03-22T00:00:01.000Z',
    generation: 2,
    taskId: 'T001',
    result: {
      passed: true,
      summary: 'ok',
      taskId: 'T001',
      commands: [
        {
          command: 'node -e "process.exit(0)"',
          exitCode: 0,
          finishedAt: '2026-03-22T00:00:01.000Z',
          passed: true,
          startedAt: '2026-03-22T00:00:00.500Z',
          stderr: '',
          stdout: '',
        },
      ],
    },
  })
  await runtime.store.saveReviewArtifact({
    attempt: 1,
    commitSha: 'commit-1',
    createdAt: '2026-03-22T00:00:02.000Z',
    generation: 2,
    taskId: 'T001',
    result: {
      changedFilesReviewed: ['src/existing.ts'],
      findings: [],
      overallRisk: 'low',
      summary: 'ok',
      taskId: 'T001',
      verdict: 'pass',
      acceptanceChecks: [
        {
          criterion: 'works',
          note: 'ok',
          status: 'pass',
        },
      ],
    },
  })

  await expect(runtime.store.loadGraph()).resolves.toEqual(graph)
  await expect(runtime.store.loadState()).resolves.toEqual(state)
  await expect(runtime.store.readReport()).resolves.toEqual(report)

  const graphJson = await readFile(path.join(featureDir, '.while', 'graph.json'), 'utf8')
  const stateJson = await readFile(path.join(featureDir, '.while', 'state.json'), 'utf8')
  const reportJson = await readFile(path.join(featureDir, '.while', 'report.json'), 'utf8')
  const implementJson = await readFile(path.join(featureDir, '.while', 'tasks', 'T001', 'g2', 'a1', 'implement.json'), 'utf8')
  const verifyJson = await readFile(path.join(featureDir, '.while', 'tasks', 'T001', 'g2', 'a1', 'verify.json'), 'utf8')
  const reviewJson = await readFile(path.join(featureDir, '.while', 'tasks', 'T001', 'g2', 'a1', 'review.json'), 'utf8')

  expect(graphJson).toContain('"featureId": "001-demo"')
  expect(stateJson).toContain('"status": "done"')
  expect(reportJson).toContain('"finalStatus": "completed"')
  expect(implementJson).toContain('"summary": "implemented"')
  expect(verifyJson).toContain('"passed": true')
  expect(reviewJson).toContain('"verdict": "pass"')
})
