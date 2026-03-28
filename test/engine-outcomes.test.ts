import { expect, test } from 'vitest'

import {
  buildReport,
  createInitialWorkflowState,
  recordImplementFailure,
  recordImplementSuccess,
  recordReviewFailure,
  recordReviewResult,
  startAttempt,
} from '../src/core/engine'

import type { ReviewOutput, TaskGraph } from '../src/types'

function createGraph(): TaskGraph {
  return {
    featureId: '001-demo',
    maxIterations: 2,
    tasks: [
      {
        commitSubject: 'Task T001: Implement greeting',
        dependsOn: [],
        handle: 'T001',
      },
      {
        commitSubject: 'Task T002: Implement farewell',
        dependsOn: ['T001'],
        handle: 'T002',
      },
    ],
  }
}

function createPassingReview(
  taskHandle: string,
  criterion: string,
): ReviewOutput {
  return {
    findings: [],
    overallRisk: 'low',
    summary: 'ok',
    taskHandle,
    verdict: 'pass',
    acceptanceChecks: [
      {
        criterion,
        note: 'ok',
        status: 'pass',
      },
    ],
  }
}

test('engine blocks after exceeding max attempts', () => {
  const graph = createGraph()
  const initial = createInitialWorkflowState(graph)

  const attemptOne = startAttempt(graph, initial, 'T001')
  const rework = recordImplementFailure(graph, attemptOne, 'T001', 'bad output')
  expect(rework.tasks.T001?.status).toBe('rework')

  const attemptTwo = startAttempt(graph, rework, 'T001')
  const blocked = recordImplementFailure(graph, attemptTwo, 'T001', 'still bad')

  expect(blocked.tasks.T001).toMatchObject({
    reason: 'still bad',
    status: 'blocked',
  })
})

test('engine returns rework then blocked when review execution itself fails repeatedly', () => {
  const graph = createGraph()
  const initial = createInitialWorkflowState(graph)

  const attemptOne = recordImplementSuccess(
    startAttempt(graph, initial, 'T001'),
    'T001',
  )
  const rework = recordReviewFailure(
    graph,
    attemptOne,
    'T001',
    'review crashed',
  )
  expect(rework.tasks.T001).toMatchObject({
    status: 'rework',
  })

  const attemptTwo = recordImplementSuccess(
    startAttempt(graph, rework, 'T001'),
    'T001',
  )
  const blocked = recordReviewFailure(
    graph,
    attemptTwo,
    'T001',
    'review crashed again',
  )
  expect(blocked.tasks.T001).toMatchObject({
    reason: 'review crashed again',
    status: 'blocked',
  })
})

test('engine maps reviewer blocked and replan verdicts to terminal workflow states', () => {
  const graph = createGraph()
  const initial = createInitialWorkflowState(graph)
  const reviewing = recordImplementSuccess(
    startAttempt(graph, initial, 'T001'),
    'T001',
  )

  const blocked = recordReviewResult(graph, reviewing, 'T001', {
    review: {
      ...createPassingReview('T001', 'buildGreeting works'),
      summary: 'waiting for dependency',
      verdict: 'blocked',
    },
  })
  expect(blocked.tasks.T001).toMatchObject({
    lastReviewVerdict: 'blocked',
    reason: 'waiting for dependency',
    status: 'blocked',
  })

  const reviewingAgain = recordImplementSuccess(
    startAttempt(graph, initial, 'T001'),
    'T001',
  )
  const replanned = recordReviewResult(graph, reviewingAgain, 'T001', {
    review: {
      ...createPassingReview('T001', 'buildGreeting works'),
      summary: 'task contract is wrong',
      verdict: 'replan',
    },
  })
  expect(replanned.tasks.T001).toMatchObject({
    lastReviewVerdict: 'replan',
    reason: 'task contract is wrong',
    status: 'replan',
  })
})

test('engine records review execution failures as rework before max attempts', () => {
  const graph = createGraph()
  const initial = createInitialWorkflowState(graph)
  const reviewing = recordImplementSuccess(
    startAttempt(graph, initial, 'T001'),
    'T001',
  )

  const failed = recordReviewFailure(graph, reviewing, 'T001', 'review crashed')
  const taskState = failed.tasks.T001!

  expect(taskState).toMatchObject({
    status: 'rework',
  })
  expect('reason' in taskState).toBe(false)
})

test('buildReport summarizes workflow state without exposing internal invalidation details', () => {
  const graph = createGraph()
  const state = {
    currentTaskHandle: null,
    featureId: '001-demo',
    tasks: {
      T001: {
        attempt: 1,
        commitSha: 'commit-1',
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        lastReviewVerdict: 'pass' as const,
        status: 'done' as const,
      },
      T002: {
        attempt: 2,
        generation: 1,
        invalidatedBy: 'T001',
        lastFindings: [],
        reason: 'needs replan',
        status: 'replan' as const,
      },
    },
  }

  const report = buildReport(graph, state, '2026-03-22T00:00:00.000Z')

  expect(report.summary.finalStatus).toBe('replan_required')
  expect(report.tasks[1]).not.toHaveProperty('invalidatedBy')
})
