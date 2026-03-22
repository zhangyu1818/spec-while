import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { expect, test } from 'vitest'

import { resolveWorkspaceContext } from '../src/runtime/workspace-resolver'

const execFileAsync = promisify(execFile)

async function createWorkspace(featureIds: string[]) {
  const root = await mkdtemp(path.join(tmpdir(), 'while-workspace-'))
  for (const featureId of featureIds) {
    const featureDir = path.join(root, 'specs', featureId)
    await mkdir(featureDir, { recursive: true })
    await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
    await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
    await writeFile(path.join(featureDir, 'tasks.md'), '# tasks\n')
  }
  return root
}

async function createGitWorkspace() {
  const root = await createWorkspace(['001-demo', '002-other'])
  await execFileAsync('git', ['init'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: root })
  await writeFile(path.join(root, '.gitkeep'), 'x\n')
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: root })
  await execFileAsync('git', ['checkout', '-b', '001-feature-branch'], { cwd: root })
  return root
}

test('resolveWorkspaceContext auto-selects the only feature', async () => {
  const root = await createWorkspace(['001-demo'])
  const featureDir = path.join(root, 'specs', '001-demo')

  const result = await resolveWorkspaceContext({
    cwd: root,
    env: {},
  })

  expect(result.workspaceRoot).toBe(root)
  expect(result.featureId).toBe('001-demo')
  expect(result.featureDir).toBe(featureDir)
})

test('resolveWorkspaceContext walks up to locate workspace root', async () => {
  const root = await createWorkspace(['001-demo'])
  const nested = path.join(root, 'specs', '001-demo', 'deep', 'nested')
  await mkdir(nested, { recursive: true })

  const result = await resolveWorkspaceContext({
    cwd: nested,
    env: {},
  })

  expect(result.workspaceRoot).toBe(root)
  expect(result.featureId).toBe('001-demo')
})

test('resolveWorkspaceContext prefers explicit feature and workspace overrides', async () => {
  const root = await createWorkspace(['001-demo', '002-other'])

  const result = await resolveWorkspaceContext({
    cwd: '/',
    env: { SPECIFY_FEATURE: '001-demo' },
    feature: '002-other',
    workspace: root,
  })

  expect(result.workspaceRoot).toBe(root)
  expect(result.featureId).toBe('002-other')
})

test('resolveWorkspaceContext can infer feature from env when multiple features exist', async () => {
  const root = await createWorkspace(['001-demo', '002-other'])

  const result = await resolveWorkspaceContext({
    cwd: root,
    env: { SPECIFY_FEATURE: '002-other' },
  })

  expect(result.featureId).toBe('002-other')
})

test('resolveWorkspaceContext can infer feature from git branch prefix', async () => {
  const root = await createGitWorkspace()

  const result = await resolveWorkspaceContext({
    cwd: root,
    env: {},
  })

  expect(result.featureId).toBe('001-demo')
})

test('resolveWorkspaceContext throws when multiple features exist without explicit selection', async () => {
  const root = await createWorkspace(['001-demo', '002-other'])

  await expect(resolveWorkspaceContext({
    cwd: root,
    env: {},
  })).rejects.toThrow(/Unable to determine feature/i)
})

test('resolveWorkspaceContext throws when workspace root cannot be found', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'while-no-workspace-'))

  await expect(resolveWorkspaceContext({
    cwd: root,
    env: {},
  })).rejects.toThrow(/Unable to locate a Spec Kit workspace/i)
})
