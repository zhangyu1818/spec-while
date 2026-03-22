import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function ensureDir(targetDir: string) {
  await mkdir(targetDir, { recursive: true })
}

export async function readTextIfExists(filePath: string) {
  try {
    return await readFile(filePath, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

export function isWithinRelativePath(targetPath: string, basePath: string) {
  return targetPath === basePath || targetPath.startsWith(`${basePath}/`)
}

export function parsePorcelainPath(line: string) {
  const rawPath = line.slice(3).trim()
  const renamedSegments = rawPath.split(' -> ')
  return renamedSegments.at(-1) ?? rawPath
}

export function filterPorcelainStatus(lines: string[], ignoredBasePath: string) {
  return lines.filter((line) => {
    const filePath = parsePorcelainPath(line)
    return !isWithinRelativePath(filePath, ignoredBasePath)
  })
}

export async function writeJsonAtomic(filePath: string, value: unknown) {
  const dir = path.dirname(filePath)
  await ensureDir(dir)
  const tempFile = `${filePath}.tmp`
  await writeFile(tempFile, JSON.stringify(value, null, 2))
  await rename(tempFile, filePath)
}
