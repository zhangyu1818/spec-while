import path from 'node:path'

import * as fsExtra from 'fs-extra'

import { readOpenSpecStatus } from './cli-json'
import { readContextFileMap } from './context-files'
import { parseTasksMd } from './parse-tasks-md'
import { createOpenSpecSession } from './session'

import type { OpenTaskSourceInput, TaskSource } from '../types'

async function assertRequiredChangeFiles(featureDir: string) {
  for (const fileName of ['proposal.md', 'design.md', 'tasks.md']) {
    const filePath = path.join(featureDir, fileName)
    const exists = await fsExtra.pathExists(filePath)
    if (!exists) {
      throw new Error(`Missing required change file: ${filePath}`)
    }
  }

  const context = await readContextFileMap(featureDir, {
    specs: 'specs/**/*.md',
  })
  if (!(context.get('specs') ?? '').trim()) {
    throw new Error(`Missing required change specs under: ${featureDir}/specs`)
  }
}

async function assertOpenSpecReady(input: OpenTaskSourceInput) {
  const status = await readOpenSpecStatus({
    changeName: input.featureId,
    workspaceRoot: input.workspaceRoot,
  })

  const allApplyRequirementsReady = status.applyRequires.every((artifactId) => {
    const artifact = status.artifacts.find((item) => item.id === artifactId)
    return artifact?.status === 'done'
  })

  if (allApplyRequirementsReady) {
    return
  }
  throw new Error(
    `OpenSpec change is not ready for apply instructions: ${input.featureId}`,
  )
}

export const openspecTaskSource: TaskSource = {
  name: 'openspec',
  async open(input: OpenTaskSourceInput) {
    await assertRequiredChangeFiles(input.featureDir)
    await assertOpenSpecReady(input)
    const tasks = await parseTasksMd(path.join(input.featureDir, 'tasks.md'))
    return createOpenSpecSession({
      ...input,
      tasks,
    })
  },
}
