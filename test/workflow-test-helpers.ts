import { FakeGit, FakeVerifier, InMemoryStore, InMemoryWorkspace } from './workflow-runtime-doubles'

import type { AgentClient, ImplementAgentInput, ReviewAgentInput } from '../src/agents/types'
import type { OrchestratorRuntime } from '../src/core/runtime'
import type {
  ImplementOutput,
  ReviewOutput,
  TaskContext,
  TaskGraph,
  VerifyResult,
} from '../src/types'

export class FakeAgentClient implements AgentClient {
  public readonly implementInputs: ImplementAgentInput[] = []
  public readonly name = 'fake'
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
        paths: ['src/greeting.ts'],
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement greeting',
        verifyCommands: ['node -e "process.exit(0)"'],
      },
      {
        id: 'T002',
        acceptance: ['buildFarewell works'],
        dependsOn: ['T001'],
        maxAttempts: 2,
        parallelizable: false,
        paths: ['src/farewell.ts'],
        phase: 'Core',
        reviewRubric: ['simple'],
        title: 'Implement farewell',
        verifyCommands: ['node -e "process.exit(0)"'],
      },
    ],
  }
}

export function createImplement(taskId: string, file: string): ImplementOutput {
  return {
    assumptions: [],
    changedFiles: [file],
    needsHumanAttention: false,
    notes: [],
    requestedAdditionalPaths: [],
    status: 'implemented',
    summary: `${taskId} done`,
    taskId,
    unresolvedItems: [],
  }
}

export function createReview(taskId: string, criterion: string, verdict: ReviewOutput['verdict'] = 'pass'): ReviewOutput {
  return {
    changedFilesReviewed: [],
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
    findings: verdict === 'pass'
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

export function createVerify(taskId: string, passed: boolean): VerifyResult {
  return {
    passed,
    summary: passed ? 'ok' : 'failed',
    taskId,
    commands: [
      {
        command: 'node -e "process.exit(0)"',
        exitCode: passed ? 0 : 1,
        finishedAt: '2026-03-22T00:00:00.000Z',
        passed,
        startedAt: '2026-03-22T00:00:00.000Z',
        stderr: '',
        stdout: '',
      },
    ],
  }
}

export function createRuntime(input?: {
  ancestorCommits?: string[]
  changedFiles?: string[][]
  commitFailures?: (Error | null)[]
  taskContexts?: Record<string, TaskContext>
  verifierResponses?: (Error | VerifyResult)[]
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
        codeContext: '## src/greeting.ts\nexport const greeting = "hi"\n',
        plan: '# plan\n',
        spec: '# spec\n',
        tasksSnippet: '- [ ] T001 Implement greeting\n',
      },
      T002: {
        codeContext: '## src/farewell.ts\nexport const farewell = "bye"\n',
        plan: '# plan\n',
        spec: '# spec\n',
        tasksSnippet: '- [ ] T002 Implement farewell\n',
      },
    },
  })
  const verifier = new FakeVerifier(input?.verifierResponses ?? [
    createVerify('T001', true),
    createVerify('T002', true),
  ])
  const git = new FakeGit(
    input?.changedFiles ?? [['src/greeting.ts'], ['src/farewell.ts']],
    new Set(input?.ancestorCommits ?? []),
    input?.commitFailures ?? [],
  )
  return {
    git,
    store,
    workspace,
    runtime: {
      git,
      store,
      verifier,
      workspace,
    },
  }
}
