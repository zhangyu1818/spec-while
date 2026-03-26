import { expect, test, vi } from 'vitest'

import { runWorkflow } from '../src/core/orchestrator'
import {
  createGraph,
  createImplement,
  createReview,
  createRuntime,
} from './workflow-test-helpers'

import type {
  ImplementerProvider,
  RemoteReviewerProvider,
} from '../src/agents/types'
import type { WorkflowRuntime } from '../src/workflow/preset'

test('runWorkflow resumes a running pull-request integrate after restart without re-running implement or review', async () => {
  const graph = {
    featureId: '001-demo',
    tasks: [createGraph().tasks[0]!],
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
        lastReviewVerdict: 'pass',
        stage: 'integrate',
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
  await store.saveReviewArtifact({
    attempt: 1,
    createdAt: '2026-03-25T08:02:00.000Z',
    generation: 1,
    result: createReview('T001', 'buildGreeting works'),
    taskId: 'T001',
  })

  const implement = vi.fn(async () => {
    throw new Error('implement should not run during integrate resume')
  })
  const review = vi.fn(async () => {
    throw new Error('review should not run during integrate resume')
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
  expect(review).not.toHaveBeenCalled()
  expect(integrate).toHaveBeenCalledTimes(1)
  expect(result.state.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    status: 'done',
  })
  expect(store.integrateArtifacts).toHaveLength(1)
})
