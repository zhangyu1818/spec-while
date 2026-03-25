import { expect, test, vi } from 'vitest'

import { runWorkflow } from '../src/core/orchestrator'
import { createPullRequestWorkflowPreset } from '../src/workflow/pull-request-preset'
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
import type { PullRequestRef } from '../src/core/runtime'
import type { WorkflowRuntime } from '../src/workflow/preset'

test('runWorkflow resumes a running pull-request review by reusing the current attempt checkpoint on HEAD', async () => {
  const graph = {
    featureId: '001-demo',
    tasks: [
      {
        ...createGraph().tasks[0]!,
        maxAttempts: 1,
      },
    ],
  }
  const { runtime, store } = createRuntime()
  const pullRequest: PullRequestRef = {
    number: 12,
    title: 'Task T001: Implement greeting',
    url: 'https://example.com/pr/12',
  }
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
  const commitTask = vi.fn(async () => ({ commitSha: 'checkpoint-sha' }))
  const pushBranch = vi.fn(async () => {})
  runtime.git.commitTask = commitTask
  runtime.git.pushBranch = pushBranch
  runtime.git.getHeadSubject = vi.fn(
    async () => 'checkpoint: Task T001: Implement greeting (attempt 1)',
  )
  runtime.github.findOpenPullRequestByHeadBranch = vi.fn(
    async () => pullRequest,
  )
  runtime.github.getPullRequestSnapshot = vi.fn(async () => ({
    changedFiles: ['src/greeting.ts'],
    discussionComments: [],
    reactions: [],
    reviewSummaries: [],
    reviewThreads: [],
  }))
  const reviewer: RemoteReviewerProvider = {
    name: 'remote',
    evaluatePullRequestReview: vi.fn(async () => ({
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
    })),
  }

  const workflow: WorkflowRuntime = {
    preset: createPullRequestWorkflowPreset({
      reviewer,
      sleep: vi.fn(async () => {}),
    }),
    roles: {
      reviewer,
      implementer: {
        name: 'scripted',
        implement,
      } as ImplementerProvider,
    },
  }

  const result = await runWorkflow({
    graph,
    runtime,
    workflow,
  })

  expect(implement).not.toHaveBeenCalled()
  expect(commitTask).not.toHaveBeenCalled()
  expect(pushBranch).toHaveBeenCalledWith('task/t001-implement-greeting')
  expect(result.state.tasks.T001).toMatchObject({
    lastReviewVerdict: 'rework',
    status: 'blocked',
  })
})
