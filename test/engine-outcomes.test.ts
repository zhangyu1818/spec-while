import { expect, test } from 'vitest'

import {
  buildReport,
  createInitialWorkflowState,
  recordImplementFailure,
  recordImplementSuccess,
  recordIntegrateResult,
  recordReviewApproved,
  recordReviewFailure,
  recordReviewResult,
  recordVerifyFailure,
  recordVerifyResult,
  rewindTaskGeneration,
  startAttempt,
} from '../src/core/engine'

import type { ReviewOutput, TaskGraph, VerifyResult } from '../src/types'

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
        paths: ['src/greeting.ts'],
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement greeting',
        verifyCommands: ['node -e "process.exit(0)"'],
      },
      {
        id: 'T002',
        acceptance: ['buildFarewell works'],
        dependsOn: ['T001'],
        maxAttempts: 2,
        parallelizable: false,
        paths: ['src/farewell.ts'],
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement farewell',
        verifyCommands: ['node -e "process.exit(0)"'],
      },
    ],
  }
}

function createPassingReview(taskId: string, criterion: string): ReviewOutput {
  return {
    changedFilesReviewed: [],
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

function createVerifyResult(taskId: string, passed: boolean): VerifyResult {
  return {
    passed,
    summary: passed ? 'ok' : 'failed',
    taskId,
    commands: [
      {
        command: 'node -e "process.exit(0)"',
        exitCode: passed ? 0 : 1,
        finishedAt: '2026-03-22T00:00:00.000Z',
        passed,
        startedAt: '2026-03-22T00:00:00.000Z',
        stderr: '',
        stdout: '',
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

test('engine returns rework then blocked when verify execution itself fails repeatedly', () => {
  const graph = createGraph()
  const initial = createInitialWorkflowState(graph)

  const attemptOne = recordImplementSuccess(
    startAttempt(graph, initial, 'T001'),
    'T001',
  )
  const rework = recordVerifyFailure(
    graph,
    attemptOne,
    'T001',
    'verify crashed',
  )
  expect(rework.tasks.T001).toMatchObject({
    lastVerifyPassed: false,
    status: 'rework',
  })

  const attemptTwo = recordImplementSuccess(
    startAttempt(graph, rework, 'T001'),
    'T001',
  )
  const blocked = recordVerifyFailure(
    graph,
    attemptTwo,
    'T001',
    'verify crashed again',
  )
  expect(blocked.tasks.T001).toMatchObject({
    lastVerifyPassed: false,
    reason: 'verify crashed again',
    status: 'blocked',
  })
})

test('engine maps reviewer blocked and replan verdicts to terminal workflow states', () => {
  const graph = createGraph()
  const initial = createInitialWorkflowState(graph)
  const reviewing = recordVerifyResult(
    recordImplementSuccess(startAttempt(graph, initial, 'T001'), 'T001'),
    'T001',
    createVerifyResult('T001', true),
  )

  const blocked = recordReviewResult(graph, reviewing, 'T001', {
    verify: createVerifyResult('T001', true),
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

  const reviewingAgain = recordVerifyResult(
    recordImplementSuccess(startAttempt(graph, initial, 'T001'), 'T001'),
    'T001',
    createVerifyResult('T001', true),
  )
  const replanned = recordReviewResult(graph, reviewingAgain, 'T001', {
    verify: createVerifyResult('T001', true),
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
  const reviewing = recordVerifyResult(
    recordImplementSuccess(startAttempt(graph, initial, 'T001'), 'T001'),
    'T001',
    createVerifyResult('T001', true),
  )

  const failed = recordReviewFailure(graph, reviewing, 'T001', 'review crashed')
  const taskState = failed.tasks.T001!

  expect(taskState).toMatchObject({
    status: 'rework',
  })
  expect('reason' in taskState).toBe(false)
})

test('rewindTaskGeneration starts a fresh generation for target and descendants', () => {
  const graph = createGraph()
  const initial = createInitialWorkflowState(graph)
  const firstRun = recordIntegrateResult(
    graph,
    recordReviewApproved(
      recordVerifyResult(
        recordImplementSuccess(startAttempt(graph, initial, 'T001'), 'T001'),
        'T001',
        createVerifyResult('T001', true),
      ),
      'T001',
      createPassingReview('T001', 'buildGreeting works'),
    ),
    'T001',
    {
      commitSha: 'commit-1',
      review: createPassingReview('T001', 'buildGreeting works'),
      verify: createVerifyResult('T001', true),
    },
  )
  const secondRun = recordIntegrateResult(
    graph,
    recordReviewApproved(
      recordVerifyResult(
        recordImplementSuccess(startAttempt(graph, firstRun, 'T002'), 'T002'),
        'T002',
        createVerifyResult('T002', true),
      ),
      'T002',
      createPassingReview('T002', 'buildFarewell works'),
    ),
    'T002',
    {
      commitSha: 'commit-2',
      review: createPassingReview('T002', 'buildFarewell works'),
      verify: createVerifyResult('T002', true),
    },
  )

  const rewound = rewindTaskGeneration(graph, secondRun, 'T001')

  expect(rewound.state.tasks.T001).toMatchObject({
    attempt: 0,
    generation: 2,
    invalidatedBy: null,
    status: 'pending',
  })
  expect(rewound.state.tasks.T002).toMatchObject({
    attempt: 0,
    generation: 2,
    invalidatedBy: 'T001',
    status: 'pending',
  })
})

test('buildReport summarizes workflow state without exposing internal invalidation details', () => {
  const graph = createGraph()
  const state = {
    currentTaskId: null,
    featureId: '001-demo',
    tasks: {
      T001: {
        attempt: 1,
        commitSha: 'commit-1',
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        lastReviewVerdict: 'pass' as const,
        lastVerifyPassed: true,
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
