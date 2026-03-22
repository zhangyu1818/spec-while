import { canStartTask, cloneState, collectDescendants, createBaseTaskState, getTask, getTaskState, shouldPassZeroGate, withReviewMetadata } from './engine-helpers'

import type {
  FinalReport,
  ReviewOutput,
  TaskDefinition,
  TaskGraph,
  VerifyResult,
  WorkflowState,
} from '../types'

export function createInitialWorkflowState(graph: TaskGraph): WorkflowState {
  return {
    currentTaskId: null,
    featureId: graph.featureId,
    tasks: Object.fromEntries(graph.tasks.map((task) => [task.id, createBaseTaskState()])),
  }
}

export function alignStateWithGraph(graph: TaskGraph, state: WorkflowState): WorkflowState {
  const next = cloneState(state)
  const alignedTasks = Object.fromEntries(
    graph.tasks.map((task) => {
      const existing = next.tasks[task.id] ?? createBaseTaskState()
      if (existing.status === 'running') {
        return [task.id, {
          attempt: existing.attempt,
          generation: existing.generation,
          invalidatedBy: existing.invalidatedBy,
          lastFindings: existing.lastFindings,
          ...(existing.lastReviewVerdict ? { lastReviewVerdict: existing.lastReviewVerdict } : {}),
          ...(existing.lastVerifyPassed !== undefined ? { lastVerifyPassed: existing.lastVerifyPassed } : {}),
          status: 'rework' as const,
        }]
      }
      return [task.id, existing]
    }),
  )

  return {
    currentTaskId: next.currentTaskId && alignedTasks[next.currentTaskId] ? next.currentTaskId : null,
    featureId: graph.featureId,
    tasks: alignedTasks,
  }
}

export function selectNextRunnableTask(graph: TaskGraph, state: WorkflowState): null | TaskDefinition {
  return graph.tasks.find((task) => {
    const taskState = state.tasks[task.id]
    if (!taskState) {
      return false
    }
    if (taskState.status === 'rework') {
      return true
    }
    return taskState.status === 'pending' && canStartTask(graph, state, task.id)
  }) ?? null
}

export function startAttempt(graph: TaskGraph, state: WorkflowState, taskId: string): WorkflowState {
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

export function recordImplementSuccess(state: WorkflowState, taskId: string): WorkflowState {
  const next = cloneState(state)
  const taskState = getTaskState(next, taskId)
  if (taskState.status !== 'running' || taskState.stage !== 'implement') {
    throw new Error(`Task ${taskId} is not implementing`)
  }
  next.tasks[taskId] = {
    ...taskState,
    stage: 'verify',
    status: 'running',
  }
  return next
}

export function recordImplementFailure(graph: TaskGraph, state: WorkflowState, taskId: string, reason: string): WorkflowState {
  const next = cloneState(state)
  const task = getTask(graph, taskId)
  const taskState = getTaskState(next, taskId)
  next.currentTaskId = null
  next.tasks[taskId] = taskState.attempt >= task.maxAttempts
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

export function recordVerifyResult(state: WorkflowState, taskId: string, verify: VerifyResult): WorkflowState {
  const next = cloneState(state)
  const taskState = getTaskState(next, taskId)
  if (taskState.status !== 'running' || taskState.stage !== 'verify') {
    throw new Error(`Task ${taskId} is not verifying`)
  }
  next.tasks[taskId] = {
    ...withReviewMetadata(taskState, {
      verifyPassed: verify.passed,
    }),
    stage: 'review',
    status: 'running',
  }
  return next
}

export function recordVerifyFailure(graph: TaskGraph, state: WorkflowState, taskId: string, reason: string): WorkflowState {
  const next = cloneState(state)
  const task = getTask(graph, taskId)
  const taskState = getTaskState(next, taskId)
  next.currentTaskId = null
  next.tasks[taskId] = taskState.attempt >= task.maxAttempts
    ? {
        ...withReviewMetadata(taskState, {
          verifyPassed: false,
        }),
        reason,
        status: 'blocked',
      }
    : {
        ...withReviewMetadata(taskState, {
          verifyPassed: false,
        }),
        status: 'rework',
      }
  return next
}

export function recordReviewResult(
  graph: TaskGraph,
  state: WorkflowState,
  taskId: string,
  input: {
    commitSha?: string
    review: ReviewOutput
    verify: VerifyResult
  },
): WorkflowState {
  const next = cloneState(state)
  const task = getTask(graph, taskId)
  const taskState = getTaskState(next, taskId)
  next.currentTaskId = null
  const metadata = withReviewMetadata(taskState, {
    findings: input.review.findings,
    reviewVerdict: input.review.verdict,
    verifyPassed: input.verify.passed,
  })

  if (shouldPassZeroGate(input)) {
    if (!input.commitSha) {
      throw new Error(`Task ${taskId} requires commitSha before completion`)
    }
    next.tasks[taskId] = {
      ...metadata,
      commitSha: input.commitSha,
      status: 'done',
    }
    return next
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

  next.tasks[taskId] = taskState.attempt >= task.maxAttempts
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

export function recordCommitFailure(graph: TaskGraph, state: WorkflowState, taskId: string, reason: string): WorkflowState {
  const next = cloneState(state)
  const task = getTask(graph, taskId)
  const taskState = getTaskState(next, taskId)
  next.currentTaskId = null
  const metadata = withReviewMetadata(taskState, {
    reviewVerdict: 'pass',
    verifyPassed: true,
  })
  next.tasks[taskId] = taskState.attempt >= task.maxAttempts
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

export function recordReviewFailure(graph: TaskGraph, state: WorkflowState, taskId: string, reason: string): WorkflowState {
  const next = cloneState(state)
  const task = getTask(graph, taskId)
  const taskState = getTaskState(next, taskId)
  next.currentTaskId = null
  next.tasks[taskId] = taskState.attempt >= task.maxAttempts
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

export function rewindTaskGeneration(graph: TaskGraph, state: WorkflowState, taskId: string) {
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

export function buildReport(graph: TaskGraph, state: WorkflowState, generatedAt: string): FinalReport {
  const tasks = graph.tasks.map((task) => {
    const taskState = getTaskState(state, task.id)
    return {
      id: task.id,
      attempt: taskState.attempt,
      generation: taskState.generation,
      ...('commitSha' in taskState ? { commitSha: taskState.commitSha } : {}),
      ...(taskState.lastReviewVerdict ? { lastReviewVerdict: taskState.lastReviewVerdict } : {}),
      ...(typeof taskState.lastVerifyPassed === 'boolean' ? { lastVerifyPassed: taskState.lastVerifyPassed } : {}),
      ...('reason' in taskState ? { reason: taskState.reason } : {}),
      status: taskState.status,
    }
  })

  const blockedTasks = tasks.filter((task) => task.status === 'blocked').length
  const completedTasks = tasks.filter((task) => task.status === 'done').length
  const replanTasks = tasks.filter((task) => task.status === 'replan').length
  const finalStatus = replanTasks > 0
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
