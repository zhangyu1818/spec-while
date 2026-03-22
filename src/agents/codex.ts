import { buildImplementerPrompt } from '../prompts/implementer'
import { buildReviewerPrompt } from '../prompts/reviewer'
import {
  implementOutputSchema,
  reviewOutputSchema,
  validateImplementOutput,
  validateReviewOutput,
} from '../schema/index'

import type { AgentClient, ImplementAgentInput, ReviewAgentInput } from './types'

export interface CodexRunResult {
  finalResponse: string
}

export interface CodexUsage {
  cached_input_tokens: number
  input_tokens: number
  output_tokens: number
}

export type CodexThreadEvent =
  | {
    error: {
      message: string
    }
    type: 'turn.failed'
  }
  | {
    item: {
      text?: string
      type: string
    }
    type: 'item.completed' | 'item.started' | 'item.updated'
  }
  | {
    message: string
    type: 'error'
  }
  | {
    thread_id: string
    type: 'thread.started'
  }
  | {
    type: 'turn.completed'
    usage: CodexUsage
  }
  | {
    type: 'turn.started'
  }

export interface CodexRunStreamedResult {
  events: AsyncGenerator<CodexThreadEvent>
}

export interface CodexThreadLike {
  run: (prompt: string, options: { outputSchema: Record<string, unknown> }) => Promise<CodexRunResult>
  runStreamed?: (prompt: string, options: { outputSchema: Record<string, unknown> }) => Promise<CodexRunStreamedResult>
}

export interface CodexClientLike {
  startThread: (options: { workingDirectory: string }) => CodexThreadLike
}

export interface CodexAgentClientOptions {
  onEvent?: (event: CodexThreadEvent) => void
  workspaceRoot: string
}

async function defaultClientFactory(): Promise<CodexClientLike> {
  const { Codex } = await import('@openai/codex-sdk')
  return new Codex()
}

export class CodexAgentClient implements AgentClient {
  private clientPromise: null | Promise<CodexClientLike> = null
  public readonly name = 'codex'

  public constructor(private readonly options: CodexAgentClientOptions) {}

  private async collectStreamedTurn<T>(
    thread: CodexThreadLike,
    input: { outputSchema: Record<string, unknown>, prompt: string },
  ): Promise<T> {
    const streamedTurn = await thread.runStreamed!(input.prompt, {
      outputSchema: input.outputSchema,
    })
    let finalResponse = ''

    for await (const event of streamedTurn.events) {
      this.options.onEvent?.(event)

      if (event.type === 'error') {
        throw new Error(event.message)
      }

      if (event.type === 'turn.failed') {
        throw new Error(event.error.message)
      }

      if (event.type === 'item.completed' && event.item.type === 'agent_message') {
        finalResponse = event.item.text?.trim() ?? ''
      }
    }

    if (!finalResponse) {
      throw new Error('Codex agent client returned empty finalResponse')
    }

    try {
      return JSON.parse(finalResponse) as T
    }
    catch (error) {
      throw new Error('Codex agent client returned non-JSON finalResponse', {
        cause: error,
      })
    }
  }

  private async getClient(): Promise<CodexClientLike> {
    this.clientPromise ??= defaultClientFactory()
    return this.clientPromise
  }

  private async invokeStructured<T>(input: {
    outputSchema: Record<string, unknown>
    prompt: string
  }): Promise<T> {
    const client = await this.getClient()
    const thread = client.startThread({
      workingDirectory: this.options.workspaceRoot,
    })

    if (this.options.onEvent && thread.runStreamed) {
      return this.collectStreamedTurn<T>(thread, input)
    }

    const turn = await thread.run(input.prompt, {
      outputSchema: input.outputSchema,
    })
    const response = turn.finalResponse.trim()
    if (!response) {
      throw new Error('Codex agent client returned empty finalResponse')
    }
    try {
      return JSON.parse(response) as T
    }
    catch (error) {
      throw new Error('Codex agent client returned non-JSON finalResponse', {
        cause: error,
      })
    }
  }

  public async implement(input: ImplementAgentInput) {
    const prompt = await buildImplementerPrompt(input)
    const output = await this.invokeStructured<unknown>({
      outputSchema: implementOutputSchema,
      prompt,
    })
    return validateImplementOutput(output)
  }

  public async review(input: ReviewAgentInput) {
    const prompt = await buildReviewerPrompt(input)
    const output = await this.invokeStructured<unknown>({
      outputSchema: reviewOutputSchema,
      prompt,
    })
    return validateReviewOutput(output)
  }
}
