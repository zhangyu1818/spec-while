import { inspect } from 'node:util'

import arg from 'arg'

import { rewindCommand } from './commands/rewind'
import { runCommand } from './commands/run'
import { resolveWorkspaceContext } from './runtime/workspace-resolver'

function assertNoPositionalArgs(values: { _: string[] }) {
  if (values._.length !== 0) {
    throw new Error(`Unexpected positional arguments: ${values._.join(' ')}`)
  }
}

function parseRunOptions(args: string[]) {
  const values = arg({
    '--feature': String,
    '--until-task': String,
    '--verbose': Boolean,
    '--workspace': String,
  }, { argv: args })
  assertNoPositionalArgs(values)
  return {
    feature: values['--feature'],
    untilTaskId: values['--until-task'],
    verbose: values['--verbose'] ?? false,
    workspace: values['--workspace'],
  }
}

function parseRewindOptions(args: string[]) {
  const values = arg({
    '--feature': String,
    '--task': String,
    '--workspace': String,
  }, { argv: args })
  assertNoPositionalArgs(values)
  if (!values['--task']) {
    throw new Error('Missing --task')
  }
  return {
    feature: values['--feature'],
    taskId: values['--task'],
    workspace: values['--workspace'],
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const [command = 'run', ...args] = argv
  switch (command) {
    case 'run': {
      const options = parseRunOptions(args)
      const context = await resolveWorkspaceContext({
        cwd: process.cwd(),
        env: process.env,
        ...(options.feature ? { feature: options.feature } : {}),
        ...(options.workspace ? { workspace: options.workspace } : {}),
      })
      const result = await runCommand(context, {
        ...(options.untilTaskId ? { untilTaskId: options.untilTaskId } : {}),
        verbose: options.verbose,
      })
      process.stdout.write(`${inspect(result, { colors: false, depth: null })}\n`)
      return
    }
    case 'rewind': {
      const options = parseRewindOptions(args)
      const context = await resolveWorkspaceContext({
        cwd: process.cwd(),
        env: process.env,
        ...(options.feature ? { feature: options.feature } : {}),
        ...(options.workspace ? { workspace: options.workspace } : {}),
      })
      const result = await rewindCommand(context, options.taskId)
      process.stdout.write(`${inspect(result, { colors: false, depth: null })}\n`)
      return
    }
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

export async function main() {
  return runCli()
}

export function handleFatalError(error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

void main().catch(handleFatalError)
