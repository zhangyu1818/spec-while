import { finalizeTaskCheckbox } from './finalize-task-checkbox'

import type {
  PullRequestReviewResult,
  RemoteReviewerProvider,
} from '../agents/types'
import type { OrchestratorRuntime, PullRequestRef } from '../core/runtime'
import type {
  IntegratePhaseResult,
  PullRequestReviewPhaseContext,
  PullRequestWorkflowPreset,
  ReviewPhaseResult,
} from './preset'

const DEFAULT_BASE_BRANCH = 'main'
const DEFAULT_REVIEW_POLL_INTERVAL_MS = 60_000

function toTaskBranchName(commitMessage: string) {
  const slug = commitMessage
    .replace(/^Task\s+/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `task/${slug}`
}

function createCheckpointCommitMessage(commitMessage: string, attempt: number) {
  return `checkpoint: ${commitMessage} (attempt ${attempt})`
}

function createPullRequestBody(context: PullRequestReviewPhaseContext) {
  return [
    `Task: ${context.commitMessage}`,
    `Attempt: ${context.attempt}`,
    '',
    'Managed by task-while.',
  ].join('\n')
}

interface EnsureTaskBranchInput {
  branchName: string
  restoreFromRemote: boolean
  runtime: OrchestratorRuntime
}

async function ensureTaskBranch(input: EnsureTaskBranchInput) {
  const currentBranch = await input.runtime.git.getCurrentBranch()
  if (currentBranch === input.branchName) {
    return
  }
  try {
    await input.runtime.git.checkoutBranch(input.branchName)
  } catch {
    if (input.restoreFromRemote) {
      await input.runtime.git.checkoutRemoteBranch(input.branchName)
      return
    }
    await input.runtime.git.checkoutBranch(input.branchName, {
      create: true,
      startPoint: DEFAULT_BASE_BRANCH,
    })
  }
}

interface EnsurePullRequestInput {
  branchName: string
  branchNeedsPush: boolean
  context: PullRequestReviewPhaseContext
  existingPullRequest: null | PullRequestRef
}

async function ensurePullRequest(
  input: EnsurePullRequestInput,
): Promise<PullRequestRef> {
  let pullRequest = input.existingPullRequest

  if (input.branchNeedsPush || !pullRequest) {
    await input.context.runtime.git.pushBranch(input.branchName)
  }

  if (pullRequest) {
    return pullRequest
  }

  pullRequest = await input.context.runtime.github.createPullRequest({
    baseBranch: DEFAULT_BASE_BRANCH,
    body: createPullRequestBody(input.context),
    headBranch: input.branchName,
    title: input.context.commitMessage,
  })
  return pullRequest
}

interface WaitForRemoteReviewInput {
  checkpointStartedAt: string
  context: PullRequestReviewPhaseContext
  pullRequest: PullRequestRef
  reviewer: RemoteReviewerProvider
  sleep: SleepFunction
}

type SleepFunction = (ms: number) => Promise<void>

async function waitForRemoteReview(
  input: WaitForRemoteReviewInput,
): Promise<ReviewPhaseResult> {
  const evaluateReview = async () => {
    const snapshot = await input.context.runtime.github.getPullRequestSnapshot({
      pullRequestNumber: input.pullRequest.number,
    })
    return input.reviewer.evaluatePullRequestReview({
      checkpointStartedAt: input.checkpointStartedAt,
      completionCriteria: input.context.completionCriteria,
      pullRequest: snapshot,
      taskHandle: input.context.taskHandle,
    })
  }

  let result: PullRequestReviewResult = await evaluateReview()
  while (result.kind === 'pending') {
    await input.sleep(DEFAULT_REVIEW_POLL_INTERVAL_MS)
    result = await evaluateReview()
  }
  return result
}

function toLocalCleanupWarning(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

interface CleanupAfterMergeInput {
  branchName: string
  runtime: OrchestratorRuntime
}

async function cleanupAfterMerge(input: CleanupAfterMergeInput) {
  const warnings: string[] = []
  let onBaseBranch = false

  try {
    await input.runtime.git.checkoutBranch(DEFAULT_BASE_BRANCH)
    onBaseBranch = true
  } catch (error) {
    warnings.push(
      `checkout ${DEFAULT_BASE_BRANCH} failed: ${toLocalCleanupWarning(error)}`,
    )
  }

  if (!onBaseBranch) {
    return warnings
  }

  try {
    await input.runtime.git.pullFastForward(DEFAULT_BASE_BRANCH)
  } catch (error) {
    warnings.push(
      `pull ${DEFAULT_BASE_BRANCH} failed: ${toLocalCleanupWarning(error)}`,
    )
  }

  try {
    await input.runtime.git.deleteLocalBranch(input.branchName)
  } catch (error) {
    warnings.push(`delete local branch failed: ${toLocalCleanupWarning(error)}`)
  }

  return warnings
}

interface SummarizeIntegrateResultInput {
  status: 'already integrated' | 'integrated'
  warnings: string[]
}

function summarizeIntegrateResult(input: SummarizeIntegrateResultInput) {
  return input.warnings.length === 0
    ? input.status
    : `${input.status}; local cleanup warning: ${input.warnings.join('; ')}`
}

export interface CreatePullRequestWorkflowPresetInput {
  reviewer: RemoteReviewerProvider
  sleep?: SleepFunction
}

export function createPullRequestWorkflowPreset(
  input: CreatePullRequestWorkflowPresetInput,
): PullRequestWorkflowPreset {
  const sleep =
    input.sleep ??
    (async (ms: number) => {
      await new Promise((resolve) => {
        setTimeout(resolve, ms)
      })
    })

  return {
    mode: 'pull-request',
    async integrate(context): Promise<IntegratePhaseResult> {
      const branchName = toTaskBranchName(context.commitMessage)
      const openPullRequest =
        await context.runtime.github.findOpenPullRequestByHeadBranch({
          headBranch: branchName,
        })
      if (openPullRequest) {
        await ensureTaskBranch({
          branchName,
          restoreFromRemote: true,
          runtime: context.runtime,
        })
        const taskChecked = await context.runtime.taskSource.isTaskCompleted(
          context.taskHandle,
        )
        if (!taskChecked) {
          await finalizeTaskCheckbox({
            commitMessage: context.commitMessage,
            runtime: context.runtime,
            taskHandle: context.taskHandle,
          })
        }
        await context.runtime.git.pushBranch(branchName)
        const mergeResult = await context.runtime.github.squashMergePullRequest(
          {
            pullRequestNumber: openPullRequest.number,
            subject: context.commitMessage,
          },
        )
        const warnings = await cleanupAfterMerge({
          branchName,
          runtime: context.runtime,
        })

        return {
          kind: 'completed',
          result: {
            commitSha: mergeResult.commitSha,
            summary: summarizeIntegrateResult({
              status: 'integrated',
              warnings,
            }),
          },
        }
      }

      const mergedPullRequest =
        await context.runtime.github.findMergedPullRequestByHeadBranch({
          headBranch: branchName,
        })
      if (!mergedPullRequest) {
        throw new Error(
          `Missing open or merged pull request for branch ${branchName}`,
        )
      }
      const warnings = await cleanupAfterMerge({
        branchName,
        runtime: context.runtime,
      })

      return {
        kind: 'completed',
        result: {
          commitSha: mergedPullRequest.mergeCommitSha,
          summary: summarizeIntegrateResult({
            status: 'already integrated',
            warnings,
          }),
        },
      }
    },
    async review(context): Promise<ReviewPhaseResult> {
      const branchName = toTaskBranchName(context.commitMessage)
      const checkpointMessage = createCheckpointCommitMessage(
        context.commitMessage,
        context.attempt,
      )
      const existingPullRequest =
        await context.runtime.github.findOpenPullRequestByHeadBranch({
          headBranch: branchName,
        })
      await ensureTaskBranch({
        branchName,
        restoreFromRemote: existingPullRequest !== null,
        runtime: context.runtime,
      })

      const headSubject = await context.runtime.git.getHeadSubject()
      if (headSubject !== checkpointMessage) {
        await context.runtime.git.commitTask({
          message: checkpointMessage,
        })
      }

      const checkpointStartedAt = await context.runtime.git.getHeadTimestamp()
      const pullRequest = await ensurePullRequest({
        branchName,
        branchNeedsPush: true,
        context,
        existingPullRequest,
      })

      return waitForRemoteReview({
        checkpointStartedAt,
        context,
        pullRequest,
        reviewer: input.reviewer,
        sleep,
      })
    },
  }
}

export { DEFAULT_REVIEW_POLL_INTERVAL_MS, toTaskBranchName }
