import path from 'node:path'

import { ClaudeAgentClient } from '../agents/claude'
import { CodexAgentClient } from '../agents/codex'

import type { BatchProviderName } from './config'

export interface BatchFileInput {
  absoluteFilePath: string
  content: string
  filePath: string
  outputSchema: Record<string, unknown>
  prompt: string
  workdir: string
}

export interface BatchStructuredOutputProvider {
  readonly name: string
  runFile: (input: BatchFileInput) => Promise<unknown>
}

export interface CreateBatchStructuredOutputProviderInput {
  provider: BatchProviderName
  workspaceRoot: string
}

function buildBatchPrompt(input: BatchFileInput) {
  const relativeToWorkspace = path
    .relative(input.workdir, input.absoluteFilePath)
    .split(path.sep)
    .join('/')
  return [
    'Process exactly one file and return structured output only.',
    input.prompt,
    `File path: ${input.filePath}`,
    `Workdir-relative path: ${relativeToWorkspace}`,
    'File content:',
    input.content,
  ].join('\n\n')
}

class CodexBatchStructuredOutputProvider implements BatchStructuredOutputProvider {
  public readonly name = 'codex'

  public constructor(private readonly client: CodexAgentClient) {}

  public async runFile(input: BatchFileInput) {
    return this.client.invokeStructured<unknown>({
      outputSchema: input.outputSchema,
      prompt: buildBatchPrompt(input),
    })
  }
}

class ClaudeBatchStructuredOutputProvider implements BatchStructuredOutputProvider {
  public readonly name = 'claude'

  public constructor(private readonly client: ClaudeAgentClient) {}

  public async runFile() {
    void this.client
    throw new Error('claude batch provider is not configured')
  }
}

export function createBatchStructuredOutputProvider(
  input: CreateBatchStructuredOutputProviderInput,
): BatchStructuredOutputProvider {
  if (input.provider === 'codex') {
    return new CodexBatchStructuredOutputProvider(
      new CodexAgentClient({
        workspaceRoot: input.workspaceRoot,
      }),
    )
  }

  return new ClaudeBatchStructuredOutputProvider(new ClaudeAgentClient())
}
