import { rewindTask } from '../core/orchestrator'
import { normalizeTaskGraph } from '../core/task-normalizer'
import { createFsRuntime } from '../runtime/fs-runtime'

import type { WorkspaceContext } from '../types'

export async function rewindCommand(context: WorkspaceContext, taskId: string) {
  const runtime = createFsRuntime({
    featureDir: context.featureDir,
    workspaceRoot: context.workspaceRoot,
  })
  await runtime.git.requireCleanWorktree()
  return rewindTask({
    runtime,
    taskId,
    loadGraph: () => normalizeTaskGraph({
      featureDir: context.featureDir,
      tasksPath: context.tasksPath,
    }),
  })
}
