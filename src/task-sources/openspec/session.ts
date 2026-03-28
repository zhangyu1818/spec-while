import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { readOpenSpecApplyInstructions } from './cli-json'
import { readContextFileMap } from './context-files'

import type {
  OpenTaskSourceInput,
  TaskPrompt,
  TaskSourceSession,
} from '../types'
import type { OpenSpecTask } from './parse-tasks-md'

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function createImplementPrompt(
  task: OpenSpecTask,
  input: {
    apply: Awaited<ReturnType<typeof readOpenSpecApplyInstructions>>
    context: Map<string, string>
    featureId: string
  },
): TaskPrompt {
  return {
    instructions: [
      'Implement only the current task from the OpenSpec change.',
      'Use the OpenSpec apply instruction as the execution contract.',
      input.apply.instruction,
      'Do not mark tasks.md complete; while will apply completion after review/integrate.',
      'Do not move to the next task.',
      'Return structured output only.',
    ],
    sections: [
      { content: input.featureId, title: 'Change' },
      { content: input.apply.schemaName, title: 'Schema' },
      { content: input.apply.state, title: 'Apply State' },
      {
        content: `${input.apply.progress.complete}/${input.apply.progress.total} complete`,
        title: 'Apply Progress',
      },
      { content: task.rawLine, title: 'Current Task' },
      { content: task.sectionTitle, title: 'Task Group' },
      { content: input.context.get('proposal') ?? '', title: 'Proposal' },
      { content: input.context.get('design') ?? '', title: 'Design' },
      { content: input.context.get('specs') ?? '', title: 'Specs' },
      { content: input.context.get('tasks') ?? '', title: 'Tasks' },
    ],
  }
}

function createReviewPrompt(
  task: OpenSpecTask,
  input: {
    apply: Awaited<ReturnType<typeof readOpenSpecApplyInstructions>>
    context: Map<string, string>
    featureId: string
  },
): TaskPrompt {
  return {
    instructions: [
      'Review only the current task from the OpenSpec change.',
      'Use the OpenSpec apply instruction as the execution contract.',
      'Judge the implementation against the current task, OpenSpec context, and actual changed files.',
      'Only return verdict "pass" when the current task is satisfied by the implementation.',
      'Do not expand the review to unrelated repository changes.',
    ],
    sections: [
      { content: input.featureId, title: 'Change' },
      { content: input.apply.schemaName, title: 'Schema' },
      { content: input.apply.state, title: 'Apply State' },
      {
        content: `${input.apply.progress.complete}/${input.apply.progress.total} complete`,
        title: 'Apply Progress',
      },
      { content: task.rawLine, title: 'Current Task' },
      { content: task.sectionTitle, title: 'Task Group' },
      { content: input.context.get('proposal') ?? '', title: 'Proposal' },
      { content: input.context.get('design') ?? '', title: 'Design' },
      { content: input.context.get('specs') ?? '', title: 'Specs' },
      { content: input.context.get('tasks') ?? '', title: 'Tasks' },
    ],
  }
}

function getTaskBody(task: OpenSpecTask) {
  if (!task.rawLine.match(/^[-*]\s+\[[ x]\]/i)) {
    throw new Error(`Invalid task line: ${task.rawLine}`)
  }
  const markerIndex = task.rawLine.indexOf(']')
  if (markerIndex === -1) {
    throw new Error(`Invalid task line: ${task.rawLine}`)
  }
  return task.rawLine.slice(markerIndex + 1).trimStart()
}

function isTaskChecked(tasksMd: string, task: OpenSpecTask) {
  const taskBody = getTaskBody(task)
  const pattern = new RegExp(
    String.raw`^[-*]\s+\[[xX]\]\s+${escapeRegExp(taskBody)}$`,
    'm',
  )
  return pattern.test(tasksMd)
}

async function updateTaskCheckbox(
  tasksPath: string,
  task: OpenSpecTask,
  checked: boolean,
) {
  const content = await readFile(tasksPath, 'utf8')
  const taskBody = getTaskBody(task)
  const pattern = new RegExp(
    String.raw`^([-*]\s+)\[[ xX]\]\s+${escapeRegExp(taskBody)}$`,
    'm',
  )
  const replacementCheckbox = checked ? '[X]' : '[ ]'
  const updated = content.replace(
    pattern,
    `$1${replacementCheckbox} ${taskBody}`,
  )
  await writeFile(tasksPath, updated)
}

export interface CreateOpenSpecSessionInput extends OpenTaskSourceInput {
  tasks: OpenSpecTask[]
}

export function createOpenSpecSession(
  input: CreateOpenSpecSessionInput,
): TaskSourceSession {
  const tasksPath = path.join(input.featureDir, 'tasks.md')
  const tasksByHandle = new Map(input.tasks.map((task) => [task.handle, task]))

  const getTask = (taskHandle: string) => {
    const task = tasksByHandle.get(taskHandle)
    if (!task) {
      throw new Error(`Unknown task selector: ${taskHandle}`)
    }
    return task
  }

  const loadApplyContext = async () => {
    const apply = await readOpenSpecApplyInstructions({
      changeName: input.featureId,
      workspaceRoot: input.workspaceRoot,
    })
    const context = await readContextFileMap(
      input.featureDir,
      apply.contextFiles,
    )
    return {
      apply,
      context,
    }
  }

  return {
    async applyTaskCompletion(taskHandle: string) {
      const task = getTask(taskHandle)
      if (await this.isTaskCompleted(taskHandle)) {
        return
      }
      await updateTaskCheckbox(tasksPath, task, true)
    },
    buildCommitSubject(taskHandle: string) {
      const task = getTask(taskHandle)
      return `Task ${input.featureId}/${task.handle}: ${task.title}`
    },
    async buildImplementPrompt(args) {
      const task = getTask(args.taskHandle)
      const applyContext = await loadApplyContext()
      return createImplementPrompt(task, {
        ...applyContext,
        featureId: input.featureId,
      })
    },
    async buildReviewPrompt(args) {
      const task = getTask(args.taskHandle)
      const applyContext = await loadApplyContext()
      void args
      return createReviewPrompt(task, {
        ...applyContext,
        featureId: input.featureId,
      })
    },
    async getCompletionCriteria(taskHandle: string) {
      return [getTask(taskHandle).title]
    },
    getTaskDependencies(taskHandle: string) {
      void taskHandle
      return []
    },
    async isTaskCompleted(taskHandle: string) {
      const task = getTask(taskHandle)
      const tasksMd = await readFile(tasksPath, 'utf8')
      return isTaskChecked(tasksMd, task)
    },
    listTasks() {
      return input.tasks.map((task) => task.handle)
    },
    resolveTaskSelector(selector: string) {
      if (tasksByHandle.has(selector)) {
        return selector
      }
      if (!selector.match(/^\d+$/)) {
        throw new Error(`Unknown task selector: ${selector}`)
      }
      const ordinal = Number(selector)
      const task = input.tasks.find((item) => item.ordinal === ordinal)
      if (!task) {
        throw new Error(`Unknown task selector: ${selector}`)
      }
      return task.handle
    },
    async revertTaskCompletion(taskHandle: string) {
      const task = getTask(taskHandle)
      if (!(await this.isTaskCompleted(taskHandle))) {
        return
      }
      await updateTaskCheckbox(tasksPath, task, false)
    },
  }
}
