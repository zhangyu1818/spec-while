import { createCodexProvider } from '../agents/codex'
import { runWorkflow } from '../core/orchestrator'
import { normalizeTaskGraph } from '../core/task-normalizer'
import { createFsRuntime } from '../runtime/fs-runtime'
import { loadWorkflowConfig } from '../workflow/config'
import { createDirectWorkflowPreset } from '../workflow/preset'

import type { ImplementerProvider, ReviewerProvider, WorkflowRoleProviders } from '../agents/types'
import type { WorkspaceContext } from '../types'
import type { WorkflowConfig } from '../workflow/config'
import type { WorkflowRuntime } from '../workflow/preset'

export interface RunCommandOptions {
  untilTaskId?: string
  verbose?: boolean
}

function createCodexEventHandler(verbose: boolean | undefined) {
  if (!verbose) {
    return undefined
  }
  return (event: { item?: { type?: string }, type: string }) => {
    const itemType = 'item' in event ? event.item?.type : undefined
    process.stderr.write(`[codex] ${event.type}${itemType ? ` ${itemType}` : ''}\n`)
  }
}

function createProviderResolver(context: WorkspaceContext, verbose: boolean | undefined) {
  const cache = new Map<
    WorkflowConfig['workflow']['roles']['implementer']['provider'],
    ImplementerProvider & ReviewerProvider
  >()
  return (providerName: WorkflowConfig['workflow']['roles']['implementer']['provider']) => {
    if (providerName === 'claude') {
      throw new Error('claude provider is not available in CLI mode because no Claude adapter is configured')
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

function resolveWorkflowRuntime(
  context: WorkspaceContext,
  config: WorkflowConfig,
  options: RunCommandOptions,
): WorkflowRuntime {
  const resolveProvider = createProviderResolver(context, options.verbose)
  const roles: WorkflowRoleProviders = {
    implementer: resolveProvider(config.workflow.roles.implementer.provider),
    reviewer: resolveProvider(config.workflow.roles.reviewer.provider),
  }

  return {
    preset: createDirectWorkflowPreset({
      reviewer: roles.reviewer,
    }),
    roles,
  }
}

export interface WorkflowExecution {
  config: WorkflowConfig
  workflow: WorkflowRuntime
  execute: () => ReturnType<typeof runWorkflow>
}

export async function loadWorkflowExecution(context: WorkspaceContext, options: RunCommandOptions = {}): Promise<WorkflowExecution> {
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

export async function runCommand(context: WorkspaceContext, options: RunCommandOptions = {}) {
  const execution = await loadWorkflowExecution(context, options)
  return execution.execute()
}
