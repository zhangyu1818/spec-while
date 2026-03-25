import type { ReviewerProvider } from '../agents/types'
import type { WorkflowPreset } from './preset'

export function createDirectWorkflowPreset(input: {
  reviewer: ReviewerProvider
}): WorkflowPreset {
  return {
    mode: 'direct',
    async integrate(context) {
      let taskChecked = false
      try {
        await context.runtime.workspace.updateTaskChecks([
          { checked: true, taskId: context.taskId },
        ])
        taskChecked = true
        const { commitSha } = await context.runtime.git.commitTask({
          message: context.commitMessage,
        })
        return {
          kind: 'completed',
          result: {
            commitSha,
            summary: 'integrated',
          },
        }
      } catch (error) {
        let reason = `Task commit failed: ${error instanceof Error ? error.message : String(error)}`
        if (taskChecked) {
          try {
            await context.runtime.workspace.updateTaskChecks([
              { checked: false, taskId: context.taskId },
            ])
          } catch (rollbackError) {
            reason = `${reason}; checkbox rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
          }
        }
        throw new Error(reason)
      }
    },
    async review(context) {
      const review = await input.reviewer.review({
        actualChangedFiles: context.actualChangedFiles,
        attempt: context.attempt,
        generation: context.generation,
        implement: context.implement,
        lastFindings: context.lastFindings,
        plan: context.taskContext.plan,
        spec: context.taskContext.spec,
        task: context.task,
        tasksSnippet: context.taskContext.tasksSnippet,
        verify: context.verify,
      })
      return review.verdict === 'pass'
        ? { kind: 'approved', review }
        : { kind: 'rejected', review }
    },
  }
}
