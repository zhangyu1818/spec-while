import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { createFsRuntime } from '../src/runtime/fs-runtime'

test('FsRuntime task snippet starts from the matching task header instead of dependency lines', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'while-fs-runtime-context-'))
  const featureDir = path.join(root, 'specs', '001-demo')
  await mkdir(featureDir, { recursive: true })
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'greeting.ts'), 'export const greeting = "hi"\n')
  await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  await writeFile(path.join(featureDir, 'tasks.md'), `
# Tasks

## Phase 1: Core

- [ ] T001 Implement greeting
  - Paths: src/greeting.ts
  - Depends: T002
  - Acceptance:
    - works
  - Review Rubric:
    - clear
  - Max Iterations: 1

- [ ] T002 Implement follow-up
  - Paths: src/greeting.ts
  - Depends:
  - Acceptance:
    - works
  - Review Rubric:
    - clear
  - Max Iterations: 1
`)

  const runtime = createFsRuntime({
    featureDir,
    workspaceRoot: root,
  })
  const context = await runtime.workspace.loadTaskContext({
    id: 'T002',
    acceptance: ['works'],
    dependsOn: [],
    maxAttempts: 1,
    parallelizable: false,
    paths: ['src/greeting.ts'],
    phase: 'Core',
    reviewRubric: ['clear'],
    title: 'Implement follow-up',
    verifyCommands: [],
  })

  expect(context.tasksSnippet.trimStart()).toMatch(/^- \[ \] T002 Implement follow-up/m)
  expect(context.tasksSnippet).not.toContain('- Depends: T002')
})
