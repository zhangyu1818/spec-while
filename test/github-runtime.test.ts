import { expect, expectTypeOf, test, vi } from 'vitest'

import { GitHubRuntime } from '../src/runtime/github'
import { createPullRequestConnectionPage } from './github-runtime-test-helpers'

import type { PullRequestSnapshot } from '../src/core/runtime'

test('GitHubRuntime finds an open pull request by head branch', async () => {
  const runGh = vi.fn(async () =>
    JSON.stringify([
      {
        headRefName: 'task/t001-do-work',
        number: 12,
        title: 'Task T001: Do work',
        url: 'https://github.com/acme/repo/pull/12',
        headRepositoryOwner: {
          login: 'acme',
        },
      },
    ]),
  )
  const runtime = new GitHubRuntime('/tmp/workspace', runGh, 'acme/repo')

  const result = await runtime.findOpenPullRequestByHeadBranch({
    headBranch: 'task/t001-do-work',
  })

  expect(result).toEqual({
    number: 12,
    title: 'Task T001: Do work',
    url: 'https://github.com/acme/repo/pull/12',
  })
  expect(runGh).toHaveBeenCalledWith([
    'pr',
    'list',
    '--head',
    'task/t001-do-work',
    '--state',
    'open',
    '--json',
    'number,title,url,headRefName,headRepositoryOwner',
  ])
})

test('GitHubRuntime returns null when no open pull request matches the head branch', async () => {
  const runtime = new GitHubRuntime(
    '/tmp/workspace',
    vi.fn(async () => JSON.stringify([])),
    'acme/repo',
  )

  await expect(
    runtime.findOpenPullRequestByHeadBranch({
      headBranch: 'task/t001-do-work',
    }),
  ).resolves.toBeNull()
})

test('GitHubRuntime finds a merged pull request by head branch and returns its merge commit sha', async () => {
  const runGh = vi.fn(async () =>
    JSON.stringify([
      {
        headRefName: 'task/t001-do-work',
        number: 12,
        title: 'Task T001: Do work',
        url: 'https://github.com/acme/repo/pull/12',
        headRepositoryOwner: {
          login: 'acme',
        },
        mergeCommit: {
          oid: 'merged-sha',
        },
      },
    ]),
  )
  const runtime = new GitHubRuntime('/tmp/workspace', runGh, 'acme/repo')

  const result = await runtime.findMergedPullRequestByHeadBranch({
    headBranch: 'task/t001-do-work',
  })

  expect(result).toEqual({
    mergeCommitSha: 'merged-sha',
    number: 12,
    title: 'Task T001: Do work',
    url: 'https://github.com/acme/repo/pull/12',
  })
  expect(runGh).toHaveBeenCalledWith([
    'pr',
    'list',
    '--head',
    'task/t001-do-work',
    '--state',
    'merged',
    '--json',
    'number,title,url,mergeCommit,headRefName,headRepositoryOwner',
  ])
})

test('GitHubRuntime ignores open pull requests from forks with the same branch name', async () => {
  const runGh = vi.fn(async () =>
    JSON.stringify([
      {
        headRefName: 'task/t001-do-work',
        number: 88,
        title: 'Fork PR',
        url: 'https://github.com/acme/repo/pull/88',
        headRepositoryOwner: {
          login: 'other-user',
        },
      },
      {
        headRefName: 'task/t001-do-work',
        number: 12,
        title: 'Task T001: Do work',
        url: 'https://github.com/acme/repo/pull/12',
        headRepositoryOwner: {
          login: 'acme',
        },
      },
    ]),
  )
  const runtime = new GitHubRuntime('/tmp/workspace', runGh, 'acme/repo')

  const result = await runtime.findOpenPullRequestByHeadBranch({
    headBranch: 'task/t001-do-work',
  })

  expect(result).toEqual({
    number: 12,
    title: 'Task T001: Do work',
    url: 'https://github.com/acme/repo/pull/12',
  })
})

test('GitHubRuntime ignores merged pull requests from forks with the same branch name', async () => {
  const runGh = vi.fn(async () =>
    JSON.stringify([
      {
        headRefName: 'task/t001-do-work',
        number: 88,
        title: 'Fork PR',
        url: 'https://github.com/acme/repo/pull/88',
        headRepositoryOwner: {
          login: 'other-user',
        },
        mergeCommit: {
          oid: 'fork-merged-sha',
        },
      },
      {
        headRefName: 'task/t001-do-work',
        number: 12,
        title: 'Task T001: Do work',
        url: 'https://github.com/acme/repo/pull/12',
        headRepositoryOwner: {
          login: 'acme',
        },
        mergeCommit: {
          oid: 'merged-sha',
        },
      },
    ]),
  )
  const runtime = new GitHubRuntime('/tmp/workspace', runGh, 'acme/repo')

  const result = await runtime.findMergedPullRequestByHeadBranch({
    headBranch: 'task/t001-do-work',
  })

  expect(result).toEqual({
    mergeCommitSha: 'merged-sha',
    number: 12,
    title: 'Task T001: Do work',
    url: 'https://github.com/acme/repo/pull/12',
  })
})

test('GitHubRuntime builds a pull request snapshot from GraphQL responses only', async () => {
  const runGh = vi.fn().mockResolvedValueOnce(
    createPullRequestConnectionPage({
      comments: [
        {
          author: { login: 'chatgpt-codex-connector[bot]' },
          body: 'please confirm timeout semantics',
          createdAt: '2026-03-25T07:58:00.000Z',
          databaseId: 301,
          url: 'https://github.com/acme/repo/issues/12#issuecomment-301',
        },
      ],
      files: [
        { path: 'src/workflow/preset.ts' },
        { path: 'src/commands/run.ts' },
      ],
      reactions: [
        {
          content: 'THUMBS_UP',
          createdAt: '2026-03-25T08:00:00.000Z',
          user: { login: 'chatgpt-codex-connector[bot]' },
        },
      ],
      reviews: [
        {
          author: { login: 'chatgpt-codex-connector[bot]' },
          body: 'please tighten this',
          fullDatabaseId: 101,
          state: 'COMMENTED',
          submittedAt: '2026-03-25T07:50:00.000Z',
          url: 'https://github.com/acme/repo/pull/12#pullrequestreview-101',
        },
      ],
      reviewThreads: [
        {
          id: 'thread-1',
          isOutdated: false,
          isResolved: false,
          comments: {
            nodes: [
              {
                author: { login: 'chatgpt-codex-connector[bot]' },
                body: 'needs one more fix',
                createdAt: '2026-03-25T07:57:00.000Z',
                line: 33,
                path: 'src/workflow/preset.ts',
                url: 'https://github.com/acme/repo/pull/12#discussion_r201',
              },
            ],
            pageInfo: {
              endCursor: null,
              hasNextPage: false,
            },
          },
        },
      ],
    }),
  )

  const runtime = new GitHubRuntime('/tmp/workspace', runGh, 'acme/repo')
  const snapshot = await runtime.getPullRequestSnapshot({
    pullRequestNumber: 12,
  })

  expect(snapshot.changedFiles).toEqual([
    'src/workflow/preset.ts',
    'src/commands/run.ts',
  ])
  expect(snapshot.reactions).toHaveLength(1)
  expect(snapshot.reviewSummaries).toHaveLength(1)
  expect(snapshot.discussionComments).toEqual([
    {
      id: 301,
      body: 'please confirm timeout semantics',
      createdAt: '2026-03-25T07:58:00.000Z',
      url: 'https://github.com/acme/repo/issues/12#issuecomment-301',
      userLogin: 'chatgpt-codex-connector[bot]',
    },
  ])
  expect(snapshot.reviewThreads).toHaveLength(1)
  expect(runGh).not.toHaveBeenCalledWith(
    expect.arrayContaining([`repos/acme/repo/pulls/12/files`]),
  )
  expect(runGh).not.toHaveBeenCalledWith(
    expect.arrayContaining([`repos/acme/repo/issues/12/reactions`]),
  )
  expect(runGh).not.toHaveBeenCalledWith(
    expect.arrayContaining([`repos/acme/repo/pulls/12/reviews`]),
  )
  expect(runGh).not.toHaveBeenCalledWith(
    expect.arrayContaining([`repos/acme/repo/issues/12/comments`]),
  )
})

test('PullRequestSnapshot no longer exposes reviewComments', () => {
  type SnapshotHasReviewComments = PullRequestSnapshot extends {
    reviewComments: unknown
  }
    ? true
    : false

  expectTypeOf<SnapshotHasReviewComments>().toEqualTypeOf<false>()
})

test('GitHubRuntime merges pull requests via API and returns the merge commit sha', async () => {
  const runGh = vi.fn(async () =>
    JSON.stringify({
      merged: true,
      message: 'Pull Request successfully merged',
      sha: 'merged-sha',
    }),
  )
  const runtime = new GitHubRuntime('/tmp/workspace', runGh, 'acme/repo')

  const result = await runtime.squashMergePullRequest({
    pullRequestNumber: 12,
    subject: 'Task T001: Do work',
  })

  expect(result).toEqual({ commitSha: 'merged-sha' })
  expect(runGh).toHaveBeenCalledWith([
    'api',
    'repos/acme/repo/pulls/12/merge',
    '--method',
    'PUT',
    '-f',
    'merge_method=squash',
    '-f',
    'commit_title=Task T001: Do work',
  ])
})
