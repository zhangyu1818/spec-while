import {
  parseReviewThreadCommentsPage,
  parseSnapshotPage,
} from './github-pr-snapshot-decode'
import {
  buildReviewThreadCommentsArgs,
  buildSnapshotArgs,
} from './github-pr-snapshot-queries'

import type {
  PullRequestDiscussionComment,
  PullRequestReaction,
  PullRequestReviewSummary,
  PullRequestReviewThread,
  PullRequestSnapshot,
} from '../core/runtime'

export type RunGh = (args: string[]) => Promise<string>

export async function getPullRequestSnapshotViaGraphQL(input: {
  owner: string
  pullRequestNumber: number
  repo: string
  runGh: RunGh
}): Promise<PullRequestSnapshot> {
  const changedFiles: string[] = []
  const discussionComments: PullRequestDiscussionComment[] = []
  const reactions: PullRequestReaction[] = []
  const reviewSummaries: PullRequestReviewSummary[] = []
  const reviewThreads: PullRequestReviewThread[] = []
  const cursors = {
    comments: null as null | string,
    files: null as null | string,
    reactions: null as null | string,
    reviews: null as null | string,
    reviewThreads: null as null | string,
  }
  const includes = {
    comments: true,
    files: true,
    reactions: true,
    reviews: true,
    reviewThreads: true,
  }

  while (
    includes.comments ||
    includes.files ||
    includes.reactions ||
    includes.reviews ||
    includes.reviewThreads
  ) {
    const page = parseSnapshotPage(
      await input.runGh(
        buildSnapshotArgs({
          commentsAfter: cursors.comments,
          filesAfter: cursors.files,
          includeComments: includes.comments,
          includeFiles: includes.files,
          includeReactions: includes.reactions,
          includeReviews: includes.reviews,
          includeReviewThreads: includes.reviewThreads,
          number: input.pullRequestNumber,
          owner: input.owner,
          reactionsAfter: cursors.reactions,
          repo: input.repo,
          reviewsAfter: cursors.reviews,
          reviewThreadsAfter: cursors.reviewThreads,
        }),
      ),
      {
        comments: includes.comments,
        files: includes.files,
        reactions: includes.reactions,
        reviews: includes.reviews,
        reviewThreads: includes.reviewThreads,
      },
    )

    if (page.comments) {
      discussionComments.push(...page.comments.nodes)
      cursors.comments = page.comments.pageInfo.endCursor
      includes.comments = page.comments.pageInfo.hasNextPage
    }
    if (page.files) {
      changedFiles.push(...page.files.nodes)
      cursors.files = page.files.pageInfo.endCursor
      includes.files = page.files.pageInfo.hasNextPage
    }
    if (page.reactions) {
      reactions.push(...page.reactions.nodes)
      cursors.reactions = page.reactions.pageInfo.endCursor
      includes.reactions = page.reactions.pageInfo.hasNextPage
    }
    if (page.reviews) {
      reviewSummaries.push(...page.reviews.nodes)
      cursors.reviews = page.reviews.pageInfo.endCursor
      includes.reviews = page.reviews.pageInfo.hasNextPage
    }
    if (page.reviewThreads) {
      for (const thread of page.reviewThreads.nodes) {
        const comments = [...thread.comments]
        let pageInfo = thread.commentsPageInfo
        while (pageInfo.hasNextPage) {
          const nextPage = parseReviewThreadCommentsPage(
            await input.runGh(
              buildReviewThreadCommentsArgs({
                after: pageInfo.endCursor,
                threadId: thread.id,
              }),
            ),
          )
          comments.push(...nextPage.nodes)
          pageInfo = nextPage.pageInfo
        }
        reviewThreads.push({
          id: thread.id,
          comments,
          isOutdated: thread.isOutdated,
          isResolved: thread.isResolved,
        })
      }
      cursors.reviewThreads = page.reviewThreads.pageInfo.endCursor
      includes.reviewThreads = page.reviewThreads.pageInfo.hasNextPage
    }
  }

  return {
    changedFiles: changedFiles.filter(Boolean),
    discussionComments,
    reactions,
    reviewSummaries,
    reviewThreads,
  }
}
