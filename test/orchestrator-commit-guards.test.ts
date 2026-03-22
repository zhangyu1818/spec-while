import { expect, test } from 'vitest'

import { rewindTask, runWorkflow } from '../src/core/orchestrator'
import { createGraph, createImplement, createReview, createRuntime, createVerify, FakeAgentClient } from './workflow-test-helpers'

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
        paths: ['src/greeting.ts'],
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement greeting',
        verifyCommands: ['node -e "process.exit(0)"'],
      },
    ],
  }
  const { git, runtime, store, workspace } = createRuntime({
    verifierResponses: [createVerify('T001', true)],
  })
  const originalSaveImplementArtifact = store.saveImplementArtifact.bind(store)
  store.saveImplementArtifact = async (artifact) => {
    if (artifact.commitSha) {
      throw new Error('artifact disk full')
    }
    await originalSaveImplementArtifact(artifact)
  }
  const agent = new FakeAgentClient(
    [createImplement('T001', 'src/greeting.ts')],
    [createReview('T001', 'buildGreeting works')],
  )

  await expect(runWorkflow({
    agent,
    graph,
    runtime,
  })).rejects.toThrow(/artifact disk full/)

  expect(git.commitMessages).toEqual(['Task T001: Implement greeting'])
  expect(store.state?.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    status: 'done',
  })
  expect(store.report?.summary.finalStatus).toBe('completed')
  expect(workspace.checkboxUpdates).toEqual([[{ checked: true, taskId: 'T001' }]])
})

test('rewindTask resets rolled-back task commits into a new pending generation', async () => {
  const graph = createGraph()
  const { git, runtime, store, workspace } = createRuntime()
  const agent = new FakeAgentClient(
    [createImplement('T001', 'src/greeting.ts'), createImplement('T002', 'src/farewell.ts')],
    [
      {
        changedFilesReviewed: [],
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
        changedFilesReviewed: [],
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
  )

  await runWorkflow({
    agent,
    graph,
    runtime,
  })

  const rewound = await rewindTask({
    runtime,
    taskId: 'T001',
    loadGraph: async () => graph,
  })

  expect(git.resetTargets).toEqual(['commit-1-parent'])
  expect(rewound.tasks.T001).toMatchObject({ generation: 2, invalidatedBy: null, status: 'pending' })
  expect(rewound.tasks.T002).toMatchObject({ generation: 2, invalidatedBy: 'T001', status: 'pending' })
  expect(store.report?.summary.finalStatus).toBe('in_progress')
  expect(workspace.checkboxUpdates).toEqual([
    [{ checked: true, taskId: 'T001' }],
    [{ checked: true, taskId: 'T002' }],
  ])
})

test('rewindTask rejects rewinding before any workflow state exists', async () => {
  const { runtime } = createRuntime()

  await expect(rewindTask({
    runtime,
    taskId: 'T001',
    loadGraph: async () => createGraph(),
  })).rejects.toThrow(/before workflow state exists/i)
})
