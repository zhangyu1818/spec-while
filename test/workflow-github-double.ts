import type { GitHubPort } from '../src/core/runtime'

export class FakeGitHub implements GitHubPort {
  public async createPullRequest() {
    return {
      number: 1,
      title: 'Task T001: Implement greeting',
      url: 'https://example.com/pr/1',
    }
  }

  public async findMergedPullRequestByHeadBranch() {
    return null
  }

  public async findOpenPullRequestByHeadBranch() {
    return null
  }

  public async getPullRequestSnapshot() {
    return {
      changedFiles: [],
      discussionComments: [],
      reactions: [],
      reviewSummaries: [],
      reviewThreads: [],
    }
  }

  public async squashMergePullRequest() {
    return { commitSha: 'merged-sha' }
  }
}
