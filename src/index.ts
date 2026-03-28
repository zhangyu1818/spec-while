import { inspect } from 'node:util'

import arg from 'arg'

import { runCommand } from './commands/run'
import { resolveWorkspaceContext } from './runtime/workspace-resolver'

interface PositionalArgs {
  _: string[]
}

interface RunOptions {
  feature?: string
  untilTaskId?: string
  verbose: boolean
}

function assertNoPositionalArgs(values: PositionalArgs) {
  if (values._.length !== 0) {
    throw new Error(`Unexpected positional arguments: ${values._.join(' ')}`)
  }
}

function parseRunOptions(args: string[]) {
  const values = arg(
    {
      '--feature': String,
      '--until-task': String,
      '--verbose': Boolean,
    },
    { argv: args },
  )
  assertNoPositionalArgs(values)
  const options: RunOptions = {
    verbose: values['--verbose'] ?? false,
  }
  if (values['--until-task']) {
    options.untilTaskId = values['--until-task']
  }
  if (values['--feature']) {
    options.feature = values['--feature']
  }
  return options
}

export async function runCli(argv = process.argv.slice(2)) {
  const [command = 'run', ...args] = argv
  switch (command) {
    case 'run': {
      const options = parseRunOptions(args)
      const context = await resolveWorkspaceContext({
        cwd: process.cwd(),
        ...(options.feature ? { feature: options.feature } : {}),
      })
      const result = await runCommand(context, {
        ...(options.untilTaskId ? { untilTaskId: options.untilTaskId } : {}),
        verbose: options.verbose,
      })
      process.stdout.write(
        `${inspect(result, { colors: false, depth: null })}\n`,
      )
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
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
}

void main().catch(handleFatalError)
