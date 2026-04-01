import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import * as fsExtra from 'fs-extra'

import type {
  OpenTaskSourceInput,
  TaskPrompt,
  TaskSourceSession,
} from '../types'
import type { SpecKitTask } from './parse-tasks-md'

async function readRequiredTextFile(filePath: string) {
  const exists = await fsExtra.pathExists(filePath)
  if (!exists) {
    throw new Error(`Missing required feature file: ${filePath}`)
  }
  return readFile(filePath, 'utf8')
}

function isTaskChecked(tasksMd: string, taskId: string) {
  const pattern = new RegExp(String.raw`^- \[[Xx]\] ${taskId}(?=\b)`, 'm')
  return pattern.test(tasksMd)
}

async function updateTaskCheckbox(
  tasksPath: string,
  taskHandle: string,
  checked: boolean,
) {
  const content = await readFile(tasksPath, 'utf8')
  const pattern = new RegExp(String.raw`^- \[[ Xx]\] ${taskHandle}(?=\b)`, 'm')
  const replacement = checked ? `- [X] ${taskHandle}` : `- [ ] ${taskHandle}`
  await writeFile(tasksPath, content.replace(pattern, replacement))
}

function createImplementPrompt(
  task: SpecKitTask,
  input: {
    plan: string
    spec: string
    tasks: string
  },
): TaskPrompt {
  return {
    instructions: [
      'Implement only the current task.',
      'Use the provided source documents as the source of truth.',
      'Modify only the files that are reasonably required for the current task.',
      'Do not modify tasks.md.',
      'Do not move to the next task.',
      'Do not declare the task finalized.',
      'Return structured output only.',
    ],
    sections: [
      { content: task.rawLine, title: 'Task' },
      { content: task.phase, title: 'Phase' },
      { content: input.spec, title: 'Spec' },
      { content: input.plan, title: 'Plan' },
      { content: input.tasks, title: 'Tasks' },
    ],
  }
}

function createReviewPrompt(
  task: SpecKitTask,
  input: {
    plan: string
    spec: string
    tasks: string
  },
): TaskPrompt {
  return {
    instructions: [
      'Review only the current task.',
      'Use the provided source documents to judge whether the task matches the intended implementation.',
      'Evaluate the task description, source documents, actual changed files, and overall risk.',
      'Only return verdict "pass" when the current task is satisfied by the implementation.',
      'acceptanceChecks must stay consistent with the current task description.',
      'Do not expand the review to unrelated files or repository-wide history.',
    ],
    sections: [
      { content: task.rawLine, title: 'Task' },
      { content: task.phase, title: 'Phase' },
      { content: input.spec, title: 'Spec' },
      { content: input.plan, title: 'Plan' },
      { content: input.tasks, title: 'Tasks' },
    ],
  }
}

export interface CreateSpecKitSessionInput extends OpenTaskSourceInput {
  tasks: SpecKitTask[]
}

export function createSpecKitSession(
  input: CreateSpecKitSessionInput,
): TaskSourceSession {
  const tasksPath = path.join(input.featureDir, 'tasks.md')
  const planPath = path.join(input.featureDir, 'plan.md')
  const specPath = path.join(input.featureDir, 'spec.md')
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]))

  const getTask = (taskHandle: string) => {
    const task = tasksById.get(taskHandle)
    if (!task) {
      throw new Error(`Unknown task selector: ${taskHandle}`)
    }
    return task
  }

  const loadSharedDocs = async () => {
    const [plan, spec, tasks] = await Promise.all([
      readRequiredTextFile(planPath),
      readRequiredTextFile(specPath),
      readRequiredTextFile(tasksPath),
    ])
    return {
      plan,
      spec,
      tasks,
    }
  }

  return {
    async applyTaskCompletion(taskHandle: string) {
      if (await this.isTaskCompleted(taskHandle)) {
        return
      }
      await updateTaskCheckbox(tasksPath, taskHandle, true)
    },
    buildCommitSubject(taskHandle: string) {
      const task = getTask(taskHandle)
      return `Task ${task.id}: ${task.title}`
    },
    async buildImplementPrompt(args) {
      const task = getTask(args.taskHandle)
      const docs = await loadSharedDocs()
      return createImplementPrompt(task, docs)
    },
    async buildReviewPrompt(args) {
      const task = getTask(args.taskHandle)
      const docs = await loadSharedDocs()
      void args
      return createReviewPrompt(task, docs)
    },
    async getCompletionCriteria(taskHandle: string) {
      return [getTask(taskHandle).title]
    },
    getTaskDependencies(taskHandle: string) {
      void taskHandle
      return []
    },
    async isTaskCompleted(taskHandle: string) {
      const tasksMd = await readRequiredTextFile(tasksPath)
      return isTaskChecked(tasksMd, taskHandle)
    },
    listTasks() {
      return input.tasks.map((task) => task.id)
    },
    resolveTaskSelector(selector: string) {
      if (!tasksById.has(selector)) {
        throw new Error(`Unknown task selector: ${selector}`)
      }
      return selector
    },
    async revertTaskCompletion(taskHandle: string) {
      if (!(await this.isTaskCompleted(taskHandle))) {
        return
      }
      await updateTaskCheckbox(tasksPath, taskHandle, false)
    },
  }
}
