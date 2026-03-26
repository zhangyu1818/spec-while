import { finalizeTaskCheckbox } from './finalize-task-checkbox'

import type { ReviewerProvider } from '../agents/types'
import type { DirectWorkflowPreset } from './preset'

export function createDirectWorkflowPreset(input: {
  reviewer: ReviewerProvider
}): DirectWorkflowPreset {
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
      })
      return review.verdict === 'pass'
        ? { kind: 'approved', review }
        : { kind: 'rejected', review }
    },
  }
}
