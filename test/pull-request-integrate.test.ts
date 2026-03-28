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

test('pull-request preset finalizes and squashes an approved task branch', async () => {
  const preset = createPullRequestWorkflowPreset({
    reviewer: createUnusedReviewer(),
  })
  const git = createGitPortStub({
    checkoutBranch: vi.fn(async () => {}),
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'finalize-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'task/t001-implement-greeting'),
    getHeadSha: vi.fn(async () => 'merged-sha'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:01:00.000Z'),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
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

  expect(taskSource.isTaskCompleted).toHaveBeenCalledWith('T001')
  expect(taskSource.applyTaskCompletion).toHaveBeenCalledWith('T001')
  expect(git.commitTask).toHaveBeenCalledWith({
    message: 'Task T001: Implement greeting',
  })
  expect(git.pushBranch).toHaveBeenCalledWith('task/t001-implement-greeting')
  expect(github.squashMergePullRequest).toHaveBeenCalledWith({
    pullRequestNumber: 12,
    subject: 'Task T001: Implement greeting',
  })
  expect(git.checkoutBranch).toHaveBeenCalledWith('main')
  expect(git.pullFastForward).toHaveBeenCalledWith('main')
  expect(git.deleteLocalBranch).toHaveBeenCalledWith(
    'task/t001-implement-greeting',
  )
  expect(result.result.commitSha).toBe('merged-sha')
})

test('pull-request preset restores a missing local task branch from origin during integrate', async () => {
  const preset = createPullRequestWorkflowPreset({
    reviewer: createUnusedReviewer(),
  })
  const git = createGitPortStub({
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'finalize-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'main'),
    getHeadSha: vi.fn(async () => 'merged-sha'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:01:00.000Z'),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
    checkoutBranch: vi
      .fn()
      .mockRejectedValueOnce(new Error('missing local branch'))
      .mockResolvedValueOnce(undefined),
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

  expect(git.checkoutRemoteBranch).toHaveBeenCalledWith(
    'task/t001-implement-greeting',
  )
  expect(git.pushBranch).toHaveBeenCalledWith('task/t001-implement-greeting')
  expect(result.result.commitSha).toBe('merged-sha')
})

test('pull-request integrate rolls back the task checkbox when finalize commit fails', async () => {
  const preset = createPullRequestWorkflowPreset({
    reviewer: createUnusedReviewer(),
  })
  const git = createGitPortStub({
    checkoutBranch: vi.fn(async () => {}),
    checkoutRemoteBranch: vi.fn(async () => {}),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'task/t001-implement-greeting'),
    getHeadSha: vi.fn(async () => 'merged-sha'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:01:00.000Z'),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
    commitTask: vi.fn(async () => {
      throw new Error('commit exploded')
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
    isTaskCompleted: vi.fn(async () => false),
    revertTaskCompletion: vi.fn(async () => {}),
    applyTaskCompletion: vi.fn(async () => {
      throw new Error('commit exploded')
    }),
  })
  const runtime = createOrchestratorRuntimeStub({
    git,
    github,
    taskSource,
  })

  await expect(
    preset.integrate({
      commitMessage: 'Task T001: Implement greeting',
      runtime,
      taskHandle: 'T001',
    }),
  ).rejects.toThrow(/commit exploded/)
  expect(taskSource.applyTaskCompletion).toHaveBeenCalledWith('T001')
  expect(taskSource.revertTaskCompletion).toHaveBeenCalledWith('T001')
})
