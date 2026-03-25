import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { beforeEach, expect, test, vi } from 'vitest'

import { rewindCommand } from '../src/commands/rewind'
import {
  createPassingReview,
  createWorkspace,
  currentHead,
  gitLogMessages,
  initGitRepo,
  ScriptedWorkflowProvider,
} from './command-test-helpers'

const providerState = vi.hoisted(() => ({
  queue: [] as ScriptedWorkflowProvider[],
  createdOptions: [] as {
    onEvent?: (event: { item?: { type?: string }; type: string }) => void
    workspaceRoot: string
  }[],
}))

vi.mock('../src/agents/codex', () => {
  return {
    createCodexProvider: vi.fn(
      (options: {
        onEvent?: (event: { item?: { type?: string }; type: string }) => void
        workspaceRoot: string
      }) => {
        providerState.createdOptions.push(options)
        const provider = providerState.queue.shift()
        if (!provider) {
          throw new Error('Missing scripted workflow provider')
        }
        return provider
      },
    ),
  }
})

const { runCommand } = await import('../src/commands/run')

beforeEach(() => {
  providerState.createdOptions = []
  providerState.queue = []
})

test('rewindCommand hard-resets code and rebuilds runtime from surviving commits', async () => {
  const { context, featureDir, root } = await createWorkspace()
  await initGitRepo(root)
  providerState.queue.push(
    new ScriptedWorkflowProvider(
      async (input) => {
        if (input.task.id === 'T001') {
          await writeFile(
            path.join(root, 'src', 'greeting.js'),
            'exports.buildGreeting = () => "Hello, world!"\n',
          )
          return
        }
        await writeFile(
          path.join(root, 'src', 'farewell.js'),
          'exports.buildFarewell = () => "Bye, world!"\n',
        )
      },
      async (input) => createPassingReview(input),
    ),
  )

  await runCommand(context)
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
  const state = JSON.parse(
    await readFile(path.join(featureDir, '.while', 'state.json'), 'utf8'),
  ) as {
    tasks: Record<
      string,
      { attempt: number; generation: number; status: string }
    >
  }
  const report = JSON.parse(
    await readFile(path.join(featureDir, '.while', 'report.json'), 'utf8'),
  ) as {
    summary: { finalStatus: string }
    tasks: {
      commitSha?: string
      generation: number
      id: string
      status: string
    }[]
  }

  expect(messages).toEqual(['Initial commit'])
  expect(await currentHead(root)).not.toBe(initialHead)
  expect(greeting).toContain('broken')
  expect(farewell).toContain('broken')
  expect(tasksMd).toMatch(/- \[ \] T001/)
  expect(tasksMd).toMatch(/- \[ \] T002/)
  expect(state.tasks.T001).toMatchObject({
    attempt: 0,
    generation: 2,
    status: 'pending',
  })
  expect(state.tasks.T002).toMatchObject({
    attempt: 0,
    generation: 2,
    status: 'pending',
  })
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

  await expect(rewindCommand(context, 'T001')).rejects.toThrow(
    /worktree.*clean/i,
  )
})
