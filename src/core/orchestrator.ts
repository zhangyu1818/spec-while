import {
  alignStateWithGraph,
  createInitialWorkflowState,
  selectNextRunnableTask,
} from './engine'
import { persistState } from './orchestrator-helpers'
import { resumePullRequestIntegrate } from './orchestrator-integrate-resume'
import { resumePullRequestReview } from './orchestrator-review-resume'
import { executeTaskAttempt } from './orchestrator-task-attempt'

import type { FinalReport, TaskGraph, WorkflowState } from '../types'
import type { WorkflowRuntime } from '../workflow/preset'
import type { OrchestratorRuntime } from './runtime'

export interface WorkflowRunResult {
  state: WorkflowState
  summary: FinalReport['summary']
}

export interface RunWorkflowInput {
  graph: TaskGraph
  runtime: OrchestratorRuntime
  untilTaskHandle?: string
  workflow: WorkflowRuntime
}

export async function runWorkflow(
  input: RunWorkflowInput,
): Promise<WorkflowRunResult> {
  const workflow = input.workflow
  const isPullRequestMode = workflow.preset.mode === 'pull-request'
  await input.runtime.store.saveGraph(input.graph)
  const storedState = await input.runtime.store.loadState()
  let state = alignStateWithGraph(
    input.graph,
    storedState ?? createInitialWorkflowState(input.graph),
    {
      preserveRunningIntegrate: isPullRequestMode,
      preserveRunningReview: isPullRequestMode,
    },
  )
  let report = await persistState(input.runtime, input.graph, state)

  while (
    report.summary.finalStatus !== 'blocked' &&
    report.summary.finalStatus !== 'replan_required'
  ) {
    if (
      input.untilTaskHandle &&
      state.tasks[input.untilTaskHandle]?.status === 'done'
    ) {
      break
    }

    const resumedIntegrate = await resumePullRequestIntegrate({
      graph: input.graph,
      runtime: input.runtime,
      state,
      workflow,
    })
    if (resumedIntegrate) {
      report = resumedIntegrate.report
      state = resumedIntegrate.state
      continue
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

    const next = await executeTaskAttempt({
      graph: input.graph,
      runtime: input.runtime,
      state,
      taskHandle: task,
      workflow,
    })
    report = next.report
    state = next.state
  }

  return {
    state,
    summary: report.summary,
  }
}
