#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const entry = path.join(__dirname, '..', 'src', 'index.ts')
const tsxLoader = require.resolve('tsx')
const result = spawnSync(
  process.execPath,
  ['--import', tsxLoader, entry, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
)

if (typeof result.status === 'number') {
  process.exit(result.status)
}
process.exit(1)
