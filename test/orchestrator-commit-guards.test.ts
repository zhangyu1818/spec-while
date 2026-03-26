import { expect, test } from 'vitest'

import { rewindTask, runWorkflow } from '../src/core/orchestrator'
import {
  createGraph,
  createImplement,
  createReview,
  createRuntime,
  createWorkflow,
  ScriptedWorkflowProvider,
} from './workflow-test-helpers'

test('runWorkflow keeps a task done when post-commit artifact persistence fails', async () => {
  const graph = {
    featureId: '001-demo',
    tasks: [
      {
        id: 'T001',
        acceptance: ['buildGreeting works'],
        dependsOn: [],
        maxAttempts: 1,
        parallelizable: false,
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement greeting',
      },
    ],
  }
  const { git, runtime, store, workspace } = createRuntime()
  const originalSaveImplementArtifact = store.saveImplementArtifact.bind(store)
  store.saveImplementArtifact = async (artifact) => {
    if (artifact.commitSha) {
      throw new Error('artifact disk full')
    }
    await originalSaveImplementArtifact(artifact)
  }
  const workflow = createWorkflow(
    new ScriptedWorkflowProvider(
      [createImplement('T001', 'src/greeting.ts')],
      [createReview('T001', 'buildGreeting works')],
    ),
  )

  await expect(
    runWorkflow({
      graph,
      runtime,
      workflow,
    }),
  ).rejects.toThrow(/artifact disk full/)

  expect(git.commitMessages).toEqual(['Task T001: Implement greeting'])
  expect(store.events.map((event) => event.type)).toEqual([
    'attempt_started',
    'implement_succeeded',
    'review_started',
    'review_completed',
    'integrate_started',
    'integrate_completed',
  ])
  expect(store.state?.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    status: 'done',
  })
  expect(store.report?.summary.finalStatus).toBe('completed')
  expect(workspace.checkboxUpdates).toEqual([
    [{ checked: true, taskId: 'T001' }],
  ])
})

test('runWorkflow does not re-run a completed task when integrate completion event persistence fails', async () => {
  const graph = {
    featureId: '001-demo',
    tasks: [
      {
        id: 'T001',
        acceptance: ['buildGreeting works'],
        dependsOn: [],
        maxAttempts: 1,
        parallelizable: false,
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement greeting',
      },
    ],
  }
  const { git, runtime, store, workspace } = createRuntime()
  const originalAppendEvent = store.appendEvent.bind(store)
  let failIntegrateCompleted = true
  store.appendEvent = async (event) => {
    if (failIntegrateCompleted && event.type === 'integrate_completed') {
      failIntegrateCompleted = false
      throw new Error('events disk full')
    }
    await originalAppendEvent(event)
  }
  const workflow = createWorkflow(
    new ScriptedWorkflowProvider(
      [createImplement('T001', 'src/greeting.ts')],
      [createReview('T001', 'buildGreeting works')],
    ),
  )

  await expect(
    runWorkflow({
      graph,
      runtime,
      workflow,
    }),
  ).rejects.toThrow(/events disk full/)

  expect(store.state?.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    status: 'done',
  })

  const resumed = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(git.commitMessages).toEqual(['Task T001: Implement greeting'])
  expect(resumed.state.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    status: 'done',
  })
  expect(workspace.checkboxUpdates).toEqual([
    [{ checked: true, taskId: 'T001' }],
  ])
})

test('runWorkflow records integrate failure events when commit integration fails', async () => {
  const graph = {
    featureId: '001-demo',
    tasks: [
      {
        id: 'T001',
        acceptance: ['buildGreeting works'],
        dependsOn: [],
        maxAttempts: 1,
        parallelizable: false,
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement greeting',
      },
    ],
  }
  const { git, runtime, store, workspace } = createRuntime({
    commitFailures: [new Error('git commit rejected')],
  })
  const workflow = createWorkflow(
    new ScriptedWorkflowProvider(
      [createImplement('T001', 'src/greeting.ts')],
      [createReview('T001', 'buildGreeting works')],
    ),
  )

  const result = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(git.commitMessages).toEqual([])
  expect(store.events.map((event) => event.type)).toEqual([
    'attempt_started',
    'implement_succeeded',
    'review_started',
    'review_completed',
    'integrate_started',
    'integrate_failed',
  ])
  expect(store.integrateArtifacts).toEqual([])
  expect(result.state.tasks.T001).toMatchObject({
    reason: 'Task commit failed: git commit rejected',
    status: 'blocked',
  })
  expect(workspace.checkboxUpdates).toEqual([
    [{ checked: true, taskId: 'T001' }],
    [{ checked: false, taskId: 'T001' }],
  ])
})

test('rewindTask resets rolled-back task commits into a new pending generation', async () => {
  const graph = createGraph()
  const { git, runtime, store, workspace } = createRuntime()
  const workflow = createWorkflow(
    new ScriptedWorkflowProvider(
      [
        createImplement('T001', 'src/greeting.ts'),
        createImplement('T002', 'src/farewell.ts'),
      ],
      [
        {
          findings: [],
          overallRisk: 'low',
          summary: 'ok',
          taskId: 'T001',
          verdict: 'pass',
          acceptanceChecks: [
            {
              criterion: 'buildGreeting works',
              note: 'ok',
              status: 'pass',
            },
          ],
        },
        {
          findings: [],
          overallRisk: 'low',
          summary: 'ok',
          taskId: 'T002',
          verdict: 'pass',
          acceptanceChecks: [
            {
              criterion: 'buildFarewell works',
              note: 'ok',
              status: 'pass',
            },
          ],
        },
      ],
    ),
  )

  await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  const rewound = await rewindTask({
    runtime,
    taskId: 'T001',
    loadGraph: async () => graph,
  })

  expect(git.resetTargets).toEqual(['commit-1-parent'])
  expect(rewound.tasks.T001).toMatchObject({
    generation: 2,
    invalidatedBy: null,
    status: 'pending',
  })
  expect(rewound.tasks.T002).toMatchObject({
    generation: 2,
    invalidatedBy: 'T001',
    status: 'pending',
  })
  expect(store.report?.summary.finalStatus).toBe('in_progress')
  expect(workspace.checkboxUpdates).toEqual([
    [{ checked: true, taskId: 'T001' }],
    [{ checked: true, taskId: 'T002' }],
  ])
})

test('rewindTask rejects rewinding before any workflow state exists', async () => {
  const { runtime } = createRuntime()

  await expect(
    rewindTask({
      runtime,
      taskId: 'T001',
      loadGraph: async () => createGraph(),
    }),
  ).rejects.toThrow(/before workflow state exists/i)
})
