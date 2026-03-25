import { zodToJsonSchema } from 'zod-to-json-schema'

import {
  finalReportSchema,
  implementArtifactSchema,
  implementOutputSchemaInternal,
  integrateArtifactSchema,
  reviewArtifactSchema,
  reviewOutputSchemaInternal,
  taskGraphSchema,
  verifyArtifactSchema,
  verifyResultSchema,
  workflowEventSchema,
  workflowStateSchema,
} from './model'
import { parseWithSchema } from './shared'

export * from './model'
export * from './shared'

function ensureReviewSemantics(result: ReviewOutput) {
  if (result.verdict === 'pass' && result.findings.length !== 0) {
    throw new Error('Review verdict pass requires empty findings')
  }
  if (
    result.verdict === 'pass' &&
    result.acceptanceChecks.some((check) => check.status !== 'pass')
  ) {
    throw new Error(
      'Review verdict pass requires all acceptance checks to pass',
    )
  }
}

function toOpenAiOutputSchema(
  schema:
    | typeof implementOutputSchemaInternal
    | typeof reviewOutputSchemaInternal,
) {
  return zodToJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'openAi',
  }) as Record<string, unknown>
}

export const implementOutputSchema = toOpenAiOutputSchema(
  implementOutputSchemaInternal,
)
export const reviewOutputSchema = toOpenAiOutputSchema(
  reviewOutputSchemaInternal,
)

export function validateImplementOutput(value: unknown) {
  return parseWithSchema(implementOutputSchemaInternal, value)
}

export function validateReviewOutput(value: unknown) {
  const result = parseWithSchema(reviewOutputSchemaInternal, value)
  ensureReviewSemantics(result)
  return result
}

export function validateTaskGraph(value: unknown) {
  return parseWithSchema(taskGraphSchema, value)
}

export function validateWorkflowState(value: unknown) {
  return parseWithSchema(workflowStateSchema, value)
}

export function validateVerifyResult(value: unknown) {
  return parseWithSchema(verifyResultSchema, value)
}

export function validateImplementArtifact(value: unknown) {
  return parseWithSchema(implementArtifactSchema, value)
}

export function validateIntegrateArtifact(value: unknown) {
  return parseWithSchema(integrateArtifactSchema, value)
}

export function validateVerifyArtifact(value: unknown) {
  return parseWithSchema(verifyArtifactSchema, value)
}

export function validateReviewArtifact(value: unknown) {
  return parseWithSchema(reviewArtifactSchema, value)
}

export function validateWorkflowEvent(value: unknown) {
  return parseWithSchema(workflowEventSchema, value)
}

export function validateFinalReport(value: unknown) {
  return parseWithSchema(finalReportSchema, value)
}

export type AcceptanceCheck =
  (typeof import('./model').acceptanceCheckSchema)['_output']
export type BlockedTaskState =
  (typeof import('./model').blockedTaskStateSchema)['_output']
export type DoneTaskState =
  (typeof import('./model').doneTaskStateSchema)['_output']
export type FinalReport = (typeof finalReportSchema)['_output']
export type FinalReportTask =
  (typeof import('./model').finalReportTaskSchema)['_output']
export type IntegrateArtifact = (typeof integrateArtifactSchema)['_output']
export type ImplementArtifact = (typeof implementArtifactSchema)['_output']
export type ImplementOutput = (typeof implementOutputSchemaInternal)['_output']
export type PendingTaskState =
  (typeof import('./model').pendingTaskStateSchema)['_output']
export type ReviewArtifact = (typeof reviewArtifactSchema)['_output']
export type ReviewFinding =
  (typeof import('./model').reviewFindingSchema)['_output']
export type ReviewOutput = (typeof reviewOutputSchemaInternal)['_output']
export type ReviewVerdict =
  (typeof reviewOutputSchemaInternal)['_output']['verdict']
export type ReplanTaskState =
  (typeof import('./model').replanTaskStateSchema)['_output']
export type ReworkTaskState =
  (typeof import('./model').reworkTaskStateSchema)['_output']
export type RunningStage =
  (typeof import('./model').runningTaskStateSchema)['_output']['stage']
export type RunningTaskState =
  (typeof import('./model').runningTaskStateSchema)['_output']
export type TaskDefinition =
  (typeof import('./model').taskDefinitionSchema)['_output']
export type TaskGraph = (typeof taskGraphSchema)['_output']
export type TaskState = (typeof import('./model').taskStateSchema)['_output']
export type TaskStatus =
  (typeof import('./model').taskStateSchema)['_output']['status']
export type VerifyArtifact = (typeof verifyArtifactSchema)['_output']
export type VerifyCommandResult =
  (typeof import('./model').verifyCommandResultSchema)['_output']
export type VerifyResult = (typeof verifyResultSchema)['_output']
export type WorkflowEvent = (typeof workflowEventSchema)['_output']
export type WorkflowEventType = (typeof workflowEventSchema)['_output']['type']
export type WorkflowState = (typeof workflowStateSchema)['_output']
