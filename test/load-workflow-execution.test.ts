import { beforeEach, expect, test, vi } from 'vitest'

import {
  createOrchestratorRuntimeStub,
  createTaskSourceSessionStub,
} from './orchestrator-runtime-test-helpers'

import type { CodexAgentClientOptions } from '../src/agents/codex'
import type { ImplementerProvider, ReviewerProvider } from '../src/agents/types'
import type { TaskGraph, WorkspaceContext } from '../src/types'
import type {
  WorkflowConfig,
  WorkflowProvider,
  WorkflowRoleConfig,
} from '../src/workflow/config'

interface MockCodexInstance {
  options: CodexAgentClientOptions
  provider: ImplementerProvider & ReviewerProvider
}

function createConfig(input?: {
  implementer?: WorkflowProvider
  mode?: WorkflowConfig['workflow']['mode']
  reviewer?: WorkflowProvider
}): WorkflowConfig {
  return {
    task: {
      maxIterations: 5,
      source: 'spec-kit',
    },
    workflow: {
      mode: input?.mode ?? 'direct',
      roles: {
        implementer: createWorkflowRoleConfig(input?.implementer),
        reviewer: createWorkflowRoleConfig(input?.reviewer),
      },
    },
  }
}

function createWorkflowRoleConfig(
  provider: WorkflowProvider = 'codex',
): WorkflowRoleConfig {
  return {
    provider,
  }
}

const mockState = (() => {
  const taskSource = createTaskSourceSessionStub({
    applyTaskCompletion: vi.fn(async () => {}),
    buildCommitSubject: vi.fn(() => 'Task T001: Demo'),
    getCompletionCriteria: vi.fn(async () => []),
    getTaskDependencies: vi.fn(() => []),
    isTaskCompleted: vi.fn(async () => false),
    listTasks: vi.fn(() => []),
    resolveTaskSelector: vi.fn((selector: string) => selector),
    revertTaskCompletion: vi.fn(async () => {}),
    buildImplementPrompt: vi.fn(async () => ({
      instructions: [],
      sections: [],
    })),
    buildReviewPrompt: vi.fn(async () => ({
      instructions: [],
      sections: [],
    })),
  })
  const runtime = createOrchestratorRuntimeStub({
    taskSource,
    git: {
      requireCleanWorktree: vi.fn(async () => {}),
    },
  })
  return {
    callSequence: [] as string[],
    codexInstances: [] as MockCodexInstance[],
    config: createConfig(),
    openTaskSourceCalls: [] as unknown[],
    runtime,
    runWorkflowCalls: [] as unknown[],
    taskSource,
    workflowConfigCalls: [] as string[],
    workflowConfigError: null as Error | null,
    graph: {
      featureId: '001-demo',
      maxIterations: 5,
      tasks: [],
    } as TaskGraph,
  }
})()

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
    createCodexProvider: vi.fn((options: CodexAgentClientOptions) => {
      const provider: ImplementerProvider & ReviewerProvider = {
        name: 'codex',
        async implement() {
          return {
            assumptions: [],
            needsHumanAttention: false,
            notes: [],
            status: 'implemented' as const,
            summary: 'unused',
            taskHandle: 'T001',
            unresolvedItems: [],
          }
        },
        async review() {
          return {
            findings: [],
            overallRisk: 'low' as const,
            summary: 'unused',
            taskHandle: 'T001',
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
    }),
  }
})

vi.mock('../src/task-sources/registry', () => {
  return {
    openTaskSource: vi.fn(async (...args: unknown[]) => {
      mockState.openTaskSourceCalls.push(args)
      mockState.callSequence.push('task-source')
      return mockState.taskSource
    }),
  }
})

vi.mock('../src/core/task-topology', () => {
  return {
    buildTaskTopology: vi.fn(() => {
      mockState.callSequence.push('graph')
      return mockState.graph
    }),
  }
})

vi.mock('../src/runtime/fs-runtime', () => {
  return {
    createOrchestratorRuntime: vi.fn(() => {
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
          currentTaskHandle: null,
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
    runtimeDir: '/tmp/specs/001-demo/.while',
    workspaceRoot: '/tmp',
  }
}

beforeEach(() => {
  mockState.callSequence = []
  mockState.codexInstances = []
  mockState.config = createConfig()
  mockState.openTaskSourceCalls = []
  mockState.runWorkflowCalls = []
  mockState.workflowConfigError = null
  mockState.workflowConfigCalls = []
})

test('loadWorkflowExecution rejects claude providers before runtime setup because CLI has no adapter path', async () => {
  const context = createContext()
  mockState.config = createConfig({ implementer: 'claude' })

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
  mockState.config = createConfig({ mode: 'pull-request' })

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
  mockState.config = createConfig({
    mode: 'pull-request',
    reviewer: 'claude',
  })

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
    untilTaskHandle: 'T003',
    workflow: execution.workflow,
  })
  expect(mockState.runWorkflowCalls[0]).not.toHaveProperty('agent')
})
test('loadWorkflowExecution reuses preloaded config without re-reading while.yaml', async () => {
  const context = createContext()
  const config = createConfig()
  config.task.source = 'openspec'

  await loadWorkflowExecution(context, {
    config,
  })

  expect(mockState.workflowConfigCalls).toEqual([])
  expect(mockState.openTaskSourceCalls).toEqual([
    [
      'openspec',
      {
        featureDir: '/tmp/specs/001-demo',
        featureId: '001-demo',
        workspaceRoot: '/tmp',
      },
    ],
  ])
})
