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
} from '../types'

export interface WorkflowStore {
  appendEvent: (event: WorkflowEvent) => Promise<void>
  loadGraph: () => Promise<null | TaskGraph>
  loadState: () => Promise<null | WorkflowState>
  readReport: () => Promise<FinalReport | null>
  reset: () => Promise<void>
  saveGraph: (graph: TaskGraph) => Promise<void>
  saveImplementArtifact: (artifact: ImplementArtifact) => Promise<void>
  saveReport: (report: FinalReport) => Promise<void>
  saveReviewArtifact: (artifact: ReviewArtifact) => Promise<void>
  saveState: (state: WorkflowState) => Promise<void>
  saveVerifyArtifact: (artifact: VerifyArtifact) => Promise<void>
}

export interface WorkspacePort {
  loadTaskContext: (task: TaskDefinition) => Promise<TaskContext>
  updateTaskChecks: (updates: { checked: boolean, taskId: string }[]) => Promise<void>
}

export interface GitPort {
  commitTask: (input: { message: string }) => Promise<{ commitSha: string }>
  getChangedFilesSinceHead: () => Promise<string[]>
  getParentCommit: (commitSha: string) => Promise<string>
  isAncestorOfHead: (commitSha: string) => Promise<boolean>
  requireCleanWorktree: () => Promise<void>
  resetHard: (commitSha: string) => Promise<void>
}

export interface Verifier {
  verify: (input: { commands: string[], taskId: string }) => Promise<VerifyResult>
}

export interface OrchestratorRuntime {
  git: GitPort
  store: WorkflowStore
  verifier: Verifier
  workspace: WorkspacePort
}
