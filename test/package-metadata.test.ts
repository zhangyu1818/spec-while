import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'

test('package.json exposes task-while as the CLI bin entry', async () => {
  const packageJsonPath = fileURLToPath(
    new URL('../package.json', import.meta.url),
  )
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
    bin: Record<string, string>
  }

  expect(packageJson.bin).toEqual({
    'task-while': 'bin/task-while.mjs',
  })
})
