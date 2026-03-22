import { execFile , spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { expect, test } from 'vitest'

import { runWorkflow } from '../src/core/orchestrator'
import { normalizeTaskGraph } from '../src/core/task-normalizer'
import { createFsRuntime } from '../src/runtime/fs-runtime'

import type { AgentClient } from '../src/agents/types'

const execFileAsync = promisify(execFile)
const cliEntry = fileURLToPath(new URL('../bin/spec-while.mjs', import.meta.url))

class FakeAgentClient implements AgentClient {
  public readonly name = 'fake'

  public async implement() {
    return {
      assumptions: [],
      changedFiles: ['src/parser.ts'],
      needsHumanAttention: false,
      notes: [],
      requestedAdditionalPaths: [],
      status: 'implemented' as const,
      summary: 'done',
      taskId: 'T001',
      unresolvedItems: [],
    }
  }

  public async review() {
    return {
      changedFilesReviewed: ['src/parser.ts'],
      findings: [],
      overallRisk: 'low' as const,
      summary: 'ok',
      taskId: 'T001',
      verdict: 'pass' as const,
      acceptanceChecks: [
        {
          criterion: 'parser exists',
          note: 'ok',
          status: 'pass' as const,
        },
      ],
    }
  }
}

async function createWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'while-cli-'))
  const featureDir = path.join(root, 'specs', '001-demo')
  await mkdir(featureDir, { recursive: true })
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'parser.ts'), 'export const value = 1\n')
  await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  await writeFile(path.join(featureDir, 'tasks.md'), `
# Tasks

## Phase 1: Setup

- [ ] T001 Create parser in src/parser.ts
  - Paths: src/parser.ts
  - Depends:
  - Acceptance:
    - parser exists
  - Verify:
    - node -e "process.exit(0)"
  - Review Rubric:
    - naming clarity
  - Max Iterations: 2
`)
  await writeFile(path.join(root, '.gitignore'), '.while\n')
  await execFileAsync('git', ['init'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'While Test'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'while@example.com'], { cwd: root })
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: root })
  return { featureDir, root }
}

function runCli(args: string[], cwd: string) {
  return new Promise<{ code: null | number, stderr: string, stdout: string }>((resolve) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd,
      env: process.env,
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('close', (code) => {
      resolve({ code, stderr, stdout })
    })
  })
}

test('spec-while rejects unknown commands', async () => {
  const { root } = await createWorkspace()
  const result = await runCli(['unknown', '--workspace', root, '--feature', '001-demo'], root)

  expect(result.code).not.toBe(0)
  expect(result.stderr).toMatch(/unknown command/i)
})

test('spec-while rewind resolves workspace from the actual current directory and rewinds lifecycle state', async () => {
  const { featureDir, root } = await createWorkspace()
  const runtime = createFsRuntime({
    featureDir,
    workspaceRoot: root,
  })
  const graph = await normalizeTaskGraph({
    featureDir,
    tasksPath: path.join(featureDir, 'tasks.md'),
  })
  await runWorkflow({
    agent: new FakeAgentClient(),
    graph,
    runtime,
  })

  const result = await runCli(['rewind', '--task', 'T001'], path.join(root, 'src'))

  expect(result.code).toBe(0)
  const state = JSON.parse(await readFile(path.join(featureDir, '.while', 'state.json'), 'utf8')) as {
    tasks: Record<string, { attempt: number, generation: number, status: string }>
  }
  const tasksMd = await readFile(path.join(featureDir, 'tasks.md'), 'utf8')
  expect(state.tasks.T001).toMatchObject({ attempt: 0, generation: 2, status: 'pending' })
  expect(tasksMd).toMatch(/- \[ \] T001/)
  expect(result.stdout).toMatch(/T001/)
  expect(result.stderr).toBe('')
})
