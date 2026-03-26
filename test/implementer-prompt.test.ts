import { expect, test } from 'vitest'

import { buildImplementerPrompt } from '../src/prompts/implementer'

test('buildImplementerPrompt makes while task boundaries explicit', async () => {
  const prompt = await buildImplementerPrompt({
    attempt: 2,
    generation: 3,
    plan: '# plan',
    spec: '# spec',
    tasksSnippet: '- [ ] T001 Implement greeting',
    lastFindings: [
      {
        file: 'src/greeting.ts',
        fixHint: 'match the plan',
        issue: 'output text does not satisfy acceptance',
        severity: 'medium',
      },
    ],
    task: {
      id: 'T001',
      acceptance: ['buildGreeting returns Hello, world!'],
      dependsOn: [],
      maxAttempts: 2,
      parallelizable: false,
      phase: 'Phase 1',
      reviewRubric: ['simple and scoped'],
      title: 'Implement greeting',
    },
  })

  expect(prompt).toContain('Implement only the current task.')
  expect(prompt).toContain(
    'Use spec.md, plan.md, and the provided tasks snippet as the source of truth.',
  )
  expect(prompt).toContain(
    'Modify only the files that are reasonably required for the current task.',
  )
  expect(prompt).toContain('Do not modify tasks.md.')
  expect(prompt).toContain('Do not move to the next task.')
  expect(prompt).toContain('Do not declare the task finalized.')
  expect(prompt).toMatch(/# spec/)
  expect(prompt).toMatch(/# plan/)
  expect(prompt).toMatch(/src\/greeting\.ts/)
})
