import { beforeEach, expect, test, vi } from 'vitest'

import type { AgentClient } from '../src/agents/types'
import type { WorkspaceContext } from '../src/types'

const mockState = vi.hoisted(() => {
  return {
    codexInstances: [] as { options: { onEvent?: (event: { item?: { type?: string }, type: string }) => void, workspaceRoot: string } }[],
    runWorkflowCalls: [] as unknown[],
    graph: {
      featureId: '001-demo',
      tasks: [],
    } as { featureId: string, tasks: unknown[] },
    runtime: {
      store: {},
      verifier: {},
      workspace: {},
      git: {
        requireCleanWorktree: vi.fn(async () => {}),
      },
    },
  }
})

vi.mock('../src/agents/codex', () => {
  return {
    CodexAgentClient: class MockCodexAgentClient implements AgentClient {
      public readonly name = 'codex'

      public constructor(public readonly options: { onEvent?: (event: { item?: { type?: string }, type: string }) => void, workspaceRoot: string }) {
        mockState.codexInstances.push({ options })
      }

      public async implement() {
        return {
          assumptions: [],
          changedFiles: [],
          needsHumanAttention: false,
          notes: [],
          requestedAdditionalPaths: [],
          status: 'implemented' as const,
          summary: 'unused',
          taskId: 'T001',
          unresolvedItems: [],
        }
      }

      public async review() {
        return {
          changedFilesReviewed: [],
          findings: [],
          overallRisk: 'low' as const,
          summary: 'unused',
          taskId: 'T001',
          verdict: 'pass' as const,
          acceptanceChecks: [
            {
              criterion: 'unused',
              note: 'unused',
              status: 'pass' as const,
            },
          ],
        }
      }
    },
  }
})

vi.mock('../src/core/task-normalizer', () => {
  return {
    normalizeTaskGraph: vi.fn(async () => mockState.graph),
  }
})

vi.mock('../src/runtime/fs-runtime', () => {
  return {
    createFsRuntime: vi.fn(() => mockState.runtime),
  }
})

vi.mock('../src/core/orchestrator', () => {
  return {
    runWorkflow: vi.fn(async (input) => {
      mockState.runWorkflowCalls.push(input)
      return {
        state: {
          currentTaskId: null,
          featureId: '001-demo',
          tasks: {},
        },
        summary: {
          blockedTasks: 0,
          completedTasks: 0,
          finalStatus: 'in_progress',
          replanTasks: 0,
          totalTasks: 0,
        },
      }
    }),
  }
})

const { runCommand } = await import('../src/commands/run')

function createContext(): WorkspaceContext {
  return {
    featureDir: '/tmp/specs/001-demo',
    featureId: '001-demo',
    planPath: '/tmp/specs/001-demo/plan.md',
    runtimeDir: '/tmp/specs/001-demo/.while',
    specPath: '/tmp/specs/001-demo/spec.md',
    tasksPath: '/tmp/specs/001-demo/tasks.md',
    workspaceRoot: '/tmp',
  }
}

beforeEach(() => {
  mockState.codexInstances = []
  mockState.runWorkflowCalls = []
})

test('runCommand creates default Codex agent and forwards untilTaskId', async () => {
  const context = createContext()

  await runCommand(context, {
    untilTaskId: 'T002',
  })

  expect(mockState.codexInstances).toHaveLength(1)
  expect(mockState.codexInstances[0]?.options.workspaceRoot).toBe('/tmp')
  expect(mockState.codexInstances[0]?.options.onEvent).toBeUndefined()
  expect(mockState.runWorkflowCalls[0]).toMatchObject({
    graph: mockState.graph,
    runtime: mockState.runtime,
    untilTaskId: 'T002',
  })
})

test('runCommand enables Codex progress callback when verbose is true', async () => {
  const context = createContext()
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

  await runCommand(context, {
    verbose: true,
  })

  expect(mockState.codexInstances).toHaveLength(1)
  expect(mockState.codexInstances[0]?.options.onEvent).toBeTypeOf('function')
  mockState.codexInstances[0]?.options.onEvent?.({
    type: 'item.completed',
    item: {
      type: 'agent_message',
    },
  })
  expect(stderr).toHaveBeenCalledWith('[codex] item.completed agent_message\n')
})

test('runCommand respects an injected agent instead of creating Codex client', async () => {
  const context = createContext()
  const injectedAgent: AgentClient = {
    name: 'fake',
    async implement() {
      throw new Error('not used in this test')
    },
    async review() {
      throw new Error('not used in this test')
    },
  }

  await runCommand(context, {
    agent: injectedAgent,
  })

  expect(mockState.codexInstances).toHaveLength(0)
  expect(mockState.runWorkflowCalls[0]).toMatchObject({
    agent: injectedAgent,
  })
})
