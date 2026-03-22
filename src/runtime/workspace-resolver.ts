import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import type { WorkspaceContext } from '../types'

const execFileAsync = promisify(execFile)

export interface ResolveWorkspaceContextInput {
  cwd: string
  env?: NodeJS.ProcessEnv | undefined
  feature?: string | undefined
  workspace?: string | undefined
}

async function exists(targetPath: string) {
  try {
    await access(targetPath, constants.F_OK)
    return true
  }
  catch {
    return false
  }
}

async function findWorkspaceRoot(startDir: string) {
  let current = path.resolve(startDir)
  for (;;) {
    if (await exists(path.join(current, 'specs'))) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) {
      throw new Error('Unable to locate a Spec Kit workspace from current directory')
    }
    current = parent
  }
}

async function readFeatureDirs(workspaceRoot: string) {
  const specsDir = path.join(workspaceRoot, 'specs')
  const entries = await readdir(specsDir, {
    withFileTypes: true,
  })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

async function detectGitBranch(workspaceRoot: string) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspaceRoot,
    })
    return stdout.trim()
  }
  catch {
    return null
  }
}

function matchFeatureByPrefix(featureDirs: string[], branch: string) {
  const prefixMatch = branch.match(/^(\d{3}|\d{8}-\d{6})-/)
  const prefix = prefixMatch?.[1]
  if (!prefix) {
    return null
  }
  return featureDirs.find((feature) => feature.startsWith(`${prefix}-`)) ?? null
}

export async function resolveWorkspaceContext(input: ResolveWorkspaceContextInput): Promise<WorkspaceContext> {
  const workspaceRoot = input.workspace
    ? path.resolve(input.workspace)
    : await findWorkspaceRoot(input.cwd)

  const featureDirs = await readFeatureDirs(workspaceRoot)
  const env = input.env ?? process.env

  let featureId = input.feature
    ?? env.SPECIFY_FEATURE
    ?? null

  if (!featureId) {
    const branch = await detectGitBranch(workspaceRoot)
    if (branch) {
      featureId = matchFeatureByPrefix(featureDirs, branch)
    }
  }

  if (!featureId) {
    if (featureDirs.length === 1) {
      featureId = featureDirs[0] ?? null
    }
    else {
      throw new Error('Unable to determine feature. Pass --feature explicitly.')
    }
  }

  if (!featureId) {
    throw new Error('Unable to determine feature. Pass --feature explicitly.')
  }

  const featureDir = path.join(workspaceRoot, 'specs', featureId)
  return {
    featureDir,
    featureId,
    planPath: path.join(featureDir, 'plan.md'),
    runtimeDir: path.join(featureDir, '.while'),
    specPath: path.join(featureDir, 'spec.md'),
    tasksPath: path.join(featureDir, 'tasks.md'),
    workspaceRoot,
  }
}
