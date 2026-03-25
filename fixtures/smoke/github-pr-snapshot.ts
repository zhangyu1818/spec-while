import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { GitHubRuntime } from '../../src/runtime/github'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)

async function runGitHubSnapshotSmoke() {
  const repo = process.env.WHILE_SMOKE_GITHUB_REPO
  const pullRequestNumber = Number(process.env.WHILE_SMOKE_GITHUB_PR_NUMBER)

  if (!process.env.GITHUB_BOT_TOKEN) {
    throw new Error('GITHUB_BOT_TOKEN is required')
  }
  if (!repo) {
    throw new Error('WHILE_SMOKE_GITHUB_REPO is required')
  }
  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new Error('WHILE_SMOKE_GITHUB_PR_NUMBER must be a positive integer')
  }

  const runtime = new GitHubRuntime(repoRoot, undefined, repo)
  const snapshot = await runtime.getPullRequestSnapshot({
    pullRequestNumber,
  })

  assert.ok(Array.isArray(snapshot.changedFiles))
  assert.ok(Array.isArray(snapshot.discussionComments))
  assert.ok(Array.isArray(snapshot.reactions))
  assert.ok(Array.isArray(snapshot.reviewSummaries))
  assert.ok(Array.isArray(snapshot.reviewThreads))

  process.stdout.write(
    `${JSON.stringify(
      {
        pullRequestNumber,
        repo,
        counts: {
          changedFiles: snapshot.changedFiles.length,
          discussionComments: snapshot.discussionComments.length,
          reactions: snapshot.reactions.length,
          reviewSummaries: snapshot.reviewSummaries.length,
          reviewThreads: snapshot.reviewThreads.length,
        },
      },
      null,
      2,
    )}\n`,
  )
}

void runGitHubSnapshotSmoke().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exitCode = 1
})
