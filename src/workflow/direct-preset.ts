import { finalizeTaskCheckbox } from './finalize-task-checkbox'

import type { ReviewerProvider } from '../agents/types'
import type { WorkflowPreset } from './preset'

export function createDirectWorkflowPreset(input: {
  reviewer: ReviewerProvider
}): WorkflowPreset {
  return {
    mode: 'direct',
    async integrate(context) {
      const { commitSha } = await finalizeTaskCheckbox({
        commitMessage: context.commitMessage,
        runtime: context.runtime,
        taskId: context.taskId,
      })
      return {
        kind: 'completed',
        result: {
          commitSha,
          summary: 'integrated',
        },
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
