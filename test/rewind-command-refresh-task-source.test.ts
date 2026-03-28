import { beforeEach, expect, test, vi } from 'vitest'

import type { OrchestratorRuntime } from '../src/core/runtime'
import type { TaskSourceSession } from '../src/task-sources/types'
import type { WorkspaceContext } from '../src/types'
import type { WorkflowConfig } from '../src/workflow/config'

const mockState = vi.hoisted(() => {
  const staleTaskSource: TaskSourceSession = {
    applyTaskCompletion: vi.fn(async () => {}),
    buildReviewPrompt: vi.fn(async () => ({ instructions: [], sections: [] })),
    getCompletionCriteria: vi.fn(async () => []),
    getTaskDependencies: vi.fn(() => []),
    isTaskCompleted: vi.fn(async () => false),
    listTasks: vi.fn(() => ['T001']),
    resolveTaskSelector: vi.fn((selector: string) => selector),
    revertTaskCompletion: vi.fn(async () => {}),
    buildCommitSubject: vi.fn(
      (taskHandle: string) => `Task ${taskHandle}: stale`,
    ),
    buildImplementPrompt: vi.fn(async () => ({
      instructions: [],
      sections: [],
    })),
  }
  const freshTaskSource: TaskSourceSession = {
    applyTaskCompletion: vi.fn(async () => {}),
    buildReviewPrompt: vi.fn(async () => ({ instructions: [], sections: [] })),
    getCompletionCriteria: vi.fn(async () => []),
    getTaskDependencies: vi.fn(() => []),
    isTaskCompleted: vi.fn(async () => false),
    listTasks: vi.fn(() => ['T010']),
    resolveTaskSelector: vi.fn((selector: string) => selector),
    revertTaskCompletion: vi.fn(async () => {}),
    buildCommitSubject: vi.fn(
      (taskHandle: string) => `Task ${taskHandle}: fresh`,
    ),
    buildImplementPrompt: vi.fn(async () => ({
      instructions: [],
      sections: [],
    })),
  }
  const runtime: OrchestratorRuntime = {
    taskSource: staleTaskSource,
    git: {
      checkoutBranch: vi.fn(async () => {}),
      checkoutRemoteBranch: vi.fn(async () => {}),
      commitTask: vi.fn(async () => ({ commitSha: 'commit-sha' })),
      deleteLocalBranch: vi.fn(async () => {}),
      getChangedFilesSinceHead: vi.fn(async () => []),
      getCurrentBranch: vi.fn(async () => 'main'),
      getHeadSha: vi.fn(async () => 'head-sha'),
      getHeadSubject: vi.fn(async () => 'Task T001: Demo'),
      getHeadTimestamp: vi.fn(async () => '2026-03-25T08:00:00.000Z'),
      getParentCommit: vi.fn(async () => 'parent-sha'),
      isAncestorOfHead: vi.fn(async () => false),
      pullFastForward: vi.fn(async () => {}),
      pushBranch: vi.fn(async () => {}),
      requireCleanWorktree: vi.fn(async () => {}),
      resetHard: vi.fn(async () => {}),
    },
    github: {
      findMergedPullRequestByHeadBranch: vi.fn(async () => null),
      findOpenPullRequestByHeadBranch: vi.fn(async () => null),
      squashMergePullRequest: vi.fn(async () => ({ commitSha: 'merged-sha' })),
      createPullRequest: vi.fn(async () => ({
        number: 1,
        title: 'Task T001: Demo',
        url: 'https://example.com/pr/1',
      })),
      getPullRequestSnapshot: vi.fn(async () => ({
        changedFiles: [],
        discussionComments: [],
        reactions: [],
        reviewSummaries: [],
        reviewThreads: [],
      })),
    },
    store: {
      appendEvent: vi.fn(async () => {}),
      loadGraph: vi.fn(async () => null),
      loadImplementArtifact: vi.fn(async () => null),
      loadReviewArtifact: vi.fn(async () => null),
      loadState: vi.fn(async () => null),
      readReport: vi.fn(async () => null),
      reset: vi.fn(async () => {}),
      saveGraph: vi.fn(async () => {}),
      saveImplementArtifact: vi.fn(async () => {}),
      saveIntegrateArtifact: vi.fn(async () => {}),
      saveReport: vi.fn(async () => {}),
      saveReviewArtifact: vi.fn(async () => {}),
      saveState: vi.fn(async () => {}),
    },
  }
  return {
    freshTaskSource,
    rewindCalls: [] as unknown[],
    runtime,
    staleTaskSource,
    config: {
      task: {
        maxIterations: 5,
        source: 'spec-kit',
      },
      workflow: {
        mode: 'direct',
        roles: {
          implementer: {
            provider: 'codex',
          },
          reviewer: {
            provider: 'codex',
          },
        },
      },
    } as WorkflowConfig,
    loadedGraph: null as
      | null
      | {
          commitSubject: string
          dependsOn: string[]
          handle: string
        }[],
  }
})

vi.mock('../src/workflow/config', () => {
  return {
    loadWorkflowConfig: vi.fn(async () => mockState.config),
  }
})

vi.mock('../src/task-sources/registry', () => {
  const openTaskSource = vi.fn(async () => {
    return openTaskSource.mock.calls.length === 1
      ? mockState.staleTaskSource
      : mockState.freshTaskSource
  })

  return {
    openTaskSource,
  }
})

vi.mock('../src/runtime/fs-runtime', () => {
  return {
    createOrchestratorRuntime: vi.fn(() => mockState.runtime),
  }
})

vi.mock('../src/core/orchestrator', () => {
  return {
    rewindTask: vi.fn(async (input) => {
      mockState.rewindCalls.push(input)
      const graph = await input.loadGraph()
      mockState.loadedGraph = graph.tasks
      return {
        currentTaskHandle: null,
        featureId: graph.featureId,
        tasks: {},
      }
    }),
  }
})

const { rewindCommand } = await import('../src/commands/rewind')

function createContext(): WorkspaceContext {
  return {
    featureDir: '/tmp/specs/001-demo',
    featureId: '001-demo',
    runtimeDir: '/tmp/specs/001-demo/.while',
    workspaceRoot: '/tmp',
  }
}

beforeEach(() => {
  mockState.loadedGraph = null
  mockState.rewindCalls = []
})

test('rewindCommand reopens the task source after reset before rebuilding topology', async () => {
  await rewindCommand(createContext(), 'T001')

  expect(mockState.loadedGraph).toEqual([
    {
      commitSubject: 'Task T010: fresh',
      dependsOn: [],
      handle: 'T010',
    },
  ])
})
