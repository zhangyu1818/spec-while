import { expect, test } from 'vitest'

import { ClaudeAgentClient, createClaudeProvider } from '../src/agents/claude'

import type { ImplementerProvider, ReviewerProvider } from '../src/agents/types'

test('ClaudeAgentClient forwards implement and review to injected adapter', async () => {
  const calls: string[] = []
  const client = new ClaudeAgentClient({
    async implement(input) {
      calls.push(`implement:${input.task.id}`)
      return {
        assumptions: [],
        needsHumanAttention: false,
        notes: [],
        status: 'implemented',
        summary: 'ok',
        taskId: input.task.id,
        unresolvedItems: [],
      }
    },
    async review(input) {
      calls.push(`review:${input.task.id}`)
      return {
        findings: [],
        overallRisk: 'low',
        summary: 'ok',
        taskId: input.task.id,
        verdict: 'pass',
        acceptanceChecks: [
          {
            criterion: 'works',
            note: 'ok',
            status: 'pass',
          },
        ],
      }
    },
  })

  const implement = await client.implement({
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
      maxAttempts: 1,
      parallelizable: false,
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
    },
  })
  const review = await client.review({
    actualChangedFiles: ['src/a.ts'],
    attempt: 1,
    generation: 1,
    implement,
    lastFindings: [],
    plan: '# plan',
    spec: '# spec',
    tasksSnippet: '- [ ] T001 Do work',
    task: {
      id: 'T001',
      acceptance: ['works'],
      dependsOn: [],
      maxAttempts: 1,
      parallelizable: false,
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
    },
  })

  expect(implement.taskId).toBe('T001')
  expect(review.verdict).toBe('pass')
  expect(calls).toEqual(['implement:T001', 'review:T001'])
})

test('ClaudeAgentClient default adapter throws explicit configuration errors', async () => {
  const client = new ClaudeAgentClient()

  await expect(
    client.implement({
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
        maxAttempts: 1,
        parallelizable: false,
        phase: 'Core',
        reviewRubric: ['clear'],
        title: 'Do work',
      },
    }),
  ).rejects.toThrow(/claude agent adapter is not configured/i)

  await expect(
    client.review({
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
        maxAttempts: 1,
        parallelizable: false,
        phase: 'Core',
        reviewRubric: ['clear'],
        title: 'Do work',
      },
    }),
  ).rejects.toThrow(/claude agent adapter is not configured/i)
})

test('createClaudeProvider returns a role-scoped claude provider', async () => {
  const provider: ImplementerProvider & ReviewerProvider = createClaudeProvider(
    {
      async implement(input) {
        return {
          assumptions: [],
          needsHumanAttention: false,
          notes: [],
          status: 'implemented',
          summary: 'ok',
          taskId: input.task.id,
          unresolvedItems: [],
        }
      },
      async review(input) {
        return {
          findings: [],
          overallRisk: 'low',
          summary: 'ok',
          taskId: input.task.id,
          verdict: 'pass',
          acceptanceChecks: [
            {
              criterion: 'works',
              note: 'ok',
              status: 'pass',
            },
          ],
        }
      },
    },
  )

  const implement = await provider.implement({
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
      maxAttempts: 1,
      parallelizable: false,
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
    },
  })
  const review = await provider.review({
    actualChangedFiles: ['src/a.ts'],
    attempt: 1,
    generation: 1,
    implement,
    lastFindings: [],
    plan: '# plan',
    spec: '# spec',
    tasksSnippet: '- [ ] T001 Do work',
    task: {
      id: 'T001',
      acceptance: ['works'],
      dependsOn: [],
      maxAttempts: 1,
      parallelizable: false,
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
    },
  })

  expect(provider.name).toBe('claude')
  expect(implement.taskId).toBe('T001')
  expect(review.verdict).toBe('pass')
})
