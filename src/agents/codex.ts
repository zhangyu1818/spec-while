import { buildImplementerPrompt } from '../prompts/implementer'
import { buildReviewerPrompt } from '../prompts/reviewer'
import {
  implementOutputSchema,
  reviewOutputSchema,
  validateImplementOutput,
  validateReviewOutput,
} from '../schema/index'

import type {
  ImplementAgentInput,
  ImplementerProvider,
  ReviewAgentInput,
  ReviewerProvider,
} from './types'

export interface CodexRunResult {
  finalResponse: string
}

export interface CodexUsage {
  cached_input_tokens: number
  input_tokens: number
  output_tokens: number
}

export interface CodexTurnFailedEvent {
  error: CodexTurnFailedError
  type: 'turn.failed'
}

export interface CodexItemEvent {
  item: CodexItemPayload
  type: 'item.completed' | 'item.started' | 'item.updated'
}

export interface CodexErrorEvent {
  message: string
  type: 'error'
}

export interface CodexThreadStartedEvent {
  thread_id: string
  type: 'thread.started'
}

export interface CodexTurnCompletedEvent {
  type: 'turn.completed'
  usage: CodexUsage
}

export interface CodexTurnStartedEvent {
  type: 'turn.started'
}

export interface CodexTurnFailedError {
  message: string
}

export interface CodexItemPayload {
  text?: string
  type: string
}

export type CodexThreadEvent =
  | CodexErrorEvent
  | CodexItemEvent
  | CodexThreadStartedEvent
  | CodexTurnCompletedEvent
  | CodexTurnFailedEvent
  | CodexTurnStartedEvent

export type CodexThreadEventHandler = (event: CodexThreadEvent) => void

export interface CodexRunStreamedResult {
  events: AsyncGenerator<CodexThreadEvent>
}

export interface CodexThreadRunOptions {
  outputSchema: Record<string, unknown>
}

export interface CodexThreadLike {
  run: (
    prompt: string,
    options: CodexThreadRunOptions,
  ) => Promise<CodexRunResult>
  runStreamed?: (
    prompt: string,
    options: CodexThreadRunOptions,
  ) => Promise<CodexRunStreamedResult>
}

export interface CodexStartThreadOptions {
  workingDirectory: string
}

export interface CodexClientLike {
  startThread: (options: CodexStartThreadOptions) => CodexThreadLike
}

export interface CodexAgentClientOptions {
  onEvent?: CodexThreadEventHandler
  workspaceRoot: string
}

export interface CodexStructuredInput {
  outputSchema: Record<string, unknown>
  prompt: string
}

async function defaultClientFactory(): Promise<CodexClientLike> {
  const { Codex } = await import('@openai/codex-sdk')
  return new Codex()
}

export class CodexAgentClient implements ImplementerProvider, ReviewerProvider {
  private clientPromise: null | Promise<CodexClientLike> = null
  public readonly name = 'codex'

  public constructor(private readonly options: CodexAgentClientOptions) {}

  private async collectStreamedTurn<T>(
    thread: CodexThreadLike,
    input: CodexStructuredInput,
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

      if (
        event.type === 'item.completed' &&
        event.item.type === 'agent_message'
      ) {
        finalResponse = event.item.text?.trim() ?? ''
      }
    }

    if (!finalResponse) {
      throw new Error('Codex agent client returned empty finalResponse')
    }

    try {
      return JSON.parse(finalResponse) as T
    } catch (error) {
      throw new Error('Codex agent client returned non-JSON finalResponse', {
        cause: error,
      })
    }
  }

  private async getClient(): Promise<CodexClientLike> {
    this.clientPromise ??= defaultClientFactory()
    return this.clientPromise
  }

  public async implement(input: ImplementAgentInput) {
    const prompt = await buildImplementerPrompt(input)
    const output = await this.invokeStructured<unknown>({
      outputSchema: implementOutputSchema,
      prompt,
    })
    return validateImplementOutput(output)
  }

  public async invokeStructured<T>(input: CodexStructuredInput): Promise<T> {
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
    } catch (error) {
      throw new Error('Codex agent client returned non-JSON finalResponse', {
        cause: error,
      })
    }
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

export function createCodexProvider(
  options: CodexAgentClientOptions,
): ImplementerProvider & ReviewerProvider {
  return new CodexAgentClient(options)
}
