import type {
  ImplementOutput,
  ReviewFinding,
  ReviewOutput,
  TaskDefinition,
  VerifyResult,
} from '../types'

export interface ImplementAgentInput {
  attempt: number
  codeContext: string
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
  verify: VerifyResult
}

export interface AgentClient {
  implement: (input: ImplementAgentInput) => Promise<ImplementOutput>
  readonly name: string
  review: (input: ReviewAgentInput) => Promise<ReviewOutput>
}
