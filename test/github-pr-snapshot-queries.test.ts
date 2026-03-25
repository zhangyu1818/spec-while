import { expect, test } from 'vitest'

import {
  buildReviewThreadCommentsArgs,
  buildSnapshotArgs,
} from '../src/runtime/github-pr-snapshot-queries'

test('buildSnapshotArgs passes the GraphQL document as query=', () => {
  const args = buildSnapshotArgs({
    commentsAfter: null,
    filesAfter: null,
    includeComments: true,
    includeFiles: true,
    includeReactions: true,
    includeReviews: true,
    includeReviewThreads: true,
    number: 1,
    owner: 'zhangyu1818',
    reactionsAfter: null,
    repo: 'spec-while',
    reviewsAfter: null,
    reviewThreadsAfter: null,
  })

  const queryIndex = args.lastIndexOf('-f')

  expect(queryIndex).toBeGreaterThanOrEqual(0)
  expect(args[queryIndex + 1]).toMatch(/^query=/)
})

test('buildReviewThreadCommentsArgs passes the GraphQL document as query=', () => {
  const args = buildReviewThreadCommentsArgs({
    threadId: 'thread-1',
  })

  const queryIndex = args.lastIndexOf('-f')

  expect(queryIndex).toBeGreaterThanOrEqual(0)
  expect(args[queryIndex + 1]).toMatch(/^query=/)
})
