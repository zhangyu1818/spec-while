import { createDirectWorkflowPreset } from '../src/workflow/direct-preset'
import { createTaskPrompt } from './task-source-test-helpers'
import { FakeGitHub } from './workflow-github-double'
import { FakeGit, InMemoryStore } from './workflow-runtime-doubles'
import {
  InMemoryTaskSource,
  InMemoryWorkspace,
} from './workflow-task-source-doubles'

import type {
  ImplementAgentInput,
  ImplementerProvider,
  ReviewAgentInput,
  ReviewerProvider,
} from '../src/agents/types'
import type { OrchestratorRuntime } from '../src/core/runtime'
import type {
  ImplementOutput,
  ReviewOutput,
  ReviewVerdict,
  TaskGraph,
} from '../src/types'
import type { WorkflowRuntime } from '../src/workflow/preset'

export class ScriptedWorkflowProvider
  implements ImplementerProvider, ReviewerProvider
{
  public readonly implementInputs: ImplementAgentInput[] = []
  public readonly name = 'scripted'
  public readonly reviewInputs: ReviewAgentInput[] = []

  public constructor(
    private readonly implementResponses: (Error | ImplementOutput)[],
    private readonly reviewResponses: (Error | ReviewOutput)[],
  ) {}

  public async implement(input: ImplementAgentInput): Promise<ImplementOutput> {
    this.implementInputs.push(input)
    const next = this.implementResponses.shift()
    if (!next) {
      throw new Error('Missing fake implement response')
    }
    if (next instanceof Error) {
      throw next
    }
    return next
  }

  public async review(input: ReviewAgentInput): Promise<ReviewOutput> {
    this.reviewInputs.push(input)
    const next = this.reviewResponses.shift()
    if (!next) {
      throw new Error('Missing fake review response')
    }
    if (next instanceof Error) {
      throw next
    }
    return next
  }
}

export function createWorkflow(
  provider: ImplementerProvider & ReviewerProvider,
): WorkflowRuntime {
  return {
    preset: createDirectWorkflowPreset({
      reviewer: provider,
    }),
    roles: {
      implementer: provider,
      reviewer: provider,
    },
  }
}

export function createGraph(): TaskGraph {
  return {
    featureId: '001-demo',
    maxIterations: 5,
    tasks: [
      {
        commitSubject: 'Task T001: Implement greeting',
        dependsOn: [],
        handle: 'T001',
      },
      {
        commitSubject: 'Task T002: Implement farewell',
        dependsOn: ['T001'],
        handle: 'T002',
      },
    ],
  }
}

export function createImplement(
  taskHandle: string,
  file: string,
): ImplementOutput {
  void file
  return {
    assumptions: [],
    needsHumanAttention: false,
    notes: [],
    status: 'implemented',
    summary: `${taskHandle} done`,
    taskHandle,
    unresolvedItems: [],
  }
}

export function createReview(
  taskHandle: string,
  criterion: string,
  verdict: ReviewVerdict = 'pass',
): ReviewOutput {
  return {
    overallRisk: verdict === 'pass' ? 'low' : 'medium',
    summary: verdict === 'pass' ? 'ok' : 'retry',
    taskHandle,
    verdict,
    acceptanceChecks: [
      {
        criterion,
        note: verdict === 'pass' ? 'ok' : 'fix needed',
        status: verdict === 'pass' ? 'pass' : 'fail',
      },
    ],
    findings:
      verdict === 'pass'
        ? []
        : [
            {
              file: 'src/greeting.ts',
              fixHint: 'retry',
              issue: 'needs work',
              severity: 'medium',
            },
          ],
  }
}

export interface CreateRuntimeInput {
  changedFiles?: string[][]
  commitFailures?: (Error | null)[]
  taskContexts?: Record<
    string,
    {
      plan: string
      spec: string
      tasksSnippet: string
    }
  >
  taskPrompts?: Record<string, ReturnType<typeof createTaskPrompt>>
}

export interface RuntimeBundle {
  git: FakeGit
  runtime: OrchestratorRuntime
  store: InMemoryStore
  workspace: InMemoryWorkspace
}

export function createRuntime(input?: CreateRuntimeInput): RuntimeBundle {
  const store = new InMemoryStore()
  const workspace = new InMemoryWorkspace({
    kind: 'per-task',
    value:
      input?.taskPrompts ??
      Object.fromEntries(
        Object.entries(
          input?.taskContexts ?? {
            T001: {
              plan: '# plan\n',
              spec: '# spec\n',
              tasksSnippet: '- [ ] T001 Implement greeting\n',
            },
            T002: {
              plan: '# plan\n',
              spec: '# spec\n',
              tasksSnippet: '- [ ] T002 Implement farewell\n',
            },
          },
        ).map(([taskHandle, context]) => [
          taskHandle,
          createTaskPrompt({
            instructions: ['Implement only the current task.'],
            plan: context.plan,
            spec: context.spec,
            taskHandle,
            tasksSnippet: context.tasksSnippet,
            title:
              taskHandle === 'T001'
                ? 'Implement greeting'
                : 'Implement farewell',
          }),
        ]),
      ),
  })
  const git = new FakeGit(
    input?.changedFiles ?? [['src/greeting.ts'], ['src/farewell.ts']],
    input?.commitFailures ?? [],
  )
  const github = new FakeGitHub()
  const graph = createGraph()
  const taskSource = new InMemoryTaskSource(graph, workspace.prompts, workspace)
  return {
    git,
    store,
    workspace,
    runtime: {
      git,
      github,
      store,
      taskSource,
    },
  }
}
