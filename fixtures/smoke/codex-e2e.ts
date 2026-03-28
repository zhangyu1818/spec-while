import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { execa } from 'execa'

import type { FinalReport, WorkflowState } from '../../src/types'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)
const templateRoot = path.join(repoRoot, 'fixtures', 'e2e', 'simple-task')
const whileEntry = path.join(repoRoot, 'src', 'index.ts')
interface CreateWhileE2eArgsInput {
  command: 'run'
  untilTaskId?: string
  workspaceRoot: string
}

export function relayChunk(
  chunk: string | Uint8Array,
  forward: (text: string) => void,
  capture: (text: string) => void,
) {
  const text = chunk.toString()
  forward(text)
  capture(text)
}

export function createWhileE2eArgs(input: CreateWhileE2eArgsInput) {
  const args = [
    '--import',
    'tsx',
    whileEntry,
    'run',
    '--feature',
    '001-simple',
    '--verbose',
  ]
  if (input.untilTaskId) {
    args.push('--until-task', input.untilTaskId)
  }
  return args
}

async function git(root: string, args: string[]) {
  const result = await execa('git', args, {
    cwd: root,
  })
  return result.stdout.trim()
}

async function initGitRepo(root: string) {
  await git(root, ['init'])
  await git(root, ['config', 'user.name', 'While Smoke'])
  await git(root, ['config', 'user.email', 'while-smoke@example.com'])
  await git(root, ['add', '.'])
  await git(root, ['commit', '-m', 'Initial commit'])
}

async function gitLogMessages(root: string) {
  const output = await git(root, ['log', '--format=%s'])
  return output.split('\n').filter(Boolean)
}

async function trackedFilesInHead(root: string) {
  const output = await git(root, ['show', '--name-only', '--format=', 'HEAD'])
  return output.split('\n').filter(Boolean)
}

async function runWhileE2e(input: CreateWhileE2eArgsInput) {
  const subprocess = execa(process.execPath, createWhileE2eArgs(input), {
    cwd: input.workspaceRoot,
    env: process.env,
    reject: false,
  })

  let stderr = ''
  let stdout = ''
  const stdoutStream = subprocess.stdout
  const stderrStream = subprocess.stderr
  if (!stdoutStream || !stderrStream) {
    throw new Error('Expected subprocess streams to be available')
  }
  stdoutStream.on('data', (chunk) => {
    relayChunk(
      chunk,
      (text) => process.stdout.write(text),
      (text) => {
        stdout += text
      },
    )
  })
  stderrStream.on('data', (chunk) => {
    relayChunk(
      chunk,
      (text) => process.stderr.write(text),
      (text) => {
        stderr += text
      },
    )
  })

  const result = await subprocess
  if (result.exitCode !== 0) {
    throw new Error(`while e2e process exited with code ${result.exitCode}`)
  }
  return { stderr, stdout }
}

async function main() {
  const tempRoot = await mkdtemp(path.join(repoRoot, '.tmp-smoke-'))
  const workspaceRoot = path.join(tempRoot, 'workspace')

  try {
    await cp(templateRoot, workspaceRoot, { recursive: true })
    await writeFile(path.join(workspaceRoot, '.gitignore'), '.while\n')
    await initGitRepo(workspaceRoot)

    await runWhileE2e({
      command: 'run',
      workspaceRoot,
    })

    const tasksMdAfterRun = await readFile(
      path.join(workspaceRoot, 'specs', '001-simple', 'tasks.md'),
      'utf8',
    )
    const stateAfterRun = JSON.parse(
      await readFile(
        path.join(workspaceRoot, 'specs', '001-simple', '.while', 'state.json'),
        'utf8',
      ),
    ) as WorkflowState
    const reportAfterRun = JSON.parse(
      await readFile(
        path.join(
          workspaceRoot,
          'specs',
          '001-simple',
          '.while',
          'report.json',
        ),
        'utf8',
      ),
    ) as FinalReport
    const messagesAfterRun = await gitLogMessages(workspaceRoot)
    const trackedFiles = await trackedFilesInHead(workspaceRoot)
    const greetingTaskAfterRun = stateAfterRun.tasks.T001
    const farewellTaskAfterRun = stateAfterRun.tasks.T002

    assert.match(tasksMdAfterRun, /- \[X\] T001/)
    assert.match(tasksMdAfterRun, /- \[X\] T002/)
    assert.equal(reportAfterRun.summary.finalStatus, 'completed')
    assert.ok(greetingTaskAfterRun)
    assert.ok(farewellTaskAfterRun)
    assert.equal(greetingTaskAfterRun.status, 'done')
    assert.equal(farewellTaskAfterRun.status, 'done')
    assert.match(greetingTaskAfterRun.commitSha, /\S+/)
    assert.match(farewellTaskAfterRun.commitSha, /\S+/)
    assert.equal(
      reportAfterRun.tasks.every(
        (task) => task.status === 'done' && typeof task.commitSha === 'string',
      ),
      true,
    )
    assert.deepEqual(messagesAfterRun.slice(0, 3), [
      'Task T002: Implement buildFarewell in src/farewell.ts',
      'Task T001: Implement buildGreeting in src/greeting.ts',
      'Initial commit',
    ])
    assert.equal(
      trackedFiles.some((file) => file.includes('.while')),
      false,
    )

    process.stdout.write(`${JSON.stringify({ workspaceRoot }, null, 2)}\n`)
  } finally {
    await rm(tempRoot, { force: true, recursive: true })
  }
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exitCode = 1
})
