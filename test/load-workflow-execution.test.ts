import { beforeEach, expect, test, vi } from 'vitest'

import type { ImplementerProvider, ReviewerProvider } from '../src/agents/types'
import type { OrchestratorRuntime } from '../src/core/runtime'
import type { TaskGraph, WorkspaceContext } from '../src/types'
import type { WorkflowConfig } from '../src/workflow/config'

const mockState = vi.hoisted(() => {
  return {
    callSequence: [] as string[],
    runWorkflowCalls: [] as unknown[],
    workflowConfigCalls: [] as string[],
    workflowConfigError: null as Error | null,
    codexInstances: [] as {
      options: {
        onEvent?: (event: { item?: { type?: string }; type: string }) => void
        workspaceRoot: string
      }
      provider: ImplementerProvider & ReviewerProvider
    }[],
    config: {
      workflow: {
        mode: 'direct',
        roles: {
          implementer: { provider: 'codex' },
          reviewer: { provider: 'codex' },
        },
      },
    } as WorkflowConfig,
    graph: {
      featureId: '001-demo',
      tasks: [],
    } as TaskGraph,
    runtime: {
      store: {},
      verifier: {},
      workspace: {},
      git: {
        requireCleanWorktree: vi.fn(async () => {}),
      },
    } as unknown as OrchestratorRuntime,
  }
})

vi.mock('../src/workflow/config', () => {
  return {
    loadWorkflowConfig: vi.fn(async (workspaceRoot: string) => {
      mockState.workflowConfigCalls.push(workspaceRoot)
      mockState.callSequence.push('config')
      if (mockState.workflowConfigError) {
        throw mockState.workflowConfigError
      }
      return mockState.config
    }),
  }
})

vi.mock('../src/agents/codex', () => {
  return {
    createCodexProvider: vi.fn(
      (options: {
        onEvent?: (event: { item?: { type?: string }; type: string }) => void
        workspaceRoot: string
      }) => {
        const provider: ImplementerProvider & ReviewerProvider = {
          name: 'codex',
          async implement() {
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
          },
          async review() {
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
          },
        }
        mockState.codexInstances.push({
          options,
          provider,
        })
        return provider
      },
    ),
  }
})

vi.mock('../src/core/task-normalizer', () => {
  return {
    normalizeTaskGraph: vi.fn(async () => {
      mockState.callSequence.push('graph')
      return mockState.graph
    }),
  }
})

vi.mock('../src/runtime/fs-runtime', () => {
  return {
    createFsRuntime: vi.fn(() => {
      mockState.callSequence.push('runtime')
      return mockState.runtime
    }),
  }
})

vi.mock('../src/core/orchestrator', () => {
  return {
    runWorkflow: vi.fn(async (input) => {
      mockState.callSequence.push('workflow')
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

const { loadWorkflowExecution } = await import('../src/commands/run')

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
  mockState.callSequence = []
  mockState.codexInstances = []
  mockState.config = {
    workflow: {
      mode: 'direct',
      roles: {
        implementer: { provider: 'codex' },
        reviewer: { provider: 'codex' },
      },
    },
  }
  mockState.runWorkflowCalls = []
  mockState.workflowConfigError = null
  mockState.workflowConfigCalls = []
})

test('loadWorkflowExecution rejects claude providers before runtime setup because CLI has no adapter path', async () => {
  const context = createContext()
  mockState.config = {
    workflow: {
      mode: 'direct',
      roles: {
        implementer: { provider: 'claude' },
        reviewer: { provider: 'codex' },
      },
    },
  }

  await expect(loadWorkflowExecution(context)).rejects.toThrow(
    /claude provider is not available in cli mode/i,
  )

  expect(mockState.callSequence).toEqual(['config'])
  expect(mockState.codexInstances).toHaveLength(0)
  expect(mockState.runWorkflowCalls).toHaveLength(0)
})

test('loadWorkflowExecution resolves a direct workflow from while.yaml role providers', async () => {
  const context = createContext()

  const execution = await loadWorkflowExecution(context)

  expect(mockState.codexInstances).toHaveLength(1)
  expect(execution.workflow).toMatchObject({
    preset: {
      mode: 'direct',
    },
    roles: {
      implementer: expect.objectContaining({ name: 'codex' }),
      reviewer: expect.objectContaining({ name: 'codex' }),
    },
  })
  expect(execution.workflow.roles.implementer).toBe(
    execution.workflow.roles.reviewer,
  )
})

test('loadWorkflowExecution selects the pull-request preset when workflow.mode is pull-request', async () => {
  const context = createContext()
  mockState.config = {
    workflow: {
      mode: 'pull-request',
      roles: {
        implementer: { provider: 'codex' },
        reviewer: { provider: 'codex' },
      },
    },
  }

  const execution = await loadWorkflowExecution(context)

  expect(execution.config).toEqual(mockState.config)
  expect(mockState.codexInstances).toHaveLength(1)
  expect(execution.workflow).toMatchObject({
    preset: {
      mode: 'pull-request',
    },
    roles: {
      implementer: expect.objectContaining({ name: 'codex' }),
      reviewer: expect.objectContaining({ name: 'codex' }),
    },
  })
})

test('loadWorkflowExecution rejects unsupported remote reviewers in pull-request mode', async () => {
  const context = createContext()
  mockState.config = {
    workflow: {
      mode: 'pull-request',
      roles: {
        implementer: { provider: 'codex' },
        reviewer: { provider: 'claude' },
      },
    },
  }

  await expect(loadWorkflowExecution(context)).rejects.toThrow(
    /claude remote reviewer is not implemented in pull-request mode/i,
  )

  expect(mockState.codexInstances).toHaveLength(1)
})

test('loadWorkflowExecution returns an executable plan with resolved config', async () => {
  const context = createContext()

  const execution = await loadWorkflowExecution(context, {
    untilTaskId: 'T003',
  })

  expect(execution.config).toEqual(mockState.config)
  expect(execution.workflow).toMatchObject({
    preset: {
      mode: 'direct',
    },
    roles: {
      implementer: expect.objectContaining({ name: 'codex' }),
      reviewer: expect.objectContaining({ name: 'codex' }),
    },
  })

  await execution.execute()

  expect(mockState.runWorkflowCalls[0]).toMatchObject({
    graph: mockState.graph,
    runtime: mockState.runtime,
    untilTaskId: 'T003',
    workflow: execution.workflow,
  })
  expect(mockState.runWorkflowCalls[0]).not.toHaveProperty('agent')
})
