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

test('pull-request integrate treats an already merged pull request as completed during resume', async () => {
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
    getHeadSubject: vi.fn(async () => 'Task T001: Implement greeting'),
    getHeadTimestamp: vi.fn(async () => '2026-03-25T08:01:00.000Z'),
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
    createPullRequest: vi.fn(async () => ({
      number: 12,
      title: 'Task T001: Implement greeting',
      url: 'https://example.com/pr/12',
    })),
    findMergedPullRequestByHeadBranch: vi.fn(async () => ({
      mergeCommitSha: 'merged-sha',
      number: 12,
      title: 'Task T001: Implement greeting',
      url: 'https://example.com/pr/12',
    })),
    squashMergePullRequest: vi.fn(async () => ({
      commitSha: 'should-not-run',
    })),
  }
  const workspace = {
    isTaskChecked: vi.fn(async () => true),
    updateTaskChecks: vi.fn(async () => {}),
    loadTaskContext: vi.fn(async () => ({
      codeContext: '',
      plan: '# plan\n',
      spec: '# spec\n',
      tasksSnippet: '- [X] T001 Implement greeting\n',
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

  expect(github.findOpenPullRequestByHeadBranch).toHaveBeenCalledWith({
    headBranch: 'task/t001-implement-greeting',
  })
  expect(github.findMergedPullRequestByHeadBranch).toHaveBeenCalledWith({
    headBranch: 'task/t001-implement-greeting',
  })
  expect(github.squashMergePullRequest).not.toHaveBeenCalled()
  expect(git.checkoutBranch).toHaveBeenCalledWith('main')
  expect(git.deleteLocalBranch).toHaveBeenCalledWith(
    'task/t001-implement-greeting',
  )
  expect(result).toEqual({
    kind: 'completed',
    result: {
      commitSha: 'merged-sha',
      summary: 'already integrated',
    },
  })
})
