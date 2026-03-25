import { expect, test } from 'vitest'

import { runWorkflow } from '../src/core/orchestrator'
import {
  createGraph,
  createImplement,
  createReview,
  createRuntime,
  createWorkflow,
  ScriptedWorkflowProvider,
} from './workflow-test-helpers'

test('runWorkflow records verifier execution failures and blocks when max attempts are exhausted', async () => {
  const graph = {
    featureId: '001-demo',
    tasks: [
      {
        id: 'T001',
        acceptance: ['buildGreeting works'],
        dependsOn: [],
        maxAttempts: 1,
        parallelizable: false,
        paths: ['src/greeting.ts'],
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement greeting',
        verifyCommands: ['node -e "process.exit(0)"'],
      },
    ],
  }
  const { runtime, store } = createRuntime({
    verifierResponses: [new Error('verify subprocess failed')],
  })
  const provider = new ScriptedWorkflowProvider(
    [createImplement('T001', 'src/greeting.ts')],
    [],
  )

  const result = await runWorkflow({
    graph,
    runtime,
    workflow: createWorkflow(provider),
  })

  expect(result.state.tasks.T001).toMatchObject({
    reason: 'verify subprocess failed',
    status: 'blocked',
  })
  expect(store.events.some((event) => event.type === 'verify_failed')).toBe(
    true,
  )
  expect(store.reviewArtifacts).toHaveLength(0)
})

test('runWorkflow stops after untilTaskId completes and leaves downstream tasks untouched', async () => {
  const graph = createGraph()
  const { runtime, store, workspace } = createRuntime()
  const provider = new ScriptedWorkflowProvider(
    [createImplement('T001', 'src/greeting.ts')],
    [createReview('T001', 'buildGreeting works')],
  )

  const result = await runWorkflow({
    graph,
    runtime,
    untilTaskId: 'T001',
    workflow: createWorkflow(provider),
  })

  expect(result.state.tasks.T001).toMatchObject({ status: 'done' })
  expect(result.state.tasks.T002).toMatchObject({ status: 'pending' })
  expect(store.implementArtifacts).toHaveLength(1)
  expect(workspace.checkboxUpdates).toEqual([
    [{ checked: true, taskId: 'T001' }],
  ])
})

test('runWorkflow returns immediately when untilTaskId is already completed in persisted state', async () => {
  const graph = createGraph()
  const { runtime, store } = createRuntime()
  store.state = {
    currentTaskId: null,
    featureId: '001-demo',
    tasks: {
      T001: {
        attempt: 1,
        commitSha: 'commit-1',
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        lastReviewVerdict: 'pass',
        lastVerifyPassed: true,
        status: 'done',
      },
      T002: {
        attempt: 0,
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        status: 'pending',
      },
    },
  }
  const provider = new ScriptedWorkflowProvider([], [])

  const result = await runWorkflow({
    graph,
    runtime,
    untilTaskId: 'T001',
    workflow: createWorkflow(provider),
  })

  expect(result.summary.finalStatus).toBe('in_progress')
  expect(result.state.tasks.T001).toMatchObject({ status: 'done' })
  expect(result.state.tasks.T002).toMatchObject({ status: 'pending' })
  expect(provider.implementInputs).toEqual([])
  expect(provider.reviewInputs).toEqual([])
})
