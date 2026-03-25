import { createCodexProvider } from '../agents/codex'
import { runWorkflow } from '../core/orchestrator'
import { normalizeTaskGraph } from '../core/task-normalizer'
import { createFsRuntime } from '../runtime/fs-runtime'
import { loadWorkflowConfig, type WorkflowConfig } from '../workflow/config'
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
  untilTaskId?: string
  verbose?: boolean
}

function writeCodexEvent(event: { item?: { type?: string }; type: string }) {
  process.stderr.write(
    `[codex] ${event.type}${event.item?.type ? ` ${event.item.type}` : ''}\n`,
  )
}

function createCodexEventHandler(verbose: boolean | undefined) {
  if (!verbose) {
    return undefined
  }
  return writeCodexEvent
}

function createProviderResolver(
  context: WorkspaceContext,
  verbose: boolean | undefined,
) {
  const cache = new Map<
    WorkflowConfig['workflow']['roles']['implementer']['provider'],
    ImplementerProvider & ReviewerProvider
  >()
  return (
    providerName: WorkflowConfig['workflow']['roles']['implementer']['provider'],
  ) => {
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

function createRemoteReviewerResolver() {
  const cache = new Map<
    WorkflowConfig['workflow']['roles']['reviewer']['provider'],
    RemoteReviewerProvider
  >()
  return (
    providerName: WorkflowConfig['workflow']['roles']['reviewer']['provider'],
  ) => {
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
  context: WorkspaceContext,
  config: WorkflowConfig,
  options: RunCommandOptions,
): WorkflowRuntime {
  const resolveProvider = createProviderResolver(context, options.verbose)
  const implementer = resolveProvider(
    config.workflow.roles.implementer.provider,
  )

  if (config.workflow.mode === 'pull-request') {
    const resolveRemoteReviewer = createRemoteReviewerResolver()
    const reviewer = resolveRemoteReviewer(
      config.workflow.roles.reviewer.provider,
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

  const reviewer = resolveProvider(config.workflow.roles.reviewer.provider)
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

export interface WorkflowExecution {
  config: WorkflowConfig
  execute: () => ReturnType<typeof runWorkflow>
  workflow: WorkflowRuntime
}

export async function loadWorkflowExecution(
  context: WorkspaceContext,
  options: RunCommandOptions = {},
): Promise<WorkflowExecution> {
  const config = await loadWorkflowConfig(context.workspaceRoot)
  const workflow = resolveWorkflowRuntime(context, config, options)
  const runtime = createFsRuntime({
    featureDir: context.featureDir,
    workspaceRoot: context.workspaceRoot,
  })
  await runtime.git.requireCleanWorktree()
  const graph = await normalizeTaskGraph({
    featureDir: context.featureDir,
    tasksPath: context.tasksPath,
  })
  const workflowInput = {
    graph,
    runtime,
    workflow,
    ...(options.untilTaskId ? { untilTaskId: options.untilTaskId } : {}),
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
