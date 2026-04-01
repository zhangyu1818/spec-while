import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { specKitTaskSource } from '../src/task-sources/spec-kit/source'

async function createFeatureDir() {
  const root = await mkdtemp(path.join(tmpdir(), 'while-spec-kit-source-'))
  const featureDir = path.join(root, 'specs', '001-engine-skeleton')
  await mkdir(featureDir, { recursive: true })
  await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  await writeFile(
    path.join(featureDir, 'tasks.md'),
    `# Tasks: Deterministic Engine Skeleton

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Add the failing contract test that executes the named verification commands and proves default exclusion of test:perf and test:live-smoke from pnpm test in tests/contract/test-commands.test.ts
- [ ] T002 Implement named test commands and Vitest suite wiring in package.json and vitest.config.ts
- [ ] T003 [P] Add the reserved-command guidance for test:perf and the no-live-provider guard note for test:live-smoke in tests/perf/README.md and tests/live-smoke/README.md

## Dependencies & Execution Order

- Setup first
- Execute phase-by-phase
`,
  )
  return { featureDir, root }
}

test('spec-kit source parses raw generated tasks without enhanced fields', async () => {
  const { featureDir, root } = await createFeatureDir()

  const session = await specKitTaskSource.open({
    featureDir,
    featureId: '001-engine-skeleton',
    workspaceRoot: root,
  })

  expect(session.listTasks()).toEqual(['T001', 'T002', 'T003'])
  expect(session.getTaskDependencies('T001')).toEqual([])
  expect(session.getTaskDependencies('T002')).toEqual([])
  expect(await session.getCompletionCriteria('T001')).toEqual([
    'Add the failing contract test that executes the named verification commands and proves default exclusion of test:perf and test:live-smoke from pnpm test in tests/contract/test-commands.test.ts',
  ])
  expect(session.buildCommitSubject('T003')).toBe(
    'Task T003: Add the reserved-command guidance for test:perf and the no-live-provider guard note for test:live-smoke in tests/perf/README.md and tests/live-smoke/README.md',
  )

  const prompt = await session.buildImplementPrompt({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    taskHandle: 'T001',
  })

  expect(prompt.sections).toContainEqual({
    title: 'Task',
    content:
      '- [ ] T001 Add the failing contract test that executes the named verification commands and proves default exclusion of test:perf and test:live-smoke from pnpm test in tests/contract/test-commands.test.ts',
  })
  expect(prompt.sections).toContainEqual({
    content: expect.stringContaining('## Dependencies & Execution Order'),
    title: 'Tasks',
  })
})

test('spec-kit source treats lowercase x as completed state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'while-spec-kit-source-'))
  const featureDir = path.join(root, 'specs', '001-engine-skeleton')
  await mkdir(featureDir, { recursive: true })
  await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  await writeFile(
    path.join(featureDir, 'tasks.md'),
    `# Tasks: Deterministic Engine Skeleton

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Add the failing contract test
- [ ] T002 Implement named test commands
`,
  )

  const session = await specKitTaskSource.open({
    featureDir,
    featureId: '001-engine-skeleton',
    workspaceRoot: root,
  })

  await expect(session.isTaskCompleted('T001')).resolves.toBe(true)
})
