import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  return {
    resolveCalls: [] as unknown[],
    rewindCalls: [] as { context: unknown, taskId: string }[],
    runCalls: [] as unknown[],
  }
})

vi.mock('../src/runtime/workspace-resolver', () => {
  return {
    resolveWorkspaceContext: vi.fn(async (input) => {
      mockState.resolveCalls.push(input)
      return {
        featureDir: '/tmp/specs/001-demo',
        featureId: '001-demo',
        planPath: '/tmp/specs/001-demo/plan.md',
        runtimeDir: '/tmp/specs/001-demo/.while',
        specPath: '/tmp/specs/001-demo/spec.md',
        tasksPath: '/tmp/specs/001-demo/tasks.md',
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

vi.mock('../src/commands/rewind', () => {
  return {
    rewindCommand: vi.fn(async (context, taskId) => {
      mockState.rewindCalls.push({ context, taskId })
      return { rewound: taskId }
    }),
  }
})

const { handleFatalError, runCli } = await import('../src/index')

beforeEach(() => {
  mockState.rewindCalls = []
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

  await runCli(['run', '--workspace', '/tmp/workspace', '--feature', '001-demo', '--until-task', 'T002', '--verbose'])

  expect(mockState.resolveCalls).toEqual([
    {
      cwd: '/tmp/current',
      env: process.env,
      feature: '001-demo',
      workspace: '/tmp/workspace',
    },
  ])
  expect(mockState.runCalls[0]).toMatchObject({
    options: {
      untilTaskId: 'T002',
      verbose: true,
    },
  })
  expect(stdout).toHaveBeenCalledWith('{ ok: true }\n')
  cwd.mockRestore()
})

test('runCli rejects unknown flags and unexpected positional arguments', async () => {
  await expect(runCli(['run', '--workspace', '/tmp/workspace', '--feature', '001-demo', '--bogus']))
    .rejects
    .toThrow(/unknown|unexpected option/i)
  await expect(runCli(['rewind', '--workspace', '/tmp/workspace', '--feature', '001-demo', '--task', 'T001', 'extra']))
    .rejects
    .toThrow(/Unexpected positional arguments: extra/)
})

test('runCli dispatches rewind command and requires task id', async () => {
  await runCli(['rewind', '--workspace', '/tmp/workspace', '--feature', '001-demo', '--task', 'T001'])

  expect(mockState.rewindCalls[0]).toMatchObject({
    taskId: 'T001',
  })

  await expect(runCli(['rewind', '--workspace', '/tmp/workspace'])).rejects.toThrow(/Missing --task/)
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
