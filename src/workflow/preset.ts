import type { WorkflowRoleProviders } from '../agents/types'
import type { OrchestratorRuntime } from '../core/runtime'
import type {
  ImplementOutput,
  ReviewFinding,
  ReviewOutput,
  TaskContext,
  TaskDefinition,
} from '../types'

export type WorkflowMode = 'direct' | 'pull-request'

interface BaseReviewPhaseContext {
  attempt: number
  commitMessage: string
  generation: number
  implement: ImplementOutput
  lastFindings: ReviewFinding[]
  runtime: OrchestratorRuntime
  task: TaskDefinition
  taskContext: TaskContext
}

export interface DirectReviewPhaseContext extends BaseReviewPhaseContext {
  actualChangedFiles: string[]
}

export type PullRequestReviewPhaseContext = BaseReviewPhaseContext

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

export interface DirectWorkflowPreset {
  integrate: (context: IntegratePhaseContext) => Promise<IntegratePhaseResult>
  readonly mode: 'direct'
  review: (context: DirectReviewPhaseContext) => Promise<ReviewPhaseResult>
}

export interface PullRequestWorkflowPreset {
  integrate: (context: IntegratePhaseContext) => Promise<IntegratePhaseResult>
  readonly mode: 'pull-request'
  review: (context: PullRequestReviewPhaseContext) => Promise<ReviewPhaseResult>
}

export type WorkflowPreset = DirectWorkflowPreset | PullRequestWorkflowPreset

export interface WorkflowRuntime {
  preset: WorkflowPreset
  roles: WorkflowRoleProviders
}

export { createDirectWorkflowPreset } from './direct-preset'
export { createPullRequestWorkflowPreset } from './pull-request-preset'
