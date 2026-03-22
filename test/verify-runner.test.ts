import { expect, test } from 'vitest'

import { ProcessVerifier } from '../src/runtime/verify-runner'

test('ProcessVerifier handles large stdout without maxBuffer failures', async () => {
  const verifier = new ProcessVerifier(process.cwd())
  const result = await verifier.verify({
    commands: ['node -e "process.stdout.write(\'x\'.repeat(1500000))"'],
    taskId: 'T001',
  })
  const commandResult = result.commands[0]

  expect(result.passed).toBe(true)
  expect(commandResult).toBeDefined()
  expect(commandResult?.passed).toBe(true)
  expect(commandResult?.stdout).toHaveLength(1500000)
})

test('ProcessVerifier preserves stderr and continues collecting later command results after a failure', async () => {
  const verifier = new ProcessVerifier(process.cwd())
  const result = await verifier.verify({
    taskId: 'T001',
    commands: [
      'node -e "process.stderr.write(\'boom\'); process.exit(1)"',
      'node -e "process.stdout.write(\'ok\')"',
    ],
  })

  expect(result.passed).toBe(false)
  expect(result.summary).toMatch(/failed/i)
  expect(result.commands).toHaveLength(2)
  expect(result.commands[0]).toMatchObject({
    exitCode: 1,
    passed: false,
    stderr: 'boom',
  })
  expect(result.commands[1]).toMatchObject({
    exitCode: 0,
    passed: true,
    stdout: 'ok',
  })
})

test('ProcessVerifier reports shell termination signals in stderr', async () => {
  const verifier = new ProcessVerifier(process.cwd())
  const result = await verifier.verify({
    commands: ['kill -TERM $$'],
    taskId: 'T001',
  })

  expect(result.passed).toBe(false)
  expect(result.commands[0]?.passed).toBe(false)
  expect(result.commands[0]?.stderr).toMatch(/Process exited with signal SIGTERM/)
})

test('ProcessVerifier treats missing verify commands as a passing no-op', async () => {
  const verifier = new ProcessVerifier(process.cwd())
  const result = await verifier.verify({
    commands: [],
    taskId: 'T001',
  })

  expect(result).toEqual({
    commands: [],
    passed: true,
    summary: 'No verify commands configured.',
    taskId: 'T001',
  })
})
