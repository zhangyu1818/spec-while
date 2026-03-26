import type { PullRequestSnapshot } from '../core/runtime'
import type {
  ImplementOutput,
  ReviewFinding,
  ReviewOutput,
  TaskDefinition,
} from '../types'

export interface ImplementAgentInput {
  attempt: number
  generation: number
  lastFindings: ReviewFinding[]
  plan: string
  spec: string
  task: TaskDefinition
  tasksSnippet: string
}

export interface ReviewAgentInput {
  actualChangedFiles: string[]
  attempt: number
  generation: number
  implement: ImplementOutput
  lastFindings: ReviewFinding[]
  plan: string
  spec: string
  task: TaskDefinition
  tasksSnippet: string
}

export interface ImplementerProvider {
  implement: (input: ImplementAgentInput) => Promise<ImplementOutput>
  readonly name: string
}

export interface ReviewerProvider {
  readonly name: string
  review: (input: ReviewAgentInput) => Promise<ReviewOutput>
}

export interface PullRequestReviewInput {
  checkpointStartedAt: string
  pullRequest: PullRequestSnapshot
  task: TaskDefinition
}

export type PullRequestReviewResult =
  | {
      kind: 'approved'
      review: ReviewOutput
    }
  | {
      kind: 'pending'
    }
  | {
      kind: 'rejected'
      review: ReviewOutput
    }

export interface RemoteReviewerProvider {
  evaluatePullRequestReview: (
    input: PullRequestReviewInput,
  ) => Promise<PullRequestReviewResult>
  readonly name: string
}

export interface WorkflowRoleProviders {
  implementer: ImplementerProvider
  reviewer: RemoteReviewerProvider | ReviewerProvider
}
