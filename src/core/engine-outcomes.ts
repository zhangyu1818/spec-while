import {
  cloneState,
  collectDescendants,
  getTask,
  getTaskState,
  shouldPassZeroGate,
  withReviewMetadata,
} from './engine-helpers'

import type {
  FinalReport,
  ReviewOutput,
  TaskGraph,
  VerifyResult,
  WorkflowState,
} from '../types'

export function recordReviewApproved(
  state: WorkflowState,
  taskId: string,
  review: ReviewOutput,
): WorkflowState {
  const next = cloneState(state)
  const taskState = getTaskState(next, taskId)
  if (taskState.status !== 'running' || taskState.stage !== 'review') {
    throw new Error(`Task ${taskId} is not reviewing`)
  }
  if (review.verdict !== 'pass') {
    throw new Error(`Task ${taskId} review is not approved`)
  }
  next.tasks[taskId] = {
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
  taskId: string,
  input: {
    commitSha: string
    review: ReviewOutput
    verify: VerifyResult
  },
): WorkflowState {
  const next = cloneState(state)
  const taskState = getTaskState(next, taskId)
  if (taskState.status !== 'running' || taskState.stage !== 'integrate') {
    throw new Error(`Task ${taskId} is not integrating`)
  }
  if (!shouldPassZeroGate(input)) {
    throw new Error(
      `Task ${taskId} integration requires an approved review and passing verify result`,
    )
  }
  next.currentTaskId = null
  next.tasks[taskId] = {
    ...withReviewMetadata(taskState, {
      findings: input.review.findings,
      reviewVerdict: input.review.verdict,
      verifyPassed: input.verify.passed,
    }),
    commitSha: input.commitSha,
    status: 'done',
  }
  return next
}

export function recordCommitFailure(
  graph: TaskGraph,
  state: WorkflowState,
  taskId: string,
  reason: string,
): WorkflowState {
  const next = cloneState(state)
  const task = getTask(graph, taskId)
  const taskState = getTaskState(next, taskId)
  next.currentTaskId = null
  const metadata = withReviewMetadata(taskState, {
    reviewVerdict: 'pass',
    verifyPassed: true,
  })
  next.tasks[taskId] =
    taskState.attempt >= task.maxAttempts
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

export function rewindTaskGeneration(
  graph: TaskGraph,
  state: WorkflowState,
  taskId: string,
) {
  const next = cloneState(state)
  const descendants = collectDescendants(graph, taskId)
  const resetTaskIds = [taskId, ...descendants]
  const uncheckedTaskIds: string[] = []

  next.currentTaskId = null
  for (const currentTaskId of resetTaskIds) {
    const taskState = getTaskState(next, currentTaskId)
    if (taskState.status === 'done') {
      uncheckedTaskIds.push(currentTaskId)
    }
    next.tasks[currentTaskId] = {
      attempt: 0,
      generation: taskState.generation + 1,
      invalidatedBy: currentTaskId === taskId ? null : taskId,
      lastFindings: [],
      status: 'pending',
    }
  }

  return {
    state: next,
    uncheckedTaskIds,
  }
}

export function buildReport(
  graph: TaskGraph,
  state: WorkflowState,
  generatedAt: string,
): FinalReport {
  const tasks = graph.tasks.map((task) => {
    const taskState = getTaskState(state, task.id)
    return {
      id: task.id,
      attempt: taskState.attempt,
      generation: taskState.generation,
      ...('commitSha' in taskState ? { commitSha: taskState.commitSha } : {}),
      ...(taskState.lastReviewVerdict
        ? { lastReviewVerdict: taskState.lastReviewVerdict }
        : {}),
      ...(typeof taskState.lastVerifyPassed === 'boolean'
        ? { lastVerifyPassed: taskState.lastVerifyPassed }
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
