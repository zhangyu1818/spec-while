import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { normalizeTaskGraph } from '../src/core/task-normalizer'

async function createFeatureDir(tasksContent: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'while-normalizer-'))
  const featureDir = path.join(root, 'specs', '001-demo')
  await mkdir(featureDir, { recursive: true })
  await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  await writeFile(path.join(featureDir, 'tasks.md'), tasksContent)
  return { featureDir, root }
}

test('normalizeTaskGraph parses tasks into the new workflow graph', async () => {
  const { featureDir } = await createFeatureDir(`
# Tasks

## Phase 1: Setup

- [ ] T001 Create parser in src/parser.ts
  - Depends:
  - Acceptance:
    - parse one task
  - Review Rubric:
    - naming clarity
  - Max Iterations: 2

## Phase 2: Core

- [ ] T002 [P] [US1] Add scheduler in src/scheduler.ts
  - Depends: T001
  - Acceptance:
    - schedule next task
  - Review Rubric:
    - no duplication
  - Max Iterations: 3
`)

  const graph = await normalizeTaskGraph({
    featureDir,
    tasksPath: path.join(featureDir, 'tasks.md'),
  })

  expect(graph.featureId).toBe('001-demo')
  expect(graph.tasks).toHaveLength(2)
  expect(graph.tasks[0]?.maxAttempts).toBe(2)
  expect(graph.tasks[1]?.parallelizable).toBe(true)
  expect(graph.tasks[1]?.storyId).toBe('US1')
})

test('normalizeTaskGraph rejects invalid dependencies', async () => {
  const { featureDir } = await createFeatureDir(`
# Tasks

## Phase 1: Setup

- [ ] T001 Create parser in src/parser.ts
  - Depends: T999
  - Acceptance:
    - parse one task
  - Review Rubric:
    - naming clarity
  - Max Iterations: 2
`)

  await expect(
    normalizeTaskGraph({
      featureDir,
      tasksPath: path.join(featureDir, 'tasks.md'),
    }),
  ).rejects.toThrow(/unknown task/i)
})
