import { beforeEach, expect, test, vi } from 'vitest'

import { CodexAgentClient, type CodexClientLike } from '../src/agents/codex'

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
              taskId: 'T001',
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
    plan: '# plan',
    spec: '# spec',
    tasksSnippet: '- [ ] T001 Create parser',
    task: {
      id: 'T001',
      acceptance: ['parser exists'],
      dependsOn: [],
      maxAttempts: 2,
      parallelizable: false,
      phase: 'Phase 1',
      reviewRubric: ['naming clarity'],
      title: 'Create parser',
    },
  })

  expect(mockState.constructorCalls).toBe(1)
  expect(receivedWorkingDirectory).toBe('/tmp/project')
  expect(receivedPrompt).toMatch(/Create parser/)
  expect(receivedSchema?.required).toContain('taskId')
  expect(result.taskId).toBe('T001')
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
                    taskId: 'T001',
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
                    taskId: 'T001',
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
    plan: '# plan',
    spec: '# spec',
    tasksSnippet: '- [ ] T001 Do work',
    task: {
      id: 'T001',
      acceptance: ['works'],
      dependsOn: [],
      maxAttempts: 2,
      parallelizable: false,
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
    },
  })
  await client.review({
    actualChangedFiles: ['src/a.ts'],
    attempt: 1,
    generation: 1,
    lastFindings: [],
    plan: '# plan',
    spec: '# spec',
    tasksSnippet: '- [ ] T001 Do work',
    implement: {
      assumptions: [],
      needsHumanAttention: false,
      notes: [],
      status: 'implemented',
      summary: 'ok',
      taskId: 'T001',
      unresolvedItems: [],
    },
    task: {
      id: 'T001',
      acceptance: ['works'],
      dependsOn: [],
      maxAttempts: 2,
      parallelizable: false,
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
    },
  })

  expect(mockState.constructorCalls).toBe(1)
  expect(startThreadCallCount).toBe(2)
})
