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

async function writeConfig(root: string) {
  const configPath = path.join(root, 'batch.yaml')
  await writeFile(
    configPath,
    [
      'provider: codex',
      'workdir: ./input',
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

test('runBatchCommand prints file failure reasons when verbose is enabled', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  const configPath = await writeConfig(root)
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  let attemptCount = 0

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      attemptCount += 1
      if (attemptCount === 1) {
        return {
          wrong: true,
        }
      }
      return {
        summary: input.filePath,
      }
    },
  }

  await runBatchCommand({
    configPath,
    cwd: root,
    verbose: true,
  })

  expect(providerState.inputs.map((input) => input.filePath)).toEqual([
    'a.txt',
    'a.txt',
  ])
  expect(stderr).toHaveBeenCalledOnce()
  expect(stderr.mock.calls[0]?.[0]).toMatch(/\[batch\] failed a\.txt:/)
})

test('runBatchCommand drops missing failed paths before starting a new run', async () => {
  const root = await createWorkspace()
  const inputDir = path.join(root, 'input')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'a.txt'), 'alpha\n')
  const configPath = await writeConfig(root)
  await writeFile(
    path.join(root, 'state.json'),
    JSON.stringify(
      {
        failed: ['missing.txt'],
        inProgress: [],
        pending: [],
      },
      null,
      2,
    ),
  )

  providerState.provider = {
    name: 'codex',
    async runFile(input) {
      providerState.inputs.push(input)
      if (input.filePath === 'a.txt') {
        await writeFile(path.join(inputDir, 'missing.txt'), 'late\n')
      }
      return {
        summary: input.filePath,
      }
    },
  }

  await runBatchCommand({
    configPath,
    cwd: root,
  })

  expect(providerState.inputs.map((input) => input.filePath)).toEqual(['a.txt'])

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
  })
})
