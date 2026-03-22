import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export interface WorkspaceSnapshot {
  files: Map<string, string>
}

export interface BoundaryCheckResult {
  actualChangedFiles: string[]
  violations: string[]
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.while'])

async function walk(currentDir: string, rootDir: string, files: Map<string, string>) {
  const entries = await readdir(currentDir, {
    withFileTypes: true,
  })
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name)
    const relativePath = path.relative(rootDir, fullPath).replaceAll(path.sep, '/')
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walk(fullPath, rootDir, files)
      }
      continue
    }
    const content = await readFile(fullPath)
    const hash = createHash('sha1').update(content).digest('hex')
    files.set(relativePath, hash)
  }
}

export async function collectWorkspaceSnapshot(workspaceRoot: string): Promise<WorkspaceSnapshot> {
  const files = new Map<string, string>()
  await walk(workspaceRoot, workspaceRoot, files)
  return { files }
}

export function getBoundaryViolations(input: {
  after: WorkspaceSnapshot
  allowedPaths: string[]
  before: WorkspaceSnapshot
}): BoundaryCheckResult {
  const changed = new Set<string>()
  const allFiles = new Set([
    ...input.before.files.keys(),
    ...input.after.files.keys(),
  ])
  for (const file of allFiles) {
    if (input.before.files.get(file) !== input.after.files.get(file)) {
      changed.add(file)
    }
  }
  const allowed = new Set(input.allowedPaths.map((item) => item.replaceAll(path.sep, '/')))
  const actualChangedFiles = [...changed].sort()
  const violations = actualChangedFiles.filter((file) => !allowed.has(file))
  return {
    actualChangedFiles,
    violations,
  }
}
