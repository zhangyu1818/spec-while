import {
  canStartTask,
  cloneState,
  createBaseTaskState,
  getTask,
  getTaskState,
  shouldPassZeroGate,
  withReviewMetadata,
} from './engine-helpers'

import type {
  ReviewOutput,
  TaskDefinition,
  TaskGraph,
  WorkflowState,
} from '../types'

export {
  buildReport,
  recordCommitFailure,
  recordIntegrateResult,
  recordReviewApproved,
  recordReviewFailure,
  rewindTaskGeneration,
} from './engine-outcomes'

export function createInitialWorkflowState(graph: TaskGraph): WorkflowState {
  return {
    currentTaskId: null,
    featureId: graph.featureId,
    tasks: Object.fromEntries(
      graph.tasks.map((task) => [task.id, createBaseTaskState()]),
    ),
  }
}

export function alignStateWithGraph(
  graph: TaskGraph,
  state: WorkflowState,
  options?: {
    preserveRunningIntegrate?: boolean
    preserveRunningReview?: boolean
  },
): WorkflowState {
  const next = cloneState(state)
  const alignedTasks = Object.fromEntries(
    graph.tasks.map((task) => {
      const existing = next.tasks[task.id] ?? createBaseTaskState()
      if (existing.status === 'running') {
        if (
          (options?.preserveRunningReview && existing.stage === 'review') ||
          (options?.preserveRunningIntegrate && existing.stage === 'integrate')
        ) {
          return [task.id, existing]
        }
        return [
          task.id,
          {
            attempt: existing.attempt,
            generation: existing.generation,
            invalidatedBy: existing.invalidatedBy,
            lastFindings: existing.lastFindings,
            ...(existing.lastReviewVerdict
              ? { lastReviewVerdict: existing.lastReviewVerdict }
              : {}),
            status: 'rework' as const,
          },
        ]
      }
      return [task.id, existing]
    }),
  )

  return {
    featureId: graph.featureId,
    tasks: alignedTasks,
    currentTaskId:
      next.currentTaskId && alignedTasks[next.currentTaskId]
        ? next.currentTaskId
        : null,
  }
}

export function selectNextRunnableTask(
  graph: TaskGraph,
  state: WorkflowState,
): null | TaskDefinition {
  return (
    graph.tasks.find((task) => {
      const taskState = state.tasks[task.id]
      if (!taskState) {
        return false
      }
      if (taskState.status === 'rework') {
        return true
      }
      return (
        taskState.status === 'pending' && canStartTask(graph, state, task.id)
      )
    }) ?? null
  )
}

export function startAttempt(
  graph: TaskGraph,
  state: WorkflowState,
  taskId: string,
): WorkflowState {
  const taskState = getTaskState(state, taskId)
  if (taskState.status !== 'pending' && taskState.status !== 'rework') {
    throw new Error(`Task ${taskId} is not runnable`)
  }
  if (taskState.status === 'pending' && !canStartTask(graph, state, taskId)) {
    throw new Error(`Task ${taskId} dependencies are not completed`)
  }
  const next = cloneState(state)
  const current = getTaskState(next, taskId)
  next.currentTaskId = taskId
  next.tasks[taskId] = {
    ...current,
    attempt: current.attempt + 1,
    invalidatedBy: null,
    stage: 'implement',
    status: 'running',
  }
  return next
}

export function recordImplementSuccess(
  state: WorkflowState,
  taskId: string,
): WorkflowState {
  const next = cloneState(state)
  const taskState = getTaskState(next, taskId)
  if (taskState.status !== 'running' || taskState.stage !== 'implement') {
    throw new Error(`Task ${taskId} is not implementing`)
  }
  next.tasks[taskId] = {
    ...taskState,
    stage: 'review',
    status: 'running',
  }
  return next
}

export function recordImplementFailure(
  graph: TaskGraph,
  state: WorkflowState,
  taskId: string,
  reason: string,
): WorkflowState {
  const next = cloneState(state)
  const task = getTask(graph, taskId)
  const taskState = getTaskState(next, taskId)
  next.currentTaskId = null
  next.tasks[taskId] =
    taskState.attempt >= task.maxAttempts
      ? {
          ...withReviewMetadata(taskState, {}),
          reason,
          status: 'blocked',
        }
      : {
          ...withReviewMetadata(taskState, {}),
          status: 'rework',
        }
  return next
}

export function recordReviewResult(
  graph: TaskGraph,
  state: WorkflowState,
  taskId: string,
  input: { review: ReviewOutput },
): WorkflowState {
  const next = cloneState(state)
  const task = getTask(graph, taskId)
  const taskState = getTaskState(next, taskId)
  next.currentTaskId = null
  const metadata = withReviewMetadata(taskState, {
    findings: input.review.findings,
    reviewVerdict: input.review.verdict,
  })

  if (shouldPassZeroGate(input)) {
    throw new Error(
      `Task ${taskId} requires integrate result after approved review`,
    )
  }

  if (input.review.verdict === 'replan') {
    next.tasks[taskId] = {
      ...metadata,
      reason: input.review.summary,
      status: 'replan',
    }
    return next
  }

  if (input.review.verdict === 'blocked') {
    next.tasks[taskId] = {
      ...metadata,
      reason: input.review.summary,
      status: 'blocked',
    }
    return next
  }

  next.tasks[taskId] =
    taskState.attempt >= task.maxAttempts
      ? {
          ...metadata,
          reason: input.review.summary,
          status: 'blocked',
        }
      : {
          ...metadata,
          status: 'rework',
        }
  return next
}
