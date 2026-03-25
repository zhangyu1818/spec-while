import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { loadWorkflowConfig } from '../src/workflow/config'

const workspaces: string[] = []

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), 'while-workflow-config-'),
  )
  workspaces.push(workspaceRoot)
  return workspaceRoot
}

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map(async (workspaceRoot) =>
        rm(workspaceRoot, { force: true, recursive: true }),
      ),
  )
})

test('loadWorkflowConfig defaults to direct codex roles when while.yaml is absent', async () => {
  const workspaceRoot = await createWorkspace()

  const config = await loadWorkflowConfig(workspaceRoot)

  expect(config).toEqual({
    workflow: {
      mode: 'direct',
      roles: {
        implementer: { provider: 'codex' },
        reviewer: { provider: 'codex' },
      },
    },
  })
})

test('loadWorkflowConfig parses configured role providers from yaml mappings', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'workflow:',
      '  roles:',
      '    implementer: { provider: claude }',
      '    reviewer: { provider: codex }',
      '',
    ].join('\n'),
  )

  const config = await loadWorkflowConfig(workspaceRoot)

  expect(config).toEqual({
    workflow: {
      mode: 'direct',
      roles: {
        implementer: { provider: 'claude' },
        reviewer: { provider: 'codex' },
      },
    },
  })
})

test('loadWorkflowConfig parses pull-request mode without rewriting it to direct', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'workflow:',
      '  mode: pull-request',
      '  roles:',
      '    implementer: { provider: codex }',
      '    reviewer: { provider: claude }',
      '',
    ].join('\n'),
  )

  const config = await loadWorkflowConfig(workspaceRoot)

  expect(config).toEqual({
    workflow: {
      mode: 'pull-request',
      roles: {
        implementer: { provider: 'codex' },
        reviewer: { provider: 'claude' },
      },
    },
  })
})

test('loadWorkflowConfig rejects unknown keys instead of silently defaulting', async () => {
  const workspaceRoot = await createWorkspace()
  await writeFile(
    path.join(workspaceRoot, 'while.yaml'),
    [
      'workflow:',
      '  roles:',
      '    implementer:',
      '      proivder: claude',
      '',
    ].join('\n'),
  )

  await expect(loadWorkflowConfig(workspaceRoot)).rejects.toThrow(
    /proivder|unrecognized/i,
  )
})
