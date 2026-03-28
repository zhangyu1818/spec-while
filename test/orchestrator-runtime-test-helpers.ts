import { vi } from 'vitest'

import type {
  GitHubPort,
  GitPort,
  OrchestratorRuntime,
  WorkflowStore,
} from '../src/core/runtime'
import type { TaskSourceSession } from '../src/task-sources/types'

export function createWorkflowStoreStub(
  overrides: Partial<WorkflowStore> = {},
): WorkflowStore {
  return {
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
    ...overrides,
  }
}

export function createTaskSourceSessionStub(
  overrides: Partial<TaskSourceSession> = {},
): TaskSourceSession {
  return {
    applyTaskCompletion: vi.fn(async () => {}),
    getCompletionCriteria: vi.fn(async () => []),
    getTaskDependencies: vi.fn(() => []),
    isTaskCompleted: vi.fn(async () => false),
    listTasks: vi.fn(() => []),
    resolveTaskSelector: vi.fn((selector: string) => selector),
    revertTaskCompletion: vi.fn(async () => {}),
    buildCommitSubject: vi.fn(
      (taskHandle: string) => `Task ${taskHandle}: Demo`,
    ),
    buildImplementPrompt: vi.fn(async () => ({
      instructions: [],
      sections: [],
    })),
    buildReviewPrompt: vi.fn(async () => ({
      instructions: [],
      sections: [],
    })),
    ...overrides,
  }
}

export function createGitPortStub(overrides: Partial<GitPort> = {}): GitPort {
  return {
    checkoutBranch: vi.fn(async () => {}),
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'commit-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'main'),
    getHeadSha: vi.fn(async () => 'head-sha'),
    getHeadSubject: vi.fn(async () => 'Task T001: Demo'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:00:00.000Z'),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
    ...overrides,
  }
}

export function createGitHubPortStub(
  overrides: Partial<GitHubPort> = {},
): GitHubPort {
  return {
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
    ...overrides,
  }
}

export function createOrchestratorRuntimeStub(input?: {
  git?: Partial<GitPort>
  github?: Partial<GitHubPort>
  store?: Partial<WorkflowStore>
  taskSource?: Partial<TaskSourceSession>
}): OrchestratorRuntime {
  return {
    git: createGitPortStub(input?.git),
    github: createGitHubPortStub(input?.github),
    store: createWorkflowStoreStub(input?.store),
    taskSource: createTaskSourceSessionStub(input?.taskSource),
  }
}
