import {
  cloneState,
  getMaxIterations,
  getTaskState,
  shouldPassZeroGate,
  withReviewMetadata,
} from './engine-helpers'

import type {
  FinalReport,
  ReviewOutput,
  TaskGraph,
  WorkflowState,
} from '../types'

export function recordReviewApproved(
  state: WorkflowState,
  taskHandle: string,
  review: ReviewOutput,
): WorkflowState {
  const next = cloneState(state)
  const taskState = getTaskState(next, taskHandle)
  if (taskState.status !== 'running' || taskState.stage !== 'review') {
    throw new Error(`Task ${taskHandle} is not reviewing`)
  }
  if (review.verdict !== 'pass') {
    throw new Error(`Task ${taskHandle} review is not approved`)
  }
  next.tasks[taskHandle] = {
    ...withReviewMetadata(taskState, {
      findings: review.findings,
      reviewVerdict: review.verdict,
    }),
    stage: 'integrate',
    status: 'running',
  }
  return next
}

export function recordIntegrateResult(
  _graph: TaskGraph,
  state: WorkflowState,
  taskHandle: string,
  input: RecordIntegrateResultInput,
): WorkflowState {
  const next = cloneState(state)
  const taskState = getTaskState(next, taskHandle)
  if (taskState.status !== 'running' || taskState.stage !== 'integrate') {
    throw new Error(`Task ${taskHandle} is not integrating`)
  }
  if (!shouldPassZeroGate(input)) {
    throw new Error(
      `Task ${taskHandle} integration requires an approved review`,
    )
  }
  next.currentTaskHandle = null
  next.tasks[taskHandle] = {
    ...withReviewMetadata(taskState, {
      findings: input.review.findings,
      reviewVerdict: input.review.verdict,
    }),
    commitSha: input.commitSha,
    status: 'done',
  }
  return next
}

export interface RecordIntegrateResultInput {
  commitSha: string
  review: ReviewOutput
}

export function recordCommitFailure(
  graph: TaskGraph,
  state: WorkflowState,
  taskHandle: string,
  reason: string,
): WorkflowState {
  const next = cloneState(state)
  const taskState = getTaskState(next, taskHandle)
  next.currentTaskHandle = null
  const metadata = withReviewMetadata(taskState, {
    reviewVerdict: 'pass',
  })
  next.tasks[taskHandle] =
    taskState.attempt >= getMaxIterations(graph)
      ? {
          ...metadata,
          reason,
          status: 'blocked',
        }
      : {
          ...metadata,
          status: 'rework',
        }
  return next
}

export function recordReviewFailure(
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

export function buildReport(
  graph: TaskGraph,
  state: WorkflowState,
  generatedAt: string,
): FinalReport {
  const tasks = graph.tasks.map((task) => {
    const taskState = getTaskState(state, task.handle)
    return {
      attempt: taskState.attempt,
      generation: taskState.generation,
      taskHandle: task.handle,
      ...('commitSha' in taskState ? { commitSha: taskState.commitSha } : {}),
      ...(taskState.lastReviewVerdict
        ? { lastReviewVerdict: taskState.lastReviewVerdict }
        : {}),
      ...('reason' in taskState ? { reason: taskState.reason } : {}),
      status: taskState.status,
    }
  })

  const blockedTasks = tasks.filter((task) => task.status === 'blocked').length
  const completedTasks = tasks.filter((task) => task.status === 'done').length
  const replanTasks = tasks.filter((task) => task.status === 'replan').length
  const finalStatus =
    replanTasks > 0
      ? 'replan_required'
      : blockedTasks > 0
        ? 'blocked'
        : completedTasks === tasks.length
          ? 'completed'
          : 'in_progress'

  return {
    featureId: graph.featureId,
    generatedAt,
    tasks,
    summary: {
      blockedTasks,
      completedTasks,
      finalStatus,
      replanTasks,
      totalTasks: tasks.length,
    },
  }
}
