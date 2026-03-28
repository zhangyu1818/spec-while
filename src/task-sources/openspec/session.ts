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
      input.apply.instruction,
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

function splitTasksMd(tasksMd: string) {
  return {
    lineEnding: tasksMd.includes('\r\n') ? '\r\n' : '\n',
    lines: tasksMd.split(/\r?\n/),
  }
}

function getTaskLineIndex(lines: string[], task: OpenSpecTask) {
  let currentOrdinal = 0
  for (const [index, line] of lines.entries()) {
    if (!line.match(/^[-*]\s+\[[ x]\]\s+/i)) {
      continue
    }
    currentOrdinal += 1
    if (currentOrdinal === task.ordinal) {
      return index
    }
  }
  throw new Error(`Task line not found for handle: ${task.handle}`)
}

function isTaskChecked(tasksMd: string, task: OpenSpecTask) {
  const { lines } = splitTasksMd(tasksMd)
  const line = lines[getTaskLineIndex(lines, task)]
  if (!line) {
    return false
  }
  return /^[-*]\s+\[x\]\s+/i.test(line)
}

async function updateTaskCheckbox(
  tasksPath: string,
  task: OpenSpecTask,
  checked: boolean,
) {
  const content = await readFile(tasksPath, 'utf8')
  const { lineEnding, lines } = splitTasksMd(content)
  const targetIndex = getTaskLineIndex(lines, task)
  const targetLine = lines[targetIndex]
  if (!targetLine) {
    throw new Error(`Task line not found for handle: ${task.handle}`)
  }
  const pattern = /^([-*]\s+)\[[ x]\](\s+(?:\S.*)?)$/i
  const match = targetLine.match(pattern)
  if (!match) {
    throw new Error(`Invalid task line: ${targetLine}`)
  }
  const replacementCheckbox = checked ? '[X]' : '[ ]'
  lines[targetIndex] = `${match[1]}${replacementCheckbox}${match[2]}`
  await writeFile(tasksPath, lines.join(lineEnding))
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
