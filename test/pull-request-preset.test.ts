import { expect, test, vi } from 'vitest'

import { createPullRequestWorkflowPreset } from '../src/workflow/pull-request-preset'
import {
  createGitHubPortStub,
  createGitPortStub,
  createOrchestratorRuntimeStub,
} from './orchestrator-runtime-test-helpers'
import { createGraph, createReview } from './workflow-test-helpers'

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

test('pull-request preset creates or reuses a PR and polls until approval', async () => {
  const task = createGraph().tasks[0]!
  const reviewer: RemoteReviewerProvider = {
    name: 'codex',
    evaluatePullRequestReview: vi
      .fn()
      .mockResolvedValueOnce({ kind: 'pending' as const })
      .mockResolvedValueOnce({
        kind: 'approved' as const,
        review: createReview('T001', 'buildGreeting works'),
      }),
  }
  const sleep = vi.fn(async () => {})
  const preset = createPullRequestWorkflowPreset({
    reviewer,
    sleep,
  })
  const git = createGitPortStub({
    checkoutBranch: vi.fn(async () => {}),
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'checkpoint-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => ['src/greeting.ts']),
    getCurrentBranch: vi.fn(async () => 'main'),
    getHeadSha: vi.fn(async () => 'checkpoint-sha'),
    getHeadSubject: vi.fn(async () => 'Task T001: Implement greeting'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:01:00.000Z'),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
  })
  const github = createGitHubPortStub({
    findOpenPullRequestByHeadBranch: vi.fn().mockResolvedValueOnce(null),
    squashMergePullRequest: vi.fn(async () => ({ commitSha: 'merged-sha' })),
    createPullRequest: vi.fn(async () => ({
      number: 12,
      title: 'Task T001: Implement greeting',
      url: 'https://example.com/pr/12',
    })),
    getPullRequestSnapshot: vi
      .fn()
      .mockResolvedValueOnce(createSnapshot())
      .mockResolvedValueOnce(createSnapshot()),
  })
  const runtime = createOrchestratorRuntimeStub({
    git,
    github,
  })

  const result = await preset.review({
    attempt: 1,
    commitMessage: 'Task T001: Implement greeting',
    completionCriteria: ['buildGreeting works'],
    runtime,
    taskHandle: task.handle,
  })

  expect(result.kind).toBe('approved')
  expect(git.commitTask).toHaveBeenCalledWith({
    message: 'checkpoint: Task T001: Implement greeting (attempt 1)',
  })
  expect(github.createPullRequest).toHaveBeenCalledTimes(1)
  expect(reviewer.evaluatePullRequestReview).toHaveBeenCalledTimes(2)
  expect(sleep).toHaveBeenCalledWith(60_000)
})

test('pull-request preset restores a missing local task branch from origin when an open PR exists', async () => {
  const task = createGraph().tasks[0]!
  const reviewer: RemoteReviewerProvider = {
    name: 'codex',
    evaluatePullRequestReview: vi.fn(async () => ({
      kind: 'approved' as const,
      review: createReview('T001', 'buildGreeting works'),
    })),
  }
  const preset = createPullRequestWorkflowPreset({ reviewer })
  const git = createGitPortStub({
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'checkpoint-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'main'),
    getHeadSha: vi.fn(async () => 'checkpoint-sha'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:01:00.000Z'),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
    checkoutBranch: vi
      .fn()
      .mockRejectedValueOnce(new Error('missing local branch')),
    getHeadSubject: vi.fn(
      async () => 'checkpoint: Task T001: Implement greeting (attempt 1)',
    ),
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
  const runtime = createOrchestratorRuntimeStub({
    git,
    github,
  })

  const result = await preset.review({
    attempt: 1,
    commitMessage: 'Task T001: Implement greeting',
    completionCriteria: ['buildGreeting works'],
    runtime,
    taskHandle: task.handle,
  })

  expect(result.kind).toBe('approved')
  expect(git.checkoutRemoteBranch).toHaveBeenCalledWith(
    'task/t001-implement-greeting',
  )
  expect(github.createPullRequest).not.toHaveBeenCalled()
  expect(git.commitTask).not.toHaveBeenCalled()
})
