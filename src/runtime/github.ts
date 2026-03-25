import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  getPullRequestSnapshotViaGraphQL,
  type RunGh,
} from './github-pr-snapshot'

import type {
  GitHubPort,
  PullRequestRef,
  PullRequestSnapshot,
} from '../core/runtime'

const execFileAsync = promisify(execFile)

async function defaultRunGh(args: string[], cwd: string) {
  const env = process.env.GITHUB_BOT_TOKEN
    ? {
        ...process.env,
        GH_TOKEN: process.env.GITHUB_BOT_TOKEN,
      }
    : process.env
  const result = await execFileAsync('gh', args, { cwd, env })
  return result.stdout.trim()
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export class GitHubRuntime implements GitHubPort {
  private readonly runGh: RunGh

  public constructor(
    workspaceRoot: string,
    runGh?: RunGh,
    private readonly repoName?: string,
  ) {
    this.runGh = runGh ?? ((args) => defaultRunGh(args, workspaceRoot))
  }

  private async resolveRepo() {
    if (this.repoName) {
      return this.repoName
    }
    const payload = JSON.parse(
      await this.runGh(['repo', 'view', '--json', 'nameWithOwner']),
    ) as { nameWithOwner?: unknown }
    return asString(payload.nameWithOwner)
  }

  public async createPullRequest(input: {
    baseBranch: string
    body: string
    headBranch: string
    title: string
  }): Promise<PullRequestRef> {
    await this.runGh([
      'pr',
      'create',
      '--base',
      input.baseBranch,
      '--head',
      input.headBranch,
      '--title',
      input.title,
      '--body',
      input.body,
    ])
    const created = await this.findOpenPullRequestByHeadBranch({
      headBranch: input.headBranch,
    })
    if (!created) {
      throw new Error(
        `Could not resolve pull request after creating branch ${input.headBranch}`,
      )
    }
    return created
  }

  public async findOpenPullRequestByHeadBranch(input: {
    headBranch: string
  }): Promise<null | PullRequestRef> {
    const payload = JSON.parse(
      await this.runGh([
        'pr',
        'list',
        '--head',
        input.headBranch,
        '--state',
        'open',
        '--json',
        'number,title,url',
      ]),
    )
    const pullRequests = asArray<Record<string, unknown>>(payload)
    const match = pullRequests[0]
    if (!match) {
      return null
    }
    return {
      number: asNumber(match.number),
      title: asString(match.title),
      url: asString(match.url),
    }
  }

  public async getPullRequestSnapshot(input: {
    pullRequestNumber: number
  }): Promise<PullRequestSnapshot> {
    const repo = await this.resolveRepo()
    const [owner, repoName] = repo.split('/')
    if (!owner || !repoName) {
      throw new Error(`Invalid GitHub repository name: ${repo}`)
    }
    return getPullRequestSnapshotViaGraphQL({
      owner,
      pullRequestNumber: input.pullRequestNumber,
      repo: repoName,
      runGh: this.runGh,
    })
  }

  public async squashMergePullRequest(input: {
    pullRequestNumber: number
    subject: string
  }) {
    const repo = await this.resolveRepo()
    const commitSha = asString(
      JSON.parse(
        await this.runGh([
          'api',
          `repos/${repo}/pulls/${input.pullRequestNumber}/merge`,
          '--method',
          'PUT',
          '-f',
          'merge_method=squash',
          '-f',
          `commit_title=${input.subject}`,
        ]),
      ).sha,
    )
    return { commitSha }
  }
}
