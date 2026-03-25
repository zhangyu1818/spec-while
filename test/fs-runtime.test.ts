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
  await writeFile(
    path.join(root, 'src', 'existing.ts'),
    'export const value = 1\n',
  )
  await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  await writeFile(
    path.join(featureDir, 'tasks.md'),
    `
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
`,
  )
  return { featureDir, root }
}

async function createRemoteBackedWorkspace() {
  const remoteRoot = await mkdtemp(path.join(tmpdir(), 'while-fs-remote-'))
  const remote = path.join(remoteRoot, 'origin.git')
  await execFileAsync('git', ['init', '--bare', remote])

  const root = await mkdtemp(path.join(tmpdir(), 'while-fs-clone-'))
  await execFileAsync('git', ['clone', remote, root])

  const featureDir = path.join(root, 'specs', '001-demo')
  await mkdir(featureDir, { recursive: true })
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(
    path.join(root, 'src', 'existing.ts'),
    'export const value = 1\n',
  )
  await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  await writeFile(
    path.join(featureDir, 'tasks.md'),
    `
# Tasks

## Phase 1: Core

- [ ] T001 Do work in src/existing.ts
  - Paths: src/existing.ts
  - Depends:
  - Acceptance:
    - works
  - Verify:
    - node -e "process.exit(0)"
  - Review Rubric:
    - clear
  - Max Iterations: 1
`,
  )

  await git(root, ['config', 'user.name', 'While Test'])
  await git(root, ['config', 'user.email', 'while@example.com'])
  await git(root, ['checkout', '-b', 'main'])
  await git(root, ['add', '.'])
  await git(root, ['commit', '-m', 'Initial commit'])
  await git(root, ['push', '-u', 'origin', 'main'])

  return { featureDir, remote, root }
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
  await git(root, ['branch', '-M', 'main'])
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
  await git(root, ['branch', '-M', 'main'])
  await writeFile(path.join(root, '.gitignore'), '.while\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-m', 'Initial commit'])
  const runtime = createFsRuntime({
    featureDir,
    workspaceRoot: root,
  })

  await writeFile(path.join(root, 'notes.txt'), 'keep me untracked\n')
  await expect(runtime.git.requireCleanWorktree()).rejects.toThrow(
    /worktree must be clean/i,
  )
  await git(root, ['add', 'notes.txt'])
  await git(root, ['commit', '-m', 'Add notes'])

  await writeFile(
    path.join(root, 'src', 'existing.ts'),
    'export const value = 2\n',
  )
  await runtime.workspace.updateTaskChecks([{ checked: true, taskId: 'T001' }])

  expect(await runtime.git.getChangedFilesSinceHead()).toEqual([
    'specs/001-demo/tasks.md',
    'src/existing.ts',
  ])
  expect(await runtime.git.getCurrentBranch()).toBe('main')

  const { commitSha } = await runtime.git.commitTask({
    message: 'Task T001: Do work',
  })
  const files = await git(root, ['show', '--name-only', '--format=', commitSha])

  expect(commitSha).toBeTruthy()
  expect(files.split('\n')).toContain('specs/001-demo/tasks.md')
  expect(files.split('\n')).toContain('src/existing.ts')
  expect(files).not.toContain('.while')

  await runtime.git.checkoutBranch('task/t001-do-work', {
    create: true,
    startPoint: 'main',
  })
  expect(await runtime.git.getCurrentBranch()).toBe('task/t001-do-work')
  expect(await runtime.git.getHeadSha()).toBeTruthy()
  expect(await runtime.git.getHeadSubject()).toBe('Task T001: Do work')
  expect(await runtime.git.getHeadTimestamp()).toBeTruthy()

  await runtime.git.checkoutBranch('main')
  await runtime.git.deleteLocalBranch('task/t001-do-work')
  await expect(
    git(root, ['rev-parse', '--verify', 'task/t001-do-work']),
  ).rejects.toThrow()
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
  const events = await readFile(
    path.join(featureDir, '.while', 'events.jsonl'),
    'utf8',
  )
  expect(events).toContain('"type":"attempt_started"')
})

test('FsRuntime can restore a task branch from origin when the local branch is missing', async () => {
  const { featureDir, root } = await createRemoteBackedWorkspace()
  const runtime = createFsRuntime({
    featureDir,
    workspaceRoot: root,
  })

  await runtime.git.checkoutBranch('task/t001-do-work', {
    create: true,
    startPoint: 'main',
  })
  await writeFile(
    path.join(root, 'src', 'existing.ts'),
    'export const value = 2\n',
  )
  await runtime.git.commitTask({
    message: 'checkpoint: Task T001: Do work (attempt 1)',
  })
  const remoteSha = await runtime.git.getHeadSha()
  await runtime.git.pushBranch('task/t001-do-work')

  await runtime.git.checkoutBranch('main')
  await runtime.git.deleteLocalBranch('task/t001-do-work')

  await runtime.git.checkoutRemoteBranch('task/t001-do-work')

  expect(await runtime.git.getCurrentBranch()).toBe('task/t001-do-work')
  expect(await runtime.git.getHeadSha()).toBe(remoteSha)
})
