import {
  alignStateWithGraph,
  createInitialWorkflowState,
  recordCommitFailure,
  recordImplementFailure,
  recordImplementSuccess,
  recordIntegrateResult,
  recordReviewApproved,
  recordReviewFailure,
  recordReviewResult,
  recordVerifyFailure,
  recordVerifyResult,
  selectNextRunnableTask,
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
  TaskGraph,
  VerifyArtifact,
  WorkflowState,
} from '../types'
import type { WorkflowRuntime } from '../workflow/preset'
import type { OrchestratorRuntime } from './runtime'

async function resumePullRequestReview(input: {
  graph: TaskGraph
  runtime: OrchestratorRuntime
  state: WorkflowState
  workflow: WorkflowRuntime
}): Promise<null | { report: FinalReport; state: WorkflowState }> {
  if (input.workflow.preset.mode !== 'pull-request' || !input.state.currentTaskId) {
    return null
  }

  const taskId = input.state.currentTaskId
  const taskState = input.state.tasks[taskId]
  if (
    taskState?.status !== 'running' ||
    taskState.stage !== 'review'
  ) {
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
    const nextState = recordReviewFailure(input.graph, input.state, task.id, reason)
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

export async function runWorkflow(input: {
  graph: TaskGraph
  runtime: OrchestratorRuntime
  untilTaskId?: string
  workflow: WorkflowRuntime
}): Promise<{ state: WorkflowState; summary: FinalReport['summary'] }> {
  const workflow = input.workflow
  await input.runtime.store.saveGraph(input.graph)
  let state = alignStateWithGraph(
    input.graph,
    (await input.runtime.store.loadState()) ??
      createInitialWorkflowState(input.graph),
    {
      preserveRunningReview: input.workflow.preset.mode === 'pull-request',
    },
  )
  let report = await persistState(input.runtime, input.graph, state)

  for (;;) {
    if (
      input.untilTaskId &&
      state.tasks[input.untilTaskId]?.status === 'done'
    ) {
      break
    }
    if (
      report.summary.finalStatus === 'blocked' ||
      report.summary.finalStatus === 'replan_required'
    ) {
      break
    }

    const resumedReview = await resumePullRequestReview({
      graph: input.graph,
      runtime: input.runtime,
      state,
      workflow,
    })
    if (resumedReview) {
      report = resumedReview.report
      state = resumedReview.state
      continue
    }

    const task = selectNextRunnableTask(input.graph, state)
    if (!task) {
      break
    }

    state = startAttempt(input.graph, state, task.id)
    await appendEvent(input.runtime, {
      attempt: state.tasks[task.id]!.attempt,
      generation: state.tasks[task.id]!.generation,
      taskId: task.id,
      timestamp: now(),
      type: 'attempt_started',
    })
    report = await persistState(input.runtime, input.graph, state)

    const taskState = state.tasks[task.id]!
    const taskContext = await input.runtime.workspace.loadTaskContext(task)
    const commitMessage = createTaskCommitMessage(task.id, task.title)
    let implementArtifact: ImplementArtifact | null = null
    let verifyArtifact: null | VerifyArtifact = null
    let reviewArtifact: null | ReviewArtifact = null

    let implement
    try {
      implement = await workflow.roles.implementer.implement({
        attempt: taskState.attempt,
        codeContext: taskContext.codeContext,
        generation: taskState.generation,
        lastFindings: taskState.lastFindings,
        plan: taskContext.plan,
        spec: taskContext.spec,
        task,
        tasksSnippet: taskContext.tasksSnippet,
      })
      if (implement.taskId !== task.id) {
        throw new Error(
          `Implement taskId mismatch: expected ${task.id}, received ${implement.taskId}`,
        )
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      state = recordImplementFailure(input.graph, state, task.id, reason)
      await appendEvent(input.runtime, {
        attempt: taskState.attempt,
        detail: reason,
        generation: taskState.generation,
        taskId: task.id,
        timestamp: now(),
        type: 'implement_failed',
      })
      report = await persistState(input.runtime, input.graph, state)
      continue
    }

    implementArtifact = {
      attempt: taskState.attempt,
      createdAt: now(),
      generation: taskState.generation,
      result: implement,
      taskId: task.id,
    }
    await input.runtime.store.saveImplementArtifact(implementArtifact)
    state = recordImplementSuccess(state, task.id)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      generation: taskState.generation,
      taskId: task.id,
      timestamp: now(),
      type: 'implement_succeeded',
    })
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      generation: taskState.generation,
      taskId: task.id,
      timestamp: now(),
      type: 'verify_started',
    })
    report = await persistState(input.runtime, input.graph, state)

    let verify
    try {
      verify = await input.runtime.verifier.verify({
        commands: task.verifyCommands,
        taskId: task.id,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      state = recordVerifyFailure(input.graph, state, task.id, reason)
      await appendEvent(input.runtime, {
        attempt: taskState.attempt,
        detail: reason,
        generation: taskState.generation,
        taskId: task.id,
        timestamp: now(),
        type: 'verify_failed',
      })
      report = await persistState(input.runtime, input.graph, state)
      continue
    }

    verifyArtifact = {
      attempt: taskState.attempt,
      createdAt: now(),
      generation: taskState.generation,
      result: verify,
      taskId: task.id,
    }
    await input.runtime.store.saveVerifyArtifact(verifyArtifact)
    state = recordVerifyResult(state, task.id, verify)
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      detail: verify.summary,
      generation: taskState.generation,
      taskId: task.id,
      timestamp: now(),
      type: 'verify_completed',
    })
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      generation: taskState.generation,
      taskId: task.id,
      timestamp: now(),
      type: 'review_started',
    })
    report = await persistState(input.runtime, input.graph, state)

    const actualChangedFiles =
      await input.runtime.git.getChangedFilesSinceHead()

    let review
    let reviewPhaseKind: 'approved' | 'rejected'
    try {
      const reviewPhase = await workflow.preset.review({
        actualChangedFiles,
        attempt: taskState.attempt,
        commitMessage,
        generation: taskState.generation,
        implement,
        lastFindings: taskState.lastFindings,
        runtime: input.runtime,
        task,
        taskContext,
        verify,
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
      state = recordReviewFailure(input.graph, state, task.id, reason)
      await appendEvent(input.runtime, {
        attempt: taskState.attempt,
        detail: reason,
        generation: taskState.generation,
        taskId: task.id,
        timestamp: now(),
        type: 'review_failed',
      })
      report = await persistState(input.runtime, input.graph, state)
      continue
    }

    reviewArtifact = {
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
      shouldPassZeroGate({ review, verify })
    ) {
      state = recordReviewApproved(state, task.id, review)
      await appendEvent(input.runtime, {
        attempt: taskState.attempt,
        generation: taskState.generation,
        taskId: task.id,
        timestamp: now(),
        type: 'integrate_started',
      })
      report = await persistState(input.runtime, input.graph, state)

      let integrateResult
      try {
        integrateResult = await workflow.preset.integrate({
          commitMessage,
          runtime: input.runtime,
          taskId: task.id,
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        state = recordCommitFailure(input.graph, state, task.id, reason)
        await appendEvent(input.runtime, {
          attempt: taskState.attempt,
          detail: reason,
          generation: taskState.generation,
          taskId: task.id,
          timestamp: now(),
          type: 'integrate_failed',
        })
        report = await persistState(input.runtime, input.graph, state)
        continue
      }

      const integrateArtifact: IntegrateArtifact = {
        attempt: taskState.attempt,
        createdAt: now(),
        generation: taskState.generation,
        result: integrateResult.result,
        taskId: task.id,
      }
      state = recordIntegrateResult(input.graph, state, task.id, {
        commitSha: integrateResult.result.commitSha,
        review,
        verify,
      })
      report = await persistState(input.runtime, input.graph, state)
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
      continue
    } else {
      state = recordReviewResult(input.graph, state, task.id, {
        review,
        verify,
      })
    }
    report = await persistState(input.runtime, input.graph, state)
  }

  return {
    state,
    summary: report.summary,
  }
}

export async function rewindTask(input: {
  loadGraph: () => Promise<TaskGraph>
  runtime: OrchestratorRuntime
  taskId: string
}) {
  const state = await input.runtime.store.loadState()
  if (!state) {
    throw new Error('Cannot rewind before workflow state exists')
  }
  const targetTask = state.tasks[input.taskId]
  if (targetTask?.status !== 'done') {
    throw new Error(
      `Task ${input.taskId} is not completed and cannot be rewound`,
    )
  }

  const parentCommit = await input.runtime.git.getParentCommit(
    targetTask.commitSha,
  )
  await input.runtime.git.resetHard(parentCommit)
  await input.runtime.store.reset()

  const graph = await input.loadGraph()
  const nextState = createInitialWorkflowState(graph)
  const rewoundTaskIds: string[] = []

  for (const task of graph.tasks) {
    const previousTask = state.tasks[task.id]
    if (!previousTask) {
      continue
    }
    if (
      previousTask.status === 'done' &&
      (await input.runtime.git.isAncestorOfHead(previousTask.commitSha))
    ) {
      nextState.tasks[task.id] = previousTask
      continue
    }
    if (previousTask.status === 'done') {
      rewoundTaskIds.push(task.id)
      nextState.tasks[task.id] = {
        attempt: 0,
        generation: previousTask.generation + 1,
        invalidatedBy: task.id === input.taskId ? null : input.taskId,
        lastFindings: [],
        status: 'pending',
      }
    }
  }

  await input.runtime.store.saveGraph(graph)
  for (const taskId of rewoundTaskIds) {
    const taskState = nextState.tasks[taskId]!
    await appendEvent(input.runtime, {
      attempt: taskState.attempt,
      generation: taskState.generation,
      taskId,
      timestamp: now(),
      type: taskId === input.taskId ? 'task_rewound' : 'task_invalidated',
      detail:
        taskId === input.taskId
          ? 'rewound manually'
          : `invalidated by rewind of ${input.taskId}`,
    })
  }
  await persistState(input.runtime, graph, nextState)
  return nextState
}
