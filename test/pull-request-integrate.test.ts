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

test('pull-request preset finalizes and squashes an approved task branch', async () => {
  const preset = createPullRequestWorkflowPreset({
    reviewer: createUnusedReviewer(),
  })
  const git = {
    checkoutBranch: vi.fn(async () => {}),
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'finalize-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'task/t001-implement-greeting'),
    getHeadSha: vi.fn(async () => 'merged-sha'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:01:00.000Z'),
    getParentCommit: vi.fn(async () => 'parent-sha'),
    isAncestorOfHead: vi.fn(async () => true),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
    resetHard: vi.fn(async () => {}),
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

  expect(workspace.isTaskChecked).toHaveBeenCalledWith('T001')
  expect(workspace.updateTaskChecks).toHaveBeenCalledWith([
    { checked: true, taskId: 'T001' },
  ])
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
  const git = {
    checkoutRemoteBranch: vi.fn(async () => {}),
    commitTask: vi.fn(async () => ({ commitSha: 'finalize-sha' })),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'main'),
    getHeadSha: vi.fn(async () => 'merged-sha'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:01:00.000Z'),
    getParentCommit: vi.fn(async () => 'parent-sha'),
    isAncestorOfHead: vi.fn(async () => true),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
    resetHard: vi.fn(async () => {}),
    checkoutBranch: vi
      .fn()
      .mockRejectedValueOnce(new Error('missing local branch'))
      .mockResolvedValueOnce(undefined),
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
  const git = {
    checkoutBranch: vi.fn(async () => {}),
    checkoutRemoteBranch: vi.fn(async () => {}),
    deleteLocalBranch: vi.fn(async () => {}),
    getChangedFilesSinceHead: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'task/t001-implement-greeting'),
    getHeadSha: vi.fn(async () => 'merged-sha'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:01:00.000Z'),
    getParentCommit: vi.fn(async () => 'parent-sha'),
    isAncestorOfHead: vi.fn(async () => true),
    pullFastForward: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    requireCleanWorktree: vi.fn(async () => {}),
    resetHard: vi.fn(async () => {}),
    commitTask: vi.fn(async () => {
      throw new Error('commit exploded')
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
    loadTaskContext: vi.fn(async () => ({
      codeContext: '',
      plan: '# plan\n',
      spec: '# spec\n',
      tasksSnippet: '- [ ] T001 Implement greeting\n',
    })),
    updateTaskChecks: vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined),
  }
  const runtime = {
    git,
    github,
    store: {},
    verifier: {},
    workspace,
  } as unknown as OrchestratorRuntime

  await expect(
    preset.integrate({
      commitMessage: 'Task T001: Implement greeting',
      runtime,
      taskId: 'T001',
    }),
  ).rejects.toThrow(/commit exploded/)

  expect(workspace.updateTaskChecks).toHaveBeenNthCalledWith(1, [
    { checked: true, taskId: 'T001' },
  ])
  expect(workspace.updateTaskChecks).toHaveBeenNthCalledWith(2, [
    { checked: false, taskId: 'T001' },
  ])
})
