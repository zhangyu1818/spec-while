import type { RemoteReviewerProvider } from '../agents/types'
import type { WorkflowPreset } from './preset'

export function createPullRequestWorkflowPreset(input: {
  reviewer: RemoteReviewerProvider
}): WorkflowPreset {
  return {
    mode: 'pull-request',
    async integrate() {
      throw new Error(
        `workflow.mode "pull-request" is not implemented for reviewer "${input.reviewer.name}"`,
      )
    },
    async review() {
      throw new Error(
        `workflow.mode "pull-request" is not implemented for reviewer "${input.reviewer.name}"`,
      )
    },
  }
}
