import { expect, test } from 'vitest'

import { runWorkflow } from '../src/core/orchestrator'
import { createGraph, createImplement, createReview, createRuntime, createVerify, FakeAgentClient } from './workflow-test-helpers'

test('runWorkflow does not mechanically block when changed files extend beyond task.paths', async () => {
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
    changedFiles: [['src/greeting.ts', 'src/outside.ts']],
    verifierResponses: [createVerify('T001', true)],
  })
  const agent = new FakeAgentClient(
    [createImplement('T001', 'src/greeting.ts')],
    [
      {
        changedFilesReviewed: ['src/greeting.ts', 'src/outside.ts'],
        findings: [],
        overallRisk: 'low',
        summary: 'review passed with additional related files',
        taskId: 'T001',
        verdict: 'pass',
        acceptanceChecks: [
          {
            criterion: 'buildGreeting works',
            note: 'core behavior is correct',
            status: 'pass',
          },
        ],
      },
    ],
  )

  const result = await runWorkflow({
    agent,
    graph,
    runtime,
  })

  expect(agent.reviewInputs[0]?.actualChangedFiles).toEqual(['src/greeting.ts', 'src/outside.ts'])
  expect(result.summary.finalStatus).toBe('completed')
  expect(result.state.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    lastReviewVerdict: 'pass',
    lastVerifyPassed: true,
    status: 'done',
  })
  expect(workspace.checkboxUpdates).toEqual([[{ checked: true, taskId: 'T001' }]])
  expect(git.commitMessages).toEqual(['Task T001: Implement greeting'])
  expect(store.reviewArtifacts).toHaveLength(1)
})

test('runWorkflow preserves implement artifacts when review fails and blocks after max attempts', async () => {
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
    verifierResponses: [createVerify('T001', true)],
  })
  const agent = new FakeAgentClient(
    [createImplement('T001', 'src/greeting.ts')],
    [new Error('review output invalid')],
  )

  const result = await runWorkflow({
    agent,
    graph,
    runtime,
  })

  expect(result.state.tasks.T001).toMatchObject({ reason: 'review output invalid', status: 'blocked' })
  expect(store.implementArtifacts).toHaveLength(1)
  expect(store.reviewArtifacts).toHaveLength(0)
})

test('runWorkflow treats task checkbox write failures as recoverable commit failures', async () => {
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
  const { git, runtime, workspace } = createRuntime({
    verifierResponses: [createVerify('T001', true)],
  })
  workspace.updateTaskChecks = async (updates) => {
    if (updates[0]?.checked) {
      throw new Error('disk full')
    }
    workspace.checkboxUpdates.push(updates)
  }
  const agent = new FakeAgentClient(
    [createImplement('T001', 'src/greeting.ts')],
    [createReview('T001', 'buildGreeting works')],
  )

  const result = await runWorkflow({
    agent,
    graph,
    runtime,
  })

  expect(result.state.tasks.T001).toMatchObject({
    reason: 'Task commit failed: disk full',
    status: 'blocked',
  })
  expect(git.commitMessages).toEqual([])
})

test('runWorkflow aligns persisted state with newly added tasks before saving reports', async () => {
  const graph = createGraph()
  const { runtime, store } = createRuntime({
    verifierResponses: [createVerify('T002', true)],
  })
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
    },
  }
  const agent = new FakeAgentClient(
    [createImplement('T002', 'src/farewell.ts')],
    [createReview('T002', 'buildFarewell works')],
  )

  const result = await runWorkflow({
    agent,
    graph,
    runtime,
  })

  expect(result.state.tasks.T001).toMatchObject({ status: 'done' })
  expect(result.state.tasks.T002).toMatchObject({ status: 'done' })
  expect(store.report?.tasks.map((task) => task.id)).toEqual(['T001', 'T002'])
})

test('runWorkflow requeues persisted running tasks so interrupted attempts can resume', async () => {
  const graph = {
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
    ],
  }
  const { runtime, store } = createRuntime({
    verifierResponses: [createVerify('T001', true)],
  })
  store.state = {
    currentTaskId: 'T001',
    featureId: '001-demo',
    tasks: {
      T001: {
        attempt: 1,
        generation: 1,
        invalidatedBy: null,
        lastFindings: [],
        stage: 'review',
        status: 'running',
      },
    },
  }
  const agent = new FakeAgentClient(
    [createImplement('T001', 'src/greeting.ts')],
    [createReview('T001', 'buildGreeting works')],
  )

  const result = await runWorkflow({
    agent,
    graph,
    runtime,
  })

  expect(result.summary.finalStatus).toBe('completed')
  expect(result.state.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    status: 'done',
  })
  expect(agent.implementInputs).toHaveLength(1)
})
