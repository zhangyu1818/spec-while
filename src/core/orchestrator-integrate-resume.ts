import { recordCommitFailure, recordIntegrateResult } from './engine'
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
  TaskGraph,
  WorkflowState,
} from '../types'
import type { WorkflowRuntime } from '../workflow/preset'
import type { OrchestratorRuntime } from './runtime'

export async function resumePullRequestIntegrate(input: {
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
  if (taskState?.status !== 'running' || taskState.stage !== 'integrate') {
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
  const [implementArtifact, reviewArtifact] = await Promise.all([
    input.runtime.store.loadImplementArtifact(artifactKey),
    input.runtime.store.loadReviewArtifact(artifactKey),
  ])

  if (!implementArtifact || !reviewArtifact) {
    const reason = `Cannot resume integrate for ${taskId} without persisted implement and review artifacts`
    const nextState = recordCommitFailure(
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
      type: 'integrate_failed',
    })
    const report = await persistState(input.runtime, input.graph, nextState)
    return {
      report,
      state: nextState,
    }
  }

  const commitMessage = createTaskCommitMessage(task.id, task.title)

  let integrateResult
  try {
    integrateResult = await input.workflow.preset.integrate({
      commitMessage,
      runtime: input.runtime,
      taskId: task.id,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const nextState = recordCommitFailure(
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
      type: 'integrate_failed',
    })
    const report = await persistState(input.runtime, input.graph, nextState)
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
  const nextState = recordIntegrateResult(input.graph, input.state, task.id, {
    commitSha: integrateResult.result.commitSha,
    review: reviewArtifact.result,
  })
  const report = await persistState(input.runtime, input.graph, nextState)
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
  })
  return {
    report,
    state: nextState,
  }
}
