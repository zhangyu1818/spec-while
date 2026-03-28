import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  return {
    batchCalls: [] as unknown[],
    configCalls: [] as unknown[],
    resolveCalls: [] as unknown[],
    runCalls: [] as unknown[],
  }
})

vi.mock('../src/workflow/config', () => {
  return {
    loadWorkflowConfig: vi.fn(async (workspaceRoot: string) => {
      mockState.configCalls.push(workspaceRoot)
      return {
        task: {
          maxIterations: 5,
          source: 'openspec',
        },
        workflow: {
          mode: 'direct',
          roles: {
            implementer: { provider: 'codex' },
            reviewer: { provider: 'codex' },
          },
        },
      }
    }),
  }
})

vi.mock('../src/runtime/workspace-resolver', () => {
  return {
    resolveWorkspaceContext: vi.fn(async (input) => {
      mockState.resolveCalls.push(input)
      return {
        featureDir: '/tmp/specs/001-demo',
        featureId: '001-demo',
        runtimeDir: '/tmp/specs/001-demo/.while',
        workspaceRoot: '/tmp/workspace',
      }
    }),
  }
})

vi.mock('../src/commands/run', () => {
  return {
    runCommand: vi.fn(async (context, options) => {
      mockState.runCalls.push({ context, options })
      return { ok: true }
    }),
  }
})

vi.mock('../src/commands/batch', () => {
  return {
    runBatchCommand: vi.fn(async (options) => {
      mockState.batchCalls.push(options)
      return { batch: true }
    }),
  }
})

const { handleFatalError, runCli } = await import('../src/index')

beforeEach(() => {
  mockState.batchCalls = []
  mockState.configCalls = []
  mockState.resolveCalls = []
  mockState.runCalls = []
})

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

test('runCli dispatches run command and prints result', async () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/current')

  await runCli([
    'run',
    '--feature',
    '001-demo',
    '--until-task',
    'T002',
    '--verbose',
  ])

  expect(mockState.resolveCalls).toEqual([
    {
      cwd: '/tmp/current',
      feature: '001-demo',
      taskSource: 'openspec',
    },
  ])
  expect(mockState.configCalls).toEqual(['/tmp/current'])
  expect(mockState.runCalls[0]).toMatchObject({
    options: {
      untilTaskId: 'T002',
      verbose: true,
      config: {
        task: {
          maxIterations: 5,
          source: 'openspec',
        },
      },
    },
  })
  expect(stdout).toHaveBeenCalledWith('{ ok: true }\n')
  cwd.mockRestore()
})

test('runCli dispatches batch command and prints result without loading workflow config', async () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/current')

  await runCli(['batch', '--config', './jobs/batch.yaml', '--verbose'])

  expect(mockState.batchCalls).toEqual([
    {
      configPath: './jobs/batch.yaml',
      cwd: '/tmp/current',
      verbose: true,
    },
  ])
  expect(mockState.configCalls).toEqual([])
  expect(mockState.resolveCalls).toEqual([])
  expect(mockState.runCalls).toEqual([])
  expect(stdout).toHaveBeenCalledWith('{ batch: true }\n')
  cwd.mockRestore()
})

test('runCli rejects removed workspace flag and unexpected positional arguments', async () => {
  const removedWorkspaceFlag = ['--', 'workspace'].join('')

  await expect(
    runCli([
      'run',
      removedWorkspaceFlag,
      '/tmp/workspace',
      '--feature',
      '001-demo',
    ]),
  ).rejects.toThrow(/unknown|unexpected option/i)
  await expect(
    runCli(['rewind', removedWorkspaceFlag, '/tmp/workspace']),
  ).rejects.toThrow(/unknown|unexpected option/i)
})

test('runCli rejects rewind as an unknown command', async () => {
  await expect(runCli(['rewind', '--task', 'T001'])).rejects.toThrow(
    /Unknown command: rewind/,
  )
})

test('runCli rejects removed resume command and unknown commands', async () => {
  await expect(runCli(['resume'])).rejects.toThrow(/Unknown command: resume/)
  await expect(runCli(['wat'])).rejects.toThrow(/Unknown command: wat/)
})

test('handleFatalError writes message to stderr and sets exitCode', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

  handleFatalError(new Error('boom'))

  expect(stderr).toHaveBeenCalledWith('boom\n')
  expect(process.exitCode).toBe(1)
})
