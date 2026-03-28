import {
  createCodexProvider,
  type CodexThreadEvent,
  type CodexThreadEventHandler,
} from '../agents/codex'
import { runWorkflow, type WorkflowRunResult } from '../core/orchestrator'
import { buildTaskTopology } from '../core/task-topology'
import { createOrchestratorRuntime } from '../runtime/fs-runtime'
import { openTaskSource } from '../task-sources/registry'
import {
  loadWorkflowConfig,
  type WorkflowConfig,
  type WorkflowProvider,
} from '../workflow/config'
import {
  createDirectWorkflowPreset,
  createPullRequestWorkflowPreset,
  type WorkflowRuntime,
} from '../workflow/preset'
import { createCodexRemoteReviewerProvider } from '../workflow/remote-reviewer'

import type {
  ImplementerProvider,
  RemoteReviewerProvider,
  ReviewerProvider,
  WorkflowRoleProviders,
} from '../agents/types'
import type { WorkspaceContext } from '../types'

export interface RunCommandOptions {
  config?: WorkflowConfig
  untilTaskId?: string
  verbose?: boolean
}

export type WorkflowExecutionRunner = () => Promise<WorkflowRunResult>

export interface WorkflowExecution {
  config: WorkflowConfig
  execute: WorkflowExecutionRunner
  workflow: WorkflowRuntime
}

export interface ResolveWorkflowRuntimeInput {
  config: WorkflowConfig
  context: WorkspaceContext
  options: RunCommandOptions
}

export type ProviderResolver = (
  providerName: WorkflowProvider,
) => ImplementerProvider & ReviewerProvider

export type RemoteReviewerResolver = (
  providerName: WorkflowProvider,
) => RemoteReviewerProvider

function writeCodexEvent(event: CodexThreadEvent) {
  const itemType =
    event.type === 'item.completed' ||
    event.type === 'item.started' ||
    event.type === 'item.updated'
      ? event.item.type
      : null
  process.stderr.write(
    `[codex] ${event.type}${itemType ? ` ${itemType}` : ''}\n`,
  )
  if (
    event.type === 'item.completed' &&
    event.item.type === 'agent_message' &&
    event.item.text?.trim()
  ) {
    process.stderr.write(`[codex] message ${event.item.text.trim()}\n`)
  }
  if (event.type === 'error') {
    process.stderr.write(`[codex] error ${event.message}\n`)
  }
  if (event.type === 'turn.failed') {
    process.stderr.write(`[codex] error ${event.error.message}\n`)
  }
}

function createCodexEventHandler(
  verbose: boolean | undefined,
): CodexThreadEventHandler | undefined {
  if (!verbose) {
    return undefined
  }
  return writeCodexEvent
}

function createProviderResolver(
  context: WorkspaceContext,
  verbose: boolean | undefined,
): ProviderResolver {
  const cache = new Map<
    WorkflowProvider,
    ImplementerProvider & ReviewerProvider
  >()
  return (providerName: WorkflowProvider) => {
    if (providerName === 'claude') {
      throw new Error(
        'claude provider is not available in CLI mode because no Claude adapter is configured',
      )
    }
    const cached = cache.get(providerName)
    if (cached) {
      return cached
    }
    const codexEventHandler = createCodexEventHandler(verbose)
    const provider = createCodexProvider({
      ...(codexEventHandler
        ? {
            onEvent: codexEventHandler,
          }
        : {}),
      workspaceRoot: context.workspaceRoot,
    })
    cache.set(providerName, provider)
    return provider
  }
}

function createRemoteReviewerResolver(): RemoteReviewerResolver {
  const cache = new Map<WorkflowProvider, RemoteReviewerProvider>()
  return (providerName: WorkflowProvider) => {
    const cached = cache.get(providerName)
    if (cached) {
      return cached
    }
    if (providerName === 'claude') {
      throw new Error(
        'claude remote reviewer is not implemented in pull-request mode',
      )
    }
    const provider = createCodexRemoteReviewerProvider()
    cache.set(providerName, provider)
    return provider
  }
}

function resolveWorkflowRuntime(
  input: ResolveWorkflowRuntimeInput,
): WorkflowRuntime {
  const resolveProvider = createProviderResolver(
    input.context,
    input.options.verbose,
  )
  const implementer = resolveProvider(
    input.config.workflow.roles.implementer.provider,
  )

  if (input.config.workflow.mode === 'pull-request') {
    const resolveRemoteReviewer = createRemoteReviewerResolver()
    const reviewer = resolveRemoteReviewer(
      input.config.workflow.roles.reviewer.provider,
    )
    const roles: WorkflowRoleProviders = {
      implementer,
      reviewer,
    }

    return {
      roles,
      preset: createPullRequestWorkflowPreset({
        reviewer,
      }),
    }
  }

  const reviewer = resolveProvider(
    input.config.workflow.roles.reviewer.provider,
  )
  const roles: WorkflowRoleProviders = {
    implementer,
    reviewer,
  }

  return {
    roles,
    preset: createDirectWorkflowPreset({
      reviewer,
    }),
  }
}

export async function loadWorkflowExecution(
  context: WorkspaceContext,
  options: RunCommandOptions = {},
): Promise<WorkflowExecution> {
  const config =
    options.config ?? (await loadWorkflowConfig(context.workspaceRoot))
  const workflow = resolveWorkflowRuntime({
    config,
    context,
    options,
  })
  const taskSource = await openTaskSource(config.task.source, {
    featureDir: context.featureDir,
    featureId: context.featureId,
    workspaceRoot: context.workspaceRoot,
  })
  const runtime = createOrchestratorRuntime({
    featureDir: context.featureDir,
    taskSource,
    workspaceRoot: context.workspaceRoot,
  })
  await runtime.git.requireCleanWorktree()
  const graph = buildTaskTopology(
    taskSource,
    context.featureId,
    config.task.maxIterations,
  )
  const untilTaskHandle = options.untilTaskId
    ? taskSource.resolveTaskSelector(options.untilTaskId)
    : undefined
  const workflowInput = {
    graph,
    runtime,
    workflow,
    ...(untilTaskHandle ? { untilTaskHandle } : {}),
  }

  return {
    config,
    workflow,
    async execute() {
      return runWorkflow(workflowInput)
    },
  }
}

export async function runCommand(
  context: WorkspaceContext,
  options: RunCommandOptions = {},
) {
  const execution = await loadWorkflowExecution(context, options)
  return execution.execute()
}
