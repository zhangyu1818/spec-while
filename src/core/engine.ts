import {
  canStartTask,
  cloneState,
  createBaseTaskState,
  getMaxIterations,
  getTaskState,
  shouldPassZeroGate,
  withReviewMetadata,
} from './engine-helpers'

import type { ReviewOutput, TaskGraph, WorkflowState } from '../types'

export {
  buildReport,
  recordCommitFailure,
  recordIntegrateResult,
  recordReviewApproved,
  recordReviewFailure,
} from './engine-outcomes'

export function createInitialWorkflowState(graph: TaskGraph): WorkflowState {
  return {
    currentTaskHandle: null,
    featureId: graph.featureId,
    tasks: Object.fromEntries(
      graph.tasks.map((task) => [task.handle, createBaseTaskState()]),
    ),
  }
}

export function alignStateWithGraph(
  graph: TaskGraph,
  state: WorkflowState,
  options?: AlignStateWithGraphOptions,
): WorkflowState {
  const next = cloneState(state)
  const alignedTasks = Object.fromEntries(
    graph.tasks.map((task) => {
      const existing = next.tasks[task.handle] ?? createBaseTaskState()
      if (existing.status === 'running') {
        if (
          (options?.preserveRunningReview && existing.stage === 'review') ||
          (options?.preserveRunningIntegrate && existing.stage === 'integrate')
        ) {
          return [task.handle, existing]
        }
        return [
          task.handle,
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
      return [task.handle, existing]
    }),
  )

  return {
    featureId: graph.featureId,
    tasks: alignedTasks,
    currentTaskHandle:
      next.currentTaskHandle && alignedTasks[next.currentTaskHandle]
        ? next.currentTaskHandle
        : null,
  }
}

export function selectNextRunnableTask(
  graph: TaskGraph,
  state: WorkflowState,
): null | string {
  return (
    graph.tasks.find((task) => {
      const taskState = state.tasks[task.handle]
      if (!taskState) {
        return false
      }
      if (taskState.status === 'rework') {
        return true
      }
      return (
        taskState.status === 'pending' &&
        canStartTask(graph, state, task.handle)
      )
    })?.handle ?? null
  )
}

export function startAttempt(
  graph: TaskGraph,
  state: WorkflowState,
  taskHandle: string,
): WorkflowState {
  const taskState = getTaskState(state, taskHandle)
  if (taskState.status !== 'pending' && taskState.status !== 'rework') {
    throw new Error(`Task ${taskHandle} is not runnable`)
  }
  if (
    taskState.status === 'pending' &&
    !canStartTask(graph, state, taskHandle)
  ) {
    throw new Error(`Task ${taskHandle} dependencies are not completed`)
  }
  const next = cloneState(state)
  const current = getTaskState(next, taskHandle)
  next.currentTaskHandle = taskHandle
  next.tasks[taskHandle] = {
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
  taskHandle: string,
): WorkflowState {
  const next = cloneState(state)
  const taskState = getTaskState(next, taskHandle)
  if (taskState.status !== 'running' || taskState.stage !== 'implement') {
    throw new Error(`Task ${taskHandle} is not implementing`)
  }
  next.tasks[taskHandle] = {
    ...taskState,
    stage: 'review',
    status: 'running',
  }
  return next
}

export function recordImplementFailure(
  graph: TaskGraph,
  state: WorkflowState,
  taskHandle: string,
  reason: string,
): WorkflowState {
  const next = cloneState(state)
  const taskState = getTaskState(next, taskHandle)
  next.currentTaskHandle = null
  next.tasks[taskHandle] =
    taskState.attempt >= getMaxIterations(graph)
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
  taskHandle: string,
  input: RecordReviewResultInput,
): WorkflowState {
  const next = cloneState(state)
  const taskState = getTaskState(next, taskHandle)
  next.currentTaskHandle = null
  const metadata = withReviewMetadata(taskState, {
    findings: input.review.findings,
    reviewVerdict: input.review.verdict,
  })

  if (shouldPassZeroGate(input)) {
    throw new Error(
      `Task ${taskHandle} requires integrate result after approved review`,
    )
  }

  if (input.review.verdict === 'replan') {
    next.tasks[taskHandle] = {
      ...metadata,
      reason: input.review.summary,
      status: 'replan',
    }
    return next
  }

  if (input.review.verdict === 'blocked') {
    next.tasks[taskHandle] = {
      ...metadata,
      reason: input.review.summary,
      status: 'blocked',
    }
    return next
  }

  next.tasks[taskHandle] =
    taskState.attempt >= getMaxIterations(graph)
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

export interface AlignStateWithGraphOptions {
  preserveRunningIntegrate?: boolean
  preserveRunningReview?: boolean
}

export interface RecordReviewResultInput {
  review: ReviewOutput
}
