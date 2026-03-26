import { expect, test } from 'vitest'

import { createCodexRemoteReviewerProvider } from '../src/workflow/remote-reviewer'
import { createGraph } from './workflow-test-helpers'

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

test('codex remote reviewer compares checkpoint and approval timestamps across timezones', async () => {
  const reviewer = createCodexRemoteReviewerProvider()
  const task = createGraph().tasks[0]!

  const result = await reviewer.evaluatePullRequestReview({
    checkpointStartedAt: '2026-03-25T16:00:00+08:00',
    task,
    pullRequest: createSnapshot({
      reactions: [
        {
          content: '+1',
          createdAt: '2026-03-25T08:05:00.000Z',
          userLogin: 'chatgpt-codex-connector[bot]',
        },
      ],
    }),
  })

  expect(result.kind).toBe('approved')
})

test('codex remote reviewer compares checkpoint and active feedback timestamps across timezones', async () => {
  const reviewer = createCodexRemoteReviewerProvider()
  const task = createGraph().tasks[0]!

  const result = await reviewer.evaluatePullRequestReview({
    checkpointStartedAt: '2026-03-25T16:00:00+08:00',
    task,
    pullRequest: createSnapshot({
      reviewThreads: [
        {
          id: 'thread-tz',
          isOutdated: false,
          isResolved: false,
          comments: [
            {
              body: 'newer timezone-aware feedback',
              createdAt: '2026-03-25T08:03:00.000Z',
              line: 12,
              path: 'src/greeting.ts',
              url: 'https://example.com/thread/tz',
              userLogin: 'chatgpt-codex-connector[bot]',
            },
          ],
        },
      ],
    }),
  })

  expect(result.kind).toBe('rejected')
})

test('codex remote reviewer compares approval and feedback ordering across timezones', async () => {
  const reviewer = createCodexRemoteReviewerProvider()
  const task = createGraph().tasks[0]!

  const result = await reviewer.evaluatePullRequestReview({
    checkpointStartedAt: '2026-03-25T16:00:00+08:00',
    task,
    pullRequest: createSnapshot({
      reactions: [
        {
          content: '+1',
          createdAt: '2026-03-25T08:05:00.000Z',
          userLogin: 'chatgpt-codex-connector[bot]',
        },
      ],
      reviewThreads: [
        {
          id: 'thread-ordering',
          isOutdated: false,
          isResolved: false,
          comments: [
            {
              body: 'older timezone-aware feedback',
              createdAt: '2026-03-25T16:03:00+08:00',
              line: 12,
              path: 'src/greeting.ts',
              url: 'https://example.com/thread/ordering',
              userLogin: 'chatgpt-codex-connector[bot]',
            },
          ],
        },
      ],
    }),
  })

  expect(result.kind).toBe('approved')
})
