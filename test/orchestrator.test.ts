import { expect, test } from 'vitest'

import { runWorkflow } from '../src/core/orchestrator'
import { createGraph, createImplement, createReview, createRuntime, createVerify, FakeAgentClient } from './workflow-test-helpers'

test('runWorkflow finalizes tasks, commits each done task, and records commitSha in artifacts', async () => {
  const graph = createGraph()
  const { git, runtime, store, workspace } = createRuntime()
  const agent = new FakeAgentClient(
    [createImplement('T001', 'src/greeting.ts'), createImplement('T002', 'src/farewell.ts')],
    [createReview('T001', 'buildGreeting works'), createReview('T002', 'buildFarewell works')],
  )

  const result = await runWorkflow({
    agent,
    graph,
    runtime,
  })

  expect(result.summary.finalStatus).toBe('completed')
  expect(store.implementArtifacts).toHaveLength(2)
  expect(store.verifyArtifacts).toHaveLength(2)
  expect(store.reviewArtifacts).toHaveLength(2)
  expect(workspace.checkboxUpdates.flat()).toEqual([
    { checked: true, taskId: 'T001' },
    { checked: true, taskId: 'T002' },
  ])
  expect(git.commitMessages).toEqual([
    'Task T001: Implement greeting',
    'Task T002: Implement farewell',
  ])
  expect(store.state?.tasks.T001).toMatchObject({ commitSha: 'commit-1', status: 'done' })
  expect(store.state?.tasks.T002).toMatchObject({ commitSha: 'commit-2', status: 'done' })
  expect(store.implementArtifacts[0]).toMatchObject({ commitSha: 'commit-1' })
  expect(store.verifyArtifacts[1]).toMatchObject({ commitSha: 'commit-2' })
})

test('runWorkflow loads per-task context and passes git-based changed files into review', async () => {
  const graph = createGraph()
  const { runtime } = createRuntime({
    changedFiles: [['src/greeting.ts'], ['src/farewell.ts']],
    taskContexts: {
      T001: {
        codeContext: '## src/greeting.ts\nexport const greeting = "hi"\n',
        plan: '# plan for T001\n',
        spec: '# spec for T001\n',
        tasksSnippet: '- [ ] T001 Implement greeting\n',
      },
      T002: {
        codeContext: '## src/farewell.ts\nexport const farewell = "bye"\n',
        plan: '# plan for T002\n',
        spec: '# spec for T002\n',
        tasksSnippet: '- [ ] T002 Implement farewell\n',
      },
    },
  })
  const agent = new FakeAgentClient(
    [createImplement('T001', 'src/greeting.ts'), createImplement('T002', 'src/farewell.ts')],
    [createReview('T001', 'buildGreeting works'), createReview('T002', 'buildFarewell works')],
  )

  await runWorkflow({
    agent,
    graph,
    runtime,
  })

  expect(agent.implementInputs[0]?.codeContext).toContain('src/greeting.ts')
  expect(agent.implementInputs[1]?.codeContext).toContain('src/farewell.ts')
  expect(agent.reviewInputs[0]?.actualChangedFiles).toEqual(['src/greeting.ts'])
  expect(agent.reviewInputs[1]?.actualChangedFiles).toEqual(['src/farewell.ts'])
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
  const { runtime } = createRuntime({
    verifierResponses: [createVerify('T001', true), createVerify('T001', true)],
  })
  const agent = new FakeAgentClient(
    [createImplement('T001', 'src/greeting.ts'), createImplement('T001', 'src/greeting.ts')],
    [
      {
        changedFilesReviewed: ['src/greeting.ts'],
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
    agent,
    graph,
    runtime,
  })

  expect(result.state.tasks.T001).toMatchObject({ status: 'done' })
  expect(agent.implementInputs[0]?.lastFindings).toEqual([])
  expect(agent.implementInputs[1]?.lastFindings).toEqual(findings)
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
  const { runtime, store } = createRuntime({
    verifierResponses: [createVerify('T001', true)],
  })
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
        lastVerifyPassed: false,
        status: 'rework',
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

  expect(result.state.tasks.T001).toMatchObject({ attempt: 2, status: 'done' })
  expect(agent.implementInputs[0]?.lastFindings).toEqual(findings)
})

test('runWorkflow still reviews failed verify results before later retries', async () => {
  const graph = {
    featureId: '001-demo',
    tasks: [createGraph().tasks[0]!],
  }
  const { runtime, store } = createRuntime({
    verifierResponses: [createVerify('T001', false), createVerify('T001', true)],
  })
  const agent = new FakeAgentClient(
    [createImplement('T001', 'src/greeting.ts'), createImplement('T001', 'src/greeting.ts')],
    [createReview('T001', 'buildGreeting works', 'rework'), createReview('T001', 'buildGreeting works')],
  )

  const result = await runWorkflow({
    agent,
    graph,
    runtime,
  })

  expect(agent.reviewInputs).toHaveLength(2)
  expect(agent.reviewInputs[0]?.verify.passed).toBe(false)
  expect(result.state.tasks.T001).toMatchObject({ status: 'done' })
  expect(store.report?.tasks[0]?.lastVerifyPassed).toBe(true)
})

test('runWorkflow retries after implement failure and keeps downstream tasks pending until the target succeeds', async () => {
  const graph = createGraph()
  const { runtime, store } = createRuntime()
  const agent = new FakeAgentClient(
    [new Error('implement crashed'), createImplement('T001', 'src/greeting.ts'), createImplement('T002', 'src/farewell.ts')],
    [createReview('T001', 'buildGreeting works'), createReview('T002', 'buildFarewell works')],
  )

  const result = await runWorkflow({
    agent,
    graph,
    runtime,
  })

  expect(result.summary.finalStatus).toBe('completed')
  expect(agent.implementInputs).toHaveLength(3)
  expect(store.events.some((event) => event.type === 'implement_failed')).toBe(true)
})

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
  const agent = new FakeAgentClient(
    [createImplement('T001', 'src/greeting.ts')],
    [],
  )

  const result = await runWorkflow({
    agent,
    graph,
    runtime,
  })

  expect(result.state.tasks.T001).toMatchObject({
    reason: 'verify subprocess failed',
    status: 'blocked',
  })
  expect(store.events.some((event) => event.type === 'verify_failed')).toBe(true)
  expect(store.reviewArtifacts).toHaveLength(0)
})

test('runWorkflow stops after untilTaskId completes and leaves downstream tasks untouched', async () => {
  const graph = createGraph()
  const { runtime, store, workspace } = createRuntime()
  const agent = new FakeAgentClient(
    [createImplement('T001', 'src/greeting.ts')],
    [createReview('T001', 'buildGreeting works')],
  )

  const result = await runWorkflow({
    agent,
    graph,
    runtime,
    untilTaskId: 'T001',
  })

  expect(result.state.tasks.T001).toMatchObject({ status: 'done' })
  expect(result.state.tasks.T002).toMatchObject({ status: 'pending' })
  expect(store.implementArtifacts).toHaveLength(1)
  expect(workspace.checkboxUpdates).toEqual([[{ checked: true, taskId: 'T001' }]])
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
  const agent = new FakeAgentClient([], [])

  const result = await runWorkflow({
    agent,
    graph,
    runtime,
    untilTaskId: 'T001',
  })

  expect(result.summary.finalStatus).toBe('in_progress')
  expect(result.state.tasks.T001).toMatchObject({ status: 'done' })
  expect(result.state.tasks.T002).toMatchObject({ status: 'pending' })
  expect(agent.implementInputs).toEqual([])
  expect(agent.reviewInputs).toEqual([])
})
