import type { ReviewAgentInput, WorkflowRoleProviders } from '../agents/types'
import type { OrchestratorRuntime } from '../core/runtime'
import type { ReviewOutput } from '../types'

export type WorkflowMode = 'direct'

export interface ReviewPhaseContext {
  reviewInput: ReviewAgentInput
}

export type ReviewPhaseResult =
  | {
      kind: 'approved'
      review: ReviewOutput
    }
  | {
      kind: 'rejected'
      review: ReviewOutput
    }

export interface IntegratePhaseContext {
  commitMessage: string
  runtime: OrchestratorRuntime
  taskId: string
}

export type IntegratePhaseResult = {
  kind: 'completed'
  result: {
    commitSha: string
    summary: string
  }
}

export interface WorkflowPreset {
  readonly mode: WorkflowMode
  integrate: (context: IntegratePhaseContext) => Promise<IntegratePhaseResult>
  review: (context: ReviewPhaseContext) => Promise<ReviewPhaseResult>
}

export interface WorkflowRuntime {
  preset: WorkflowPreset
  roles: WorkflowRoleProviders
}

export { createDirectWorkflowPreset } from './direct-preset'
