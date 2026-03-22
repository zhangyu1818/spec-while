import { alignStateWithGraph, createInitialWorkflowState, recordImplementFailure, recordImplementSuccess, recordReviewFailure, recordReviewResult, recordVerifyFailure, recordVerifyResult, selectNextRunnableTask, startAttempt } from './engine'
import { shouldPassZeroGate } from './engine-helpers'
import { appendEvent, finalizePassedTask, now, persistCommittedArtifacts, persistState } from './orchestrator-helpers'

import type { AgentClient } from '../agents/types'
import type { FinalReport, ImplementArtifact, ReviewArtifact, TaskGraph, VerifyArtifact, WorkflowState } from '../types'
import type { OrchestratorRuntime } from './runtime'

export async function runWorkflow(input: {
  agent: AgentClient
  graph: TaskGraph
  runtime: OrchestratorRuntime
  untilTaskId?: string
}): Promise<{ state: WorkflowState, summary: FinalReport['summary'] }> {
  await input.runtime.store.saveGraph(input.graph)
  let state = alignStateWithGraph(
    input.graph,
    await input.runtime.store.loadState() ?? createInitialWorkflowState(input.graph),
  )
  let report = await persistState(input.runtime, input.graph, state)

  for (;;) {
    if (input.untilTaskId && state.tasks[input.untilTaskId]?.status === 'done') {
      break
    }
    if (report.summary.finalStatus === 'blocked' || report.summary.finalStatus === 'replan_required') {
      break
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
    let implementArtifact: ImplementArtifact | null = null
    let verifyArtifact: null | VerifyArtifact = null
    let reviewArtifact: null | ReviewArtifact = null

    let implement
    try {
      implement = await input.agent.implement({
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
        throw new Error(`Implement taskId mismatch: expected ${task.id}, received ${implement.taskId}`)
      }
    }
    catch (error) {
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
    }
    catch (error) {
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

    const actualChangedFiles = await input.runtime.git.getChangedFilesSinceHead()

    let review
    try {
      review = await input.agent.review({
        actualChangedFiles,
        attempt: taskState.attempt,
        generation: taskState.generation,
        implement,
        lastFindings: taskState.lastFindings,
        plan: taskContext.plan,
        spec: taskContext.spec,
        task,
        tasksSnippet: taskContext.tasksSnippet,
        verify,
      })
      if (review.taskId !== task.id) {
        throw new Error(`Review taskId mismatch: expected ${task.id}, received ${review.taskId}`)
      }
    }
    catch (error) {
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

    if (shouldPassZeroGate({ review, verify })) {
      const finalized = await finalizePassedTask({
        graph: input.graph,
        review,
        runtime: input.runtime,
        state,
        taskId: task.id,
        taskTitle: task.title,
        verify,
      })
      state = finalized.state
      report = await persistState(input.runtime, input.graph, state)
      if ('commitSha' in finalized) {
        await persistCommittedArtifacts(input.runtime, {
          commitSha: finalized.commitSha,
          implementArtifact,
          reviewArtifact,
          verifyArtifact,
        })
      }
      continue
    }
    else {
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
    throw new Error(`Task ${input.taskId} is not completed and cannot be rewound`)
  }

  const parentCommit = await input.runtime.git.getParentCommit(targetTask.commitSha)
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
    if (previousTask.status === 'done' && await input.runtime.git.isAncestorOfHead(previousTask.commitSha)) {
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
      detail: taskId === input.taskId ? 'rewound manually' : `invalidated by rewind of ${input.taskId}`,
      generation: taskState.generation,
      taskId,
      timestamp: now(),
      type: taskId === input.taskId ? 'task_rewound' : 'task_invalidated',
    })
  }
  await persistState(input.runtime, graph, nextState)
  return nextState
}
