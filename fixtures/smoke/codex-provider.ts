import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CodexAgentClient } from '../../src/agents/codex'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

async function runAgentSmoke() {
  const client = new CodexAgentClient({
    workspaceRoot: repoRoot,
    onEvent(event) {
      const itemType = 'item' in event ? event.item.type : undefined
      process.stderr.write(`[smoke:codex] ${event.type}${itemType ? ` ${itemType}` : ''}\n`)
    },
  })
  const result = await client.implement({
    attempt: 1,
    codeContext: '',
    generation: 1,
    lastFindings: [],
    plan: '# plan',
    spec: '# spec',
    tasksSnippet: '- [ ] T001 Inspect repository',
    task: {
      id: 'T001',
      acceptance: ['Return repository metadata'],
      dependsOn: [],
      maxAttempts: 1,
      parallelizable: false,
      paths: [],
      phase: 'Smoke',
      reviewRubric: ['respond in JSON'],
      title: 'Inspect repository',
      verifyCommands: ['node -e "process.exit(0)"'],
    },
  })

  assert.equal(result.taskId, 'T001')
  assert.match(result.summary, /\S/)
  return result
}

void runAgentSmoke().then((result) => {
  process.stdout.write(`${JSON.stringify({ repoRoot, result }, null, 2)}\n`)
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
