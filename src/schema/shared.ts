import { z } from 'zod'

export const taskIdPattern = /^T\d{3,}$/
export const storyIdPattern = /^US\d+$/
export const nonEmptyStringSchema = z.string().min(1)
export const taskIdSchema = z.string().regex(taskIdPattern, 'Task id must match T###')
export const storyIdSchema = z.string().regex(storyIdPattern, 'Story id must match US<number>')
export const dateTimeSchema = z.string().datetime({ offset: true })

export const taskStatusValues = ['pending', 'running', 'rework', 'done', 'blocked', 'replan'] as const
export const runningStageValues = ['implement', 'verify', 'review'] as const
export const reviewVerdictValues = ['blocked', 'pass', 'replan', 'rework'] as const
export const implementStatusValues = ['blocked', 'implemented', 'partial'] as const
export const findingSeverityValues = ['high', 'low', 'medium'] as const
export const acceptanceStatusValues = ['fail', 'pass', 'unclear'] as const
export const overallRiskValues = ['high', 'low', 'medium'] as const
export const workflowEventTypeValues = [
  'attempt_started',
  'implement_succeeded',
  'implement_failed',
  'verify_started',
  'verify_completed',
  'verify_failed',
  'review_started',
  'review_completed',
  'review_failed',
  'task_rewound',
  'task_invalidated',
] as const
export const finalStatusValues = ['blocked', 'completed', 'in_progress', 'replan_required'] as const

function uniqueStrings(items: string[], label: string, ctx: z.RefinementCtx) {
  const seen = new Set<string>()
  for (const [index, item] of items.entries()) {
    if (seen.has(item)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate ${label}: ${item}`,
        path: [index],
      })
      continue
    }
    seen.add(item)
  }
}

export function uniqueStringArray(label: string, options?: { minItems?: number }) {
  const base = z.array(nonEmptyStringSchema)
  const withMin = options?.minItems ? base.min(options.minItems) : base
  return withMin.superRefine((items, ctx) => {
    uniqueStrings(items, label, ctx)
  })
}

export function formatPath(path: (number | string)[]) {
  if (path.length === 0) {
    return '/'
  }
  return `/${path.join('/')}`
}

export function formatIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => `${formatPath(issue.path)} ${issue.message}`.trim())
    .join('; ')
}

export function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error(formatIssues(result.error))
  }
  return result.data
}
