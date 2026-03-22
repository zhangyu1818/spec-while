import { CodexAgentClient } from '../agents/codex'
import { runWorkflow } from '../core/orchestrator'
import { normalizeTaskGraph } from '../core/task-normalizer'
import { createFsRuntime } from '../runtime/fs-runtime'

import type { AgentClient } from '../agents/types'
import type { WorkspaceContext } from '../types'

export interface RunCommandOptions {
  agent?: AgentClient
  untilTaskId?: string
  verbose?: boolean
}

function createDefaultAgent(context: WorkspaceContext, verbose: boolean | undefined) {
  return new CodexAgentClient({
    ...(verbose
      ? {
          onEvent(event) {
            const itemType = 'item' in event ? event.item.type : undefined
            process.stderr.write(`[codex] ${event.type}${itemType ? ` ${itemType}` : ''}\n`)
          },
        }
      : {}),
    workspaceRoot: context.workspaceRoot,
  })
}

export async function runCommand(context: WorkspaceContext, options: RunCommandOptions = {}) {
  const runtime = createFsRuntime({
    featureDir: context.featureDir,
    workspaceRoot: context.workspaceRoot,
  })
  await runtime.git.requireCleanWorktree()
  const graph = await normalizeTaskGraph({
    featureDir: context.featureDir,
    tasksPath: context.tasksPath,
  })
  return runWorkflow({
    agent: options.agent ?? createDefaultAgent(context, options.verbose),
    graph,
    runtime,
    ...(options.untilTaskId ? { untilTaskId: options.untilTaskId } : {}),
  })
}
