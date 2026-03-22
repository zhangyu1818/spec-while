import { spawn } from 'node:child_process'

import type { VerifyCommandResult, VerifyResult } from '../types'

async function runVerifyCommand(command: string, workspaceRoot: string): Promise<VerifyCommandResult> {
  const startedAt = new Date().toISOString()
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: workspaceRoot,
      env: process.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      const finishedAt = new Date().toISOString()
      const exitCode = typeof code === 'number' ? code : 1
      resolve({
        command,
        exitCode,
        finishedAt,
        passed: exitCode === 0,
        startedAt,
        stderr: signal ? `${stderr}${stderr ? '\n' : ''}Process exited with signal ${signal}` : stderr,
        stdout,
      })
    })
  })
}

export class ProcessVerifier {
  public constructor(private readonly workspaceRoot: string) {}

  public async verify(input: {
    commands: string[]
    taskId: string
  }): Promise<VerifyResult> {
    if (input.commands.length === 0) {
      return {
        commands: [],
        passed: true,
        summary: 'No verify commands configured.',
        taskId: input.taskId,
      }
    }

    const commands: VerifyCommandResult[] = []
    for (const command of input.commands) {
      commands.push(await runVerifyCommand(command, this.workspaceRoot))
    }
    const passed = commands.every((result) => result.passed)
    return {
      commands,
      passed,
      summary: passed ? 'All verify commands passed' : 'One or more verify commands failed',
      taskId: input.taskId,
    }
  }
}
