import path from 'node:path'

import { execa } from 'execa'
import * as fsExtra from 'fs-extra'

import type { WorkspaceContext } from '../types'

export interface ResolveWorkspaceContextInput {
  cwd: string
  feature?: string | undefined
  taskSource?: string | undefined
}

function resolveFeatureRoot(workspaceRoot: string, taskSource: string) {
  if (taskSource === 'openspec') {
    return path.join(workspaceRoot, 'openspec', 'changes')
  }
  return path.join(workspaceRoot, 'specs')
}

async function resolveWorkspaceRoot(cwd: string, taskSource: string) {
  const workspaceRoot = path.resolve(cwd)
  const featureRoot = resolveFeatureRoot(workspaceRoot, taskSource)
  const featureRootExists = await fsExtra.pathExists(featureRoot)
  if (!featureRootExists) {
    if (taskSource === 'openspec') {
      throw new Error(
        'Current working directory must contain an openspec/changes/ directory. Run task-while from the workspace root.',
      )
    }
    throw new Error(
      'Current working directory must contain a specs/ directory. Run task-while from the workspace root.',
    )
  }
  return workspaceRoot
}

async function readFeatureDirs(workspaceRoot: string, taskSource: string) {
  const featureRoot = resolveFeatureRoot(workspaceRoot, taskSource)
  const entries = await fsExtra.readdir(featureRoot, {
    withFileTypes: true,
  })
  return entries
    .filter((entry) => {
      if (!entry.isDirectory()) {
        return false
      }
      if (taskSource === 'openspec' && entry.name === 'archive') {
        return false
      }
      return true
    })
    .map((entry) => entry.name)
}

async function detectGitBranch(workspaceRoot: string) {
  try {
    const { stdout } = await execa(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      {
        cwd: workspaceRoot,
      },
    )
    return stdout.trim()
  } catch {
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

export async function resolveWorkspaceContext(
  input: ResolveWorkspaceContextInput,
): Promise<WorkspaceContext> {
  const taskSource = input.taskSource ?? 'spec-kit'
  const workspaceRoot = await resolveWorkspaceRoot(input.cwd, taskSource)

  const featureDirs = await readFeatureDirs(workspaceRoot, taskSource)
  let featureId = input.feature ?? null

  if (!featureId && taskSource === 'spec-kit') {
    const branch = await detectGitBranch(workspaceRoot)
    if (branch) {
      featureId = matchFeatureByPrefix(featureDirs, branch)
    }
  }

  if (!featureId) {
    if (featureDirs.length === 1) {
      featureId = featureDirs[0] ?? null
    } else {
      throw new Error('Unable to determine feature. Pass --feature explicitly.')
    }
  }

  if (!featureId) {
    throw new Error('Unable to determine feature. Pass --feature explicitly.')
  }

  const featureDir = path.join(
    resolveFeatureRoot(workspaceRoot, taskSource),
    featureId,
  )
  const featureExists = await fsExtra.pathExists(featureDir)
  if (!featureExists) {
    if (taskSource === 'openspec') {
      throw new Error(`OpenSpec change directory does not exist: ${featureId}`)
    }
    throw new Error(`Feature directory does not exist: ${featureId}`)
  }
  return {
    featureDir,
    featureId,
    runtimeDir: path.join(featureDir, '.while'),
    workspaceRoot,
  }
}
