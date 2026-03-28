import { readFile } from 'node:fs/promises'

export interface OpenSpecTask {
  checked: boolean
  handle: string
  ordinal: number
  rawLine: string
  sectionTitle: string
  title: string
}

function createTask(
  line: string,
  ordinal: number,
  sectionTitle: string,
): OpenSpecTask {
  const checkboxMatch = line.match(/^[-*]\s+\[([ x])\]\s+(\S.*)$/i)
  if (!checkboxMatch) {
    throw new Error(`Invalid task line: ${line}`)
  }
  const body = checkboxMatch[2]!
  const numberedMatch = body.match(/^(\d+(?:\.\d+)*)\s+(\S.*)$/)

  return {
    checked: checkboxMatch[1]!.toLowerCase() === 'x',
    handle: numberedMatch?.[1] ?? `task-${ordinal}`,
    ordinal,
    rawLine: line,
    sectionTitle,
    title: numberedMatch?.[2] ?? body,
  }
}

export async function parseTasksMd(tasksPath: string): Promise<OpenSpecTask[]> {
  const content = await readFile(tasksPath, 'utf8')
  const lines = content.split(/\r?\n/)
  const tasks: OpenSpecTask[] = []
  let currentSectionTitle = 'unknown'

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.startsWith('## ')) {
      currentSectionTitle = line.replace(/^##\s+/, '').trim()
      continue
    }
    if (!line.match(/^[-*]\s+\[[ x]\]\s+/i)) {
      continue
    }
    tasks.push(createTask(line, tasks.length + 1, currentSectionTitle))
  }

  if (tasks.length === 0) {
    throw new Error('No tasks found in tasks.md')
  }

  return tasks
}
