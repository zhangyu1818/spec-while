import { expect, test, vi } from 'vitest'

import { runWorkflow } from '../src/core/orchestrator'
import {
  createGraph,
  createImplement,
  createRuntime,
  createVerify,
} from './workflow-test-helpers'

import type {
  ImplementerProvider,
  RemoteReviewerProvider,
} from '../src/agents/types'
import type { WorkflowRuntime } from '../src/workflow/preset'

test('runWorkflow resumes a running pull-request review without re-running implement', async () => {
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
        lastVerifyPassed: true,
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
  await store.saveVerifyArtifact({
    attempt: 1,
    createdAt: '2026-03-25T08:01:00.000Z',
    generation: 1,
    result: createVerify('T001', true),
    taskId: 'T001',
  })

  const implement = vi.fn(async () => {
    throw new Error('implement should not run during review resume')
  })
  const review = vi.fn(async () => ({
    kind: 'approved' as const,
    review: {
      changedFilesReviewed: ['src/greeting.ts'],
      findings: [],
      overallRisk: 'low' as const,
      summary: 'approved remotely',
      taskId: 'T001',
      verdict: 'pass' as const,
      acceptanceChecks: [
        {
          criterion: 'buildGreeting works',
          note: 'ok',
          status: 'pass' as const,
        },
      ],
    },
  }))
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
  expect(review).toHaveBeenCalledWith(
    expect.objectContaining({
      actualChangedFiles: ['src/greeting.ts'],
      attempt: 1,
      generation: 1,
    }),
  )
  expect(integrate).toHaveBeenCalledTimes(1)
  expect(result.state.tasks.T001).toMatchObject({
    commitSha: 'commit-1',
    status: 'done',
  })
})

test('runWorkflow resumes a running pull-request review and records rejected feedback without re-running implement', async () => {
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
        lastVerifyPassed: true,
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
  await store.saveVerifyArtifact({
    attempt: 1,
    createdAt: '2026-03-25T08:01:00.000Z',
    generation: 1,
    result: createVerify('T001', true),
    taskId: 'T001',
  })

  const implement = vi.fn(async () => {
    throw new Error('implement should not run during review resume')
  })
  const review = vi.fn(async () => ({
    kind: 'rejected' as const,
    review: {
      changedFilesReviewed: ['src/greeting.ts'],
      overallRisk: 'medium' as const,
      summary: 'handle edge case',
      taskId: 'T001',
      verdict: 'rework' as const,
      acceptanceChecks: [
        {
          criterion: 'buildGreeting works',
          note: 'handle edge case',
          status: 'unclear' as const,
        },
      ],
      findings: [
        {
          file: 'src/greeting.ts',
          fixHint: 'handle edge case',
          issue: 'handle edge case',
          severity: 'medium' as const,
        },
      ],
    },
  }))
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
    lastReviewVerdict: 'rework',
    reason: 'handle edge case',
    status: 'blocked',
    lastFindings: [
      {
        file: 'src/greeting.ts',
        fixHint: 'handle edge case',
        issue: 'handle edge case',
        severity: 'medium',
      },
    ],
  })
})
