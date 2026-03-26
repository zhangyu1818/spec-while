import type { WorkflowStore } from '../src/core/runtime'
import type {
  FinalReport,
  ImplementArtifact,
  IntegrateArtifact,
  ReviewArtifact,
  TaskContext,
  TaskDefinition,
  TaskGraph,
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

export class FakeGit {
  private commitIndex = 0

  private headSubject: string
  public readonly commitMessages: string[] = []
  public readonly currentBranches = ['main']
  public readonly resetTargets: string[] = []

  public constructor(
    private readonly changedFiles: string[][] = [[], []],
    private readonly ancestorCommits = new Set<string>(),
    private readonly commitFailures: (Error | null)[] = [],
    headSubject = 'Initial commit',
  ) {
    this.headSubject = headSubject
  }

  public async checkoutBranch(
    name: string,
    options?: { create?: boolean; startPoint?: string },
  ) {
    if (
      options?.create &&
      options.startPoint &&
      !this.currentBranches.includes(options.startPoint)
    ) {
      throw new Error(`Missing branch ${options.startPoint}`)
    }
    this.currentBranches.push(name)
  }

  public async checkoutRemoteBranch(name: string) {
    this.currentBranches.push(name)
  }

  public async commitTask(input: { message: string }) {
    const failure = this.commitFailures.shift() ?? null
    if (failure) {
      throw failure
    }
    this.commitMessages.push(input.message)
    this.headSubject = input.message
    this.commitIndex += 1
    const commitSha = `commit-${this.commitIndex}`
    this.ancestorCommits.add(commitSha)
    return { commitSha }
  }

  public async deleteLocalBranch(name: string) {
    if (this.currentBranches.at(-1) === name) {
      throw new Error(`Cannot delete checked out branch ${name}`)
    }
  }

  public async getChangedFilesSinceHead() {
    return this.changedFiles.shift() ?? []
  }

  public async getCurrentBranch() {
    return this.currentBranches.at(-1) ?? 'main'
  }

  public async getHeadSha() {
    return `head-${this.commitIndex}`
  }

  public async getHeadSubject() {
    return this.headSubject
  }

  public async getHeadTimestamp() {
    return '2026-03-25T08:00:00.000Z'
  }

  public async getParentCommit(commitSha: string) {
    return `${commitSha}-parent`
  }

  public async isAncestorOfHead(commitSha: string) {
    return this.ancestorCommits.has(commitSha)
  }

  public async pullFastForward() {}

  public async pushBranch() {}

  public async requireCleanWorktree() {}

  public async resetHard(commitSha: string) {
    this.resetTargets.push(commitSha)
    this.ancestorCommits.clear()
  }
}

export class InMemoryStore implements WorkflowStore {
  public events: WorkflowEvent[] = []
  public graph: null | TaskGraph = null
  public implementArtifacts: ImplementArtifact[] = []
  public integrateArtifacts: IntegrateArtifact[] = []
  public report: FinalReport | null = null
  public reviewArtifacts: ReviewArtifact[] = []
  public state: null | WorkflowState = null

  public async appendEvent(event: WorkflowEvent) {
    this.events.push(event)
  }

  public async loadGraph() {
    return this.graph
  }

  public async loadImplementArtifact(key: {
    attempt: number
    generation: number
    taskId: string
  }) {
    return (
      this.implementArtifacts.find(
        (item) =>
          item.taskId === key.taskId &&
          item.generation === key.generation &&
          item.attempt === key.attempt,
      ) ?? null
    )
  }
  public async loadReviewArtifact(key: {
    attempt: number
    generation: number
    taskId: string
  }) {
    return (
      this.reviewArtifacts.find(
        (item) =>
          item.taskId === key.taskId &&
          item.generation === key.generation &&
          item.attempt === key.attempt,
      ) ?? null
    )
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
    this.integrateArtifacts = []
    this.implementArtifacts = []
    this.report = null
    this.reviewArtifacts = []
    this.state = null
  }

  public async saveGraph(graph: TaskGraph) {
    this.graph = graph
  }

  public async saveImplementArtifact(artifact: ImplementArtifact) {
    const index = this.implementArtifacts.findIndex(
      (item) =>
        item.taskId === artifact.taskId &&
        item.generation === artifact.generation &&
        item.attempt === artifact.attempt,
    )
    if (index >= 0) {
      this.implementArtifacts[index] = artifact
      return
    }
    this.implementArtifacts.push(artifact)
  }

  public async saveIntegrateArtifact(artifact: IntegrateArtifact) {
    const index = this.integrateArtifacts.findIndex(
      (item) =>
        item.taskId === artifact.taskId &&
        item.generation === artifact.generation &&
        item.attempt === artifact.attempt,
    )
    if (index >= 0) {
      this.integrateArtifacts[index] = artifact
      return
    }
    this.integrateArtifacts.push(artifact)
  }

  public async saveReport(report: FinalReport) {
    this.report = report
  }

  public async saveReviewArtifact(artifact: ReviewArtifact) {
    const index = this.reviewArtifacts.findIndex(
      (item) =>
        item.taskId === artifact.taskId &&
        item.generation === artifact.generation &&
        item.attempt === artifact.attempt,
    )
    if (index >= 0) {
      this.reviewArtifacts[index] = artifact
      return
    }
    this.reviewArtifacts.push(artifact)
  }

  public async saveState(state: WorkflowState) {
    this.state = state
  }
}

export class InMemoryWorkspace {
  public readonly checkboxUpdates: { checked: boolean; taskId: string }[][] = []
  public constructor(private readonly taskContext: TaskContextSource) {}
  public async isTaskChecked(taskId: string) {
    const latest = this.checkboxUpdates
      .flat()
      .findLast((item) => item.taskId === taskId)
    return latest?.checked ?? false
  }

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

  public async updateTaskChecks(
    updates: { checked: boolean; taskId: string }[],
  ) {
    this.checkboxUpdates.push(updates)
  }
}
