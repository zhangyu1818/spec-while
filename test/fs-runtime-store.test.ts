import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { createFsRuntime } from '../src/runtime/fs-runtime'

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
  - Paths: src/existing.ts
  - Depends:
  - Acceptance:
    - works
  - Verify:
    - node -e "process.exit(0)"
  - Review Rubric:
    - clear
  - Max Iterations: 2
`,
  )
  return { featureDir, root }
}

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
  await runtime.store.saveIntegrateArtifact({
    attempt: 1,
    createdAt: '2026-03-22T00:00:03.000Z',
    generation: 2,
    taskId: 'T001',
    result: {
      commitSha: 'commit-1',
      summary: 'integrated',
    },
  })

  await expect(runtime.store.loadGraph()).resolves.toEqual(graph)
  await expect(runtime.store.loadState()).resolves.toEqual(state)
  await expect(runtime.store.readReport()).resolves.toEqual(report)
  await expect(
    runtime.store.loadImplementArtifact({
      attempt: 1,
      generation: 2,
      taskId: 'T001',
    }),
  ).resolves.toMatchObject({
    attempt: 1,
    generation: 2,
    taskId: 'T001',
  })
  await expect(
    runtime.store.loadVerifyArtifact({
      attempt: 1,
      generation: 2,
      taskId: 'T001',
    }),
  ).resolves.toMatchObject({
    attempt: 1,
    generation: 2,
    taskId: 'T001',
  })
  await expect(
    runtime.store.loadReviewArtifact({
      attempt: 1,
      generation: 2,
      taskId: 'T001',
    }),
  ).resolves.toMatchObject({
    attempt: 1,
    generation: 2,
    taskId: 'T001',
  })
  expect(runtime.github).toBeDefined()

  const graphJson = await readFile(
    path.join(featureDir, '.while', 'graph.json'),
    'utf8',
  )
  const stateJson = await readFile(
    path.join(featureDir, '.while', 'state.json'),
    'utf8',
  )
  const reportJson = await readFile(
    path.join(featureDir, '.while', 'report.json'),
    'utf8',
  )
  const implementJson = await readFile(
    path.join(
      featureDir,
      '.while',
      'tasks',
      'T001',
      'g2',
      'a1',
      'implement.json',
    ),
    'utf8',
  )
  const verifyJson = await readFile(
    path.join(featureDir, '.while', 'tasks', 'T001', 'g2', 'a1', 'verify.json'),
    'utf8',
  )
  const reviewJson = await readFile(
    path.join(featureDir, '.while', 'tasks', 'T001', 'g2', 'a1', 'review.json'),
    'utf8',
  )
  const integrateJson = await readFile(
    path.join(
      featureDir,
      '.while',
      'tasks',
      'T001',
      'g2',
      'a1',
      'integrate.json',
    ),
    'utf8',
  )

  expect(JSON.parse(graphJson)).toEqual(graph)
  expect(JSON.parse(stateJson)).toEqual(state)
  expect(JSON.parse(reportJson)).toEqual(report)
  expect(JSON.parse(implementJson)).toMatchObject({ taskId: 'T001' })
  expect(JSON.parse(verifyJson)).toMatchObject({ taskId: 'T001' })
  expect(JSON.parse(reviewJson)).toMatchObject({ taskId: 'T001' })
  expect(JSON.parse(integrateJson)).toMatchObject({ taskId: 'T001' })
})
