import type { WorkflowRoleProviders } from '../agents/types'
import type { OrchestratorRuntime } from '../core/runtime'
import type {
  ImplementOutput,
  ReviewFinding,
  ReviewOutput,
  TaskContext,
  TaskDefinition,
  VerifyResult,
} from '../types'

export type WorkflowMode = 'direct' | 'pull-request'

export interface ReviewPhaseContext {
  actualChangedFiles: string[]
  attempt: number
  commitMessage: string
  generation: number
  implement: ImplementOutput
  lastFindings: ReviewFinding[]
  runtime: OrchestratorRuntime
  task: TaskDefinition
  taskContext: TaskContext
  verify: VerifyResult
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

export interface IntegratePhaseResult {
  kind: 'completed'
  result: {
    commitSha: string
    summary: string
  }
}

export interface WorkflowPreset {
  integrate: (context: IntegratePhaseContext) => Promise<IntegratePhaseResult>
  readonly mode: WorkflowMode
  review: (context: ReviewPhaseContext) => Promise<ReviewPhaseResult>
}

export interface WorkflowRuntime {
  preset: WorkflowPreset
  roles: WorkflowRoleProviders
}

export { createDirectWorkflowPreset } from './direct-preset'
export { createPullRequestWorkflowPreset } from './pull-request-preset'
