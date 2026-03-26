import { expect, test, vi } from 'vitest'

import { runWorkflow } from '../src/core/orchestrator'
import {
  createGraph,
  createImplement,
  createRuntime,
} from './workflow-test-helpers'

import type {
  ImplementerProvider,
  RemoteReviewerProvider,
} from '../src/agents/types'
import type { WorkflowRuntime } from '../src/workflow/preset'

test('runWorkflow records review_failed when pull-request review resume throws', async () => {
  const task = {
    ...createGraph().tasks[0]!,
    maxAttempts: 1,
  }
  const graph = {
    featureId: '001-demo',
    tasks: [task],
  }
  const { runtime, store } = createRuntime()
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
  await store.saveImplementArtifact({
    attempt: 1,
    createdAt: '2026-03-25T08:00:00.000Z',
    generation: 1,
    result: createImplement('T001', 'src/greeting.ts'),
    taskId: 'T001',
  })

  const implement = vi.fn(async () => {
    throw new Error('implement should not run during review resume')
  })
  const review = vi.fn(async () => {
    throw new Error('snapshot exploded')
  })
  const integrate = vi.fn(async () => ({
    kind: 'completed' as const,
    result: {
      commitSha: 'commit-1',
      summary: 'integrated',
    },
  }))

  const workflow: WorkflowRuntime = {
    preset: {
      integrate,
      mode: 'pull-request',
      review,
    },
    roles: {
      implementer: {
        name: 'scripted',
        implement,
      } as ImplementerProvider,
      reviewer: {
        name: 'remote',
        async evaluatePullRequestReview() {
          throw new Error('unused')
        },
      } as RemoteReviewerProvider,
    },
  }

  const result = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(implement).not.toHaveBeenCalled()
  expect(review).toHaveBeenCalledTimes(1)
  expect(integrate).not.toHaveBeenCalled()
  expect(result.state.currentTaskId).toBeNull()
  expect(result.state.tasks.T001).toMatchObject({
    reason: 'snapshot exploded',
    status: 'blocked',
  })
  expect(store.events.at(-1)).toMatchObject({
    detail: 'snapshot exploded',
    taskId: 'T001',
    type: 'review_failed',
  })
})

test('runWorkflow lets pull-request review resume continue when no open PR exists yet', async () => {
  const task = {
    ...createGraph().tasks[0]!,
    maxAttempts: 1,
  }
  const graph = {
    featureId: '001-demo',
    tasks: [task],
  }
  const { runtime, store } = createRuntime()
  runtime.github.findOpenPullRequestByHeadBranch = vi.fn(async () => null)
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
  await store.saveImplementArtifact({
    attempt: 1,
    createdAt: '2026-03-25T08:00:00.000Z',
    generation: 1,
    result: createImplement('T001', 'src/greeting.ts'),
    taskId: 'T001',
  })

  const implement = vi.fn(async () => {
    throw new Error('implement should not run during review resume')
  })
  const review = vi.fn(async () => ({
    kind: 'rejected' as const,
    review: {
      overallRisk: 'medium' as const,
      summary: 'review still pending',
      taskId: 'T001',
      verdict: 'rework' as const,
      acceptanceChecks: [
        {
          criterion: 'buildGreeting works',
          note: 'review still pending',
          status: 'unclear' as const,
        },
      ],
      findings: [
        {
          file: 'src/greeting.ts',
          fixHint: 'wait for remote review',
          issue: 'review still pending',
          severity: 'medium' as const,
        },
      ],
    },
  }))

  const workflow: WorkflowRuntime = {
    preset: {
      mode: 'pull-request',
      review,
      integrate: vi.fn(async () => ({
        kind: 'completed' as const,
        result: {
          commitSha: 'commit-1',
          summary: 'integrated',
        },
      })),
    },
    roles: {
      implementer: {
        name: 'scripted',
        implement,
      } as ImplementerProvider,
      reviewer: {
        name: 'remote',
        async evaluatePullRequestReview() {
          throw new Error('unused')
        },
      } as RemoteReviewerProvider,
    },
  }

  const result = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(implement).not.toHaveBeenCalled()
  expect(review).toHaveBeenCalledTimes(1)
  expect(result.state.tasks.T001).toMatchObject({
    lastReviewVerdict: 'rework',
    reason: 'review still pending',
    status: 'blocked',
  })
})
