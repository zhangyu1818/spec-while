import { expect, test } from 'vitest'

import { buildReviewerPrompt } from '../src/prompts/reviewer'

test('buildReviewerPrompt keeps review context path-only', async () => {
  const prompt = await buildReviewerPrompt({
    actualChangedFiles: ['src/parser.ts'],
    attempt: 2,
    generation: 3,
    plan: '# plan',
    spec: '# spec',
    tasksSnippet: '- [ ] T001 Create parser',
    implement: {
      assumptions: [],
      needsHumanAttention: false,
      notes: [],
      status: 'implemented',
      summary: 'done',
      taskId: 'T001',
      unresolvedItems: [],
    },
    lastFindings: [
      {
        file: 'src/parser.ts',
        fixHint: 'tighten boundary',
        issue: 'missed edge case',
        severity: 'medium',
      },
    ],
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

  expect(prompt).toMatch(/# spec/)
  expect(prompt).toMatch(/# plan/)
  expect(prompt).toMatch(/Generation: 3/)
  expect(prompt).toMatch(/Attempt: 2/)
  expect(prompt).toMatch(/src\/parser\.ts/)
  expect(prompt).toMatch(/missed edge case/)
  expect(prompt).toContain(
    'Use spec.md, plan.md, and the provided tasks snippet to judge whether the task matches the intended implementation.',
  )
  expect(prompt).toContain(
    'Evaluate task acceptance, spec/plan alignment, actual changed files, and overall risk.',
  )
  expect(prompt).toContain(
    'Do not expand the review to unrelated files or repository-wide history.',
  )
  expect(prompt).not.toMatch(/export const value/)
})
