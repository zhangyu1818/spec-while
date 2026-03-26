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

test('runWorkflow finalizes tasks, commits each done task, and records commitSha in artifacts', async () => {
  const graph = createGraph()
  const { git, runtime, store, workspace } = createRuntime()
  const provider = new ScriptedWorkflowProvider(
    [
      createImplement('T001', 'src/greeting.ts'),
      createImplement('T002', 'src/farewell.ts'),
    ],
    [
      createReview('T001', 'buildGreeting works'),
      createReview('T002', 'buildFarewell works'),
    ],
  )

  const result = await runWorkflow({
    graph,
    runtime,
    workflow: createWorkflow(provider),
  })

  expect(result.summary.finalStatus).toBe('completed')
  expect(store.integrateArtifacts).toHaveLength(2)
  expect(store.implementArtifacts).toHaveLength(2)
  expect(store.reviewArtifacts).toHaveLength(2)
  expect(workspace.checkboxUpdates.flat()).toEqual([
    { checked: true, taskId: 'T001' },
    { checked: true, taskId: 'T002' },
  ])
  expect(git.commitMessages).toEqual([
    'Task T001: Implement greeting',
    'Task T002: Implement farewell',
  ])
  expect(store.state?.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    status: 'done',
  })
  expect(store.state?.tasks.T002).toMatchObject({
    commitSha: 'commit-2',
    status: 'done',
  })
  expect(store.integrateArtifacts[0]).toMatchObject({
    result: { commitSha: 'commit-1' },
  })
  expect(store.implementArtifacts[0]).toMatchObject({ commitSha: 'commit-1' })
})

test('runWorkflow loads per-task context and passes git-based changed files into review', async () => {
  const graph = createGraph()
  const { runtime } = createRuntime({
    changedFiles: [['src/greeting.ts'], ['src/farewell.ts']],
    taskContexts: {
      T001: {
        plan: '# plan for T001\n',
        spec: '# spec for T001\n',
        tasksSnippet: '- [ ] T001 Implement greeting\n',
      },
      T002: {
        plan: '# plan for T002\n',
        spec: '# spec for T002\n',
        tasksSnippet: '- [ ] T002 Implement farewell\n',
      },
    },
  })
  const provider = new ScriptedWorkflowProvider(
    [
      createImplement('T001', 'src/greeting.ts'),
      createImplement('T002', 'src/farewell.ts'),
    ],
    [
      createReview('T001', 'buildGreeting works'),
      createReview('T002', 'buildFarewell works'),
    ],
  )

  await runWorkflow({
    graph,
    runtime,
    workflow: createWorkflow(provider),
  })

  expect(provider.implementInputs[0]?.plan).toContain('# plan for T001')
  expect(provider.implementInputs[1]?.plan).toContain('# plan for T002')
  expect(provider.reviewInputs[0]?.actualChangedFiles).toEqual([
    'src/greeting.ts',
  ])
  expect(provider.reviewInputs[1]?.actualChangedFiles).toEqual([
    'src/farewell.ts',
  ])
})

test('runWorkflow carries review findings into the next implement attempt', async () => {
  const graph = {
    featureId: '001-demo',
    tasks: [createGraph().tasks[0]!],
  }
  const findings = [
    {
      file: 'src/greeting.ts',
      fixHint: 'handle the empty-name branch',
      issue: 'missing edge-case handling',
      severity: 'medium' as const,
    },
  ]
  const { runtime } = createRuntime()
  const provider = new ScriptedWorkflowProvider(
    [
      createImplement('T001', 'src/greeting.ts'),
      createImplement('T001', 'src/greeting.ts'),
    ],
    [
      {
        findings,
        overallRisk: 'medium',
        summary: 'retry with edge-case handling',
        taskId: 'T001',
        verdict: 'rework',
        acceptanceChecks: [
          {
            criterion: 'buildGreeting works',
            note: 'empty-name branch still missing',
            status: 'fail',
          },
        ],
      },
      createReview('T001', 'buildGreeting works'),
    ],
  )

  const result = await runWorkflow({
    graph,
    runtime,
    workflow: createWorkflow(provider),
  })

  expect(result.state.tasks.T001).toMatchObject({ status: 'done' })
  expect(provider.implementInputs[0]?.lastFindings).toEqual([])
  expect(provider.implementInputs[1]?.lastFindings).toEqual(findings)
})

test('runWorkflow resumes a persisted rework task with its last findings', async () => {
  const graph = {
    featureId: '001-demo',
    tasks: [createGraph().tasks[0]!],
  }
  const findings = [
    {
      file: 'src/greeting.ts',
      fixHint: 'handle the empty-name branch',
      issue: 'missing edge-case handling',
      severity: 'medium' as const,
    },
  ]
  const { runtime, store } = createRuntime()
  store.state = {
    currentTaskId: null,
    featureId: '001-demo',
    tasks: {
      T001: {
        attempt: 1,
        generation: 1,
        invalidatedBy: null,
        lastFindings: findings,
        lastReviewVerdict: 'rework',
        status: 'rework',
      },
    },
  }
  const provider = new ScriptedWorkflowProvider(
    [createImplement('T001', 'src/greeting.ts')],
    [createReview('T001', 'buildGreeting works')],
  )

  const result = await runWorkflow({
    graph,
    runtime,
    workflow: createWorkflow(provider),
  })

  expect(result.state.tasks.T001).toMatchObject({ attempt: 2, status: 'done' })
  expect(provider.implementInputs[0]?.lastFindings).toEqual(findings)
})

test('runWorkflow retries after review rework results before later success', async () => {
  const graph = {
    featureId: '001-demo',
    tasks: [createGraph().tasks[0]!],
  }
  const { runtime } = createRuntime()
  const provider = new ScriptedWorkflowProvider(
    [
      createImplement('T001', 'src/greeting.ts'),
      createImplement('T001', 'src/greeting.ts'),
    ],
    [
      createReview('T001', 'buildGreeting works', 'rework'),
      createReview('T001', 'buildGreeting works'),
    ],
  )

  const result = await runWorkflow({
    graph,
    runtime,
    workflow: createWorkflow(provider),
  })

  expect(provider.reviewInputs).toHaveLength(2)
  expect(result.state.tasks.T001).toMatchObject({ status: 'done' })
})

test('runWorkflow retries after implement failure and keeps downstream tasks pending until the target succeeds', async () => {
  const graph = createGraph()
  const { runtime, store } = createRuntime()
  const provider = new ScriptedWorkflowProvider(
    [
      new Error('implement crashed'),
      createImplement('T001', 'src/greeting.ts'),
      createImplement('T002', 'src/farewell.ts'),
    ],
    [
      createReview('T001', 'buildGreeting works'),
      createReview('T002', 'buildFarewell works'),
    ],
  )

  const result = await runWorkflow({
    graph,
    runtime,
    workflow: createWorkflow(provider),
  })

  expect(result.summary.finalStatus).toBe('completed')
  expect(provider.implementInputs).toHaveLength(3)
  expect(store.events.some((event) => event.type === 'implement_failed')).toBe(
    true,
  )
})
