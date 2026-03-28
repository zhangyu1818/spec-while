import { openspecTaskSource } from './openspec/source'
import { specKitTaskSource } from './spec-kit/source'

import type { TaskSource } from './types'

export function getTaskSource(name: string): TaskSource {
  if (name === 'spec-kit') {
    return specKitTaskSource
  }
  if (name === 'openspec') {
    return openspecTaskSource
  }

  throw new Error(`Unknown task source: ${name}`)
}

export async function openTaskSource(
  name: string,
  input: Parameters<TaskSource['open']>[0],
) {
  return getTaskSource(name).open(input)
}
