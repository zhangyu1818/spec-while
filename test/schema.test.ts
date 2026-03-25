import { expect, test } from 'vitest'

import {
  implementArtifactSchema,
  integrateArtifactSchema,
  reviewOutputSchema,
  validateReviewOutput,
  validateTaskGraph,
  validateWorkflowEvent,
  validateWorkflowState,
} from '../src/schema/index'

test('validateWorkflowState accepts discriminated task states', () => {
  const state = validateWorkflowState({
    currentTaskId: 'T001',
    featureId: '001-demo',
    tasks: {
      T001: {
        attempt: 1,
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        lastReviewVerdict: 'pass',
        lastVerifyPassed: true,
        stage: 'review',
        status: 'running',
      },
      T002: {
        attempt: 0,
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        status: 'pending',
      },
    },
  })

  expect(state.tasks.T001?.status).toBe('running')
})

test('validateWorkflowState accepts integrate as a running stage', () => {
  const state = validateWorkflowState({
    currentTaskId: 'T001',
    featureId: '001-demo',
    tasks: {
      T001: {
        attempt: 1,
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        stage: 'integrate',
        status: 'running',
      },
    },
  })

  expect(state.tasks.T001).toMatchObject({
    stage: 'integrate',
    status: 'running',
  })
})

test('validateWorkflowState rejects running task without stage', () => {
  expect(() => {
    validateWorkflowState({
      currentTaskId: 'T001',
      featureId: '001-demo',
      tasks: {
        T001: {
          attempt: 1,
          generation: 1,
          invalidatedBy: null,
          lastFindings: [],
          status: 'running',
        },
      },
    })
  }).toThrow(/stage/i)
})

test('implementArtifactSchema captures generation and attempt metadata', () => {
  const result = implementArtifactSchema.safeParse({
    attempt: 2,
    createdAt: '2026-03-22T00:00:00.000Z',
    generation: 3,
    taskId: 'T001',
    result: {
      assumptions: [],
      changedFiles: ['src/a.ts'],
      needsHumanAttention: false,
      notes: [],
      requestedAdditionalPaths: [],
      status: 'implemented',
      summary: 'done',
      taskId: 'T001',
      unresolvedItems: [],
    },
  })

  expect(result.success).toBe(true)
})

test('integrateArtifactSchema captures commit metadata', () => {
  const result = integrateArtifactSchema.safeParse({
    attempt: 1,
    createdAt: '2026-03-24T00:00:00.000Z',
    generation: 2,
    taskId: 'T001',
    result: {
      commitSha: 'commit-1',
      summary: 'integrated',
    },
  })

  expect(result.success).toBe(true)
})

test('validateWorkflowEvent accepts integrate lifecycle events', () => {
  for (const type of [
    'integrate_started',
    'integrate_completed',
    'integrate_failed',
  ] as const) {
    expect(
      validateWorkflowEvent({
        attempt: 1,
        generation: 2,
        taskId: 'T001',
        timestamp: '2026-03-24T00:00:00.000Z',
        type,
      }).type,
    ).toBe(type)
  }
})

test('reviewOutputSchema remains compatible with structured outputs', () => {
  const findings = (reviewOutputSchema.properties as Record<string, unknown>)
    .findings as Record<string, unknown>

  expect(findings.uniqueItems).toBeUndefined()
})

test('validateReviewOutput rejects pass verdicts with remaining findings', () => {
  expect(() => {
    validateReviewOutput({
      changedFilesReviewed: ['src/a.ts'],
      overallRisk: 'medium',
      summary: 'looks mostly fine',
      taskId: 'T001',
      verdict: 'pass',
      acceptanceChecks: [
        {
          criterion: 'works',
          note: 'ok',
          status: 'pass',
        },
      ],
      findings: [
        {
          file: 'src/a.ts',
          fixHint: 'remove dead branch',
          issue: 'dead branch remains',
          severity: 'medium',
        },
      ],
    })
  }).toThrow(/pass requires empty findings/i)
})

test('validateReviewOutput rejects pass verdicts with failed acceptance checks', () => {
  expect(() => {
    validateReviewOutput({
      changedFilesReviewed: ['src/a.ts'],
      findings: [],
      overallRisk: 'medium',
      summary: 'looks mostly fine',
      taskId: 'T001',
      verdict: 'pass',
      acceptanceChecks: [
        {
          criterion: 'works',
          note: 'still broken',
          status: 'fail',
        },
      ],
    })
  }).toThrow(/pass requires all acceptance checks to pass/i)
})

test('validateTaskGraph rejects duplicate task ids', () => {
  expect(() => {
    validateTaskGraph({
      featureId: '001-demo',
      tasks: [
        {
          id: 'T001',
          acceptance: ['works'],
          dependsOn: [],
          maxAttempts: 2,
          parallelizable: false,
          paths: ['src/a.ts'],
          phase: 'Phase 1',
          reviewRubric: ['clear'],
          title: 'Do work',
          verifyCommands: ['node -e "process.exit(0)"'],
        },
        {
          id: 'T001',
          acceptance: ['works'],
          dependsOn: [],
          maxAttempts: 2,
          parallelizable: false,
          paths: ['src/b.ts'],
          phase: 'Phase 1',
          reviewRubric: ['clear'],
          title: 'Do more work',
          verifyCommands: ['node -e "process.exit(0)"'],
        },
      ],
    })
  }).toThrow(/duplicate/i)
})
