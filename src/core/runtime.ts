import type { TaskSourceSession } from '../task-sources/types'
import type {
  FinalReport,
  ImplementArtifact,
  IntegrateArtifact,
  ReviewArtifact,
  TaskGraph,
  WorkflowEvent,
  WorkflowState,
} from '../types'

export interface AttemptArtifactKey {
  attempt: number
  generation: number
  taskHandle: string
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
  readReport: () => Promise<FinalReport | null>
  reset: () => Promise<void>
  saveGraph: (graph: TaskGraph) => Promise<void>
  saveImplementArtifact: (artifact: ImplementArtifact) => Promise<void>
  saveIntegrateArtifact: (artifact: IntegrateArtifact) => Promise<void>
  saveReport: (report: FinalReport) => Promise<void>
  saveReviewArtifact: (artifact: ReviewArtifact) => Promise<void>
  saveState: (state: WorkflowState) => Promise<void>
}

export interface GitCheckoutBranchOptions {
  create?: boolean
  startPoint?: string
}

export interface GitCommitTaskInput {
  message: string
}

export interface GitCommitTaskResult {
  commitSha: string
}

export interface GitPushBranchOptions {
  setUpstream?: boolean
}

export interface GitPort {
  checkoutBranch: (
    name: string,
    options?: GitCheckoutBranchOptions,
  ) => Promise<void>
  checkoutRemoteBranch: (name: string) => Promise<void>
  commitTask: (input: GitCommitTaskInput) => Promise<GitCommitTaskResult>
  deleteLocalBranch: (name: string) => Promise<void>
  getChangedFilesSinceHead: () => Promise<string[]>
  getCurrentBranch: () => Promise<string>
  getHeadSha: () => Promise<string>
  getHeadSubject: () => Promise<string>
  getHeadTimestamp: () => Promise<string>
  pullFastForward: (branch: string) => Promise<void>
  pushBranch: (name: string, options?: GitPushBranchOptions) => Promise<void>
  requireCleanWorktree: () => Promise<void>
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
  createPullRequest: (input: CreatePullRequestInput) => Promise<PullRequestRef>
  findMergedPullRequestByHeadBranch: (
    input: FindMergedPullRequestByHeadBranchInput,
  ) => Promise<MergedPullRequestRef | null>
  findOpenPullRequestByHeadBranch: (
    input: FindOpenPullRequestByHeadBranchInput,
  ) => Promise<null | PullRequestRef>
  getPullRequestSnapshot: (
    input: GetPullRequestSnapshotInput,
  ) => Promise<PullRequestSnapshot>
  squashMergePullRequest: (
    input: SquashMergePullRequestInput,
  ) => Promise<GitCommitTaskResult>
}

export interface CreatePullRequestInput {
  baseBranch: string
  body: string
  headBranch: string
  title: string
}

export interface FindMergedPullRequestByHeadBranchInput {
  headBranch: string
}

export interface FindOpenPullRequestByHeadBranchInput {
  headBranch: string
}

export interface GetPullRequestSnapshotInput {
  pullRequestNumber: number
}

export interface SquashMergePullRequestInput {
  pullRequestNumber: number
  subject: string
}

export interface OrchestratorRuntime {
  git: GitPort
  github: GitHubPort
  store: WorkflowStore
  taskSource: TaskSourceSession
}
