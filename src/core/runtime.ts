import type {
  FinalReport,
  ImplementArtifact,
  IntegrateArtifact,
  ReviewArtifact,
  TaskContext,
  TaskDefinition,
  TaskGraph,
  VerifyArtifact,
  VerifyResult,
  WorkflowEvent,
  WorkflowState,
} from '../types'

export interface AttemptArtifactKey {
  attempt: number
  generation: number
  taskId: string
}

export interface WorkflowStore {
  appendEvent: (event: WorkflowEvent) => Promise<void>
  loadGraph: () => Promise<null | TaskGraph>
  loadImplementArtifact: (
    key: AttemptArtifactKey,
  ) => Promise<ImplementArtifact | null>
  loadReviewArtifact: (
    key: AttemptArtifactKey,
  ) => Promise<null | ReviewArtifact>
  loadState: () => Promise<null | WorkflowState>
  loadVerifyArtifact: (
    key: AttemptArtifactKey,
  ) => Promise<null | VerifyArtifact>
  readReport: () => Promise<FinalReport | null>
  reset: () => Promise<void>
  saveGraph: (graph: TaskGraph) => Promise<void>
  saveImplementArtifact: (artifact: ImplementArtifact) => Promise<void>
  saveIntegrateArtifact: (artifact: IntegrateArtifact) => Promise<void>
  saveReport: (report: FinalReport) => Promise<void>
  saveReviewArtifact: (artifact: ReviewArtifact) => Promise<void>
  saveState: (state: WorkflowState) => Promise<void>
  saveVerifyArtifact: (artifact: VerifyArtifact) => Promise<void>
}

export interface WorkspacePort {
  isTaskChecked: (taskId: string) => Promise<boolean>
  loadTaskContext: (task: TaskDefinition) => Promise<TaskContext>
  updateTaskChecks: (
    updates: { checked: boolean; taskId: string }[],
  ) => Promise<void>
}

export interface GitPort {
  checkoutBranch: (
    name: string,
    options?: { create?: boolean; startPoint?: string },
  ) => Promise<void>
  checkoutRemoteBranch: (name: string) => Promise<void>
  commitTask: (input: { message: string }) => Promise<{ commitSha: string }>
  deleteLocalBranch: (name: string) => Promise<void>
  getChangedFilesSinceHead: () => Promise<string[]>
  getCurrentBranch: () => Promise<string>
  getHeadSha: () => Promise<string>
  getHeadSubject: () => Promise<string>
  getHeadTimestamp: () => Promise<string>
  getParentCommit: (commitSha: string) => Promise<string>
  isAncestorOfHead: (commitSha: string) => Promise<boolean>
  pullFastForward: (branch: string) => Promise<void>
  pushBranch: (
    name: string,
    options?: { setUpstream?: boolean },
  ) => Promise<void>
  requireCleanWorktree: () => Promise<void>
  resetHard: (commitSha: string) => Promise<void>
}

export interface PullRequestRef {
  number: number
  title: string
  url: string
}

export interface MergedPullRequestRef extends PullRequestRef {
  mergeCommitSha: string
}

export interface PullRequestReaction {
  content: string
  createdAt: string
  userLogin: string
}

export interface PullRequestReviewSummary {
  body: string
  id: number
  state: string
  submittedAt: null | string
  url: string
  userLogin: string
}

export interface PullRequestDiscussionComment {
  body: string
  createdAt: string
  id: number
  url: string
  userLogin: string
}

export interface PullRequestReviewThreadComment {
  body: string
  createdAt: string
  line: null | number
  path: string
  url: string
  userLogin: string
}

export interface PullRequestReviewThread {
  comments: PullRequestReviewThreadComment[]
  id: string
  isOutdated: boolean
  isResolved: boolean
}

export interface PullRequestSnapshot {
  changedFiles: string[]
  discussionComments: PullRequestDiscussionComment[]
  reactions: PullRequestReaction[]
  reviewSummaries: PullRequestReviewSummary[]
  reviewThreads: PullRequestReviewThread[]
}

export interface GitHubPort {
  createPullRequest: (input: {
    baseBranch: string
    body: string
    headBranch: string
    title: string
  }) => Promise<PullRequestRef>
  findMergedPullRequestByHeadBranch: (input: {
    headBranch: string
  }) => Promise<MergedPullRequestRef | null>
  findOpenPullRequestByHeadBranch: (input: {
    headBranch: string
  }) => Promise<null | PullRequestRef>
  getPullRequestSnapshot: (input: {
    pullRequestNumber: number
  }) => Promise<PullRequestSnapshot>
  squashMergePullRequest: (input: {
    pullRequestNumber: number
    subject: string
  }) => Promise<{ commitSha: string }>
}

export interface Verifier {
  verify: (input: {
    commands: string[]
    taskId: string
  }) => Promise<VerifyResult>
}

export interface OrchestratorRuntime {
  git: GitPort
  github: GitHubPort
  store: WorkflowStore
  verifier: Verifier
  workspace: WorkspacePort
}
