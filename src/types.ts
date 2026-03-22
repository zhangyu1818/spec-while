export type {
  AcceptanceCheck,
  FinalReport,
  FinalReportTask,
  ImplementArtifact,
  ImplementOutput,
  PendingTaskState,
  ReviewArtifact,
  ReviewFinding,
  ReviewOutput,
  ReviewVerdict,
  RunningStage,
  RunningTaskState,
  TaskDefinition,
  TaskGraph,
  TaskState,
  TaskStatus,
  VerifyArtifact,
  VerifyCommandResult,
  VerifyResult,
  WorkflowEvent,
  WorkflowEventType,
  WorkflowState,
} from './schema/index'

export interface TaskContext {
  codeContext: string
  plan: string
  spec: string
  tasksSnippet: string
}

export interface WorkspaceContext {
  featureDir: string
  featureId: string
  planPath: string
  runtimeDir: string
  specPath: string
  tasksPath: string
  workspaceRoot: string
}
