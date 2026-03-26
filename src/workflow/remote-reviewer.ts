import type {
  PullRequestReviewInput,
  PullRequestReviewResult,
  RemoteReviewerProvider,
} from '../agents/types'
import type {
  PullRequestDiscussionComment,
  PullRequestReviewSummary,
  PullRequestReviewThread,
  PullRequestReviewThreadComment,
} from '../core/runtime'
import type { ReviewOutput } from '../types'

export const CODEX_REVIEWER_ACTOR = 'chatgpt-codex-connector[bot]'

type FeedbackSignal =
  | (PullRequestDiscussionComment & {
      kind: 'discussion'
    })
  | (PullRequestReviewSummary & {
      kind: 'review-summary'
    })
  | (PullRequestReviewThreadComment & {
      kind: 'thread'
    })

function isAfterCheckpoint(
  timestamp: null | string,
  checkpointStartedAt: string,
) {
  if (typeof timestamp !== 'string') {
    return false
  }
  const eventAt = Date.parse(timestamp)
  const checkpointAt = Date.parse(checkpointStartedAt)
  return Number.isFinite(eventAt) && Number.isFinite(checkpointAt)
    ? eventAt >= checkpointAt
    : false
}

function compareTimestamps(left: string, right: string) {
  return Date.parse(left) - Date.parse(right)
}

function isAtOrAfter(left: string, right: string) {
  return compareTimestamps(left, right) >= 0
}

function isActor(login: string) {
  return login === CODEX_REVIEWER_ACTOR
}

function collectThreadFeedback(
  thread: PullRequestReviewThread,
  checkpointStartedAt: string,
) {
  if (thread.isResolved || thread.isOutdated) {
    return null
  }
  const latest = [...thread.comments]
    .filter((comment) => isActor(comment.userLogin))
    .sort((left, right) => compareTimestamps(left.createdAt, right.createdAt))
    .at(-1)
  if (!latest || !isAfterCheckpoint(latest.createdAt, checkpointStartedAt)) {
    return null
  }
  return {
    ...latest,
    kind: 'thread' as const,
  }
}

function collectFeedbackSignals(
  input: PullRequestReviewInput,
): FeedbackSignal[] {
  const discussion = input.pullRequest.discussionComments
    .filter(
      (comment) =>
        isActor(comment.userLogin) &&
        isAfterCheckpoint(comment.createdAt, input.checkpointStartedAt),
    )
    .map((comment) => ({
      ...comment,
      kind: 'discussion' as const,
    }))
  const reviewSummaries = input.pullRequest.reviewSummaries
    .filter(
      (summary) =>
        isActor(summary.userLogin) &&
        isAfterCheckpoint(summary.submittedAt, input.checkpointStartedAt),
    )
    .map((summary) => ({
      ...summary,
      kind: 'review-summary' as const,
    }))
  const threads = input.pullRequest.reviewThreads
    .map((thread) => collectThreadFeedback(thread, input.checkpointStartedAt))
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return [...discussion, ...reviewSummaries, ...threads].sort((left, right) => {
    const leftTime =
      'submittedAt' in left ? (left.submittedAt ?? '') : left.createdAt
    const rightTime =
      'submittedAt' in right ? (right.submittedAt ?? '') : right.createdAt
    return compareTimestamps(leftTime, rightTime)
  })
}

function getFeedbackTimestamp(signal: FeedbackSignal) {
  return 'submittedAt' in signal ? (signal.submittedAt ?? '') : signal.createdAt
}

function latestApprovalTimestamp(input: PullRequestReviewInput) {
  return (
    input.pullRequest.reactions
      .filter(
        (reaction) =>
          reaction.content === '+1' &&
          isActor(reaction.userLogin) &&
          isAfterCheckpoint(reaction.createdAt, input.checkpointStartedAt),
      )
      .map((reaction) => reaction.createdAt)
      .sort(compareTimestamps)
      .at(-1) ?? null
  )
}

function signalSeverity(signal: FeedbackSignal): 'high' | 'medium' {
  if (
    signal.kind === 'review-summary' &&
    signal.state === 'CHANGES_REQUESTED'
  ) {
    return 'high'
  }
  return 'medium'
}

function buildApprovedReview(input: PullRequestReviewInput): ReviewOutput {
  return {
    findings: [],
    overallRisk: 'low',
    summary: `Remote reviewer ${CODEX_REVIEWER_ACTOR} approved the pull request`,
    taskId: input.task.id,
    verdict: 'pass',
    acceptanceChecks: input.task.acceptance.map((criterion) => ({
      criterion,
      note: `Remote reviewer ${CODEX_REVIEWER_ACTOR} approved the pull request`,
      status: 'pass' as const,
    })),
  }
}

function buildRejectedReview(
  input: PullRequestReviewInput,
  feedbackSignals: FeedbackSignal[],
): ReviewOutput {
  const findings = feedbackSignals.map((signal) => {
    const path = 'path' in signal && signal.path ? signal.path : undefined
    const issue = signal.body.trim() || 'Remote reviewer requested changes'
    return {
      ...(path ? { file: path } : {}),
      fixHint: issue,
      issue,
      severity: signalSeverity(signal),
    }
  })
  return {
    findings,
    taskId: input.task.id,
    verdict: 'rework',
    acceptanceChecks: input.task.acceptance.map((criterion) => ({
      criterion,
      note: 'Remote review left active feedback',
      status: 'unclear' as const,
    })),
    overallRisk: findings.some((finding) => finding.severity === 'high')
      ? 'high'
      : 'medium',
    summary:
      feedbackSignals
        .map((signal) => signal.body.trim())
        .filter(Boolean)
        .join('\n') || 'Remote reviewer left active feedback',
  }
}

export function createCodexRemoteReviewerProvider(): RemoteReviewerProvider {
  return {
    name: 'codex',
    async evaluatePullRequestReview(
      input: PullRequestReviewInput,
    ): Promise<PullRequestReviewResult> {
      const feedbackSignals = collectFeedbackSignals(input)
      const latestFeedbackTimestamp =
        feedbackSignals
          .map((signal) => getFeedbackTimestamp(signal))
          .sort(compareTimestamps)
          .at(-1) ?? null
      const approvalTimestamp = latestApprovalTimestamp(input)

      if (
        approvalTimestamp &&
        (!latestFeedbackTimestamp ||
          isAtOrAfter(approvalTimestamp, latestFeedbackTimestamp))
      ) {
        return {
          kind: 'approved',
          review: buildApprovedReview(input),
        }
      }

      if (feedbackSignals.length !== 0) {
        return {
          kind: 'rejected',
          review: buildRejectedReview(input, feedbackSignals),
        }
      }

      return {
        kind: 'pending',
      }
    },
  }
}
