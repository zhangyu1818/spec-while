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
  const git = createGitPortStub({
    checkoutBranch: vi.fn(async () => {}),
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'checkpoint-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'main'),
    getHeadSha: vi.fn(async () => 'checkpoint-sha'),
    getHeadSubject: vi.fn(async () => 'Task T001: Implement greeting'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:05:00.000Z'),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
  })
  const github = createGitHubPortStub({
    findOpenPullRequestByHeadBranch: vi.fn(async () => null),
    getPullRequestSnapshot: vi.fn(async () => createSnapshot()),
    squashMergePullRequest: vi.fn(async () => ({ commitSha: 'merged-sha' })),
    createPullRequest: vi.fn(async () => ({
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
    attempt: 2,
    commitMessage: 'Task T001: Implement greeting',
    completionCriteria: ['buildGreeting works'],
    runtime,
    taskHandle: task.handle,
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
  const git = createGitPortStub({
    checkoutBranch: vi.fn(async () => {}),
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'checkpoint-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'main'),
    getHeadSha: vi.fn(async () => 'checkpoint-sha'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:05:00.000Z'),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
    getHeadSubject: vi.fn(
      async () => 'checkpoint: Task T001: Implement greeting (attempt 2)',
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
    attempt: 2,
    commitMessage: 'Task T001: Implement greeting',
    completionCriteria: ['buildGreeting works'],
    runtime,
    taskHandle: task.handle,
  })

  expect(result.kind).toBe('approved')
  expect(git.commitTask).not.toHaveBeenCalled()
  expect(git.pushBranch).toHaveBeenCalledWith('task/t001-implement-greeting')
})
