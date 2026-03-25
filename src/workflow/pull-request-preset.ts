import { finalizeTaskCheckbox } from './finalize-task-checkbox'

import type { RemoteReviewerProvider } from '../agents/types'
import type { OrchestratorRuntime, PullRequestRef } from '../core/runtime'
import type {
  IntegratePhaseResult,
  ReviewPhaseContext,
  ReviewPhaseResult,
  WorkflowPreset,
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

function createPullRequestBody(context: ReviewPhaseContext) {
  const changedFiles =
    context.implement.changedFiles.length !== 0
      ? context.implement.changedFiles.map((file) => `- ${file}`).join('\n')
      : '- none'
  return [
    `Task: ${context.commitMessage}`,
    `Attempt: ${context.attempt}`,
    '',
    'Changed files:',
    changedFiles,
    '',
    `Verify: ${context.verify.summary}`,
    '',
    'Managed by spec-while.',
  ].join('\n')
}

async function ensureTaskBranch(input: {
  branchName: string
  restoreFromRemote: boolean
  runtime: OrchestratorRuntime
}) {
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

async function ensurePullRequest(input: {
  branchName: string
  branchNeedsPush: boolean
  context: ReviewPhaseContext
  existingPullRequest: null | PullRequestRef
}): Promise<PullRequestRef> {
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

async function waitForRemoteReview(input: {
  checkpointStartedAt: string
  context: ReviewPhaseContext
  pullRequest: PullRequestRef
  reviewer: RemoteReviewerProvider
  sleep: (ms: number) => Promise<void>
}): Promise<ReviewPhaseResult> {
  for (;;) {
    const snapshot = await input.context.runtime.github.getPullRequestSnapshot({
      pullRequestNumber: input.pullRequest.number,
    })
    const result = await input.reviewer.evaluatePullRequestReview({
      checkpointStartedAt: input.checkpointStartedAt,
      pullRequest: snapshot,
      task: input.context.task,
      verify: input.context.verify,
    })
    if (result.kind === 'pending') {
      await input.sleep(DEFAULT_REVIEW_POLL_INTERVAL_MS)
      continue
    }
    return result
  }
}

function toLocalCleanupWarning(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function cleanupAfterMerge(input: {
  branchName: string
  runtime: OrchestratorRuntime
}) {
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

function summarizeIntegrateResult(input: {
  status: 'already integrated' | 'integrated'
  warnings: string[]
}) {
  return input.warnings.length === 0
    ? input.status
    : `${input.status}; local cleanup warning: ${input.warnings.join('; ')}`
}

export function createPullRequestWorkflowPreset(input: {
  reviewer: RemoteReviewerProvider
  sleep?: (ms: number) => Promise<void>
}): WorkflowPreset {
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
      if (!openPullRequest) {
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
      }

      await ensureTaskBranch({
        branchName,
        restoreFromRemote: true,
        runtime: context.runtime,
      })
      if (!(await context.runtime.workspace.isTaskChecked(context.taskId))) {
        await finalizeTaskCheckbox({
          commitMessage: context.commitMessage,
          runtime: context.runtime,
          taskId: context.taskId,
        })
      }
      await context.runtime.git.pushBranch(branchName)
      const mergeResult = await context.runtime.github.squashMergePullRequest({
        pullRequestNumber: openPullRequest.number,
        subject: context.commitMessage,
      })
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

      if ((await context.runtime.git.getHeadSubject()) !== checkpointMessage) {
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
