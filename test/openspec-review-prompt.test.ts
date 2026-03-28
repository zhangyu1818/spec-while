import path from 'node:path'

import { beforeEach, expect, test, vi } from 'vitest'

import { openspecTaskSource } from '../src/task-sources/openspec/source'
import { createOpenSpecChangeFixture } from './openspec-task-source-test-helpers'

const mockState = vi.hoisted(() => {
  return {
    applyResult: {
      changeName: 'example-change',
      schemaName: 'spec-driven',
      state: 'ready',
      tasks: [],
      contextFiles: {
        design: 'design.md',
        proposal: 'proposal.md',
        specs: 'specs/**/*.md',
        tasks: 'tasks.md',
      },
      instruction:
        'Review only passes when the config parser preserves declared job order.',
      progress: {
        complete: 0,
        total: 8,
      },
    },
    statusResult: {
      applyRequires: ['tasks'],
      changeName: 'example-change',
      isComplete: false,
      schemaName: 'spec-driven',
      artifacts: [
        {
          id: 'proposal',
          outputPath: 'proposal.md',
          status: 'done',
        },
        {
          id: 'design',
          outputPath: 'design.md',
          status: 'ready',
        },
        {
          id: 'specs',
          outputPath: 'specs/**/*.md',
          status: 'done',
        },
        {
          id: 'tasks',
          outputPath: 'tasks.md',
          status: 'done',
        },
      ],
    },
  }
})

vi.mock('../src/task-sources/openspec/cli-json', async () => {
  const actual = await vi.importActual('../src/task-sources/openspec/cli-json')
  return {
    ...actual,
    readOpenSpecApplyInstructions: vi.fn(async () => mockState.applyResult),
    readOpenSpecStatus: vi.fn(async () => mockState.statusResult),
  }
})

beforeEach(() => {
  mockState.applyResult = {
    changeName: 'example-change',
    schemaName: 'spec-driven',
    state: 'ready',
    tasks: [],
    contextFiles: {
      design: 'design.md',
      proposal: 'proposal.md',
      specs: 'specs/**/*.md',
      tasks: 'tasks.md',
    },
    instruction:
      'Review only passes when the config parser preserves declared job order.',
    progress: {
      complete: 0,
      total: 8,
    },
  }
  mockState.statusResult = {
    applyRequires: ['tasks'],
    changeName: 'example-change',
    isComplete: false,
    schemaName: 'spec-driven',
    artifacts: [
      {
        id: 'proposal',
        outputPath: 'proposal.md',
        status: 'done',
      },
      {
        id: 'design',
        outputPath: 'design.md',
        status: 'ready',
      },
      {
        id: 'specs',
        outputPath: 'specs/**/*.md',
        status: 'done',
      },
      {
        id: 'tasks',
        outputPath: 'tasks.md',
        status: 'done',
      },
    ],
  }
})

test('openspec source includes the apply instruction text in the review prompt', async () => {
  const fixture = await createOpenSpecChangeFixture()
  mockState.applyResult.contextFiles = {
    design: fixture.designPath,
    proposal: fixture.proposalPath,
    specs: path.join(fixture.changeDir, 'specs/**/*.md'),
    tasks: fixture.tasksPath,
  }

  const session = await openspecTaskSource.open({
    featureDir: fixture.changeDir,
    featureId: fixture.changeId,
    workspaceRoot: fixture.root,
  })
  const prompt = await session.buildReviewPrompt({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    taskHandle: '1.1',
  })

  expect(prompt.instructions).toContain(
    'Review only passes when the config parser preserves declared job order.',
  )
})
