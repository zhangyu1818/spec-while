import {
  recordCommitFailure,
  recordImplementFailure,
  recordImplementSuccess,
  recordIntegrateResult,
  recordReviewApproved,
  recordReviewFailure,
  recordReviewResult,
  recordVerifyFailure,
  recordVerifyResult,
  startAttempt,
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
  ImplementArtifact,
  IntegrateArtifact,
  ReviewArtifact,
  TaskDefinition,
  TaskGraph,
  VerifyArtifact,
  WorkflowState,
} from '../types'
import type { WorkflowRuntime } from '../workflow/preset'
import type { OrchestratorRuntime } from './runtime'

export async function executeTaskAttempt(input: {
  graph: TaskGraph
  runtime: OrchestratorRuntime
  state: WorkflowState
  task: TaskDefinition
  workflow: WorkflowRuntime
}): Promise<{ report: FinalReport; state: WorkflowState }> {
  let state = startAttempt(input.graph, input.state, input.task.id)
  await appendEvent(input.runtime, {
    attempt: state.tasks[input.task.id]!.attempt,
    generation: state.tasks[input.task.id]!.generation,
    taskId: input.task.id,
    timestamp: now(),
    type: 'attempt_started',
  })
  let report = await persistState(input.runtime, input.graph, state)
  const taskState = state.tasks[input.task.id]!
  const taskContext = await input.runtime.workspace.loadTaskContext(input.task)
  const commitMessage = createTaskCommitMessage(input.task.id, input.task.title)
  let implementArtifact: ImplementArtifact | null = null
  let reviewArtifact: null | ReviewArtifact = null
  let verifyArtifact: null | VerifyArtifact = null
  let implement
  try {
    implement = await input.workflow.roles.implementer.implement({
      attempt: taskState.attempt,
      codeContext: taskContext.codeContext,
      generation: taskState.generation,
      lastFindings: taskState.lastFindings,
      plan: taskContext.plan,
      spec: taskContext.spec,
      task: input.task,
      tasksSnippet: taskContext.tasksSnippet,
    })
    if (implement.taskId !== input.task.id) {
      throw new Error(
        `Implement taskId mismatch: expected ${input.task.id}, received ${implement.taskId}`,
      )
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    state = recordImplementFailure(input.graph, state, input.task.id, reason)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: reason,
      generation: taskState.generation,
      taskId: input.task.id,
      timestamp: now(),
      type: 'implement_failed',
    })
    report = await persistState(input.runtime, input.graph, state)
    return { report, state }
  }
  implementArtifact = {
    attempt: taskState.attempt,
    createdAt: now(),
    generation: taskState.generation,
    result: implement,
    taskId: input.task.id,
  }
  await input.runtime.store.saveImplementArtifact(implementArtifact)
  state = recordImplementSuccess(state, input.task.id)
  await appendEvent(input.runtime, {
    attempt: taskState.attempt,
    generation: taskState.generation,
    taskId: input.task.id,
    timestamp: now(),
    type: 'implement_succeeded',
  })
  await appendEvent(input.runtime, {
    attempt: taskState.attempt,
    generation: taskState.generation,
    taskId: input.task.id,
    timestamp: now(),
    type: 'verify_started',
  })
  report = await persistState(input.runtime, input.graph, state)
  let verify
  try {
    verify = await input.runtime.verifier.verify({
      commands: input.task.verifyCommands,
      taskId: input.task.id,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    state = recordVerifyFailure(input.graph, state, input.task.id, reason)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: reason,
      generation: taskState.generation,
      taskId: input.task.id,
      timestamp: now(),
      type: 'verify_failed',
    })
    report = await persistState(input.runtime, input.graph, state)
    return { report, state }
  }
  verifyArtifact = {
    attempt: taskState.attempt,
    createdAt: now(),
    generation: taskState.generation,
    result: verify,
    taskId: input.task.id,
  }
  await input.runtime.store.saveVerifyArtifact(verifyArtifact)
  state = recordVerifyResult(state, input.task.id, verify)
  await appendEvent(input.runtime, {
    attempt: taskState.attempt,
    detail: verify.summary,
    generation: taskState.generation,
    taskId: input.task.id,
    timestamp: now(),
    type: 'verify_completed',
  })
  await appendEvent(input.runtime, {
    attempt: taskState.attempt,
    generation: taskState.generation,
    taskId: input.task.id,
    timestamp: now(),
    type: 'review_started',
  })
  report = await persistState(input.runtime, input.graph, state)
  const actualChangedFiles = await input.runtime.git.getChangedFilesSinceHead()
  let review
  let reviewPhaseKind: 'approved' | 'rejected'
  try {
    const reviewPhase = await input.workflow.preset.review({
      actualChangedFiles,
      attempt: taskState.attempt,
      commitMessage,
      generation: taskState.generation,
      implement,
      lastFindings: taskState.lastFindings,
      runtime: input.runtime,
      task: input.task,
      taskContext,
      verify,
    })
    reviewPhaseKind = reviewPhase.kind
    review = reviewPhase.review
    if (review.taskId !== input.task.id) {
      throw new Error(
        `Review taskId mismatch: expected ${input.task.id}, received ${review.taskId}`,
      )
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    state = recordReviewFailure(input.graph, state, input.task.id, reason)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: reason,
      generation: taskState.generation,
      taskId: input.task.id,
      timestamp: now(),
      type: 'review_failed',
    })
    report = await persistState(input.runtime, input.graph, state)
    return { report, state }
  }
  reviewArtifact = {
    attempt: taskState.attempt,
    createdAt: now(),
    generation: taskState.generation,
    result: review,
    taskId: input.task.id,
  }
  await input.runtime.store.saveReviewArtifact(reviewArtifact)
  await appendEvent(input.runtime, {
    attempt: taskState.attempt,
    detail: review.summary,
    generation: taskState.generation,
    taskId: input.task.id,
    timestamp: now(),
    type: 'review_completed',
  })

  if (
    reviewPhaseKind === 'approved' &&
    shouldPassZeroGate({ review, verify })
  ) {
    state = recordReviewApproved(state, input.task.id, review)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      generation: taskState.generation,
      taskId: input.task.id,
      timestamp: now(),
      type: 'integrate_started',
    })
    report = await persistState(input.runtime, input.graph, state)

    let integrateResult
    try {
      integrateResult = await input.workflow.preset.integrate({
        commitMessage,
        runtime: input.runtime,
        taskId: input.task.id,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      state = recordCommitFailure(input.graph, state, input.task.id, reason)
      await appendEvent(input.runtime, {
        attempt: taskState.attempt,
        detail: reason,
        generation: taskState.generation,
        taskId: input.task.id,
        timestamp: now(),
        type: 'integrate_failed',
      })
      report = await persistState(input.runtime, input.graph, state)
      return { report, state }
    }
    const integrateArtifact: IntegrateArtifact = {
      attempt: taskState.attempt,
      createdAt: now(),
      generation: taskState.generation,
      result: integrateResult.result,
      taskId: input.task.id,
    }
    state = recordIntegrateResult(input.graph, state, input.task.id, {
      commitSha: integrateResult.result.commitSha,
      review,
      verify,
    })
    report = await persistState(input.runtime, input.graph, state)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: integrateResult.result.summary,
      generation: taskState.generation,
      taskId: input.task.id,
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
    return { report, state }
  }
  state = recordReviewResult(input.graph, state, input.task.id, {
    review,
    verify,
  })
  report = await persistState(input.runtime, input.graph, state)
  return { report, state }
}
