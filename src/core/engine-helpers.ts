import type {
  ReviewFinding,
  ReviewOutput,
  TaskDefinition,
  TaskGraph,
  TaskState,
  VerifyResult,
  WorkflowState,
} from '../types'

export function cloneState(state: WorkflowState): WorkflowState {
  return structuredClone(state)
}

export function createBaseTaskState(): Extract<TaskState, { status: 'pending' }> {
  return {
    attempt: 0,
    generation: 1,
    invalidatedBy: null,
    lastFindings: [],
    status: 'pending',
  }
}

export function getTask(graph: TaskGraph, taskId: string): TaskDefinition {
  const task = graph.tasks.find((item) => item.id === taskId)
  if (!task) {
    throw new Error(`Unknown task: ${taskId}`)
  }
  return task
}

export function getTaskState(state: WorkflowState, taskId: string): TaskState {
  const taskState = state.tasks[taskId]
  if (!taskState) {
    throw new Error(`Missing state for task ${taskId}`)
  }
  return taskState
}

export function canStartTask(graph: TaskGraph, state: WorkflowState, taskId: string) {
  const task = getTask(graph, taskId)
  return task.dependsOn.every((dependency) => state.tasks[dependency]?.status === 'done')
}

export function withReviewMetadata(taskState: TaskState, input: {
  findings?: ReviewFinding[]
  reviewVerdict?: ReviewOutput['verdict']
  verifyPassed?: boolean
}) {
  const next = {
    attempt: taskState.attempt,
    generation: taskState.generation,
    invalidatedBy: taskState.invalidatedBy,
    lastFindings: taskState.lastFindings,
    ...(taskState.lastReviewVerdict ? { lastReviewVerdict: taskState.lastReviewVerdict } : {}),
    ...(typeof taskState.lastVerifyPassed === 'boolean' ? { lastVerifyPassed: taskState.lastVerifyPassed } : {}),
  }
  if (input.findings) {
    next.lastFindings = input.findings
  }
  if (input.reviewVerdict) {
    next.lastReviewVerdict = input.reviewVerdict
  }
  if (typeof input.verifyPassed === 'boolean') {
    next.lastVerifyPassed = input.verifyPassed
  }
  return next
}

export function shouldPassZeroGate(input: {
  review: ReviewOutput
  verify: VerifyResult
}) {
  return input.review.verdict === 'pass'
    && input.review.findings.length === 0
    && input.review.acceptanceChecks.every((check) => check.status === 'pass')
    && input.verify.passed
}

export function collectDescendants(graph: TaskGraph, taskId: string, seen = new Set<string>()) {
  for (const task of graph.tasks) {
    if (task.dependsOn.includes(taskId) && !seen.has(task.id)) {
      seen.add(task.id)
      collectDescendants(graph, task.id, seen)
    }
  }
  return seen
}
