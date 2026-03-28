import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { execa } from 'execa'
import { expect, test } from 'vitest'

import { resolveWorkspaceContext } from '../src/runtime/workspace-resolver'

interface CreateWorkspaceOptions {
  omitFeatureFiles?: string[]
}

async function createWorkspace(
  featureIds: string[],
  options: CreateWorkspaceOptions = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'while-workspace-'))
  for (const featureId of featureIds) {
    const featureDir = path.join(root, 'specs', featureId)
    await mkdir(featureDir, { recursive: true })
    if (!options.omitFeatureFiles?.includes('spec.md')) {
      await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
    }
    if (!options.omitFeatureFiles?.includes('plan.md')) {
      await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
    }
    if (!options.omitFeatureFiles?.includes('tasks.md')) {
      await writeFile(path.join(featureDir, 'tasks.md'), '# tasks\n')
    }
  }
  return root
}

async function createOpenSpecWorkspace(changeIds: string[]) {
  const root = await mkdtemp(path.join(tmpdir(), 'while-openspec-workspace-'))
  await writeFile(path.join(root, 'while.yaml'), 'task:\n  source: openspec\n')
  for (const changeId of changeIds) {
    const changeDir = path.join(root, 'openspec', 'changes', changeId)
    await mkdir(path.join(changeDir, 'specs', 'example-capability'), {
      recursive: true,
    })
    await writeFile(
      path.join(root, 'openspec', 'config.yaml'),
      'schema: spec-driven\n',
    )
    await writeFile(path.join(changeDir, 'proposal.md'), '# proposal\n')
    await writeFile(path.join(changeDir, 'design.md'), '# design\n')
    await writeFile(
      path.join(changeDir, 'tasks.md'),
      '## 1. CLI 与配置\n- [ ] 1.1 示例任务\n',
    )
    await writeFile(
      path.join(changeDir, 'specs', 'example-capability', 'spec.md'),
      '# spec\n',
    )
  }
  return root
}

async function createGitWorkspace() {
  const root = await createWorkspace(['001-demo', '002-other'])
  await execa('git', ['init'], { cwd: root })
  await execa('git', ['config', 'user.email', 'test@example.com'], {
    cwd: root,
  })
  await execa('git', ['config', 'user.name', 'Test User'], {
    cwd: root,
  })
  await writeFile(path.join(root, '.gitkeep'), 'x\n')
  await execa('git', ['add', '.'], { cwd: root })
  await execa('git', ['commit', '-m', 'init'], { cwd: root })
  await execa('git', ['checkout', '-b', '001-feature-branch'], {
    cwd: root,
  })
  return root
}

test('resolveWorkspaceContext auto-selects the only feature', async () => {
  const root = await createWorkspace(['001-demo'])
  const featureDir = path.join(root, 'specs', '001-demo')

  const result = await resolveWorkspaceContext({
    cwd: root,
  })

  expect(result.workspaceRoot).toBe(root)
  expect(result.featureId).toBe('001-demo')
  expect(result.featureDir).toBe(featureDir)
})

test('resolveWorkspaceContext rejects cwd values that do not contain specs directly', async () => {
  const root = await createWorkspace(['001-demo'])
  const nested = path.join(root, 'specs', '001-demo', 'deep', 'nested')
  await mkdir(nested, { recursive: true })

  await expect(
    resolveWorkspaceContext({
      cwd: nested,
    }),
  ).rejects.toThrow(/current working directory.*specs/i)
})

test('resolveWorkspaceContext prefers explicit feature over branch inference', async () => {
  const root = await createWorkspace(['001-demo', '002-other'])

  const result = await resolveWorkspaceContext({
    cwd: root,
    feature: '002-other',
  })

  expect(result.workspaceRoot).toBe(root)
  expect(result.featureId).toBe('002-other')
})

test('resolveWorkspaceContext can infer feature from git branch prefix', async () => {
  const root = await createGitWorkspace()

  const result = await resolveWorkspaceContext({
    cwd: root,
  })

  expect(result.featureId).toBe('001-demo')
})

test('resolveWorkspaceContext throws when multiple features exist without explicit selection', async () => {
  const root = await createWorkspace(['001-demo', '002-other'])

  await expect(
    resolveWorkspaceContext({
      cwd: root,
    }),
  ).rejects.toThrow(/Unable to determine feature/i)
})

test('resolveWorkspaceContext throws a clear error when cwd/specs is missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'while-no-workspace-'))

  await expect(
    resolveWorkspaceContext({
      cwd: root,
    }),
  ).rejects.toThrow(/current working directory.*specs/i)
})

test('resolveWorkspaceContext does not validate source files like spec.md', async () => {
  const root = await createWorkspace(['001-demo'], {
    omitFeatureFiles: ['spec.md'],
  })

  await expect(
    resolveWorkspaceContext({
      cwd: root,
    }),
  ).resolves.toMatchObject({
    featureId: '001-demo',
  })
})

test('resolveWorkspaceContext does not validate source files like plan.md', async () => {
  const root = await createWorkspace(['001-demo'], {
    omitFeatureFiles: ['plan.md'],
  })

  await expect(
    resolveWorkspaceContext({
      cwd: root,
    }),
  ).resolves.toMatchObject({
    featureId: '001-demo',
  })
})

test('resolveWorkspaceContext does not validate source files like tasks.md', async () => {
  const root = await createWorkspace(['001-demo'], {
    omitFeatureFiles: ['tasks.md'],
  })

  await expect(
    resolveWorkspaceContext({
      cwd: root,
    }),
  ).resolves.toMatchObject({
    featureId: '001-demo',
  })
})

test('resolveWorkspaceContext resolves the only openspec change when taskSource is openspec', async () => {
  const root = await createOpenSpecWorkspace(['example-change'])

  await expect(
    resolveWorkspaceContext({
      cwd: root,
      taskSource: 'openspec',
    }),
  ).resolves.toMatchObject({
    featureDir: path.join(root, 'openspec', 'changes', 'example-change'),
    featureId: 'example-change',
    workspaceRoot: root,
    runtimeDir: path.join(
      root,
      'openspec',
      'changes',
      'example-change',
      '.while',
    ),
  })
})
