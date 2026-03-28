import { readFile } from 'node:fs/promises'
import path from 'node:path'

import Ajv from 'ajv'
import * as fsExtra from 'fs-extra'
import { z } from 'zod'

import { loadBatchConfig, type BatchConfig } from '../batch/config'
import { createBatchStructuredOutputProvider } from '../batch/provider'
import { parseWithSchema, uniqueStringArray } from '../schema/shared'
import { writeJsonAtomic } from '../utils/fs'

const batchStateSchema = z
  .object({
    failed: uniqueStringArray('failed'),
    inProgress: uniqueStringArray('inProgress'),
    pending: uniqueStringArray('pending'),
  })
  .strict()

const batchResultsSchema = z.custom<Record<string, unknown>>(
  (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
  {
    message: 'results must be an object',
  },
)

export interface BatchState {
  failed: string[]
  inProgress: string[]
  pending: string[]
}

export interface RunBatchCommandInput {
  configPath: string
  cwd?: string
  verbose?: boolean
}

export interface RunBatchCommandResult {
  config: BatchConfig
  failedFiles: string[]
  processedFiles: string[]
  results: Record<string, unknown>
  state: BatchState
}

function createEmptyState(): BatchState {
  return {
    failed: [],
    inProgress: [],
    pending: [],
  }
}

function normalizeRelativePath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

function unique(items: string[]) {
  return [...new Set(items)]
}

async function readJsonFileIfExists(filePath: string) {
  const exists = await fsExtra.pathExists(filePath)
  if (!exists) {
    return null
  }
  const raw = await readFile(filePath, 'utf8')
  const value: unknown = JSON.parse(raw)
  return value
}

async function loadBatchState(filePath: string) {
  const value = await readJsonFileIfExists(filePath)
  if (value === null) {
    return createEmptyState()
  }
  return parseWithSchema(batchStateSchema, value)
}

async function loadBatchResults(filePath: string) {
  const value = await readJsonFileIfExists(filePath)
  if (value === null) {
    return {}
  }
  return parseWithSchema(batchResultsSchema, value)
}

async function discoverFiles(
  workdir: string,
  excludedFiles: Set<string>,
  currentDir = workdir,
): Promise<string[]> {
  const entries = await fsExtra.readdir(currentDir, {
    withFileTypes: true,
  })
  const filePaths: string[] = []

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue
    }
    const absolutePath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      filePaths.push(
        ...(await discoverFiles(workdir, excludedFiles, absolutePath)),
      )
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    if (excludedFiles.has(absolutePath)) {
      continue
    }
    filePaths.push(normalizeRelativePath(path.relative(workdir, absolutePath)))
  }

  return filePaths
}

function mergeBatchState(input: {
  discoveredFiles: string[]
  results: Record<string, unknown>
  state: BatchState
}): BatchState {
  const discovered = new Set(input.discoveredFiles)
  const completed = new Set(Object.keys(input.results))
  const failed = unique(input.state.failed).filter(
    (filePath) => discovered.has(filePath) && !completed.has(filePath),
  )
  const failedSet = new Set(failed)
  const pending = unique([
    ...input.state.inProgress,
    ...input.state.pending,
  ]).filter(
    (filePath) =>
      discovered.has(filePath) &&
      !completed.has(filePath) &&
      !failedSet.has(filePath),
  )
  const pendingSet = new Set(pending)

  for (const filePath of input.discoveredFiles) {
    if (
      completed.has(filePath) ||
      failedSet.has(filePath) ||
      pendingSet.has(filePath)
    ) {
      continue
    }
    pending.push(filePath)
    pendingSet.add(filePath)
  }

  return {
    failed,
    inProgress: [],
    pending,
  }
}

function removeFile(items: string[], filePath: string) {
  return items.filter((item) => item !== filePath)
}

function writeBatchFailure(filePath: string, error: unknown) {
  process.stderr.write(
    `[batch] failed ${filePath}: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  )
}

async function recycleFailedFiles(
  statePath: string,
  state: BatchState,
): Promise<BatchState> {
  if (state.pending.length !== 0 || state.failed.length === 0) {
    return state
  }

  const nextState: BatchState = {
    failed: [],
    inProgress: [],
    pending: [...state.failed],
  }
  await writeJsonAtomic(statePath, nextState)
  return nextState
}

export async function runBatchCommand(
  input: RunBatchCommandInput,
): Promise<RunBatchCommandResult> {
  const cwd = input.cwd ?? process.cwd()
  const config = await loadBatchConfig({
    configPath: input.configPath,
    cwd,
  })

  const workdirExists = await fsExtra.pathExists(config.workdir)
  if (!workdirExists) {
    throw new Error(`Batch workdir does not exist: ${config.workdir}`)
  }

  const statePath = path.join(config.outputDir, 'state.json')
  const resultsPath = path.join(config.outputDir, 'results.json')
  const excludedFiles = new Set([config.configPath, statePath, resultsPath])
  const discoveredFiles = await discoverFiles(config.workdir, excludedFiles)
  const results = await loadBatchResults(resultsPath)
  let state: BatchState = mergeBatchState({
    discoveredFiles,
    results,
    state: await loadBatchState(statePath),
  })
  await writeJsonAtomic(statePath, state)
  await writeJsonAtomic(resultsPath, results)

  const provider = createBatchStructuredOutputProvider({
    provider: config.provider,
    workspaceRoot: config.workdir,
  })
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
  })
  const validateOutput = ajv.compile(config.schema)
  const processedFiles: string[] = []

  while (state.pending.length !== 0 || state.failed.length !== 0) {
    if (state.pending.length === 0) {
      state = await recycleFailedFiles(statePath, state)
      continue
    }
    const filePath = state.pending[0]!
    state = {
      ...state,
      inProgress: unique([...state.inProgress, filePath]),
      pending: state.pending.slice(1),
    }
    await writeJsonAtomic(statePath, state)

    try {
      const absoluteFilePath = path.join(config.workdir, filePath)
      const content = await readFile(absoluteFilePath, 'utf8')
      const output = await provider.runFile({
        absoluteFilePath,
        content,
        filePath,
        outputSchema: config.schema,
        prompt: config.prompt,
        workdir: config.workdir,
      })
      if (!validateOutput(output)) {
        throw new Error(ajv.errorsText(validateOutput.errors))
      }
      results[filePath] = output
      await writeJsonAtomic(resultsPath, results)
      state = {
        ...state,
        inProgress: removeFile(state.inProgress, filePath),
      }
      await writeJsonAtomic(statePath, state)
      processedFiles.push(filePath)
    } catch (error) {
      if (input.verbose) {
        writeBatchFailure(filePath, error)
      }
      state = {
        failed: unique([...state.failed, filePath]),
        inProgress: removeFile(state.inProgress, filePath),
        pending: state.pending,
      }
      await writeJsonAtomic(statePath, state)
    }
  }

  return {
    config,
    failedFiles: state.failed,
    processedFiles,
    results,
    state,
  }
}
