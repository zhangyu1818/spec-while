import type {
  PullRequestDiscussionComment,
  PullRequestReaction,
  PullRequestReviewSummary,
  PullRequestReviewThreadComment,
} from '../core/runtime'

export interface ConnectionPage<T> {
  nodes: T[]
  pageInfo: {
    endCursor: null | string
    hasNextPage: boolean
  }
}

export interface PullRequestSnapshotPage {
  comments: ConnectionPage<PullRequestDiscussionComment> | null
  files: ConnectionPage<string> | null
  reactions: ConnectionPage<PullRequestReaction> | null
  reviews: ConnectionPage<PullRequestReviewSummary> | null
  reviewThreads: ConnectionPage<ReviewThreadPageNode> | null
}

export interface ReviewThreadPageNode {
  comments: PullRequestReviewThreadComment[]
  commentsPageInfo: {
    endCursor: null | string
    hasNextPage: boolean
  }
  id: string
  isOutdated: boolean
  isResolved: boolean
}

export interface RequestedSnapshotConnections {
  comments: boolean
  files: boolean
  reactions: boolean
  reviews: boolean
  reviewThreads: boolean
}

function asBoolean(value: unknown) {
  return value === true
}

function asNullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asNullableString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function asNumericId(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function asRecord(value: unknown) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function invalidGraphQLError(label: string) {
  return new Error(`Invalid GraphQL connection: ${label}`)
}

function missingGraphQLError(label: string) {
  return new Error(`Missing GraphQL connection: ${label}`)
}

function requirePageInfo(value: unknown, label: string) {
  const record = asRecord(value)
  if (!record) {
    throw invalidGraphQLError(`${label}.pageInfo`)
  }
  if (record.endCursor !== null && typeof record.endCursor !== 'string') {
    throw invalidGraphQLError(`${label}.pageInfo.endCursor`)
  }
  if (typeof record.hasNextPage !== 'boolean') {
    throw invalidGraphQLError(`${label}.pageInfo.hasNextPage`)
  }
  if (record.hasNextPage && typeof record.endCursor !== 'string') {
    throw invalidGraphQLError(`${label}.pageInfo.endCursor`)
  }
  return {
    endCursor: record.endCursor,
    hasNextPage: record.hasNextPage,
  }
}

function requireConnectionRecord(value: unknown, label: string) {
  const record = asRecord(value)
  if (!record) {
    throw missingGraphQLError(label)
  }
  if (!Array.isArray(record.nodes)) {
    throw invalidGraphQLError(`${label}.nodes`)
  }
  return {
    nodes: record.nodes as Record<string, unknown>[],
    pageInfo: requirePageInfo(record.pageInfo, label),
  }
}

function parseConnection<T>(
  value: unknown,
  label: string,
  mapNode: (node: Record<string, unknown>) => T,
): ConnectionPage<T> {
  const record = requireConnectionRecord(value, label)
  return {
    nodes: record.nodes.map((node) => mapNode(node)),
    pageInfo: record.pageInfo,
  }
}

function parseRequestedConnection<T>(input: {
  label: string
  mapNode: (node: Record<string, unknown>) => T
  requested: boolean
  value: unknown
}): ConnectionPage<T> | null {
  if (!input.requested) {
    return null
  }
  return parseConnection(input.value, input.label, input.mapNode)
}

export function parseReviewThreadCommentsPage(
  raw: string,
): ConnectionPage<PullRequestReviewThreadComment> {
  const payload = JSON.parse(raw) as {
    data?: {
      node?: {
        comments?: Record<string, unknown>
      }
    }
  }
  return parseConnection(
    payload.data?.node?.comments,
    'reviewThread.comments',
    (node) => toReviewThreadComment(node),
  )
}

export function parseSnapshotPage(
  raw: string,
  requested: RequestedSnapshotConnections,
): PullRequestSnapshotPage {
  const payload = JSON.parse(raw) as {
    data?: {
      repository?: {
        pullRequest?: Record<string, unknown>
      }
    }
  }
  const repository = asRecord(payload.data?.repository)
  const record = asRecord(repository?.pullRequest)
  if (!record) {
    throw new Error('Missing GraphQL node: repository.pullRequest')
  }
  return {
    comments: parseRequestedConnection({
      label: 'comments',
      requested: requested.comments,
      value: record.comments,
      mapNode: (node) => toDiscussionComment(node),
    }),
    files: parseRequestedConnection({
      label: 'files',
      requested: requested.files,
      value: record.files,
      mapNode: (node) => asString(node.path),
    }),
    reactions: parseRequestedConnection({
      label: 'reactions',
      requested: requested.reactions,
      value: record.reactions,
      mapNode: (node) => toReaction(node),
    }),
    reviews: parseRequestedConnection({
      label: 'reviews',
      requested: requested.reviews,
      value: record.reviews,
      mapNode: (node) => toReviewSummary(node),
    }),
    reviewThreads: parseRequestedConnection({
      label: 'reviewThreads',
      requested: requested.reviewThreads,
      value: record.reviewThreads,
      mapNode: (node) => toReviewThreadPageNode(node),
    }),
  }
}

function toDiscussionComment(
  item: Record<string, unknown>,
): PullRequestDiscussionComment {
  return {
    id: asNumericId(item.id ?? item.databaseId),
    body: asString(item.body),
    createdAt: asString(item.created_at ?? item.createdAt),
    url: asString(item.html_url ?? item.url),
    userLogin: asString(
      (item.user as null | { login?: unknown })?.login ??
        (item.author as null | { login?: unknown })?.login,
    ),
  }
}

function toReaction(item: Record<string, unknown>): PullRequestReaction {
  return {
    content: toReactionContent(asString(item.content)),
    createdAt: asString(item.created_at ?? item.createdAt),
    userLogin: asString((item.user as null | { login?: unknown })?.login),
  }
}

function toReactionContent(value: string) {
  switch (value) {
    case 'THUMBS_DOWN':
      return '-1'
    case 'THUMBS_UP':
      return '+1'
    default:
      return value.toLowerCase()
  }
}

function toReviewSummary(
  item: Record<string, unknown>,
): PullRequestReviewSummary {
  return {
    id: asNumericId(item.id ?? item.fullDatabaseId),
    body: asString(item.body),
    state: asString(item.state),
    submittedAt: asNullableString(item.submitted_at ?? item.submittedAt),
    url: asString(item.html_url ?? item.url),
    userLogin: asString(
      (item.user as null | { login?: unknown })?.login ??
        (item.author as null | { login?: unknown })?.login,
    ),
  }
}

function toReviewThreadComment(
  item: Record<string, unknown>,
): PullRequestReviewThreadComment {
  return {
    body: asString(item.body),
    createdAt: asString(item.createdAt),
    line: asNullableNumber(item.line),
    path: asString(item.path),
    url: asString(item.url),
    userLogin: asString((item.author as null | { login?: unknown })?.login),
  }
}

function toReviewThreadPageNode(
  item: Record<string, unknown>,
): ReviewThreadPageNode {
  const commentsConnection = requireConnectionRecord(
    item.comments,
    'reviewThreads.comments',
  )
  return {
    id: asString(item.id),
    commentsPageInfo: commentsConnection.pageInfo,
    isOutdated: asBoolean(item.isOutdated),
    isResolved: asBoolean(item.isResolved),
    comments: commentsConnection.nodes.map((comment) =>
      toReviewThreadComment(comment),
    ),
  }
}
