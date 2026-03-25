import { expect, test, vi } from 'vitest'

import { createPullRequestWorkflowPreset } from '../src/workflow/pull-request-preset'
import {
  createGraph,
  createImplement,
  createReview,
  createVerify,
} from './workflow-test-helpers'

import type { RemoteReviewerProvider } from '../src/agents/types'
import type {
  OrchestratorRuntime,
  PullRequestSnapshot,
} from '../src/core/runtime'

function createSnapshot(
  input: Partial<PullRequestSnapshot> = {},
): PullRequestSnapshot {
  return {
    changedFiles: ['src/greeting.ts'],
    discussionComments: [],
    reactions: [],
    reviewSummaries: [],
    reviewThreads: [],
    ...input,
  }
}

test('pull-request preset creates a fresh checkpoint commit on the first review pass even when there is no local diff', async () => {
  const task = createGraph().tasks[0]!
  const reviewer: RemoteReviewerProvider = {
    name: 'codex',
    evaluatePullRequestReview: vi.fn(async () => ({
      kind: 'approved' as const,
      review: createReview('T001', 'buildGreeting works'),
    })),
  }
  const preset = createPullRequestWorkflowPreset({ reviewer })
  const git = {
    checkoutBranch: vi.fn(async () => {}),
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'checkpoint-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'main'),
    getHeadSha: vi.fn(async () => 'checkpoint-sha'),
    getHeadSubject: vi.fn(async () => 'Task T001: Implement greeting'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:05:00.000Z'),
    getParentCommit: vi.fn(async () => 'parent-sha'),
    isAncestorOfHead: vi.fn(async () => true),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
    resetHard: vi.fn(async () => {}),
  }
  const github = {
    findOpenPullRequestByHeadBranch: vi.fn(async () => null),
    getPullRequestSnapshot: vi.fn(async () => createSnapshot()),
    squashMergePullRequest: vi.fn(async () => ({ commitSha: 'merged-sha' })),
    createPullRequest: vi.fn(async () => ({
      number: 12,
      title: 'Task T001: Implement greeting',
      url: 'https://example.com/pr/12',
    })),
  }
  const workspace = {
    isTaskChecked: vi.fn(async () => false),
    updateTaskChecks: vi.fn(async () => {}),
    loadTaskContext: vi.fn(async () => ({
      codeContext: '',
      plan: '# plan\n',
      spec: '# spec\n',
      tasksSnippet: '- [ ] T001 Implement greeting\n',
    })),
  }
  const runtime = {
    git,
    github,
    store: {},
    verifier: {},
    workspace,
  } as unknown as OrchestratorRuntime

  const result = await preset.review({
    actualChangedFiles: ['src/greeting.ts'],
    attempt: 2,
    commitMessage: 'Task T001: Implement greeting',
    generation: 1,
    implement: createImplement('T001', 'src/greeting.ts'),
    lastFindings: [],
    runtime,
    task,
    verify: createVerify('T001', true),
    taskContext: {
      codeContext: '',
      plan: '# plan\n',
      spec: '# spec\n',
      tasksSnippet: '- [ ] T001 Implement greeting\n',
    },
  })

  expect(result.kind).toBe('approved')
  expect(git.commitTask).toHaveBeenCalledWith({
    message: 'checkpoint: Task T001: Implement greeting (attempt 2)',
  })
  expect(git.pushBranch).toHaveBeenCalledWith('task/t001-implement-greeting')
})

test('pull-request preset reuses the head checkpoint for the same review attempt without creating another commit', async () => {
  const task = createGraph().tasks[0]!
  const reviewer: RemoteReviewerProvider = {
    name: 'codex',
    evaluatePullRequestReview: vi.fn(async () => ({
      kind: 'approved' as const,
      review: createReview('T001', 'buildGreeting works'),
    })),
  }
  const preset = createPullRequestWorkflowPreset({ reviewer })
  const git = {
    checkoutBranch: vi.fn(async () => {}),
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'checkpoint-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'main'),
    getHeadSha: vi.fn(async () => 'checkpoint-sha'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:05:00.000Z'),
    getParentCommit: vi.fn(async () => 'parent-sha'),
    isAncestorOfHead: vi.fn(async () => true),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
    resetHard: vi.fn(async () => {}),
    getHeadSubject: vi.fn(
      async () => 'checkpoint: Task T001: Implement greeting (attempt 2)',
    ),
  }
  const github = {
    getPullRequestSnapshot: vi.fn(async () => createSnapshot()),
    squashMergePullRequest: vi.fn(async () => ({ commitSha: 'merged-sha' })),
    createPullRequest: vi.fn(async () => ({
      number: 12,
      title: 'Task T001: Implement greeting',
      url: 'https://example.com/pr/12',
    })),
    findOpenPullRequestByHeadBranch: vi.fn(async () => ({
      number: 12,
      title: 'Task T001: Implement greeting',
      url: 'https://example.com/pr/12',
    })),
  }
  const workspace = {
    isTaskChecked: vi.fn(async () => false),
    updateTaskChecks: vi.fn(async () => {}),
    loadTaskContext: vi.fn(async () => ({
      codeContext: '',
      plan: '# plan\n',
      spec: '# spec\n',
      tasksSnippet: '- [ ] T001 Implement greeting\n',
    })),
  }
  const runtime = {
    git,
    github,
    store: {},
    verifier: {},
    workspace,
  } as unknown as OrchestratorRuntime

  const result = await preset.review({
    actualChangedFiles: ['src/greeting.ts'],
    attempt: 2,
    commitMessage: 'Task T001: Implement greeting',
    generation: 1,
    implement: createImplement('T001', 'src/greeting.ts'),
    lastFindings: [],
    runtime,
    task,
    verify: createVerify('T001', true),
    taskContext: {
      codeContext: '',
      plan: '# plan\n',
      spec: '# spec\n',
      tasksSnippet: '- [ ] T001 Implement greeting\n',
    },
  })

  expect(result.kind).toBe('approved')
  expect(git.commitTask).not.toHaveBeenCalled()
  expect(git.pushBranch).toHaveBeenCalledWith('task/t001-implement-greeting')
})
