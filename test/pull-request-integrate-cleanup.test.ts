import { expect, test, vi } from 'vitest'

import { createPullRequestWorkflowPreset } from '../src/workflow/pull-request-preset'
import {
  createGitHubPortStub,
  createGitPortStub,
  createOrchestratorRuntimeStub,
  createTaskSourceSessionStub,
} from './orchestrator-runtime-test-helpers'

import type { RemoteReviewerProvider } from '../src/agents/types'
import type { PullRequestSnapshot } from '../src/core/runtime'

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
  const git = createGitPortStub({
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'finalize-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'task/t001-implement-greeting'),
    getHeadSha: vi.fn(async () => 'local-head-sha'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:01:00.000Z'),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
    checkoutBranch: vi.fn(async () => {
      throw new Error('checkout main failed')
    }),
  })
  const github = createGitHubPortStub({
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
  })
  const taskSource = createTaskSourceSessionStub({
    applyTaskCompletion: vi.fn(async () => {}),
    isTaskCompleted: vi.fn(async () => false),
    revertTaskCompletion: vi.fn(async () => {}),
  })
  const runtime = createOrchestratorRuntimeStub({
    git,
    github,
    taskSource,
  })

  const result = await preset.integrate({
    commitMessage: 'Task T001: Implement greeting',
    runtime,
    taskHandle: 'T001',
  })

  expect(github.squashMergePullRequest).toHaveBeenCalledWith({
    pullRequestNumber: 12,
    subject: 'Task T001: Implement greeting',
  })
  expect(result.result.commitSha).toBe('merged-sha')
  expect(result.result.summary).toMatch(/local cleanup warning/i)
  expect(git.deleteLocalBranch).not.toHaveBeenCalled()
})
