import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  ImplementAgentInput,
  ImplementerProvider,
  ReviewAgentInput,
  ReviewerProvider,
} from '../src/agents/types'
import type { WorkspaceContext } from '../src/types'

const execFileAsync = promisify(execFile)

export class ScriptedWorkflowProvider
  implements ImplementerProvider, ReviewerProvider
{
  public readonly implementInputs: ImplementAgentInput[] = []
  public readonly name = 'scripted'
  public readonly reviewInputs: ReviewAgentInput[] = []

  public constructor(
    private readonly implementHandler: (
      input: ImplementAgentInput,
    ) => Promise<void>,
    private readonly reviewHandler: (
      input: ReviewAgentInput,
    ) => Promise<Awaited<ReturnType<ReviewerProvider['review']>>>,
  ) {}

  public async implement(input: ImplementAgentInput) {
    this.implementInputs.push(input)
    await this.implementHandler(input)
    return {
      assumptions: [],
      needsHumanAttention: false,
      notes: [],
      status: 'implemented' as const,
      summary: `${input.task.id} done`,
      taskId: input.task.id,
      unresolvedItems: [],
    }
  }

  public async review(input: ReviewAgentInput) {
    this.reviewInputs.push(input)
    return this.reviewHandler(input)
  }
}

export async function git(root: string, args: string[]) {
  const result = await execFileAsync('git', args, {
    cwd: root,
  })
  return result.stdout.trim()
}

export async function initGitRepo(root: string) {
  await git(root, ['init'])
  await git(root, ['config', 'user.name', 'While Test'])
  await git(root, ['config', 'user.email', 'while@example.com'])
  await git(root, ['add', '.'])
  await git(root, ['commit', '-m', 'Initial commit'])
}

export async function gitLogMessages(root: string) {
  const output = await git(root, ['log', '--format=%s'])
  return output.split('\n').filter(Boolean)
}

export async function currentHead(root: string) {
  return git(root, ['rev-parse', 'HEAD'])
}

export async function trackedFilesInHead(root: string) {
  const output = await git(root, ['show', '--name-only', '--format=', 'HEAD'])
  return output.split('\n').filter(Boolean)
}

export async function createWorkspace(input?: {
  includeSecondTask?: boolean
  maxAttempts?: number
}) {
  const root = await mkdtemp(path.join(tmpdir(), 'while-commands-'))
  const featureDir = path.join(root, 'specs', '001-demo')
  const maxAttempts = input?.maxAttempts ?? 2
  const includeSecondTask = input?.includeSecondTask ?? true
  await mkdir(featureDir, { recursive: true })
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, '.gitignore'), '.while\n')
  await writeFile(
    path.join(root, 'while.yaml'),
    [
      'workflow:',
      '  mode: direct',
      '  roles:',
      '    implementer:',
      '      provider: codex',
      '    reviewer:',
      '      provider: codex',
      '',
    ].join('\n'),
  )
  await writeFile(
    path.join(root, 'src', 'greeting.js'),
    'exports.buildGreeting = () => "broken"\n',
  )
  await writeFile(
    path.join(root, 'src', 'farewell.js'),
    'exports.buildFarewell = () => "broken"\n',
  )
  await writeFile(
    path.join(root, 'src', 'shared.js'),
    'exports.shared = "base"\n',
  )
  await writeFile(path.join(featureDir, 'spec.md'), '# spec\n')
  await writeFile(path.join(featureDir, 'plan.md'), '# plan\n')
  await writeFile(
    path.join(featureDir, 'tasks.md'),
    `
# Tasks

## Phase 1: Core

- [ ] T001 Implement greeting in src/greeting.js
  - Depends:
  - Acceptance:
    - buildGreeting returns Hello, world!
  - Review Rubric:
    - simple and scoped
  - Max Iterations: ${maxAttempts}
${
  includeSecondTask
    ? `

- [ ] T002 Implement farewell in src/farewell.js
  - Depends: T001
  - Acceptance:
    - buildFarewell returns Bye, world!
  - Review Rubric:
    - simple and scoped
  - Max Iterations: ${maxAttempts}
`
    : ''
}
`,
  )

  const context: WorkspaceContext = {
    featureDir,
    featureId: '001-demo',
    planPath: path.join(featureDir, 'plan.md'),
    runtimeDir: path.join(featureDir, '.while'),
    specPath: path.join(featureDir, 'spec.md'),
    tasksPath: path.join(featureDir, 'tasks.md'),
    workspaceRoot: root,
  }

  return { context, featureDir, root }
}

export function createPassingReview(input: ReviewAgentInput) {
  return {
    findings: [],
    overallRisk: 'low' as const,
    summary: 'ok',
    taskId: input.task.id,
    verdict: 'pass' as const,
    acceptanceChecks: input.task.acceptance.map((criterion) => ({
      criterion,
      note: 'ok',
      status: 'pass' as const,
    })),
  }
}
