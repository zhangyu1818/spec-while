import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export interface OpenSpecChangeFixture {
  changeDir: string
  changeId: string
  designPath: string
  proposalPath: string
  root: string
  rootSpecPath?: string
  specPath: string
  tasksPath: string
}

export async function createOpenSpecChangeFixture(
  input: {
    changeId?: string
    includeRootSpec?: boolean
    tasksMd?: string
  } = {},
): Promise<OpenSpecChangeFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'while-openspec-task-source-'))
  const changeId = input.changeId ?? 'example-change'
  const changeDir = path.join(root, 'openspec', 'changes', changeId)
  const proposalPath = path.join(changeDir, 'proposal.md')
  const designPath = path.join(changeDir, 'design.md')
  const tasksPath = path.join(changeDir, 'tasks.md')
  const rootSpecPath = input.includeRootSpec
    ? path.join(changeDir, 'specs', 'spec.md')
    : undefined
  const specPath = path.join(
    changeDir,
    'specs',
    'example-capability',
    'spec.md',
  )

  await mkdir(path.dirname(specPath), { recursive: true })
  await writeFile(path.join(root, 'while.yaml'), 'task:\n  source: openspec\n')
  await writeFile(
    path.join(root, 'openspec', 'config.yaml'),
    'schema: spec-driven\n',
  )
  await writeFile(proposalPath, '# Proposal\n')
  await writeFile(designPath, '# Design\n')
  await writeFile(
    tasksPath,
    input.tasksMd ??
      `## 1. CLI 与配置
- [ ] 1.1 为示例能力新增 CLI 子命令与 \`--config\` 参数解析
- [ ] 1.2 从 YAML 配置文件读取批处理作业定义

## 2. 执行与校验
- [ ] 2.1 解析批处理作业并构建执行计划
- [ ] 2.2 校验必填字段与非法配置
- [ ] 2.3 执行单个作业并收集退出状态
- [ ] 2.4 汇总批处理执行结果并返回失败状态

## 3. 输出与文档
- [ ] 3.1 输出每个作业的执行结果摘要
- [ ] 3.2 补充用法文档与示例配置
`,
  )
  await writeFile(
    specPath,
    `# Example Capability

## ADDED Requirements

### Requirement: Example Capability
The system MUST support an example capability.
`,
  )
  if (rootSpecPath) {
    await writeFile(
      rootSpecPath,
      `# Root Capability

## ADDED Requirements

### Requirement: Root Capability
The system MUST support a root capability.
`,
    )
  }

  return {
    changeDir,
    changeId,
    designPath,
    proposalPath,
    root,
    specPath,
    tasksPath,
    ...(rootSpecPath
      ? {
          rootSpecPath,
        }
      : {}),
  }
}
