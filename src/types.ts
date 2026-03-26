export type {
  AcceptanceCheck,
  FinalReport,
  FinalReportTask,
  ImplementArtifact,
  ImplementOutput,
  IntegrateArtifact,
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
  WorkflowEvent,
  WorkflowEventType,
  WorkflowState,
} from './schema/index'

export interface TaskContext {
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
