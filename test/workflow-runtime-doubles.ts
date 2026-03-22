import type {
  FinalReport,
  ImplementArtifact,
  ReviewArtifact,
  TaskContext,
  TaskDefinition,
  TaskGraph,
  VerifyArtifact,
  VerifyResult,
  WorkflowEvent,
  WorkflowState,
} from '../src/types'

export type TaskContextSource =
  | {
      kind: 'per-task'
      value: Record<string, TaskContext>
    }
  | {
      kind: 'single'
      value: TaskContext
    }

export class FakeVerifier {
  public readonly calls: { commands: string[], taskId: string }[] = []

  public constructor(private readonly responses: (Error | VerifyResult)[]) {}

  public async verify(input: { commands: string[]; taskId: string }): Promise<VerifyResult> {
    this.calls.push(input)
    const next = this.responses.shift()
    if (!next) {
      throw new Error('Missing fake verify response')
    }
    if (next instanceof Error) {
      throw next
    }
    return next
  }
}

export class FakeGit {
  private commitIndex = 0

  public readonly commitMessages: string[] = []
  public readonly resetTargets: string[] = []

  public constructor(
    private readonly changedFiles: string[][] = [[], []],
    private readonly ancestorCommits = new Set<string>(),
    private readonly commitFailures: (Error | null)[] = [],
  ) {}

  public async commitTask(input: { message: string }) {
    const failure = this.commitFailures.shift() ?? null
    if (failure) {
      throw failure
    }
    this.commitMessages.push(input.message)
    this.commitIndex += 1
    const commitSha = `commit-${this.commitIndex}`
    this.ancestorCommits.add(commitSha)
    return { commitSha }
  }

  public async getChangedFilesSinceHead() {
    return this.changedFiles.shift() ?? []
  }

  public async getParentCommit(commitSha: string) {
    return `${commitSha}-parent`
  }

  public async isAncestorOfHead(commitSha: string) {
    return this.ancestorCommits.has(commitSha)
  }

  public async requireCleanWorktree() {}

  public async resetHard(commitSha: string) {
    this.resetTargets.push(commitSha)
    this.ancestorCommits.clear()
  }
}

export class InMemoryStore {
  public events: WorkflowEvent[] = []
  public graph: null | TaskGraph = null
  public implementArtifacts: ImplementArtifact[] = []
  public report: FinalReport | null = null
  public reviewArtifacts: ReviewArtifact[] = []
  public state: null | WorkflowState = null
  public verifyArtifacts: VerifyArtifact[] = []

  public async appendEvent(event: WorkflowEvent) {
    this.events.push(event)
  }

  public async loadGraph() {
    return this.graph
  }

  public async loadState() {
    return this.state
  }

  public async readReport() {
    return this.report
  }

  public async reset() {
    this.events = []
    this.graph = null
    this.implementArtifacts = []
    this.report = null
    this.reviewArtifacts = []
    this.state = null
    this.verifyArtifacts = []
  }

  public async saveGraph(graph: TaskGraph) {
    this.graph = graph
  }

  public async saveImplementArtifact(artifact: ImplementArtifact) {
    const index = this.implementArtifacts.findIndex((item) => item.taskId === artifact.taskId && item.generation === artifact.generation && item.attempt === artifact.attempt)
    if (index >= 0) {
      this.implementArtifacts[index] = artifact
      return
    }
    this.implementArtifacts.push(artifact)
  }

  public async saveReport(report: FinalReport) {
    this.report = report
  }

  public async saveReviewArtifact(artifact: ReviewArtifact) {
    const index = this.reviewArtifacts.findIndex((item) => item.taskId === artifact.taskId && item.generation === artifact.generation && item.attempt === artifact.attempt)
    if (index >= 0) {
      this.reviewArtifacts[index] = artifact
      return
    }
    this.reviewArtifacts.push(artifact)
  }

  public async saveState(state: WorkflowState) {
    this.state = state
  }

  public async saveVerifyArtifact(artifact: VerifyArtifact) {
    const index = this.verifyArtifacts.findIndex((item) => item.taskId === artifact.taskId && item.generation === artifact.generation && item.attempt === artifact.attempt)
    if (index >= 0) {
      this.verifyArtifacts[index] = artifact
      return
    }
    this.verifyArtifacts.push(artifact)
  }
}

export class InMemoryWorkspace {
  public readonly checkboxUpdates: { checked: boolean, taskId: string }[][] = []

  public constructor(
    private readonly taskContext: TaskContextSource,
  ) {}

  public async loadTaskContext(task: TaskDefinition) {
    if (this.taskContext.kind === 'single') {
      return this.taskContext.value
    }
    const context = this.taskContext.value[task.id]
    if (!context) {
      throw new Error(`Missing task context for ${task.id}`)
    }
    return context
  }

  public async updateTaskChecks(updates: { checked: boolean, taskId: string }[]) {
    this.checkboxUpdates.push(updates)
  }
}
