import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { readTextIfExists } from '../src/utils/fs'

test('readTextIfExists returns an empty string for missing files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'while-fs-utils-'))

  await expect(readTextIfExists(path.join(root, 'missing.txt'))).resolves.toBe('')
})

test('readTextIfExists re-throws non-ENOENT read errors', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'while-fs-utils-'))
  const dirPath = path.join(root, 'nested')
  await mkdir(dirPath)
  await writeFile(path.join(root, 'present.txt'), 'ok\n')

  await expect(readTextIfExists(dirPath)).rejects.toBeTruthy()
})
