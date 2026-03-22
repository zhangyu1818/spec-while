import type { ImplementAgentInput } from '../agents/types'

export async function buildImplementerPrompt(input: ImplementAgentInput) {
  return [
    'Return JSON only.',
    'Implement only the current task.',
    'Use spec.md, plan.md, and the provided tasks snippet as the source of truth.',
    'Use the provided code context instead of assuming full-repository context.',
    'Modify only the files that are reasonably required for the current task, starting with task.paths.',
    'Do not modify tasks.md.',
    'Do not move to the next task.',
    'Do not declare the task finalized.',
    'If additional file paths are required, report them in requestedAdditionalPaths instead of editing them.',
    'Satisfy the task acceptance criteria before optimizing or expanding scope.',
    `Task: ${JSON.stringify(input.task)}`,
    `Generation: ${input.generation}`,
    `Attempt: ${input.attempt}`,
    `Previous Findings: ${JSON.stringify(input.lastFindings)}`,
    `Spec:\n${input.spec}`,
    `Plan:\n${input.plan}`,
    `Tasks Snippet:\n${input.tasksSnippet}`,
    `Code Context:\n${input.codeContext}`,
  ].join('\n\n')
}
