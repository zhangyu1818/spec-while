import path from 'node:path'

import { beforeEach, expect, test, vi } from 'vitest'

import { parseCliJson } from '../src/task-sources/openspec/cli-json'
import { readContextFileMap } from '../src/task-sources/openspec/context-files'
import { parseTasksMd } from '../src/task-sources/openspec/parse-tasks-md'
import { openspecTaskSource } from '../src/task-sources/openspec/source'
import { createOpenSpecChangeFixture } from './openspec-task-source-test-helpers'

const mockState = vi.hoisted(() => {
  return {
    applyResult: {
      changeName: 'example-change',
      instruction: 'Implement the approved change.',
      schemaName: 'spec-driven',
      state: 'ready',
      tasks: [],
      contextFiles: {
        design: 'design.md',
        proposal: 'proposal.md',
        specs: 'specs/**/*.md',
        tasks: 'tasks.md',
      },
      progress: {
        complete: 0,
        total: 8,
      },
    },
    statusResult: {
      applyRequires: ['tasks'],
      changeName: 'example-change',
      isComplete: false,
      schemaName: 'spec-driven',
      artifacts: [
        {
          id: 'proposal',
          outputPath: 'proposal.md',
          status: 'done',
        },
        {
          id: 'design',
          outputPath: 'design.md',
          status: 'ready',
        },
        {
          id: 'specs',
          outputPath: 'specs/**/*.md',
          status: 'done',
        },
        {
          id: 'tasks',
          outputPath: 'tasks.md',
          status: 'done',
        },
      ],
    },
  }
})

vi.mock('../src/task-sources/openspec/cli-json', async () => {
  const actual = await vi.importActual('../src/task-sources/openspec/cli-json')
  return {
    ...actual,
    readOpenSpecApplyInstructions: vi.fn(async () => mockState.applyResult),
    readOpenSpecStatus: vi.fn(async () => mockState.statusResult),
  }
})

beforeEach(() => {
  mockState.applyResult = {
    changeName: 'example-change',
    instruction: 'Implement the approved change.',
    schemaName: 'spec-driven',
    state: 'ready',
    tasks: [],
    contextFiles: {
      design: 'design.md',
      proposal: 'proposal.md',
      specs: 'specs/**/*.md',
      tasks: 'tasks.md',
    },
    progress: {
      complete: 0,
      total: 8,
    },
  }
  mockState.statusResult = {
    applyRequires: ['tasks'],
    changeName: 'example-change',
    isComplete: false,
    schemaName: 'spec-driven',
    artifacts: [
      {
        id: 'proposal',
        outputPath: 'proposal.md',
        status: 'done',
      },
      {
        id: 'design',
        outputPath: 'design.md',
        status: 'ready',
      },
      {
        id: 'specs',
        outputPath: 'specs/**/*.md',
        status: 'done',
      },
      {
        id: 'tasks',
        outputPath: 'tasks.md',
        status: 'done',
      },
    ],
  }
})

test('parseTasksMd extracts stable handles from numbered openspec tasks', async () => {
  const { tasksPath } = await createOpenSpecChangeFixture()

  const tasks = await parseTasksMd(tasksPath)

  expect(tasks.map((task) => task.handle)).toEqual([
    '1.1',
    '1.2',
    '2.1',
    '2.2',
    '2.3',
    '2.4',
    '3.1',
    '3.2',
  ])
  expect(tasks[0]).toMatchObject({
    handle: '1.1',
    sectionTitle: '1. CLI 与配置',
    title: '为示例能力新增 CLI 子命令与 `--config` 参数解析',
  })
})

test('parseCliJson strips banner lines before parsing openspec json payload', async () => {
  const stdout = `- Generating apply instructions...
{
  "changeName": "example-change",
  "schemaName": "spec-driven",
  "state": "ready"
}`

  await expect(parseCliJson(stdout)).resolves.toMatchObject({
    changeName: 'example-change',
    state: 'ready',
  })
})

test('readContextFileMap expands absolute specs globs from the change directory in stable order', async () => {
  const { changeDir, designPath, proposalPath, tasksPath } =
    await createOpenSpecChangeFixture()

  const contextMap = await readContextFileMap(changeDir, {
    design: designPath,
    proposal: proposalPath,
    specs: path.join(changeDir, 'specs/**/*.md'),
    tasks: tasksPath,
  })

  expect([...contextMap.keys()]).toEqual([
    'proposal',
    'design',
    'specs',
    'tasks',
  ])
  expect(contextMap.get('specs')).toContain('## ADDED Requirements')
  expect(contextMap.get('specs')).toContain('Example Capability')
})

test('readContextFileMap lets ** globs match files directly under the glob root', async () => {
  const { changeDir } = await createOpenSpecChangeFixture({
    includeRootSpec: true,
  })

  const contextMap = await readContextFileMap(changeDir, {
    specs: path.join(changeDir, 'specs/**/*.md'),
  })

  expect(contextMap.get('specs')).toContain('Root Capability')
  expect(contextMap.get('specs')).toContain('Example Capability')
})

test('openspec source builds a session that keeps stable handles and apply-aligned prompt sections', async () => {
  const fixture = await createOpenSpecChangeFixture()
  mockState.applyResult.contextFiles = {
    design: fixture.designPath,
    proposal: fixture.proposalPath,
    specs: path.join(fixture.changeDir, 'specs/**/*.md'),
    tasks: fixture.tasksPath,
  }

  const session = await openspecTaskSource.open({
    featureDir: fixture.changeDir,
    featureId: fixture.changeId,
    workspaceRoot: fixture.root,
  })
  const prompt = await session.buildImplementPrompt({
    attempt: 1,
    generation: 1,
    lastFindings: [],
    taskHandle: '1.1',
  })

  expect(session.listTasks()).toEqual([
    '1.1',
    '1.2',
    '2.1',
    '2.2',
    '2.3',
    '2.4',
    '3.1',
    '3.2',
  ])
  expect(prompt.instructions).toContain(
    'Use the OpenSpec apply instruction as the execution contract.',
  )
  expect(prompt.instructions).toContain(
    'Do not mark tasks.md complete; while will apply completion after review/integrate.',
  )
  expect(prompt.sections).toContainEqual({
    content: '- [ ] 1.1 为示例能力新增 CLI 子命令与 `--config` 参数解析',
    title: 'Current Task',
  })
})

test('openspec source toggles task completion by stable handle and resolves ordinal selectors', async () => {
  const fixture = await createOpenSpecChangeFixture()
  mockState.applyResult.contextFiles = {
    design: fixture.designPath,
    proposal: fixture.proposalPath,
    specs: path.join(fixture.changeDir, 'specs/**/*.md'),
    tasks: fixture.tasksPath,
  }

  const session = await openspecTaskSource.open({
    featureDir: fixture.changeDir,
    featureId: fixture.changeId,
    workspaceRoot: fixture.root,
  })

  expect(session.resolveTaskSelector('1')).toBe('1.1')
  expect(await session.isTaskCompleted('1.1')).toBe(false)
  await session.applyTaskCompletion('1.1')
  expect(await session.isTaskCompleted('1.1')).toBe(true)
  await session.revertTaskCompletion('1.1')
  expect(await session.isTaskCompleted('1.1')).toBe(false)
})

test('openspec source can toggle completion for unnumbered tasks via synthetic handles', async () => {
  const fixture = await createOpenSpecChangeFixture({
    tasksMd: `## 1. Execute
- [ ] 准备上下文
- [ ] 执行实现
`,
  })
  mockState.applyResult.contextFiles = {
    design: fixture.designPath,
    proposal: fixture.proposalPath,
    specs: path.join(fixture.changeDir, 'specs/**/*.md'),
    tasks: fixture.tasksPath,
  }

  const session = await openspecTaskSource.open({
    featureDir: fixture.changeDir,
    featureId: fixture.changeId,
    workspaceRoot: fixture.root,
  })

  expect(session.listTasks()).toEqual(['task-1', 'task-2'])
  expect(session.resolveTaskSelector('1')).toBe('task-1')
  expect(await session.isTaskCompleted('task-1')).toBe(false)
  await session.applyTaskCompletion('task-1')
  expect(await session.isTaskCompleted('task-1')).toBe(true)
  await session.revertTaskCompletion('task-1')
  expect(await session.isTaskCompleted('task-1')).toBe(false)
})

test('openspec source treats lowercase x as completed state', async () => {
  const fixture = await createOpenSpecChangeFixture({
    tasksMd: `## 1. CLI 与配置
- [x] 1.1 为示例能力新增 CLI 子命令与 \`--config\` 参数解析
- [ ] 1.2 从 YAML 配置文件读取批处理作业定义
`,
  })
  mockState.applyResult.contextFiles = {
    design: fixture.designPath,
    proposal: fixture.proposalPath,
    specs: path.join(fixture.changeDir, 'specs/**/*.md'),
    tasks: fixture.tasksPath,
  }

  const session = await openspecTaskSource.open({
    featureDir: fixture.changeDir,
    featureId: fixture.changeId,
    workspaceRoot: fixture.root,
  })

  expect(await session.isTaskCompleted('1.1')).toBe(true)
})
