import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

function normalizeGlobPath(value: string) {
  return value.replaceAll(path.sep, '/')
}

function escapeRegex(value: string) {
  return value.replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
}

function globToRegExp(pattern: string) {
  const normalized = normalizeGlobPath(pattern)
  let source = ''
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] ?? ''
    const next = normalized[index + 1]
    const nextNext = normalized[index + 2]
    if (char === '*' && next === '*' && nextNext === '/') {
      source += '(?:[^/]+/)*'
      index += 2
      continue
    }
    if (char === '*' && next === '*') {
      source += '.*'
      index += 1
      continue
    }
    if (char === '*') {
      source += '[^/]*'
      continue
    }
    source += escapeRegex(char)
  }
  return new RegExp(`^${source}$`)
}

async function listFilesRecursively(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name)
      if (entry.isDirectory()) {
        return listFilesRecursively(entryPath)
      }
      return [entryPath]
    }),
  )
  return files.flat()
}

async function expandPattern(
  baseDir: string,
  pattern: string,
): Promise<string[]> {
  const isAbsolutePattern = path.isAbsolute(pattern)
  const matchRoot = isAbsolutePattern ? path.parse(pattern).root : baseDir

  if (!pattern.includes('*')) {
    return [isAbsolutePattern ? pattern : path.join(baseDir, pattern)]
  }

  const normalizedPattern = normalizeGlobPath(
    isAbsolutePattern ? path.relative(matchRoot, pattern) : pattern,
  )
  const firstGlobIndex = normalizedPattern.search(/\*/)
  const slashIndex =
    firstGlobIndex === -1
      ? normalizedPattern.length
      : normalizedPattern.lastIndexOf('/', firstGlobIndex)
  const searchPrefix =
    slashIndex <= 0 ? '.' : normalizedPattern.slice(0, slashIndex)
  const searchRoot = path.join(matchRoot, searchPrefix)
  const regex = globToRegExp(normalizedPattern)

  try {
    const files = await listFilesRecursively(searchRoot)
    return files
      .filter((filePath) =>
        regex.test(normalizeGlobPath(path.relative(matchRoot, filePath))),
      )
      .sort((left, right) =>
        normalizeGlobPath(path.relative(matchRoot, left)).localeCompare(
          normalizeGlobPath(path.relative(matchRoot, right)),
        ),
      )
  } catch {
    return []
  }
}

async function readPattern(baseDir: string, pattern: string) {
  const filePaths = await expandPattern(baseDir, pattern)
  const contents = await Promise.all(
    filePaths.map((filePath) => readFile(filePath, 'utf8')),
  )
  return contents.join('\n\n')
}

export async function readContextFileMap(
  baseDir: string,
  contextFiles: Record<string, string>,
): Promise<Map<string, string>> {
  const orderedKeys = ['proposal', 'design', 'specs', 'tasks']
  const remainingKeys = Object.keys(contextFiles).filter(
    (key) => !orderedKeys.includes(key),
  )
  const finalKeys = [
    ...orderedKeys.filter((key) => key in contextFiles),
    ...remainingKeys,
  ]

  const entries = await Promise.all(
    finalKeys.map(
      async (key) =>
        [key, await readPattern(baseDir, contextFiles[key]!)] as const,
    ),
  )

  return new Map(entries)
}
