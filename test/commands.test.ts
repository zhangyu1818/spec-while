import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from 'vitest'

import { rewindCommand } from '../src/commands/rewind'
import { runCommand } from '../src/commands/run'
import { createPassingReview, createWorkspace, currentHead, gitLogMessages, initGitRepo, ScriptedAgentClient, trackedFilesInHead } from './command-test-helpers'

test('runCommand creates one git commit per completed task and records commitSha without committing .while', async () => {
  const { context, featureDir, root } = await createWorkspace()
  await initGitRepo(root)
  const agent = new ScriptedAgentClient(
    async (input) => {
      if (input.task.id === 'T001') {
        await writeFile(path.join(root, 'src', 'greeting.js'), 'exports.buildGreeting = () => "Hello, world!"\n')
        return
      }
      await writeFile(path.join(root, 'src', 'farewell.js'), 'exports.buildFarewell = () => "Bye, world!"\n')
    },
    async (input) => createPassingReview(input),
  )

  const result = await runCommand(context, { agent })

  expect(result.summary.finalStatus).toBe('completed')
  expect(agent.reviewInputs.map((input) => input.actualChangedFiles)).toEqual([
    ['src/greeting.js'],
    ['src/farewell.js'],
  ])

  const messages = await gitLogMessages(root)
  expect(messages.slice(0, 3)).toEqual([
    'Task T002: Implement farewell in src/farewell.js',
    'Task T001: Implement greeting in src/greeting.js',
    'Initial commit',
  ])

  const state = JSON.parse(await readFile(path.join(featureDir, '.while', 'state.json'), 'utf8')) as {
    tasks: Record<string, { commitSha?: string, status: string }>
  }
  const report = JSON.parse(await readFile(path.join(featureDir, '.while', 'report.json'), 'utf8')) as {
    tasks: { commitSha?: string, id: string, status: string }[]
  }
  const headFiles = await trackedFilesInHead(root)

  expect(state.tasks.T001?.status).toBe('done')
  expect(state.tasks.T001?.commitSha).toBeTruthy()
  expect(state.tasks.T002?.status).toBe('done')
  expect(state.tasks.T002?.commitSha).toBeTruthy()
  expect(report.tasks.every((task) => task.status === 'done' && typeof task.commitSha === 'string')).toBe(true)
  expect(headFiles).toContain('src/farewell.js')
  expect(headFiles).toContain('specs/001-demo/tasks.md')
  expect(headFiles.some((file) => file.includes('.while'))).toBe(false)
})

test('runCommand rejects a dirty worktree before starting', async () => {
  const { context, root } = await createWorkspace({
    includeSecondTask: false,
  })
  await initGitRepo(root)
  await writeFile(path.join(root, 'draft.txt'), 'temporary\n')
  const agent = new ScriptedAgentClient(
    async () => {},
    async (input) => createPassingReview(input),
  )

  await expect(runCommand(context, { agent })).rejects.toThrow(/worktree.*clean/i)
})

test('runCommand keeps soft path boundaries and lets reviewer judge extra changed files', async () => {
  const { context, root } = await createWorkspace({
    includeSecondTask: false,
  })
  await initGitRepo(root)
  const agent = new ScriptedAgentClient(
    async () => {
      await writeFile(path.join(root, 'src', 'greeting.js'), 'exports.buildGreeting = () => "Hello, world!"\n')
      await writeFile(path.join(root, 'src', 'shared.js'), 'exports.shared = "updated"\n')
    },
    async (input) => {
      expect(input.actualChangedFiles).toEqual(['src/greeting.js', 'src/shared.js'])
      return createPassingReview(input)
    },
  )

  const result = await runCommand(context, { agent })

  expect(result.summary.finalStatus).toBe('completed')
})

test('runCommand treats tasks without verify commands as passing no-op verify', async () => {
  const { context, root } = await createWorkspace({
    includeSecondTask: false,
    omitVerifyForTaskIds: ['T001'],
  })
  await initGitRepo(root)
  const agent = new ScriptedAgentClient(
    async () => {
      await writeFile(path.join(root, 'src', 'greeting.js'), 'exports.buildGreeting = () => "Hello, world!"\n')
    },
    async (input) => {
      expect(input.verify).toEqual({
        commands: [],
        passed: true,
        summary: 'No verify commands configured.',
        taskId: 'T001',
      })
      return createPassingReview(input)
    },
  )

  const result = await runCommand(context, { agent })

  expect(result.summary.finalStatus).toBe('completed')
})

test('runCommand resumes remaining tasks and keeps task-to-commit mapping linear', async () => {
  const { context, root } = await createWorkspace()
  await initGitRepo(root)
  const firstAgent = new ScriptedAgentClient(
    async (input) => {
      if (input.task.id === 'T001') {
        await writeFile(path.join(root, 'src', 'greeting.js'), 'exports.buildGreeting = () => "Hello, world!"\n')
      }
    },
    async (input) => createPassingReview(input),
  )

  const partial = await runCommand(context, {
    agent: firstAgent,
    untilTaskId: 'T001',
  })
  const partialMessages = await gitLogMessages(root)

  expect(partial.summary.finalStatus).toBe('in_progress')
  expect(firstAgent.implementInputs.map((input) => input.task.id)).toEqual(['T001'])
  expect(partialMessages.slice(0, 2)).toEqual([
    'Task T001: Implement greeting in src/greeting.js',
    'Initial commit',
  ])

  const secondAgent = new ScriptedAgentClient(
    async (input) => {
      if (input.task.id === 'T002') {
        await writeFile(path.join(root, 'src', 'farewell.js'), 'exports.buildFarewell = () => "Bye, world!"\n')
      }
    },
    async (input) => createPassingReview(input),
  )

  const resumed = await runCommand(context, { agent: secondAgent })
  const resumedMessages = await gitLogMessages(root)

  expect(resumed.summary.finalStatus).toBe('completed')
  expect(secondAgent.implementInputs.map((input) => input.task.id)).toEqual(['T002'])
  expect(resumedMessages.slice(0, 3)).toEqual([
    'Task T002: Implement farewell in src/farewell.js',
    'Task T001: Implement greeting in src/greeting.js',
    'Initial commit',
  ])
})

test('runCommand reverts the tasks.md checkbox and blocks when the task commit fails', async () => {
  const { context, featureDir, root } = await createWorkspace({
    includeSecondTask: false,
    maxAttempts: 1,
  })
  await initGitRepo(root)
  const hookPath = path.join(root, '.git', 'hooks', 'pre-commit')
  await writeFile(hookPath, '#!/bin/sh\nexit 1\n')
  await chmod(hookPath, 0o755)
  const agent = new ScriptedAgentClient(
    async () => {
      await writeFile(path.join(root, 'src', 'greeting.js'), 'exports.buildGreeting = () => "Hello, world!"\n')
    },
    async (input) => createPassingReview(input),
  )

  const result = await runCommand(context, { agent })
  const messages = await gitLogMessages(root)

  expect(result.summary.finalStatus).toBe('blocked')
  expect(messages[0]).toBe('Initial commit')

  const tasksMd = await readFile(path.join(featureDir, 'tasks.md'), 'utf8')
  const state = JSON.parse(await readFile(path.join(featureDir, '.while', 'state.json'), 'utf8')) as {
    tasks: Record<string, { reason?: string, status: string }>
  }

  expect(tasksMd).toMatch(/- \[ \] T001/)
  expect(state.tasks.T001).toMatchObject({
    status: 'blocked',
  })
  expect(state.tasks.T001?.reason).toMatch(/commit/i)
})

test('rewindCommand hard-resets code and rebuilds runtime from surviving commits', async () => {
  const { context, featureDir, root } = await createWorkspace()
  await initGitRepo(root)
  const agent = new ScriptedAgentClient(
    async (input) => {
      if (input.task.id === 'T001') {
        await writeFile(path.join(root, 'src', 'greeting.js'), 'exports.buildGreeting = () => "Hello, world!"\n')
        return
      }
      await writeFile(path.join(root, 'src', 'farewell.js'), 'exports.buildFarewell = () => "Bye, world!"\n')
    },
    async (input) => createPassingReview(input),
  )

  await runCommand(context, { agent })
  const initialHead = await currentHead(root)
  const initialMessages = await gitLogMessages(root)
  expect(initialMessages.slice(0, 3)).toEqual([
    'Task T002: Implement farewell in src/farewell.js',
    'Task T001: Implement greeting in src/greeting.js',
    'Initial commit',
  ])

  await rewindCommand(context, 'T001')

  const messages = await gitLogMessages(root)
  const greeting = await readFile(path.join(root, 'src', 'greeting.js'), 'utf8')
  const farewell = await readFile(path.join(root, 'src', 'farewell.js'), 'utf8')
  const tasksMd = await readFile(path.join(featureDir, 'tasks.md'), 'utf8')
  const state = JSON.parse(await readFile(path.join(featureDir, '.while', 'state.json'), 'utf8')) as {
    tasks: Record<string, { attempt: number, generation: number, status: string }>
  }
  const report = JSON.parse(await readFile(path.join(featureDir, '.while', 'report.json'), 'utf8')) as {
    summary: { finalStatus: string }
    tasks: { commitSha?: string, generation: number, id: string, status: string }[]
  }

  expect(messages).toEqual(['Initial commit'])
  expect(await currentHead(root)).not.toBe(initialHead)
  expect(greeting).toContain('broken')
  expect(farewell).toContain('broken')
  expect(tasksMd).toMatch(/- \[ \] T001/)
  expect(tasksMd).toMatch(/- \[ \] T002/)
  expect(state.tasks.T001).toMatchObject({ attempt: 0, generation: 2, status: 'pending' })
  expect(state.tasks.T002).toMatchObject({ attempt: 0, generation: 2, status: 'pending' })
  expect(report.summary.finalStatus).toBe('in_progress')
  expect(report.tasks).toEqual([
    { id: 'T001', attempt: 0, generation: 2, status: 'pending' },
    { id: 'T002', attempt: 0, generation: 2, status: 'pending' },
  ])
})

test('rewindCommand rejects dirty worktrees', async () => {
  const { context, root } = await createWorkspace({
    includeSecondTask: false,
  })
  await initGitRepo(root)
  await writeFile(path.join(root, 'draft.txt'), 'temporary\n')

  await expect(rewindCommand(context, 'T001')).rejects.toThrow(/worktree.*clean/i)
})
