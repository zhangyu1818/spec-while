import { expect, test } from 'vitest'

import {
  alignStateWithGraph,
  createInitialWorkflowState,
  recordImplementSuccess,
  recordIntegrateResult,
  recordReviewApproved,
  selectNextRunnableTask,
  startAttempt,
} from '../src/core/engine'

import type { ReviewOutput, TaskGraph } from '../src/types'

function createGraph(): TaskGraph {
  return {
    featureId: '001-demo',
    tasks: [
      {
        id: 'T001',
        acceptance: ['buildGreeting works'],
        dependsOn: [],
        maxAttempts: 2,
        parallelizable: false,
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement greeting',
      },
      {
        id: 'T002',
        acceptance: ['buildFarewell works'],
        dependsOn: ['T001'],
        maxAttempts: 2,
        parallelizable: false,
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement farewell',
      },
    ],
  }
}

function createPassingReview(taskId: string, criterion: string): ReviewOutput {
  return {
    findings: [],
    overallRisk: 'low',
    summary: 'ok',
    taskId,
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

test('engine advances task phases and unlocks dependents from derived readiness', () => {
  const graph = createGraph()
  const initial = createInitialWorkflowState(graph)

  expect(selectNextRunnableTask(graph, initial)?.id).toBe('T001')

  const executing = startAttempt(graph, initial, 'T001')
  expect(executing.tasks.T001?.status).toBe('running')

  const reviewing = recordImplementSuccess(executing, 'T001')
  expect(reviewing.tasks.T001).toMatchObject({
    stage: 'review',
    status: 'running',
  })

  const integrating = recordReviewApproved(
    reviewing,
    'T001',
    createPassingReview('T001', 'buildGreeting works'),
  )
  expect(integrating.tasks.T001).toMatchObject({
    stage: 'integrate',
    status: 'running',
  })

  const done = recordIntegrateResult(graph, integrating, 'T001', {
    commitSha: 'commit-1',
    review: createPassingReview('T001', 'buildGreeting works'),
  })

  expect(done.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    status: 'done',
  })
  expect(selectNextRunnableTask(graph, done)?.id).toBe('T002')
})

test('alignStateWithGraph preserves running review when explicitly requested', () => {
  const graph = createGraph()
  const state = {
    currentTaskId: 'T001',
    featureId: '001-demo',
    tasks: {
      T001: {
        attempt: 1,
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        stage: 'review' as const,
        status: 'running' as const,
      },
      T002: {
        attempt: 0,
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        status: 'pending' as const,
      },
    },
  }

  const aligned = alignStateWithGraph(graph, state, {
    preserveRunningReview: true,
  })

  expect(aligned.tasks.T001).toMatchObject({
    stage: 'review',
    status: 'running',
  })
  expect(aligned.currentTaskId).toBe('T001')
})

test('engine moves approved reviews into integrate instead of done', () => {
  const graph = createGraph()
  const initial = createInitialWorkflowState(graph)
  const reviewing = recordImplementSuccess(
    startAttempt(graph, initial, 'T001'),
    'T001',
  )

  const integrating = recordReviewApproved(
    reviewing,
    'T001',
    createPassingReview('T001', 'buildGreeting works'),
  )

  expect(integrating.tasks.T001).toMatchObject({
    lastReviewVerdict: 'pass',
    stage: 'integrate',
    status: 'running',
  })
  expect('commitSha' in integrating.tasks.T001!).toBe(false)
})

test('integrate result is the only path that produces done', () => {
  const graph = createGraph()
  const initial = createInitialWorkflowState(graph)
  const reviewing = recordImplementSuccess(
    startAttempt(graph, initial, 'T001'),
    'T001',
  )
  const integrating = recordReviewApproved(
    reviewing,
    'T001',
    createPassingReview('T001', 'buildGreeting works'),
  )
  const done = recordIntegrateResult(graph, integrating, 'T001', {
    commitSha: 'commit-1',
    review: createPassingReview('T001', 'buildGreeting works'),
  })

  expect(reviewing.tasks.T001).toMatchObject({
    stage: 'review',
    status: 'running',
  })
  expect(integrating.tasks.T001).toMatchObject({
    stage: 'integrate',
    status: 'running',
  })
  expect(done.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    status: 'done',
  })
})

test('engine rejects attempts to start dependent tasks before prerequisites complete', () => {
  const graph = createGraph()
  const initial = createInitialWorkflowState(graph)

  expect(() => startAttempt(graph, initial, 'T002')).toThrow(
    /dependencies are not completed/i,
  )
})
