export function createPullRequestConnectionPage(input: {
  comments?: unknown[]
  commentsPageInfo?: { endCursor: null | string; hasNextPage: boolean }
  files?: unknown[]
  filesPageInfo?: { endCursor: null | string; hasNextPage: boolean }
  reactions?: unknown[]
  reactionsPageInfo?: { endCursor: null | string; hasNextPage: boolean }
  reviews?: unknown[]
  reviewsPageInfo?: { endCursor: null | string; hasNextPage: boolean }
  reviewThreads?: unknown[]
  reviewThreadsPageInfo?: { endCursor: null | string; hasNextPage: boolean }
}) {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          comments: {
            nodes: input.comments ?? [],
            pageInfo: input.commentsPageInfo ?? {
              endCursor: null,
              hasNextPage: false,
            },
          },
          files: {
            nodes: input.files ?? [],
            pageInfo: input.filesPageInfo ?? {
              endCursor: null,
              hasNextPage: false,
            },
          },
          reactions: {
            nodes: input.reactions ?? [],
            pageInfo: input.reactionsPageInfo ?? {
              endCursor: null,
              hasNextPage: false,
            },
          },
          reviews: {
            nodes: input.reviews ?? [],
            pageInfo: input.reviewsPageInfo ?? {
              endCursor: null,
              hasNextPage: false,
            },
          },
          reviewThreads: {
            nodes: input.reviewThreads ?? [],
            pageInfo: input.reviewThreadsPageInfo ?? {
              endCursor: null,
              hasNextPage: false,
            },
          },
        },
      },
    },
  })
}

export function createThreadCommentsPage(input: {
  comments: {
    author: { login: string }
    body: string
    createdAt: string
    line: null | number
    path: string
    url: string
  }[]
  endCursor: null | string
  hasNextPage: boolean
  threadId: string
}) {
  return JSON.stringify({
    data: {
      node: {
        id: input.threadId,
        comments: {
          nodes: input.comments,
          pageInfo: {
            endCursor: input.endCursor,
            hasNextPage: input.hasNextPage,
          },
        },
      },
    },
  })
}

export function makeFile(index: number) {
  return { path: `src/file-${index}.ts` }
}

export function makeIssueComment(index: number) {
  return {
    author: { login: 'chatgpt-codex-connector[bot]' },
    body: `issue-comment-${index}`,
    createdAt: `2026-03-25T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
    databaseId: index,
    url: `https://github.com/acme/repo/issues/12#issuecomment-${index}`,
  }
}

export function makeReaction(index: number) {
  return {
    content: 'THUMBS_UP',
    createdAt: `2026-03-25T08:${String(index % 60).padStart(2, '0')}:00.000Z`,
    user: { login: 'chatgpt-codex-connector[bot]' },
  }
}

export function makeReview(index: number) {
  return {
    author: { login: 'chatgpt-codex-connector[bot]' },
    body: `review-${index}`,
    fullDatabaseId: index,
    state: 'COMMENTED',
    submittedAt: `2026-03-25T09:${String(index % 60).padStart(2, '0')}:00.000Z`,
    url: `https://github.com/acme/repo/pull/12#pullrequestreview-${index}`,
  }
}

export function makeThread(index: number) {
  return {
    id: `thread-${index}`,
    isOutdated: false,
    isResolved: false,
    comments: {
      nodes: [
        {
          author: { login: 'chatgpt-codex-connector[bot]' },
          body: `thread-comment-${index}`,
          createdAt: `2026-03-25T11:${String(index % 60).padStart(2, '0')}:00.000Z`,
          line: index,
          path: `src/thread-${index}.ts`,
          url: `https://github.com/acme/repo/pull/12#discussion_r${index}`,
        },
      ],
      pageInfo: {
        endCursor: null,
        hasNextPage: false,
      },
    },
  }
}
