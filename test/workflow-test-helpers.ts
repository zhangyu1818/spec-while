import { createDirectWorkflowPreset } from '../src/workflow/direct-preset'
import { FakeGitHub } from './workflow-github-double'
import { FakeGit, InMemoryStore, InMemoryWorkspace } from './workflow-runtime-doubles'

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
  TaskContext,
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
    tasks: [
      {
        id: 'T001',
        acceptance: ['buildGreeting works'],
        dependsOn: [],
        maxAttempts: 2,
        parallelizable: false,
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement greeting',
      },
      {
        id: 'T002',
        acceptance: ['buildFarewell works'],
        dependsOn: ['T001'],
        maxAttempts: 2,
        parallelizable: false,
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement farewell',
      },
    ],
  }
}

export function createImplement(taskId: string, file: string): ImplementOutput {
  void file
  return {
    assumptions: [],
    needsHumanAttention: false,
    notes: [],
    status: 'implemented',
    summary: `${taskId} done`,
    taskId,
    unresolvedItems: [],
  }
}

export function createReview(
  taskId: string,
  criterion: string,
  verdict: ReviewOutput['verdict'] = 'pass',
): ReviewOutput {
  return {
    overallRisk: verdict === 'pass' ? 'low' : 'medium',
    summary: verdict === 'pass' ? 'ok' : 'retry',
    taskId,
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

export function createRuntime(input?: {
  ancestorCommits?: string[]
  changedFiles?: string[][]
  commitFailures?: (Error | null)[]
  taskContexts?: Record<string, TaskContext>
}): {
  git: FakeGit
  runtime: OrchestratorRuntime
  store: InMemoryStore
  workspace: InMemoryWorkspace
} {
  const store = new InMemoryStore()
  const workspace = new InMemoryWorkspace({
    kind: 'per-task',
    value: input?.taskContexts ?? {
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
  })
  const git = new FakeGit(
    input?.changedFiles ?? [['src/greeting.ts'], ['src/farewell.ts']],
    new Set(input?.ancestorCommits ?? []),
    input?.commitFailures ?? [],
  )
  const github = new FakeGitHub()
  return {
    git,
    store,
    workspace,
    runtime: {
      git,
      github,
      store,
      workspace,
    },
  }
}
