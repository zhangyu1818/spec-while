import { beforeEach, expect, test, vi } from 'vitest'

import { CodexAgentClient, type CodexClientLike } from '../src/agents/codex'
import { createTaskPrompt } from './task-source-test-helpers'

const mockState = vi.hoisted(() => {
  return {
    client: null as CodexClientLike | null,
    constructorCalls: 0,
  }
})

vi.mock('@openai/codex-sdk', () => {
  return {
    Codex: function MockCodex() {
      mockState.constructorCalls += 1
      if (!mockState.client) {
        throw new Error('No mock Codex client configured')
      }
      return mockState.client
    },
  }
})

beforeEach(() => {
  mockState.client = null
  mockState.constructorCalls = 0
})

test('CodexAgentClient passes workspaceRoot and structured output schema to SDK for implement', async () => {
  let receivedPrompt = ''
  let receivedSchema: Record<string, unknown> | undefined
  let receivedWorkingDirectory = ''

  mockState.client = {
    startThread(options) {
      receivedWorkingDirectory = options.workingDirectory
      return {
        async run(prompt, runOptions) {
          receivedPrompt = prompt
          receivedSchema = runOptions.outputSchema
          return {
            finalResponse: JSON.stringify({
              assumptions: [],
              needsHumanAttention: false,
              notes: [],
              status: 'implemented',
              summary: 'done',
              taskHandle: 'T001',
              unresolvedItems: [],
            }),
          }
        },
      }
    },
  }

  const client = new CodexAgentClient({
    workspaceRoot: '/tmp/project',
  })

  const result = await client.implement({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    taskHandle: 'T001',
    prompt: createTaskPrompt({
      completionCriteria: ['parser exists'],
      taskHandle: 'T001',
      tasksSnippet: '- [ ] T001 Create parser',
      title: 'Create parser',
    }),
  })

  expect(mockState.constructorCalls).toBe(1)
  expect(receivedWorkingDirectory).toBe('/tmp/project')
  expect(receivedPrompt).toMatch(/Create parser/)
  expect(receivedSchema?.required).toContain('taskHandle')
  expect(result.taskHandle).toBe('T001')
})

test('CodexAgentClient creates a fresh thread for each role invocation', async () => {
  let startThreadCallCount = 0

  mockState.client = {
    startThread() {
      startThreadCallCount += 1
      return {
        async run(_prompt, runOptions) {
          const required = Array.isArray(runOptions.outputSchema.required)
            ? runOptions.outputSchema.required
            : []
          const isReview = required.includes('verdict')
          return {
            finalResponse: JSON.stringify(
              isReview
                ? {
                    findings: [],
                    overallRisk: 'low',
                    summary: 'ok',
                    taskHandle: 'T001',
                    verdict: 'pass',
                    acceptanceChecks: [
                      {
                        criterion: 'works',
                        note: 'ok',
                        status: 'pass',
                      },
                    ],
                  }
                : {
                    assumptions: [],
                    needsHumanAttention: false,
                    notes: [],
                    status: 'implemented',
                    summary: 'ok',
                    taskHandle: 'T001',
                    unresolvedItems: [],
                  },
            ),
          }
        },
      }
    },
  }

  const client = new CodexAgentClient({
    workspaceRoot: '/tmp/project',
  })

  await client.implement({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
  })
  await client.review({
    actualChangedFiles: ['src/a.ts'],
    attempt: 1,
    generation: 1,
    lastFindings: [],
    prompt: createTaskPrompt(),
    taskHandle: 'T001',
    implement: {
      assumptions: [],
      needsHumanAttention: false,
      notes: [],
      status: 'implemented',
      summary: 'ok',
      taskHandle: 'T001',
      unresolvedItems: [],
    },
  })

  expect(mockState.constructorCalls).toBe(1)
  expect(startThreadCallCount).toBe(2)
})

test('CodexAgentClient can invoke standalone structured prompts', async () => {
  let receivedPrompt = ''
  let receivedSchema: Record<string, unknown> | undefined

  mockState.client = {
    startThread() {
      return {
        async run(prompt, runOptions) {
          receivedPrompt = prompt
          receivedSchema = runOptions.outputSchema
          return {
            finalResponse: JSON.stringify({
              summary: 'ok',
            }),
          }
        },
      }
    },
  }

  const client = new CodexAgentClient({
    workspaceRoot: '/tmp/project',
  })

  const result = await client.invokeStructured({
    prompt: 'Summarize the file.',
    outputSchema: {
      required: ['summary'],
      type: 'object',
      properties: {
        summary: {
          type: 'string',
        },
      },
    },
  })

  expect(receivedPrompt).toBe('Summarize the file.')
  expect(receivedSchema).toMatchObject({
    required: ['summary'],
    type: 'object',
  })
  expect(result).toEqual({
    summary: 'ok',
  })
})
