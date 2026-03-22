import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import {
  collectWorkspaceSnapshot,
  getBoundaryViolations,
} from '../src/runtime/file-boundary-checker'

test('getBoundaryViolations reports changes outside allowed paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'while-boundary-'))
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'allowed.ts'), 'a')
  await writeFile(path.join(root, 'src', 'other.ts'), 'a')

  const before = await collectWorkspaceSnapshot(root)
  await writeFile(path.join(root, 'src', 'allowed.ts'), 'b')
  await writeFile(path.join(root, 'src', 'other.ts'), 'b')
  const after = await collectWorkspaceSnapshot(root)

  const result = getBoundaryViolations({
    after,
    allowedPaths: ['src/allowed.ts'],
    before,
  })

  expect(result.actualChangedFiles.sort()).toEqual(['src/allowed.ts', 'src/other.ts'])
  expect(result.violations).toEqual(['src/other.ts'])
})
