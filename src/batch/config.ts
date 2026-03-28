import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'
import { z } from 'zod'

export const batchProviderSchema = z.enum(['claude', 'codex'])

const jsonSchemaSchema = z.custom<Record<string, unknown>>(
  (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  {
    message: 'schema must be an object',
  },
)

const batchConfigSchema = z
  .object({
    prompt: z.string().trim().min(1),
    provider: batchProviderSchema,
    schema: jsonSchemaSchema,
    workdir: z.string().trim().min(1).optional(),
  })
  .strict()

export type BatchProviderName = z.infer<typeof batchProviderSchema>

export interface BatchConfig {
  configPath: string
  outputDir: string
  prompt: string
  provider: BatchProviderName
  schema: Record<string, unknown>
  workdir: string
}

export interface LoadBatchConfigInput {
  configPath: string
  cwd: string
}

export async function loadBatchConfig(
  input: LoadBatchConfigInput,
): Promise<BatchConfig> {
  const configPath = path.resolve(input.cwd, input.configPath)
  const configSource = await readFile(configPath, 'utf8')
  const rawConfig = parse(configSource) ?? {}
  const parsedConfig = batchConfigSchema.parse(rawConfig)
  const outputDir = path.dirname(configPath)
  const workdir = parsedConfig.workdir
    ? path.resolve(outputDir, parsedConfig.workdir)
    : path.resolve(input.cwd)

  return {
    configPath,
    outputDir,
    prompt: parsedConfig.prompt,
    provider: parsedConfig.provider,
    schema: parsedConfig.schema,
    workdir,
  }
}
