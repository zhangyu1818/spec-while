import { expect, test, vi } from 'vitest'

import { GitHubRuntime } from '../src/runtime/github'
import { parseSnapshotPage } from '../src/runtime/github-pr-snapshot-decode'
import {
  createPullRequestConnectionPage,
  createThreadCommentsPage,
  makeFile,
  makeIssueComment,
  makeReaction,
  makeReview,
  makeThread,
} from './github-runtime-test-helpers'

test('GitHubRuntime fails fast when a requested top-level GraphQL connection is missing', async () => {
  const runGh = vi.fn(async () =>
    JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            files: {
              nodes: [],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
            reactions: {
              nodes: [],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
            reviews: {
              nodes: [],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
          },
        },
      },
    }),
  )

  const runtime = new GitHubRuntime('/tmp/workspace', runGh, 'acme/repo')

  await expect(
    runtime.getPullRequestSnapshot({
      pullRequestNumber: 12,
    }),
  ).rejects.toThrow(/missing graphql connection: comments/i)
})

test('GitHubRuntime fails fast when repository.pullRequest is missing', async () => {
  const runGh = vi.fn(async () =>
    JSON.stringify({
      data: {
        repository: {},
      },
    }),
  )

  const runtime = new GitHubRuntime('/tmp/workspace', runGh, 'acme/repo')

  await expect(
    runtime.getPullRequestSnapshot({
      pullRequestNumber: 12,
    }),
  ).rejects.toThrow(/missing graphql node: repository\.pullRequest/i)
})

test('parseSnapshotPage rejects pageInfo that reports hasNextPage without an endCursor', () => {
  expect(() =>
    parseSnapshotPage(
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              comments: {
                nodes: [],
                pageInfo: {
                  endCursor: null,
                  hasNextPage: true,
                },
              },
            },
          },
        },
      }),
      {
        comments: true,
        files: false,
        reactions: false,
        reviews: false,
        reviewThreads: false,
      },
    ),
  ).toThrow(/comments\.pageInfo\.endCursor/i)
})

test('GitHubRuntime paginates all top-level GraphQL connections', async () => {
  const runGh = vi
    .fn()
    .mockResolvedValueOnce(
      createPullRequestConnectionPage({
        files: Array.from({ length: 100 }, (_, index) => makeFile(index + 1)),
        comments: Array.from({ length: 100 }, (_, index) =>
          makeIssueComment(index + 1),
        ),
        commentsPageInfo: {
          endCursor: 'comments-cursor-1',
          hasNextPage: true,
        },
        filesPageInfo: {
          endCursor: 'files-cursor-1',
          hasNextPage: true,
        },
        reactions: Array.from({ length: 100 }, (_, index) =>
          makeReaction(index + 1),
        ),
        reactionsPageInfo: {
          endCursor: 'reactions-cursor-1',
          hasNextPage: true,
        },
        reviews: Array.from({ length: 100 }, (_, index) =>
          makeReview(index + 1),
        ),
        reviewsPageInfo: {
          endCursor: 'reviews-cursor-1',
          hasNextPage: true,
        },
        reviewThreads: Array.from({ length: 100 }, (_, index) =>
          makeThread(index + 1),
        ),
        reviewThreadsPageInfo: {
          endCursor: 'threads-cursor-1',
          hasNextPage: true,
        },
      }),
    )
    .mockResolvedValueOnce(
      createPullRequestConnectionPage({
        comments: [makeIssueComment(101)],
        files: [makeFile(101)],
        reactions: [makeReaction(101)],
        reviews: [makeReview(101)],
        reviewThreads: [makeThread(101)],
        commentsPageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
        filesPageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
        reactionsPageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
        reviewsPageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
        reviewThreadsPageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
      }),
    )

  const runtime = new GitHubRuntime('/tmp/workspace', runGh, 'acme/repo')
  const snapshot = await runtime.getPullRequestSnapshot({
    pullRequestNumber: 12,
  })

  expect(snapshot.changedFiles).toHaveLength(101)
  expect(snapshot.reactions).toHaveLength(101)
  expect(snapshot.reviewSummaries).toHaveLength(101)
  expect(snapshot.discussionComments).toHaveLength(101)
  expect(snapshot.reviewThreads).toHaveLength(101)
})

test('GitHubRuntime paginates nested review thread comments', async () => {
  const initialComments = Array.from({ length: 100 }, (_, index) => ({
    author: { login: 'chatgpt-codex-connector[bot]' },
    body: `thread-comment-${index + 1}`,
    createdAt: `2026-03-25T11:${String(index % 60).padStart(2, '0')}:00.000Z`,
    line: index + 1,
    path: 'src/thread.ts',
    url: `https://github.com/acme/repo/pull/12#discussion_r${index + 1}`,
  }))
  const runGh = vi
    .fn()
    .mockResolvedValueOnce(
      createPullRequestConnectionPage({
        reviewThreads: [
          {
            id: 'thread-1',
            isOutdated: false,
            isResolved: false,
            comments: {
              nodes: initialComments,
              pageInfo: {
                endCursor: 'thread-comments-cursor-1',
                hasNextPage: true,
              },
            },
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      createThreadCommentsPage({
        endCursor: null,
        hasNextPage: false,
        threadId: 'thread-1',
        comments: [
          {
            author: { login: 'chatgpt-codex-connector[bot]' },
            body: 'thread-comment-101',
            createdAt: '2026-03-25T12:00:00.000Z',
            line: 101,
            path: 'src/thread.ts',
            url: 'https://github.com/acme/repo/pull/12#discussion_r101',
          },
        ],
      }),
    )

  const runtime = new GitHubRuntime('/tmp/workspace', runGh, 'acme/repo')
  const snapshot = await runtime.getPullRequestSnapshot({
    pullRequestNumber: 12,
  })

  expect(snapshot.reviewThreads).toHaveLength(1)
  expect(snapshot.reviewThreads[0]?.comments).toHaveLength(101)
  expect(snapshot.reviewThreads[0]?.comments.at(-1)?.body).toBe(
    'thread-comment-101',
  )
})

test('GitHubRuntime fails fast when a review thread comments page is malformed', async () => {
  const runGh = vi
    .fn()
    .mockResolvedValueOnce(
      createPullRequestConnectionPage({
        reviewThreads: [
          {
            id: 'thread-1',
            isOutdated: false,
            isResolved: false,
            comments: {
              nodes: [
                {
                  author: { login: 'chatgpt-codex-connector[bot]' },
                  body: 'thread-comment-1',
                  createdAt: '2026-03-25T11:00:00.000Z',
                  line: 1,
                  path: 'src/thread.ts',
                  url: 'https://github.com/acme/repo/pull/12#discussion_r1',
                },
              ],
              pageInfo: {
                endCursor: 'thread-comments-cursor-1',
                hasNextPage: true,
              },
            },
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      JSON.stringify({
        data: {
          node: {},
        },
      }),
    )

  const runtime = new GitHubRuntime('/tmp/workspace', runGh, 'acme/repo')

  await expect(
    runtime.getPullRequestSnapshot({
      pullRequestNumber: 12,
    }),
  ).rejects.toThrow(/missing graphql connection: reviewThread\.comments/i)
})
