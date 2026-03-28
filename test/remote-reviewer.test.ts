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

test('codex remote reviewer approves when the latest thumbs-up wins', async () => {
  const reviewer = createCodexRemoteReviewerProvider()
  const task = createGraph().tasks[0]!

  const result = await reviewer.evaluatePullRequestReview({
    checkpointStartedAt: '2026-03-25T08:00:00.000Z',
    completionCriteria: ['buildGreeting works'],
    taskHandle: task.handle,
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
          id: 'thread-1',
          isOutdated: false,
          isResolved: false,
          comments: [
            {
              body: 'older feedback',
              createdAt: '2026-03-25T07:59:00.000Z',
              line: 10,
              path: 'src/greeting.ts',
              url: 'https://example.com/thread/1',
              userLogin: 'chatgpt-codex-connector[bot]',
            },
          ],
        },
      ],
    }),
  })

  expect(result.kind).toBe('approved')
  if (result.kind === 'approved') {
    expect(result.review.verdict).toBe('pass')
    expect(result.review.findings).toEqual([])
  }
})

test('codex remote reviewer ignores stale thumbs-up from a previous attempt on the same pull request', async () => {
  const reviewer = createCodexRemoteReviewerProvider()
  const task = createGraph().tasks[0]!

  const result = await reviewer.evaluatePullRequestReview({
    checkpointStartedAt: '2026-03-25T08:02:00.000Z',
    completionCriteria: ['buildGreeting works'],
    taskHandle: task.handle,
    pullRequest: createSnapshot({
      reactions: [
        {
          content: '+1',
          createdAt: '2026-03-25T08:01:00.000Z',
          userLogin: 'chatgpt-codex-connector[bot]',
        },
      ],
    }),
  })

  expect(result).toEqual({
    kind: 'pending',
  })
})

test('codex remote reviewer rejects when active feedback is newer than approval', async () => {
  const reviewer = createCodexRemoteReviewerProvider()
  const task = createGraph().tasks[0]!

  const result = await reviewer.evaluatePullRequestReview({
    checkpointStartedAt: '2026-03-25T08:00:00.000Z',
    completionCriteria: ['buildGreeting works'],
    taskHandle: task.handle,
    pullRequest: createSnapshot({
      reactions: [
        {
          content: '+1',
          createdAt: '2026-03-25T08:01:00.000Z',
          userLogin: 'chatgpt-codex-connector[bot]',
        },
      ],
      reviewThreads: [
        {
          id: 'thread-2',
          isOutdated: false,
          isResolved: false,
          comments: [
            {
              body: 'please handle edge case',
              createdAt: '2026-03-25T08:03:00.000Z',
              line: 12,
              path: 'src/greeting.ts',
              url: 'https://example.com/thread/2',
              userLogin: 'chatgpt-codex-connector[bot]',
            },
          ],
        },
      ],
    }),
  })

  expect(result.kind).toBe('rejected')
  if (result.kind === 'rejected') {
    expect(result.review.verdict).toBe('rework')
    expect(result.review.findings).toHaveLength(1)
  }
})

test('codex remote reviewer upgrades changes requested feedback to high risk', async () => {
  const reviewer = createCodexRemoteReviewerProvider()
  const task = createGraph().tasks[0]!

  const result = await reviewer.evaluatePullRequestReview({
    checkpointStartedAt: '2026-03-25T08:00:00.000Z',
    completionCriteria: ['buildGreeting works'],
    taskHandle: task.handle,
    pullRequest: createSnapshot({
      reviewSummaries: [
        {
          id: 101,
          body: 'needs more tests',
          state: 'CHANGES_REQUESTED',
          submittedAt: '2026-03-25T08:03:00.000Z',
          url: 'https://example.com/reviews/101',
          userLogin: 'chatgpt-codex-connector[bot]',
        },
      ],
    }),
  })

  expect(result.kind).toBe('rejected')
  if (result.kind === 'rejected') {
    expect(result.review.findings).toEqual([
      {
        fixHint: 'needs more tests',
        issue: 'needs more tests',
        severity: 'high',
      },
    ])
    expect(result.review.overallRisk).toBe('high')
  }
})

test('codex remote reviewer ignores resolved and outdated thread comments', async () => {
  const reviewer = createCodexRemoteReviewerProvider()
  const task = createGraph().tasks[0]!

  const result = await reviewer.evaluatePullRequestReview({
    checkpointStartedAt: '2026-03-25T08:00:00.000Z',
    completionCriteria: ['buildGreeting works'],
    taskHandle: task.handle,
    pullRequest: createSnapshot({
      reviewThreads: [
        {
          id: 'thread-resolved',
          isOutdated: false,
          isResolved: true,
          comments: [
            {
              body: 'resolved feedback should be ignored',
              createdAt: '2026-03-25T08:03:00.000Z',
              line: 12,
              path: 'src/greeting.ts',
              url: 'https://example.com/thread/resolved',
              userLogin: 'chatgpt-codex-connector[bot]',
            },
          ],
        },
        {
          id: 'thread-outdated',
          isOutdated: true,
          isResolved: false,
          comments: [
            {
              body: 'outdated feedback should be ignored',
              createdAt: '2026-03-25T08:04:00.000Z',
              line: 14,
              path: 'src/greeting.ts',
              url: 'https://example.com/thread/outdated',
              userLogin: 'chatgpt-codex-connector[bot]',
            },
          ],
        },
      ],
    }),
  })

  expect(result).toEqual({
    kind: 'pending',
  })
})

test('codex remote reviewer only keeps the latest active comment from each thread', async () => {
  const reviewer = createCodexRemoteReviewerProvider()
  const task = createGraph().tasks[0]!

  const result = await reviewer.evaluatePullRequestReview({
    checkpointStartedAt: '2026-03-25T08:00:00.000Z',
    completionCriteria: ['buildGreeting works'],
    taskHandle: task.handle,
    pullRequest: createSnapshot({
      reviewThreads: [
        {
          id: 'thread-duplicate',
          isOutdated: false,
          isResolved: false,
          comments: [
            {
              body: 'first thread feedback',
              createdAt: '2026-03-25T08:02:00.000Z',
              line: 10,
              path: 'src/greeting.ts',
              url: 'https://example.com/thread/duplicate/1',
              userLogin: 'chatgpt-codex-connector[bot]',
            },
            {
              body: 'latest thread feedback',
              createdAt: '2026-03-25T08:03:00.000Z',
              line: 12,
              path: 'src/greeting.ts',
              url: 'https://example.com/thread/duplicate/2',
              userLogin: 'chatgpt-codex-connector[bot]',
            },
          ],
        },
      ],
    }),
  })

  expect(result.kind).toBe('rejected')
  if (result.kind === 'rejected') {
    expect(result.review.findings).toHaveLength(1)
    expect(result.review.summary).toBe('latest thread feedback')
  }
})

test('codex remote reviewer emits a fallback acceptance check when completion criteria is empty on approval', async () => {
  const reviewer = createCodexRemoteReviewerProvider()
  const task = createGraph().tasks[0]!

  const result = await reviewer.evaluatePullRequestReview({
    checkpointStartedAt: '2026-03-25T08:00:00.000Z',
    completionCriteria: [],
    taskHandle: task.handle,
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
  if (result.kind === 'approved') {
    expect(result.review.acceptanceChecks).toHaveLength(1)
  }
})

test('codex remote reviewer emits a fallback acceptance check when completion criteria is empty on rejection', async () => {
  const reviewer = createCodexRemoteReviewerProvider()
  const task = createGraph().tasks[0]!

  const result = await reviewer.evaluatePullRequestReview({
    checkpointStartedAt: '2026-03-25T08:00:00.000Z',
    completionCriteria: [],
    taskHandle: task.handle,
    pullRequest: createSnapshot({
      reviewThreads: [
        {
          id: 'thread-empty-criteria',
          isOutdated: false,
          isResolved: false,
          comments: [
            {
              body: 'please fix this edge case',
              createdAt: '2026-03-25T08:05:00.000Z',
              line: 18,
              path: 'src/greeting.ts',
              url: 'https://example.com/thread/empty-criteria',
              userLogin: 'chatgpt-codex-connector[bot]',
            },
          ],
        },
      ],
    }),
  })

  expect(result.kind).toBe('rejected')
  if (result.kind === 'rejected') {
    expect(result.review.acceptanceChecks).toHaveLength(1)
  }
})
