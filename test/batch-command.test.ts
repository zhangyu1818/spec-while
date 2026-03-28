import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type {
  BatchFileInput,
  BatchStructuredOutputProvider,
} from '../src/batch/provider'

const providerState = vi.hoisted(() => ({
  inputs: [] as BatchFileInput[],
  provider: null as BatchStructuredOutputProvider | null,
}))

vi.mock('../src/batch/provider', () => {
  return {
    createBatchStructuredOutputProvider: vi.fn(() => {
      if (!providerState.provider) {
        throw new Error('Missing batch structured output provider')
      }
      return providerState.provider
    }),
  }
})

const { runBatchCommand } = await import('../src/commands/batch')

const workspaces: string[] = []

async function createWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'while-batch-command-'))
  workspaces.push(root)
  return root
}

async function writeConfig(root: string, workdir = './input') {
  const configPath = path.join(root, 'batch.yaml')
  await writeFile(
    configPath,
    [
      'provider: codex',
      `workdir: ${workdir}`,
      'prompt: |',
      '  summarize file',
      'schema:',
      '  type: object',
      '  properties:',
      '    summary:',
      '      type: string',
      '  required:',
      '    - summary',
      '',
    ].join('\n'),
  )
  return configPath
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(async (workspaceRoot) => {
      await rm(workspaceRoot, { force: true, recursive: true })
    }),
  )
})

beforeEach(() => {
  providerState.inputs = []
  providerState.provider = null
})

test('runBatchCommand writes results and state for discovered files', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(path.join(inputDir, 'b.txt'), 'beta\n')
  const configPath = await writeConfig(root)

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      return {
        summary: path.basename(input.filePath),
      }
    },
  }

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(providerState.inputs.map((input) => input.filePath)).toEqual([
    'a.txt',
    'b.txt',
  ])

  const state = JSON.parse(
    await readFile(path.join(root, 'state.json'), 'utf8'),
  ) as {
    failed: string[]
    inProgress: string[]
    pending: string[]
  }
  const results = JSON.parse(
    await readFile(path.join(root, 'results.json'), 'utf8'),
  ) as Record<string, { summary: string }>

  expect(state).toEqual({
    failed: [],
    inProgress: [],
    pending: [],
  })
  expect(results).toEqual({
    'a.txt': { summary: 'a.txt' },
    'b.txt': { summary: 'b.txt' },
  })
})

test('runBatchCommand restores inProgress files and skips completed results on rerun', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(path.join(inputDir, 'b.txt'), 'beta\n')
  await writeFile(path.join(inputDir, 'c.txt'), 'gamma\n')
  const configPath = await writeConfig(root)
  await writeFile(
    path.join(root, 'state.json'),
    JSON.stringify(
      {
        failed: [],
        inProgress: ['b.txt'],
        pending: ['c.txt'],
      },
      null,
      2,
    ),
  )
  await writeFile(
    path.join(root, 'results.json'),
    JSON.stringify(
      {
        'a.txt': {
          summary: 'done',
        },
      },
      null,
      2,
    ),
  )

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      return {
        summary: input.filePath,
      }
    },
  }

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(providerState.inputs.map((input) => input.filePath)).toEqual([
    'b.txt',
    'c.txt',
  ])

  const state = JSON.parse(
    await readFile(path.join(root, 'state.json'), 'utf8'),
  ) as {
    failed: string[]
    inProgress: string[]
    pending: string[]
  }
  const results = JSON.parse(
    await readFile(path.join(root, 'results.json'), 'utf8'),
  ) as Record<string, { summary: string }>

  expect(state).toEqual({
    failed: [],
    inProgress: [],
    pending: [],
  })
  expect(results).toEqual({
    'a.txt': { summary: 'done' },
    'b.txt': { summary: 'b.txt' },
    'c.txt': { summary: 'c.txt' },
  })
})

test('runBatchCommand recycles failed files into the next round until they succeed', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  await writeFile(path.join(inputDir, 'b.txt'), 'beta\n')
  const configPath = await writeConfig(root)
  let attemptCount = 0

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      if (input.filePath === 'a.txt' && attemptCount === 0) {
        attemptCount += 1
        return {
          wrong: true,
        }
      }
      return {
        summary: input.filePath,
      }
    },
  }

  const result = await runBatchCommand({
    configPath,
    cwd: root,
  })

  const state = JSON.parse(
    await readFile(path.join(root, 'state.json'), 'utf8'),
  ) as {
    failed: string[]
    inProgress: string[]
    pending: string[]
  }
  const results = JSON.parse(
    await readFile(path.join(root, 'results.json'), 'utf8'),
  ) as Record<string, unknown>

  expect(providerState.inputs.map((input) => input.filePath)).toEqual([
    'a.txt',
    'b.txt',
    'a.txt',
  ])
  expect(state).toEqual({
    failed: [],
    inProgress: [],
    pending: [],
  })
  expect(result.failedFiles).toEqual([])
  expect(results).toEqual({
    'a.txt': { summary: 'a.txt' },
    'b.txt': { summary: 'b.txt' },
  })
})

test('runBatchCommand persists recycled failed files as the next runnable queue', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  const configPath = await writeConfig(root)
  await writeFile(
    path.join(root, 'state.json'),
    JSON.stringify(
      {
        failed: ['a.txt'],
        inProgress: [],
        pending: [],
      },
      null,
      2,
    ),
  )

  let observedState: null | {
    failed: string[]
    inProgress: string[]
    pending: string[]
  } = null

  providerState.provider = {
    name: 'codex',
    async runFile() {
      observedState = JSON.parse(
        await readFile(path.join(root, 'state.json'), 'utf8'),
      ) as {
        failed: string[]
        inProgress: string[]
        pending: string[]
      }
      return {
        summary: 'a.txt',
      }
    },
  }

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(observedState).toEqual({
    failed: [],
    inProgress: ['a.txt'],
    pending: [],
  })
})

test('runBatchCommand rejects missing configured workdir with a clear error', async () => {
  const root = await createWorkspace()
  const configPath = await writeConfig(root, './missing')

  providerState.provider = {
    name: 'codex',
    async runFile() {
      return {
        summary: 'unused',
      }
    },
  }

  await expect(
    runBatchCommand({
      configPath,
      cwd: root,
    }),
  ).rejects.toThrow(/workdir does not exist/i)
})
