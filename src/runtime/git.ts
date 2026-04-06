import path from 'node:path'

import { execa } from 'execa'

import { filterPorcelainStatus } from '../utils/fs'

import type {
  GitCheckoutBranchOptions,
  GitCommitTaskInput,
  GitCommitTaskResult,
  GitPort,
  GitPushBranchOptions,
} from '../core/runtime'

function normalizeRelativePath(value: string) {
  return value.split(path.sep).join('/')
}

async function runGit(cwd: string, args: string[]) {
  const result = await execa('git', args, { cwd })
  return result.stdout.trim()
}

export class GitRuntime implements GitPort {
  private readonly runtimeDirRelative: string

  public constructor(
    private readonly workspaceRoot: string,
    runtimeDir: string,
  ) {
    this.runtimeDirRelative = normalizeRelativePath(
      path.relative(this.workspaceRoot, runtimeDir),
    )
  }

  public async checkoutBranch(
    name: string,
    options?: GitCheckoutBranchOptions,
  ) {
    if (options?.create) {
      const args = ['checkout', '-b', name]
      if (options.startPoint) {
        args.push(options.startPoint)
      }
      await runGit(this.workspaceRoot, args)
      return
    }
    await runGit(this.workspaceRoot, ['checkout', name])
  }

  public async checkoutRemoteBranch(name: string) {
    await runGit(this.workspaceRoot, ['fetch', 'origin', name])
    await runGit(this.workspaceRoot, ['checkout', '-B', name, 'FETCH_HEAD'])
  }

  public async commitTask(
    input: GitCommitTaskInput,
  ): Promise<GitCommitTaskResult> {
    await runGit(this.workspaceRoot, ['add', '-A', '.'])
    await runGit(this.workspaceRoot, ['reset', '--', this.runtimeDirRelative])
    await runGit(this.workspaceRoot, [
      'commit',
      '--allow-empty',
      '-m',
      input.message,
    ])
    const commitSha = await runGit(this.workspaceRoot, ['rev-parse', 'HEAD'])
    return { commitSha }
  }

  public async deleteLocalBranch(name: string) {
    await runGit(this.workspaceRoot, ['branch', '-D', name])
  }

  public async getChangedFilesSinceHead() {
    const [changed, untracked] = await Promise.all([
      runGit(this.workspaceRoot, ['diff', '--name-only', 'HEAD']),
      runGit(this.workspaceRoot, [
        'ls-files',
        '--others',
        '--exclude-standard',
      ]),
    ])
    const files = new Set(
      [...changed.split('\n'), ...untracked.split('\n')]
        .map((item) => item.trim())
        .filter(Boolean)
        .filter(
          (item) =>
            item !== this.runtimeDirRelative &&
            !item.startsWith(`${this.runtimeDirRelative}/`),
        ),
    )
    return [...files].sort()
  }

  public async getCurrentBranch() {
    return runGit(this.workspaceRoot, ['branch', '--show-current'])
  }

  public async getHeadSha() {
    return runGit(this.workspaceRoot, ['rev-parse', 'HEAD'])
  }

  public async getHeadSubject() {
    return runGit(this.workspaceRoot, ['log', '-1', '--format=%s', 'HEAD'])
  }

  public async getHeadTimestamp() {
    return runGit(this.workspaceRoot, ['log', '-1', '--format=%cI', 'HEAD'])
  }

  public async pullFastForward(branch: string) {
    await runGit(this.workspaceRoot, ['pull', '--ff-only', 'origin', branch])
  }

  public async pushBranch(name: string, options?: GitPushBranchOptions) {
    const args = ['push']
    if (options?.setUpstream) {
      args.push('-u')
    }
    args.push('origin', name)
    await runGit(this.workspaceRoot, args)
  }

  public async requireCleanWorktree() {
    const status = await runGit(this.workspaceRoot, ['status', '--porcelain'])
    const relevantLines = filterPorcelainStatus(
      status.split('\n').filter(Boolean),
      this.runtimeDirRelative,
    )

    if (relevantLines.length !== 0) {
      throw new Error('Worktree must be clean before running task-while')
    }
  }
}
