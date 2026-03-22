import type { ReviewAgentInput } from '../agents/types'

export async function buildReviewerPrompt(input: ReviewAgentInput) {
  return [
    'Return JSON only.',
    'Review only the current task.',
    'Use spec.md, plan.md, and the provided tasks snippet to judge whether the task matches the intended implementation.',
    'Evaluate task acceptance, spec/plan alignment, verify results, actual changed files, and overall risk.',
    'Treat task.paths as the expected primary scope, not as an absolute hard boundary.',
    'Use task.paths and actualChangedFiles to inspect code in the workspace when needed.',
    'Do not rely only on the implementer summary.',
    'Do not expand the review to unrelated files or repository-wide history.',
    `Task: ${JSON.stringify(input.task)}`,
    `Generation: ${input.generation}`,
    `Attempt: ${input.attempt}`,
    `Previous Findings: ${JSON.stringify(input.lastFindings)}`,
    `Spec:\n${input.spec}`,
    `Plan:\n${input.plan}`,
    `Tasks Snippet:\n${input.tasksSnippet}`,
    `Task Paths: ${JSON.stringify(input.task.paths)}`,
    `Actual Changed Files: ${JSON.stringify(input.actualChangedFiles)}`,
    `Implement Result: ${JSON.stringify(input.implement)}`,
    `Verify Result: ${JSON.stringify(input.verify)}`,
  ].join('\n\n')
}
