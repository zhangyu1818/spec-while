import { expect, test, vi } from 'vitest'

import { createPullRequestWorkflowPreset } from '../src/workflow/pull-request-preset'

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

function createUnusedReviewer(): RemoteReviewerProvider {
  return {
    name: 'codex',
    async evaluatePullRequestReview() {
      throw new Error('unused')
    },
  }
}

test('pull-request preset treats local cleanup failures after squash merge as non-fatal', async () => {
  const preset = createPullRequestWorkflowPreset({
    reviewer: createUnusedReviewer(),
  })
  const git = {
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'finalize-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'task/t001-implement-greeting'),
    getHeadSha: vi.fn(async () => 'local-head-sha'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:01:00.000Z'),
    getParentCommit: vi.fn(async () => 'parent-sha'),
    isAncestorOfHead: vi.fn(async () => true),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
    resetHard: vi.fn(async () => {}),
    checkoutBranch: vi.fn(async () => {
      throw new Error('checkout main failed')
    }),
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

  const result = await preset.integrate({
    commitMessage: 'Task T001: Implement greeting',
    runtime,
    taskId: 'T001',
  })

  expect(github.squashMergePullRequest).toHaveBeenCalledWith({
    pullRequestNumber: 12,
    subject: 'Task T001: Implement greeting',
  })
  expect(result.result.commitSha).toBe('merged-sha')
  expect(result.result.summary).toMatch(/local cleanup warning/i)
  expect(git.deleteLocalBranch).not.toHaveBeenCalled()
})
