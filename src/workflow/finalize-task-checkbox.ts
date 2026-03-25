import type { OrchestratorRuntime } from '../core/runtime'

export async function finalizeTaskCheckbox(input: {
  commitMessage: string
  runtime: OrchestratorRuntime
  taskId: string
}) {
  let taskChecked = false
  try {
    await input.runtime.workspace.updateTaskChecks([
      { checked: true, taskId: input.taskId },
    ])
    taskChecked = true
    return await input.runtime.git.commitTask({
      message: input.commitMessage,
    })
  } catch (error) {
    let reason = `Task commit failed: ${error instanceof Error ? error.message : String(error)}`
    if (taskChecked) {
      try {
        await input.runtime.workspace.updateTaskChecks([
          { checked: false, taskId: input.taskId },
        ])
      } catch (rollbackError) {
        reason = `${reason}; checkbox rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
      }
    }
    throw new Error(reason)
  }
}
