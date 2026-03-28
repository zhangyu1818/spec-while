import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { execa } from 'execa'
import { expect, test } from 'vitest'

const cliEntry = fileURLToPath(
  new URL('../bin/spec-while.mjs', import.meta.url),
)

async function createWorkspace() {
  return createWorkspaceWithOptions()
}

async function createWorkspaceWithOptions(
  options: { omitFeatureFiles?: string[] } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), 'while-cli-'))
  const featureDir = path.join(root, 'specs', '001-demo')
  await mkdir(featureDir, { recursive: true })
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(
    path.join(root, 'src', 'parser.ts'),
    'export const value = 1\n',
  )
  if (!options.omitFeatureFiles?.includes('spec.md')) {
    await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  }
  if (!options.omitFeatureFiles?.includes('plan.md')) {
    await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  }
  if (!options.omitFeatureFiles?.includes('tasks.md')) {
    await writeFile(
      path.join(featureDir, 'tasks.md'),
      `
# Tasks

## Phase 1: Setup

- [ ] T001 Create parser in src/parser.ts
`,
    )
  }
  await writeFile(path.join(root, '.gitignore'), '.while\n')
  await execa('git', ['init'], { cwd: root })
  await execa('git', ['config', 'user.name', 'While Test'], {
    cwd: root,
  })
  await execa('git', ['config', 'user.email', 'while@example.com'], {
    cwd: root,
  })
  await execa('git', ['add', '.'], { cwd: root })
  await execa('git', ['commit', '-m', 'Initial commit'], { cwd: root })
  return { featureDir, root }
}

function runCli(args: string[], cwd: string) {
  return execa(process.execPath, [cliEntry, ...args], {
    cwd,
    env: process.env,
    reject: false,
  }).then((result) => ({
    code: result.exitCode,
    stderr: result.stderr,
    stdout: result.stdout,
  }))
}

test('spec-while rejects unknown commands', async () => {
  const { root } = await createWorkspace()
  const result = await runCli(['unknown', '--feature', '001-demo'], root)

  expect(result.code).not.toBe(0)
  expect(result.stderr).toMatch(/unknown command/i)
})

test('spec-while rejects rewind as an unknown command', async () => {
  const { root } = await createWorkspace()
  const result = await runCli(['rewind', '--task', 'T001'], root)

  expect(result.code).not.toBe(0)
  expect(result.stderr).toMatch(/unknown command: rewind/i)
})

test('spec-while rejects nested cwd values that do not contain specs directly', async () => {
  const { root } = await createWorkspace()

  const result = await runCli(
    ['run', '--feature', '001-demo'],
    path.join(root, 'src'),
  )

  expect(result.code).not.toBe(0)
  expect(result.stderr).toMatch(/current working directory.*specs/i)
})

test('spec-while run rejects features missing plan.md', async () => {
  const { root } = await createWorkspaceWithOptions({
    omitFeatureFiles: ['plan.md'],
  })

  const result = await runCli(['run', '--feature', '001-demo'], root)

  expect(result.code).not.toBe(0)
  expect(result.stderr).toMatch(/001-demo.*plan\.md/i)
})
