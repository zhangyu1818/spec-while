import { beforeEach, expect, test, vi } from 'vitest'

import { CodexAgentClient, type CodexClientLike } from '../src/agents/codex'

const mockState = vi.hoisted(() => {
  return {
    client: null as CodexClientLike | null,
  }
})

vi.mock('@openai/codex-sdk', () => {
  return {
    Codex: function MockCodex() {
      if (!mockState.client) {
        throw new Error('No mock Codex client configured')
      }
      return mockState.client
    },
  }
})

beforeEach(() => {
  mockState.client = null
})

test('CodexAgentClient throws when SDK returns empty finalResponse in non-stream mode', async () => {
  mockState.client = {
    startThread() {
      return {
        async run() {
          return {
            finalResponse: '   ',
          }
        },
      }
    },
  }

  const client = new CodexAgentClient({
    workspaceRoot: '/tmp/project',
  })

  await expect(client.implement({
    attempt: 1,
    codeContext: '',
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
      paths: ['src/a.ts'],
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
      verifyCommands: ['node -e "process.exit(0)"'],
    },
  })).rejects.toThrow(/empty finalResponse/i)
})

test('CodexAgentClient throws when SDK returns non-JSON finalResponse in non-stream mode', async () => {
  mockState.client = {
    startThread() {
      return {
        async run() {
          return {
            finalResponse: 'not-json',
          }
        },
      }
    },
  }

  const client = new CodexAgentClient({
    workspaceRoot: '/tmp/project',
  })

  await expect(client.implement({
    attempt: 1,
    codeContext: '',
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
      paths: ['src/a.ts'],
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
      verifyCommands: ['node -e "process.exit(0)"'],
    },
  })).rejects.toThrow(/non-JSON finalResponse/i)
})

test('CodexAgentClient surfaces streamed agent failures before any structured response is produced', async () => {
  const seenEvents: string[] = []

  mockState.client = {
    startThread() {
      return {
        async run() {
          return {
            finalResponse: JSON.stringify({ ok: false }),
          }
        },
        async runStreamed() {
          return {
            events: (async function* () {
              yield { thread_id: 'thread-1', type: 'thread.started' as const }
              yield {
                type: 'turn.failed' as const,
                error: {
                  message: 'model failed',
                },
              }
            })(),
          }
        },
      }
    },
  }

  const client = new CodexAgentClient({
    workspaceRoot: '/tmp/project',
    onEvent(event) {
      seenEvents.push(event.type)
    },
  })

  await expect(client.implement({
    attempt: 1,
    codeContext: '',
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
      paths: ['src/a.ts'],
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
      verifyCommands: ['node -e "process.exit(0)"'],
    },
  })).rejects.toThrow(/model failed/i)
  expect(seenEvents).toEqual(['thread.started', 'turn.failed'])
})

test('CodexAgentClient throws when streamed mode completes without any final agent message', async () => {
  mockState.client = {
    startThread() {
      return {
        async run() {
          return {
            finalResponse: JSON.stringify({ ok: false }),
          }
        },
        async runStreamed() {
          return {
            events: (async function* () {
              yield { thread_id: 'thread-1', type: 'thread.started' as const }
              yield { type: 'turn.started' as const }
              yield {
                type: 'turn.completed' as const,
                usage: {
                  cached_input_tokens: 0,
                  input_tokens: 1,
                  output_tokens: 1,
                },
              }
            })(),
          }
        },
      }
    },
  }

  const client = new CodexAgentClient({
    workspaceRoot: '/tmp/project',
    onEvent() {},
  })

  await expect(client.implement({
    attempt: 1,
    codeContext: '',
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
      paths: ['src/a.ts'],
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
      verifyCommands: ['node -e "process.exit(0)"'],
    },
  })).rejects.toThrow(/empty finalResponse/i)
})
