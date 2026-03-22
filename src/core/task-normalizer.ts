import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { validateTaskGraph } from '../schema/index'

import type { TaskDefinition, TaskGraph } from '../types'

export interface NormalizeTaskGraphInput {
  featureDir: string
  tasksPath: string
}

function createTask(line: string, phase: string): TaskDefinition {
  const match = line.match(/^- \[[ xX]\] (T\d{3,})(?: \[P\])?(?: \[(US\d+)\])? (.+)$/)
  if (!match) {
    throw new Error(`Invalid task line: ${line}`)
  }
  return {
    id: match[1]!,
    acceptance: [],
    dependsOn: [],
    maxAttempts: 0,
    parallelizable: line.includes(' [P] '),
    paths: [],
    phase,
    reviewRubric: [],
    storyId: match[2] ?? null,
    title: match[3]!,
    verifyCommands: [],
  }
}

function splitList(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function ensureTaskField(task: TaskDefinition, field: keyof Pick<TaskDefinition, 'acceptance' | 'paths' | 'reviewRubric' | 'verifyCommands'>, label: string) {
  if (task[field].length === 0) {
    throw new Error(`${task.id} is missing ${label}`)
  }
}

function ensureUniqueTaskIds(tasks: TaskDefinition[]) {
  const ids = new Set<string>()
  for (const task of tasks) {
    if (ids.has(task.id)) {
      throw new Error(`Duplicate task id: ${task.id}`)
    }
    ids.add(task.id)
  }
}

function ensureDependsExist(tasks: TaskDefinition[]) {
  const ids = new Set(tasks.map((task) => task.id))
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) {
        throw new Error(`${task.id} depends on unknown task ${dependency}`)
      }
    }
  }
}

function ensureNoCycles(tasks: TaskDefinition[]) {
  const graph = new Map(tasks.map((task) => [task.id, task.dependsOn]))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(taskId: string) {
    if (visiting.has(taskId)) {
      throw new Error(`Dependency cycle detected at ${taskId}`)
    }
    if (visited.has(taskId)) {
      return
    }
    visiting.add(taskId)
    for (const dependency of graph.get(taskId) ?? []) {
      visit(dependency)
    }
    visiting.delete(taskId)
    visited.add(taskId)
  }

  for (const task of tasks) {
    visit(task.id)
  }
}

function parseFieldLine(line: string) {
  if (!line.startsWith('  - ')) {
    return null
  }
  const separatorIndex = line.indexOf(':', 4)
  if (separatorIndex < 0) {
    return null
  }
  return {
    label: line.slice(4, separatorIndex).trim(),
    value: line.slice(separatorIndex + 1).trim(),
  }
}

export async function normalizeTaskGraph(input: NormalizeTaskGraphInput): Promise<TaskGraph> {
  const content = await readFile(input.tasksPath, 'utf8')
  const lines = content.split(/\r?\n/)
  const tasks: TaskDefinition[] = []
  let currentPhase = 'unknown'
  let currentTask: null | TaskDefinition = null
  let currentList: 'acceptance' | 'reviewRubric' | 'verifyCommands' | null = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.startsWith('## ')) {
      currentPhase = line.replace(/^##\s+/, '').trim()
      currentTask = null
      currentList = null
      continue
    }

    if (line.startsWith('- [') && line.includes(' T')) {
      currentTask = createTask(line, currentPhase)
      tasks.push(currentTask)
      currentList = null
      continue
    }

    if (!currentTask) {
      continue
    }

    const field = parseFieldLine(line)
    if (field) {
      currentList = null

      if (field.label === 'Goal' && field.value) {
        currentTask.goal = field.value
      }
      else if (field.label === 'Paths') {
        currentTask.paths = splitList(field.value)
      }
      else if (field.label === 'Depends') {
        currentTask.dependsOn = splitList(field.value)
      }
      else if (field.label === 'Acceptance') {
        currentTask.acceptance = field.value ? [field.value] : []
        currentList = 'acceptance'
      }
      else if (field.label === 'Verify') {
        currentTask.verifyCommands = field.value ? [field.value] : []
        currentList = 'verifyCommands'
      }
      else if (field.label === 'Review Rubric') {
        currentTask.reviewRubric = field.value ? [field.value] : []
        currentList = 'reviewRubric'
      }
      else if (field.label === 'Max Iterations' || field.label === 'Max Attempts') {
        currentTask.maxAttempts = Number(field.value)
      }
      continue
    }

    const listItemMatch = line.match(/^ {4}- (.+)$/)
    if (listItemMatch && currentList) {
      currentTask[currentList].push(listItemMatch[1]!.trim())
    }
  }

  if (tasks.length === 0) {
    throw new Error('No tasks found in tasks.md')
  }

  for (const task of tasks) {
    ensureTaskField(task, 'paths', 'Paths')
    ensureTaskField(task, 'acceptance', 'Acceptance')
    ensureTaskField(task, 'reviewRubric', 'Review Rubric')
    if (!Number.isInteger(task.maxAttempts) || task.maxAttempts < 1) {
      throw new Error(`${task.id} has invalid Max Iterations`)
    }
    task.paths = task.paths.map((item) => item.replaceAll(path.sep, '/'))
    task.dependsOn = task.dependsOn.filter(Boolean)
  }

  ensureUniqueTaskIds(tasks)
  ensureDependsExist(tasks)
  ensureNoCycles(tasks)

  return validateTaskGraph({
    featureId: path.basename(input.featureDir),
    tasks,
    version: 2,
    source: {
      plan: path.join(input.featureDir, 'plan.md'),
      spec: path.join(input.featureDir, 'spec.md'),
      tasksMd: input.tasksPath,
    },
  })
}
