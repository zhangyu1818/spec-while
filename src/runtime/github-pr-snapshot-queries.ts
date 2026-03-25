export function buildReviewThreadCommentsArgs(input: {
  after?: null | string
  threadId: string
}) {
  const args = ['api', 'graphql', '-F', `threadId=${input.threadId}`]
  if (input.after) {
    args.push('-f', `commentsAfter=${input.after}`)
  }
  args.push(
    '-f',
    `query=${[
      'query($threadId: ID!, $commentsAfter: String) {',
      '  node(id: $threadId) {',
      '    ... on PullRequestReviewThread {',
      '      comments(first: 100, after: $commentsAfter) {',
      '        pageInfo { hasNextPage endCursor }',
      '        nodes { author { login } body createdAt path line url }',
      '      }',
      '    }',
      '  }',
      '}',
    ].join('\n')}`,
  )
  return args
}

export function buildSnapshotArgs(input: {
  commentsAfter?: null | string
  filesAfter?: null | string
  includeComments: boolean
  includeFiles: boolean
  includeReactions: boolean
  includeReviews: boolean
  includeReviewThreads: boolean
  number: number
  owner: string
  reactionsAfter?: null | string
  repo: string
  reviewsAfter?: null | string
  reviewThreadsAfter?: null | string
}) {
  const args = [
    'api',
    'graphql',
    '-f',
    `owner=${input.owner}`,
    '-f',
    `repo=${input.repo}`,
    '-F',
    `number=${input.number}`,
    '-F',
    `includeFiles=${String(input.includeFiles)}`,
    '-F',
    `includeReactions=${String(input.includeReactions)}`,
    '-F',
    `includeReviews=${String(input.includeReviews)}`,
    '-F',
    `includeComments=${String(input.includeComments)}`,
    '-F',
    `includeReviewThreads=${String(input.includeReviewThreads)}`,
  ]
  if (input.filesAfter) {
    args.push('-f', `filesAfter=${input.filesAfter}`)
  }
  if (input.reactionsAfter) {
    args.push('-f', `reactionsAfter=${input.reactionsAfter}`)
  }
  if (input.reviewsAfter) {
    args.push('-f', `reviewsAfter=${input.reviewsAfter}`)
  }
  if (input.commentsAfter) {
    args.push('-f', `commentsAfter=${input.commentsAfter}`)
  }
  if (input.reviewThreadsAfter) {
    args.push('-f', `reviewThreadsAfter=${input.reviewThreadsAfter}`)
  }
  args.push(
    '-f',
    `query=${[
      'query(',
      '  $owner: String!,',
      '  $repo: String!,',
      '  $number: Int!,',
      '  $includeFiles: Boolean!,',
      '  $includeReactions: Boolean!,',
      '  $includeReviews: Boolean!,',
      '  $includeComments: Boolean!,',
      '  $includeReviewThreads: Boolean!,',
      '  $filesAfter: String,',
      '  $reactionsAfter: String,',
      '  $reviewsAfter: String,',
      '  $commentsAfter: String,',
      '  $reviewThreadsAfter: String',
      ') {',
      '  repository(owner: $owner, name: $repo) {',
      '    pullRequest(number: $number) {',
      '      files(first: 100, after: $filesAfter) @include(if: $includeFiles) {',
      '        pageInfo { hasNextPage endCursor }',
      '        nodes { path }',
      '      }',
      '      reactions(first: 100, after: $reactionsAfter) @include(if: $includeReactions) {',
      '        pageInfo { hasNextPage endCursor }',
      '        nodes { content createdAt user { login } }',
      '      }',
      '      reviews(first: 100, after: $reviewsAfter) @include(if: $includeReviews) {',
      '        pageInfo { hasNextPage endCursor }',
      '        nodes { author { login } body fullDatabaseId state submittedAt url }',
      '      }',
      '      comments(first: 100, after: $commentsAfter) @include(if: $includeComments) {',
      '        pageInfo { hasNextPage endCursor }',
      '        nodes { author { login } body createdAt databaseId url }',
      '      }',
      '      reviewThreads(first: 100, after: $reviewThreadsAfter) @include(if: $includeReviewThreads) {',
      '        pageInfo { hasNextPage endCursor }',
      '        nodes {',
      '          id',
      '          isResolved',
      '          isOutdated',
      '          comments(first: 100) {',
      '            pageInfo { hasNextPage endCursor }',
      '            nodes { author { login } body createdAt path line url }',
      '          }',
      '        }',
      '      }',
      '    }',
      '  }',
      '}',
    ].join('\n')}`,
  )
  return args
}
