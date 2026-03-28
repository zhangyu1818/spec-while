import { execa } from 'execa'

export interface OpenSpecCliTask {
  description: string
  id: string
}

export interface OpenSpecApplyInstructions {
  changeName: string
  contextFiles: Record<string, string>
  instruction: string
  progress: {
    complete: number
    total: number
  }
  schemaName: string
  state: string
  tasks: OpenSpecCliTask[]
}

export interface OpenSpecStatus {
  applyRequires: string[]
  artifacts: {
    id: string
    outputPath: string
    status: string
  }[]
  changeName: string
  isComplete: boolean
  schemaName: string
}

export async function parseCliJson<T>(stdout: string): Promise<T> {
  const start = stdout.indexOf('{')
  if (start === -1) {
    throw new Error('OpenSpec CLI did not return JSON payload')
  }
  return JSON.parse(stdout.slice(start)) as T
}

export async function readOpenSpecApplyInstructions(input: {
  changeName: string
  workspaceRoot: string
}): Promise<OpenSpecApplyInstructions> {
  try {
    const { stdout } = await execa(
      'openspec',
      ['instructions', 'apply', '--change', input.changeName, '--json'],
      {
        cwd: input.workspaceRoot,
      },
    )
    return await parseCliJson<OpenSpecApplyInstructions>(stdout)
  } catch (error) {
    throw new Error(
      `Failed to read OpenSpec apply instructions for ${input.changeName}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function readOpenSpecStatus(input: {
  changeName: string
  workspaceRoot: string
}): Promise<OpenSpecStatus> {
  try {
    const { stdout } = await execa(
      'openspec',
      ['status', '--change', input.changeName, '--json'],
      {
        cwd: input.workspaceRoot,
      },
    )
    return await parseCliJson<OpenSpecStatus>(stdout)
  } catch (error) {
    throw new Error(
      `Failed to read OpenSpec status for ${input.changeName}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
