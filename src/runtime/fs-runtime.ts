import { appendFile, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  validateFinalReport,
  validateImplementArtifact,
  validateReviewArtifact,
  validateTaskGraph,
  validateVerifyArtifact,
  validateWorkflowEvent,
  validateWorkflowState,
} from '../schema/index'
import { ensureDir, readTextIfExists, writeJsonAtomic } from '../utils/fs'
import { GitRuntime } from './git'
import { createRuntimePaths } from './path-layout'
import { ProcessVerifier } from './verify-runner'

import type { OrchestratorRuntime } from '../core/runtime'
import type { TaskDefinition } from '../types'

function createArtifactDir(featureDir: string, taskId: string, generation: number, attempt: number) {
  const runtimePaths = createRuntimePaths(featureDir)
  return path.join(runtimePaths.tasksDir, taskId, `g${generation}`, `a${attempt}`)
}

async function readCodeContext(workspaceRoot: string, paths: string[]) {
  const parts: string[] = []
  for (const relativePath of paths) {
    const targetPath = path.join(workspaceRoot, relativePath)
    try {
      const content = await readFile(targetPath, 'utf8')
      parts.push(`## ${relativePath}\n${content}`)
    }
    catch {
      parts.push(`## ${relativePath}\n<missing>`)
    }
  }
  return parts.join('\n\n')
}

function buildTasksSnippet(tasksMd: string, taskId: string) {
  const lines = tasksMd.split(/\r?\n/)
  const taskHeaderPattern = new RegExp(String.raw`^- \[[ Xx]\] ${taskId}(?=\b)`)
  const taskIndex = lines.findIndex((line) => taskHeaderPattern.test(line))
  return taskIndex >= 0 ? lines.slice(taskIndex, taskIndex + 10).join('\n') : tasksMd
}

async function updateTaskCheckboxes(tasksPath: string, updates: { checked: boolean, taskId: string }[]) {
  const content = await readFile(tasksPath, 'utf8')
  const updated = updates.reduce((current, update) => {
    const pattern = new RegExp(String.raw`^- \[[ Xx]\] ${update.taskId}(?=\b)`, 'm')
    const replacement = update.checked ? `- [X] ${update.taskId}` : `- [ ] ${update.taskId}`
    return current.replace(pattern, replacement)
  }, content)
  await writeFile(tasksPath, updated)
}

export function createFsRuntime(input: { featureDir: string, workspaceRoot: string }): OrchestratorRuntime {
  const tasksPath = path.join(input.featureDir, 'tasks.md')
  const runtimePaths = createRuntimePaths(input.featureDir)

  return {
    git: new GitRuntime(input.workspaceRoot, runtimePaths.runtimeDir),
    verifier: new ProcessVerifier(input.workspaceRoot),
    store: {
      async appendEvent(event) {
        const value = validateWorkflowEvent(event)
        await ensureDir(path.dirname(runtimePaths.events))
        await appendFile(runtimePaths.events, `${JSON.stringify(value)}\n`)
      },
      async loadGraph() {
        const raw = await readTextIfExists(runtimePaths.graph)
        if (!raw) {
          return null
        }
        return validateTaskGraph(JSON.parse(raw))
      },
      async loadState() {
        const raw = await readTextIfExists(runtimePaths.state)
        if (!raw) {
          return null
        }
        return validateWorkflowState(JSON.parse(raw))
      },
      async readReport() {
        const raw = await readTextIfExists(runtimePaths.report)
        if (!raw) {
          return null
        }
        return validateFinalReport(JSON.parse(raw))
      },
      async reset() {
        await rm(runtimePaths.runtimeDir, {
          force: true,
          recursive: true,
        })
      },
      async saveGraph(graph) {
        await writeJsonAtomic(runtimePaths.graph, validateTaskGraph(graph))
      },
      async saveImplementArtifact(artifact) {
        const value = validateImplementArtifact(artifact)
        const targetPath = path.join(createArtifactDir(input.featureDir, artifact.taskId, artifact.generation, artifact.attempt), 'implement.json')
        await writeJsonAtomic(targetPath, value)
      },
      async saveReport(report) {
        await writeJsonAtomic(runtimePaths.report, validateFinalReport(report))
      },
      async saveReviewArtifact(artifact) {
        const value = validateReviewArtifact(artifact)
        const targetPath = path.join(createArtifactDir(input.featureDir, artifact.taskId, artifact.generation, artifact.attempt), 'review.json')
        await writeJsonAtomic(targetPath, value)
      },
      async saveState(state) {
        await writeJsonAtomic(runtimePaths.state, validateWorkflowState(state))
      },
      async saveVerifyArtifact(artifact) {
        const value = validateVerifyArtifact(artifact)
        const targetPath = path.join(createArtifactDir(input.featureDir, artifact.taskId, artifact.generation, artifact.attempt), 'verify.json')
        await writeJsonAtomic(targetPath, value)
      },
    },
    workspace: {
      async loadTaskContext(task: TaskDefinition) {
        const [spec, plan, tasksMd, codeContext] = await Promise.all([
          readTextIfExists(path.join(input.featureDir, 'spec.md')),
          readTextIfExists(path.join(input.featureDir, 'plan.md')),
          readTextIfExists(tasksPath),
          readCodeContext(input.workspaceRoot, task.paths),
        ])
        return {
          codeContext,
          plan,
          spec,
          tasksSnippet: buildTasksSnippet(tasksMd, task.id),
        }
      },
      async updateTaskChecks(updates) {
        await updateTaskCheckboxes(tasksPath, updates)
      },
    },
  }
}
