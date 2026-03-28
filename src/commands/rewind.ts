import { rewindTask } from '../core/orchestrator'
import { buildTaskTopology } from '../core/task-topology'
import { createOrchestratorRuntime } from '../runtime/fs-runtime'
import { openTaskSource } from '../task-sources/registry'
import { loadWorkflowConfig } from '../workflow/config'

import type { WorkspaceContext } from '../types'

export async function rewindCommand(
  context: WorkspaceContext,
  taskSelector: string,
) {
  const config = await loadWorkflowConfig(context.workspaceRoot)
  const taskSource = await openTaskSource(config.task.source, {
    featureDir: context.featureDir,
    featureId: context.featureId,
    workspaceRoot: context.workspaceRoot,
  })
  const runtime = createOrchestratorRuntime({
    featureDir: context.featureDir,
    taskSource,
    workspaceRoot: context.workspaceRoot,
  })
  await runtime.git.requireCleanWorktree()
  const taskHandle = taskSource.resolveTaskSelector(taskSelector)
  return rewindTask({
    runtime,
    taskHandle,
    async loadGraph() {
      const refreshedTaskSource = await openTaskSource(config.task.source, {
        featureDir: context.featureDir,
        featureId: context.featureId,
        workspaceRoot: context.workspaceRoot,
      })
      return buildTaskTopology(
        refreshedTaskSource,
        context.featureId,
        config.task.maxIterations,
      )
    },
  })
}
