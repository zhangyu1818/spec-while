import { expect, test } from 'vitest'

import {
  implementArtifactSchema,
  integrateArtifactSchema,
  validateReviewOutput,
  validateTaskGraph,
  validateWorkflowEvent,
  validateWorkflowState,
} from '../src/schema/index'

test('validateWorkflowState accepts discriminated task states', () => {
  const state = validateWorkflowState({
    currentTaskHandle: 'task/greet',
    featureId: '001-demo',
    tasks: {
      'task/farewell': {
        attempt: 0,
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        status: 'pending',
      },
      'task/greet': {
        attempt: 1,
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        lastReviewVerdict: 'pass',
        stage: 'review',
        status: 'running',
      },
    },
  })

  expect(state.tasks['task/greet']?.status).toBe('running')
})

test('validateWorkflowState accepts integrate as a running stage', () => {
  const state = validateWorkflowState({
    currentTaskHandle: 'T001',
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
      currentTaskHandle: 'T001',
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
    taskHandle: 'T001',
    result: {
      assumptions: [],
      needsHumanAttention: false,
      notes: [],
      status: 'implemented',
      summary: 'done',
      taskHandle: 'T001',
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
    taskHandle: 'T001',
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
        taskHandle: 'T001',
        timestamp: '2026-03-24T00:00:00.000Z',
        type,
      }).type,
    ).toBe(type)
  }
})

test('validateWorkflowEvent rejects retired rewind event types', () => {
  for (const type of ['task_rewound', 'task_invalidated'] as const) {
    expect(() => {
      validateWorkflowEvent({
        attempt: 0,
        generation: 1,
        taskHandle: 'T001',
        timestamp: '2026-03-28T00:00:00.000Z',
        type,
      })
    }).toThrow(/invalid enum value|task_rewound|task_invalidated/i)
  }
})

test('validateReviewOutput rejects pass verdicts with remaining findings', () => {
  expect(() => {
    validateReviewOutput({
      overallRisk: 'medium',
      summary: 'looks mostly fine',
      taskHandle: 'T001',
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
      findings: [],
      overallRisk: 'medium',
      summary: 'looks mostly fine',
      taskHandle: 'T001',
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

test('validateTaskGraph rejects duplicate task handles', () => {
  expect(() => {
    validateTaskGraph({
      featureId: '001-demo',
      maxIterations: 5,
      tasks: [
        {
          commitSubject: 'Task T001: Do work',
          dependsOn: [],
          handle: 'T001',
        },
        {
          commitSubject: 'Task T001: Do more work',
          dependsOn: [],
          handle: 'T001',
        },
      ],
    })
  }).toThrow(/duplicate/i)
})
