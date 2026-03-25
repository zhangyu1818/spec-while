import {
  recordCommitFailure,
  recordIntegrateResult,
  recordReviewApproved,
  recordReviewFailure,
  recordReviewResult,
} from './engine'
import { shouldPassZeroGate } from './engine-helpers'
import {
  appendEvent,
  createTaskCommitMessage,
  now,
  persistCommittedArtifacts,
  persistState,
} from './orchestrator-helpers'

import type {
  FinalReport,
  IntegrateArtifact,
  ReviewArtifact,
  TaskGraph,
  WorkflowState,
} from '../types'
import type { WorkflowRuntime } from '../workflow/preset'
import type { OrchestratorRuntime } from './runtime'

export async function resumePullRequestReview(input: {
  graph: TaskGraph
  runtime: OrchestratorRuntime
  state: WorkflowState
  workflow: WorkflowRuntime
}): Promise<null | { report: FinalReport; state: WorkflowState }> {
  if (
    input.workflow.preset.mode !== 'pull-request' ||
    !input.state.currentTaskId
  ) {
    return null
  }

  const taskId = input.state.currentTaskId
  const taskState = input.state.tasks[taskId]
  if (taskState?.status !== 'running' || taskState.stage !== 'review') {
    return null
  }

  const task = input.graph.tasks.find((item) => item.id === taskId)
  if (!task) {
    return null
  }

  const artifactKey = {
    attempt: taskState.attempt,
    generation: taskState.generation,
    taskId,
  }
  const [implementArtifact, verifyArtifact] = await Promise.all([
    input.runtime.store.loadImplementArtifact(artifactKey),
    input.runtime.store.loadVerifyArtifact(artifactKey),
  ])

  if (!implementArtifact || !verifyArtifact) {
    const reason = `Cannot resume review for ${taskId} without persisted implement and verify artifacts`
    const nextState = recordReviewFailure(
      input.graph,
      input.state,
      taskId,
      reason,
    )
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: reason,
      generation: taskState.generation,
      taskId,
      timestamp: now(),
      type: 'review_failed',
    })
    const report = await persistState(input.runtime, input.graph, nextState)
    return {
      report,
      state: nextState,
    }
  }

  const taskContext = await input.runtime.workspace.loadTaskContext(task)
  const commitMessage = createTaskCommitMessage(task.id, task.title)
  let review
  let reviewPhaseKind: 'approved' | 'rejected'

  try {
    const reviewPhase = await input.workflow.preset.review({
      actualChangedFiles: implementArtifact.result.changedFiles,
      attempt: taskState.attempt,
      commitMessage,
      generation: taskState.generation,
      implement: implementArtifact.result,
      lastFindings: taskState.lastFindings,
      runtime: input.runtime,
      task,
      taskContext,
      verify: verifyArtifact.result,
    })
    reviewPhaseKind = reviewPhase.kind
    review = reviewPhase.review
    if (review.taskId !== task.id) {
      throw new Error(
        `Review taskId mismatch: expected ${task.id}, received ${review.taskId}`,
      )
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const nextState = recordReviewFailure(
      input.graph,
      input.state,
      task.id,
      reason,
    )
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: reason,
      generation: taskState.generation,
      taskId: task.id,
      timestamp: now(),
      type: 'review_failed',
    })
    const report = await persistState(input.runtime, input.graph, nextState)
    return {
      report,
      state: nextState,
    }
  }

  const reviewArtifact: ReviewArtifact = {
    attempt: taskState.attempt,
    createdAt: now(),
    generation: taskState.generation,
    result: review,
    taskId: task.id,
  }
  await input.runtime.store.saveReviewArtifact(reviewArtifact)
  await appendEvent(input.runtime, {
    attempt: taskState.attempt,
    detail: review.summary,
    generation: taskState.generation,
    taskId: task.id,
    timestamp: now(),
    type: 'review_completed',
  })

  if (
    reviewPhaseKind === 'approved' &&
    shouldPassZeroGate({ review, verify: verifyArtifact.result })
  ) {
    let nextState = recordReviewApproved(input.state, task.id, review)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      generation: taskState.generation,
      taskId: task.id,
      timestamp: now(),
      type: 'integrate_started',
    })
    let report = await persistState(input.runtime, input.graph, nextState)

    let integrateResult
    try {
      integrateResult = await input.workflow.preset.integrate({
        commitMessage,
        runtime: input.runtime,
        taskId: task.id,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      nextState = recordCommitFailure(input.graph, nextState, task.id, reason)
      await appendEvent(input.runtime, {
        attempt: taskState.attempt,
        detail: reason,
        generation: taskState.generation,
        taskId: task.id,
        timestamp: now(),
        type: 'integrate_failed',
      })
      report = await persistState(input.runtime, input.graph, nextState)
      return {
        report,
        state: nextState,
      }
    }

    const integrateArtifact: IntegrateArtifact = {
      attempt: taskState.attempt,
      createdAt: now(),
      generation: taskState.generation,
      result: integrateResult.result,
      taskId: task.id,
    }
    nextState = recordIntegrateResult(input.graph, nextState, task.id, {
      commitSha: integrateResult.result.commitSha,
      review,
      verify: verifyArtifact.result,
    })
    report = await persistState(input.runtime, input.graph, nextState)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: integrateResult.result.summary,
      generation: taskState.generation,
      taskId: task.id,
      timestamp: now(),
      type: 'integrate_completed',
    })
    await input.runtime.store.saveIntegrateArtifact(integrateArtifact)
    await persistCommittedArtifacts(input.runtime, {
      commitSha: integrateResult.result.commitSha,
      implementArtifact,
      reviewArtifact,
      verifyArtifact,
    })
    return {
      report,
      state: nextState,
    }
  }

  const nextState = recordReviewResult(input.graph, input.state, task.id, {
    review,
    verify: verifyArtifact.result,
  })
  const report = await persistState(input.runtime, input.graph, nextState)
  return {
    report,
    state: nextState,
  }
}
