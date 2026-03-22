import { expect, test } from 'vitest'

import { ClaudeAgentClient } from '../src/agents/claude'

test('ClaudeAgentClient forwards implement and review to injected adapter', async () => {
  const calls: string[] = []
  const client = new ClaudeAgentClient({
    async implement(input) {
      calls.push(`implement:${input.task.id}`)
      return {
        assumptions: [],
        changedFiles: ['src/a.ts'],
        needsHumanAttention: false,
        notes: [],
        requestedAdditionalPaths: [],
        status: 'implemented',
        summary: 'ok',
        taskId: input.task.id,
        unresolvedItems: [],
      }
    },
    async review(input) {
      calls.push(`review:${input.task.id}`)
      return {
        changedFilesReviewed: ['src/a.ts'],
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
      maxAttempts: 1,
      parallelizable: false,
      paths: ['src/a.ts'],
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
      verifyCommands: ['node -e "process.exit(0)"'],
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
      paths: ['src/a.ts'],
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
      verifyCommands: ['node -e "process.exit(0)"'],
    },
    verify: {
      passed: true,
      summary: 'ok',
      taskId: 'T001',
      commands: [
        {
          command: 'node -e "process.exit(0)"',
          exitCode: 0,
          finishedAt: '2026-03-22T00:00:00.000Z',
          passed: true,
          startedAt: '2026-03-22T00:00:00.000Z',
          stderr: '',
          stdout: '',
        },
      ],
    },
  })

  expect(implement.taskId).toBe('T001')
  expect(review.verdict).toBe('pass')
  expect(calls).toEqual(['implement:T001', 'review:T001'])
})

test('ClaudeAgentClient default adapter throws explicit configuration errors', async () => {
  const client = new ClaudeAgentClient()

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
      maxAttempts: 1,
      parallelizable: false,
      paths: ['src/a.ts'],
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
      verifyCommands: ['node -e "process.exit(0)"'],
    },
  })).rejects.toThrow(/claude agent adapter is not configured/i)

  await expect(client.review({
    actualChangedFiles: ['src/a.ts'],
    attempt: 1,
    generation: 1,
    lastFindings: [],
    plan: '# plan',
    spec: '# spec',
    tasksSnippet: '- [ ] T001 Do work',
    implement: {
      assumptions: [],
      changedFiles: ['src/a.ts'],
      needsHumanAttention: false,
      notes: [],
      requestedAdditionalPaths: [],
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
      paths: ['src/a.ts'],
      phase: 'Core',
      reviewRubric: ['clear'],
      title: 'Do work',
      verifyCommands: ['node -e "process.exit(0)"'],
    },
    verify: {
      passed: true,
      summary: 'ok',
      taskId: 'T001',
      commands: [
        {
          command: 'node -e "process.exit(0)"',
          exitCode: 0,
          finishedAt: '2026-03-22T00:00:00.000Z',
          passed: true,
          startedAt: '2026-03-22T00:00:00.000Z',
          stderr: '',
          stdout: '',
        },
      ],
    },
  })).rejects.toThrow(/claude agent adapter is not configured/i)
})
