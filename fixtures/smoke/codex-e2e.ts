import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const templateRoot = path.join(repoRoot, 'fixtures', 'e2e', 'simple-task')
const whileEntry = path.join(repoRoot, 'src', 'index.ts')
const execFileAsync = promisify(execFile)

interface CreateWhileE2eArgsInput {
  command: 'rewind' | 'run'
  taskId?: string
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
    input.command,
    '--workspace',
    input.workspaceRoot,
    '--feature',
    '001-simple',
    '--verbose',
  ]
  if (input.command === 'rewind') {
    args.push('--task', input.taskId ?? '')
  }
  if (input.untilTaskId) {
    args.push('--until-task', input.untilTaskId)
  }
  return args
}

async function git(root: string, args: string[]) {
  const result = await execFileAsync('git', args, {
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
  return new Promise<{ stderr: string, stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, createWhileE2eArgs(input), {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      relayChunk(chunk, (text) => process.stdout.write(text), (text) => {
        stdout += text
      })
    })
    child.stderr.on('data', (chunk) => {
      relayChunk(chunk, (text) => process.stderr.write(text), (text) => {
        stderr += text
      })
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stderr, stdout })
        return
      }
      reject(new Error(`while e2e process exited with code ${code ?? 'unknown'}`))
    })
  })
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

    const tasksMdAfterRun = await readFile(path.join(workspaceRoot, 'specs', '001-simple', 'tasks.md'), 'utf8')
    const stateAfterRun = JSON.parse(await readFile(path.join(workspaceRoot, 'specs', '001-simple', '.while', 'state.json'), 'utf8')) as {
      tasks: Record<string, { commitSha?: string, status: string }>
    }
    const reportAfterRun = JSON.parse(await readFile(path.join(workspaceRoot, 'specs', '001-simple', '.while', 'report.json'), 'utf8')) as {
      summary: { finalStatus: string }
      tasks: { commitSha?: string, id: string, status: string }[]
    }
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
    assert.match(greetingTaskAfterRun.commitSha ?? '', /\S+/)
    assert.match(farewellTaskAfterRun.commitSha ?? '', /\S+/)
    assert.equal(reportAfterRun.tasks.every((task) => task.status === 'done' && typeof task.commitSha === 'string'), true)
    assert.deepEqual(messagesAfterRun.slice(0, 3), [
      'Task T002: Implement buildFarewell in src/farewell.ts',
      'Task T001: Implement buildGreeting in src/greeting.ts',
      'Initial commit',
    ])
    assert.equal(trackedFiles.some((file) => file.includes('.while')), false)

    await runWhileE2e({
      command: 'rewind',
      taskId: 'T001',
      workspaceRoot,
    })

    const tasksMdAfterReopen = await readFile(path.join(workspaceRoot, 'specs', '001-simple', 'tasks.md'), 'utf8')
    const stateAfterReopen = JSON.parse(await readFile(path.join(workspaceRoot, 'specs', '001-simple', '.while', 'state.json'), 'utf8')) as {
      tasks: Record<string, { attempt: number, generation: number, status: string }>
    }
    const reportAfterReopen = JSON.parse(await readFile(path.join(workspaceRoot, 'specs', '001-simple', '.while', 'report.json'), 'utf8')) as {
      summary: { finalStatus: string }
      tasks: { generation: number, id: string, status: string }[]
    }
    const greetingSource = await readFile(path.join(workspaceRoot, 'src', 'greeting.ts'), 'utf8')
    const farewellSource = await readFile(path.join(workspaceRoot, 'src', 'farewell.ts'), 'utf8')
    const messagesAfterReopen = await gitLogMessages(workspaceRoot)

    assert.match(tasksMdAfterReopen, /- \[ \] T001/)
    assert.match(tasksMdAfterReopen, /- \[ \] T002/)
    assert.equal(reportAfterReopen.summary.finalStatus, 'in_progress')
    assert.deepEqual(messagesAfterReopen, ['Initial commit'])
    assert.match(greetingSource, /TODO: implement greeting/)
    assert.match(farewellSource, /TODO: implement farewell/)
    assert.deepEqual(stateAfterReopen.tasks.T001, {
      attempt: 0,
      generation: 2,
      invalidatedBy: null,
      lastFindings: [],
      status: 'pending',
    })
    assert.deepEqual(stateAfterReopen.tasks.T002, {
      attempt: 0,
      generation: 2,
      invalidatedBy: 'T001',
      lastFindings: [],
      status: 'pending',
    })
    assert.deepEqual(reportAfterReopen.tasks, [
      { id: 'T001', attempt: 0, generation: 2, status: 'pending' },
      { id: 'T002', attempt: 0, generation: 2, status: 'pending' },
    ])

    process.stdout.write(`${JSON.stringify({ workspaceRoot }, null, 2)}\n`)
  }
  finally {
    await rm(tempRoot, { force: true, recursive: true })
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
