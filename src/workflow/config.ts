import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'
import { z } from 'zod'

const workflowProviderSchema = z.enum(['claude', 'codex'])
const workflowModeSchema = z.enum(['direct', 'pull-request'])

const workflowRoleSchema = z
  .object({
    provider: workflowProviderSchema.default('codex'),
  })
  .strict()

const workflowRolesSchema = z
  .object({
    implementer: workflowRoleSchema.default({}),
    reviewer: workflowRoleSchema.default({}),
  })
  .strict()

const workflowConfigSchema = z
  .object({
    workflow: z
      .object({
        mode: workflowModeSchema.default('direct'),
        roles: workflowRolesSchema.default({}),
      })
      .strict()
      .default({}),
  })
  .strict()
  .default({})

export type WorkflowProvider = z.infer<typeof workflowProviderSchema>

export interface WorkflowConfig {
  workflow: {
    mode: 'direct'
    roles: {
      implementer: {
        provider: WorkflowProvider
      }
      reviewer: {
        provider: WorkflowProvider
      }
    }
  }
}

export async function loadWorkflowConfig(
  workspaceRoot: string,
): Promise<WorkflowConfig> {
  const configPath = path.join(workspaceRoot, 'while.yaml')
  let rawConfig: unknown = {}

  try {
    rawConfig = parse(await readFile(configPath, 'utf8')) ?? {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const parsedConfig = workflowConfigSchema.parse(rawConfig)
  if (parsedConfig.workflow.mode === 'pull-request') {
    throw new Error(
      'workflow.mode "pull-request" is not supported in this version',
    )
  }

  return {
    workflow: {
      mode: 'direct',
      roles: parsedConfig.workflow.roles,
    },
  }
}
