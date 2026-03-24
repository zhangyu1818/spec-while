import type { ImplementOutput, ReviewOutput } from '../types'
import type {
  ImplementAgentInput,
  ImplementerProvider,
  ReviewAgentInput,
  ReviewerProvider,
} from './types'

export interface ClaudeAgentAdapter {
  implement: (input: ImplementAgentInput) => Promise<ImplementOutput>
  review: (input: ReviewAgentInput) => Promise<ReviewOutput>
}

class MissingAdapter implements ClaudeAgentAdapter {
  public async implement(): Promise<ImplementOutput> {
    throw new Error('claude agent adapter is not configured')
  }

  public async review(): Promise<ReviewOutput> {
    throw new Error('claude agent adapter is not configured')
  }
}

export class ClaudeAgentClient implements ImplementerProvider, ReviewerProvider {
  public readonly name = 'claude'

  public constructor(private readonly adapter: ClaudeAgentAdapter = new MissingAdapter()) {}

  public async implement(input: ImplementAgentInput) {
    return this.adapter.implement(input)
  }

  public async review(input: ReviewAgentInput) {
    return this.adapter.review(input)
  }
}

export function createClaudeProvider(
  adapter?: ClaudeAgentAdapter,
): ImplementerProvider & ReviewerProvider {
  return new ClaudeAgentClient(adapter)
}
