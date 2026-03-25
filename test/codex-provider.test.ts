import { beforeEach, expect, test, vi } from 'vitest'

import { createCodexProvider, type CodexClientLike } from '../src/agents/codex'

import type { ImplementerProvider, ReviewerProvider } from '../src/agents/types'

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

test('createCodexProvider returns a role-scoped codex provider', async () => {
  mockState.client = {
    startThread() {
      return {
        async run() {
          return {
            finalResponse: JSON.stringify({
              assumptions: [],
              changedFiles: ['src/a.ts'],
              needsHumanAttention: false,
              notes: [],
              requestedAdditionalPaths: [],
              status: 'implemented',
              summary: 'ok',
              taskId: 'T001',
              unresolvedItems: [],
            }),
          }
        },
      }
    },
  }

  const provider: ImplementerProvider & ReviewerProvider = createCodexProvider({
    workspaceRoot: '/tmp/project',
  })

  const implement = await provider.implement({
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
  })

  expect(provider.name).toBe('codex')
  expect(implement.taskId).toBe('T001')
})
