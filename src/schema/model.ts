import { z } from 'zod'

import {
  acceptanceStatusValues,
  dateTimeSchema,
  finalStatusValues,
  findingSeverityValues,
  implementStatusValues,
  nonEmptyStringSchema,
  overallRiskValues,
  reviewVerdictValues,
  runningStageValues,
  storyIdSchema,
  taskIdPattern,
  taskIdSchema,
  taskStatusValues,
  uniqueStringArray,
  workflowEventTypeValues,
} from './shared'

export const reviewFindingSchema = z.object({
  file: nonEmptyStringSchema,
  fixHint: nonEmptyStringSchema,
  issue: nonEmptyStringSchema,
  severity: z.enum(findingSeverityValues),
}).strict()

export const acceptanceCheckSchema = z.object({
  criterion: nonEmptyStringSchema,
  note: nonEmptyStringSchema,
  status: z.enum(acceptanceStatusValues),
}).strict()

export const taskDefinitionSchema = z.object({
  id: taskIdSchema,
  acceptance: uniqueStringArray('acceptance criterion', { minItems: 1 }),
  allowedTools: uniqueStringArray('allowed tool').optional(),
  description: z.string().optional(),
  goal: nonEmptyStringSchema.optional(),
  maxAttempts: z.number().int().min(1).max(20),
  metadata: z.record(z.unknown()).optional(),
  parallelizable: z.boolean(),
  paths: uniqueStringArray('task path', { minItems: 1 }),
  phase: nonEmptyStringSchema,
  reviewRubric: uniqueStringArray('review rubric', { minItems: 1 }),
  storyId: storyIdSchema.nullable().optional(),
  title: nonEmptyStringSchema,
  verifyCommands: uniqueStringArray('verify command'),
  dependsOn: uniqueStringArray('dependency task id').superRefine((items, ctx) => {
    for (const [index, item] of items.entries()) {
      if (!taskIdPattern.test(item)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid dependency task id: ${item}`,
          path: [index],
        })
      }
    }
  }),
}).strict()

export const taskGraphSchema = z.object({
  featureId: nonEmptyStringSchema,
  version: z.number().int().min(1).optional(),
  source: z.object({
    plan: nonEmptyStringSchema.optional(),
    spec: nonEmptyStringSchema.optional(),
    tasksMd: nonEmptyStringSchema.optional(),
  }).strict().optional(),
  tasks: z.array(taskDefinitionSchema).min(1).superRefine((tasks, ctx) => {
    const seen = new Set<string>()
    for (const [index, task] of tasks.entries()) {
      if (seen.has(task.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate task id: ${task.id}`,
          path: [index, 'id'],
        })
        continue
      }
      seen.add(task.id)
    }
  }),
}).strict()

export const implementOutputSchemaInternal = z.object({
  assumptions: uniqueStringArray('assumption'),
  changedFiles: uniqueStringArray('changed file'),
  needsHumanAttention: z.boolean(),
  notes: uniqueStringArray('note'),
  status: z.enum(implementStatusValues),
  summary: nonEmptyStringSchema,
  taskId: taskIdSchema,
  unresolvedItems: uniqueStringArray('unresolved item'),
  requestedAdditionalPaths: z.array(z.object({
    path: nonEmptyStringSchema,
    reason: nonEmptyStringSchema,
  }).strict()),
}).strict()

export const reviewOutputSchemaInternal = z.object({
  acceptanceChecks: z.array(acceptanceCheckSchema).min(1),
  changedFilesReviewed: uniqueStringArray('reviewed file'),
  findings: z.array(reviewFindingSchema),
  overallRisk: z.enum(overallRiskValues),
  summary: nonEmptyStringSchema,
  taskId: taskIdSchema,
  verdict: z.enum(reviewVerdictValues),
}).strict()

export const verifyCommandResultSchema = z.object({
  command: nonEmptyStringSchema,
  exitCode: z.number().int(),
  finishedAt: dateTimeSchema,
  passed: z.boolean(),
  startedAt: dateTimeSchema,
  stderr: z.string(),
  stdout: z.string(),
}).strict()

export const verifyResultSchema = z.object({
  commands: z.array(verifyCommandResultSchema),
  passed: z.boolean(),
  summary: nonEmptyStringSchema,
  taskId: taskIdSchema,
}).strict()

const taskStateBaseSchema = z.object({
  attempt: z.number().int().min(0),
  generation: z.number().int().min(1),
  invalidatedBy: taskIdSchema.nullable(),
  lastFindings: z.array(reviewFindingSchema),
  lastReviewVerdict: z.enum(reviewVerdictValues).optional(),
  lastVerifyPassed: z.boolean().optional(),
}).strict()

export const pendingTaskStateSchema = taskStateBaseSchema.extend({
  status: z.literal('pending'),
}).strict()

export const runningTaskStateSchema = taskStateBaseSchema.extend({
  stage: z.enum(runningStageValues),
  status: z.literal('running'),
}).strict()

export const reworkTaskStateSchema = taskStateBaseSchema.extend({
  status: z.literal('rework'),
}).strict()

export const doneTaskStateSchema = taskStateBaseSchema.extend({
  commitSha: nonEmptyStringSchema,
  status: z.literal('done'),
}).strict()

export const blockedTaskStateSchema = taskStateBaseSchema.extend({
  reason: nonEmptyStringSchema,
  status: z.literal('blocked'),
}).strict()

export const replanTaskStateSchema = taskStateBaseSchema.extend({
  reason: nonEmptyStringSchema,
  status: z.literal('replan'),
}).strict()

export const taskStateSchema = z.discriminatedUnion('status', [
  pendingTaskStateSchema,
  runningTaskStateSchema,
  reworkTaskStateSchema,
  doneTaskStateSchema,
  blockedTaskStateSchema,
  replanTaskStateSchema,
])

export const workflowStateSchema = z.object({
  currentTaskId: taskIdSchema.nullable(),
  featureId: nonEmptyStringSchema,
  tasks: z.record(taskStateSchema).superRefine((tasks, ctx) => {
    for (const taskId of Object.keys(tasks)) {
      if (!taskIdPattern.test(taskId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid task id key: ${taskId}`,
          path: [taskId],
        })
      }
    }
  }),
}).strict()

export const implementArtifactSchema = z.object({
  attempt: z.number().int().min(1),
  commitSha: nonEmptyStringSchema.optional(),
  createdAt: dateTimeSchema,
  generation: z.number().int().min(1),
  result: implementOutputSchemaInternal,
  taskId: taskIdSchema,
}).strict()

export const verifyArtifactSchema = z.object({
  attempt: z.number().int().min(1),
  commitSha: nonEmptyStringSchema.optional(),
  createdAt: dateTimeSchema,
  generation: z.number().int().min(1),
  result: verifyResultSchema,
  taskId: taskIdSchema,
}).strict()

export const reviewArtifactSchema = z.object({
  attempt: z.number().int().min(1),
  commitSha: nonEmptyStringSchema.optional(),
  createdAt: dateTimeSchema,
  generation: z.number().int().min(1),
  result: reviewOutputSchemaInternal,
  taskId: taskIdSchema,
}).strict()

export const workflowEventSchema = z.object({
  attempt: z.number().int().min(0),
  detail: z.string().optional(),
  generation: z.number().int().min(1),
  taskId: taskIdSchema,
  timestamp: dateTimeSchema,
  type: z.enum(workflowEventTypeValues),
}).strict()

export const finalReportTaskSchema = z.object({
  id: taskIdSchema,
  attempt: z.number().int().min(0),
  commitSha: nonEmptyStringSchema.optional(),
  generation: z.number().int().min(1),
  lastReviewVerdict: z.enum(reviewVerdictValues).optional(),
  lastVerifyPassed: z.boolean().optional(),
  reason: nonEmptyStringSchema.optional(),
  status: z.enum(taskStatusValues),
}).strict()

export const finalReportSchema = z.object({
  featureId: nonEmptyStringSchema,
  generatedAt: dateTimeSchema,
  tasks: z.array(finalReportTaskSchema),
  summary: z.object({
    blockedTasks: z.number().int().min(0),
    completedTasks: z.number().int().min(0),
    finalStatus: z.enum(finalStatusValues),
    replanTasks: z.number().int().min(0),
    totalTasks: z.number().int().min(0),
  }).strict(),
}).strict()
