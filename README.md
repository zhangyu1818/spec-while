# task-while

`task-while` is a git-first task orchestrator built around a task source protocol. The published package name and CLI binary are both `task-while`.

It reads workflow settings from `while.yaml`, opens the configured task source, executes one task at a time, reviews the result, integrates approved work, and creates one git commit per completed task. The built-in task sources are `spec-kit`, which consumes `spec.md`, `plan.md`, and `tasks.md` under `specs/<feature>/`, and `openspec`, which consumes an OpenSpec change under `openspec/changes/<change>/`.

It also provides a standalone `batch` command for YAML-driven file processing that is independent from the feature/task orchestration workflow.

## Requirements

- Node.js 18 or newer
- For `run`: a git repository with an initial commit
- For `run`: a workspace with the directory layout required by the selected task source
- For `run`: the files required by the selected task source
- For `run`: a clean worktree before `run`

Current built-in source requirements:

- `task.source: spec-kit`
- `specs/<feature>/spec.md`
- `specs/<feature>/plan.md`
- `specs/<feature>/tasks.md`
- `task.source: openspec`
- `openspec/changes/<change>/proposal.md`
- `openspec/changes/<change>/design.md`
- `openspec/changes/<change>/tasks.md`
- At least one file under `openspec/changes/<change>/specs/**/*.md`

## Install

```bash
pnpm add -D task-while
```

Run it with:

```bash
pnpm exec task-while run
```

## Configuration

`while.yaml` configures the `run` workflow only. When it is absent, the CLI runs `task.source: spec-kit`, `task.maxIterations: 5`, and `workflow.mode: direct` with `codex` for both roles.

```yaml
task:
  source: spec-kit
  maxIterations: 5

workflow:
  mode: direct
  roles:
    implementer:
      provider: codex
    reviewer:
      provider: codex
```

Current status:

- `workflow.mode: direct` uses a local reviewer
- `workflow.mode: pull-request` pushes a task branch, polls GitHub PR review from `chatgpt-codex-connector[bot]`, then squash-merges on approval
- `task.maxIterations` applies globally to every task in the selected source session

Example pull-request mode:

```yaml
workflow:
  mode: pull-request
  roles:
    implementer:
      provider: codex
    reviewer:
      provider: codex
```

## Commands

### `task-while run`

Runs the current feature workflow from the existing `.while` state or initializes a new one. Run it from the workspace root so the current directory contains the source-specific root, such as `specs/` for `spec-kit` or `openspec/changes/` for `openspec`.

```bash
cd /path/to/workspace
pnpm exec task-while run --feature 001-demo
```

Useful flags:

- `--feature <featureId>`: select the feature explicitly
- For `task.source: openspec`, `--feature <featureId>` selects the OpenSpec change id
- `--until-task <taskSelector>`: stop after the target task reaches `done`
- `--verbose`: stream agent events to `stderr`

### `task-while batch`

Runs a standalone YAML-driven batch job. This command does not read `while.yaml`, does not require `specs/`, and does not use the task-source workflow.

```bash
cd /path/to/workspace
pnpm exec task-while batch --config ./batch.yaml
```

Batch config example:

```yaml
provider: codex
workdir: ./src
prompt: |
  Read the target file and return structured output for it.
schema:
  type: object
  properties:
    summary:
      type: string
    tags:
      type: array
      items:
        type: string
  required:
    - summary
```

Batch behavior:

- `workdir` defaults to the current working directory when omitted
- `provider`, `prompt`, and `schema` are required
- each run scans the configured working directory for files
- execution state is written beside the YAML file in `state.json`
- structured results are written beside the YAML file in `results.json`
- `--verbose` prints per-file failure reasons to `stderr`
- rerunning the command resumes unfinished work and skips files that already have accepted results
- when the current `pending` queue is exhausted and `failed` is non-empty, the command persists a recycle transition that moves `failed` back into `pending` for the next round
- the command exits only when both `pending` and `failed` are empty
- there is no retry limit for file-level failures; failed files continue to be retried round by round
- `claude` is accepted as a provider value, but no batch adapter is configured by default in CLI mode

## Task Lifecycle

Each task follows this lifecycle:

1. The implement role receives a task-source-built prompt for the current task.
2. The reviewer evaluates the task-source-built review prompt plus changed-file context and overall risk.
3. If review is approved, `task-while` asks the task source to apply its completion marker, creates the final integration commit, and records integrate artifacts under `.while`.

In `pull-request` mode:

- review creates or reuses `task/<slug>` and an open PR against `main`
- if an open PR exists but the local task branch is missing, review restores the branch from `origin/task/<slug>`
- review creates a checkpoint commit with `checkpoint: Task <taskId>: <title> (attempt <n>)`
- review polls every minute with no default timeout
- review evaluates approval from a fully paginated live GraphQL PR snapshot
- approval is driven by the freshest `chatgpt-codex-connector[bot]` signal after the checkpoint commit
- process restart re-enters `review` or `integrate` and continues the same PR flow
- integrate checks the task source completion marker, creates the final task commit when needed, squash-merges, returns to `main`, and deletes the local task branch

Completion is git-first:

- one completed task = one git commit
- `.while` is runtime state and is not committed

## Built-in `spec-kit` Expectations

The built-in `spec-kit` task source parses raw Spec Kit task lines in file order. It does not require enhanced per-task metadata blocks.

Example:

```md
## Phase 1: Core

- [ ] T001 Implement greeting
- [ ] T002 [P] Implement farewell
- [ ] T010 [P] [US1] Add scenario coverage
```

Current built-in `spec-kit` behavior:

- task ordering follows the order in `tasks.md`
- explicit task dependencies are not extracted from raw task lines
- implement/review prompts include the current task line, the current phase, `spec.md`, `plan.md`, and the full `tasks.md`
- completion is still written back through `tasks.md` checkboxes

## Built-in `openspec` Expectations

The built-in `openspec` task source consumes an existing OpenSpec change directory and aligns implement/review prompts with `openspec instructions apply --json`.

Example configuration:

```yaml
task:
  source: openspec
  maxIterations: 5
```

Example run:

```bash
pnpm exec task-while run --feature example-change
```

Current built-in `openspec` behavior:

- `--feature` maps to `openspec/changes/<change>`
- stable task handles come from explicit numbering in `tasks.md`, such as `1.1` and `2.3`
- implement/review prompts include the current task, task group, `proposal.md`, `design.md`, expanded `specs/**/*.md`, full `tasks.md`, and the OpenSpec apply instruction/state/progress
- completion is still written by `task-while` after review/integrate success; it does not adopt `/opsx:apply`'s immediate checkbox update behavior
- `task-while` consumes OpenSpec artifacts and CLI JSON, but it does not run `/opsx:propose`

Task retry budget is configured globally in `while.yaml`:

```yaml
task:
  maxIterations: 2
```

## What `task-while` Does Not Do

`task-while` does not replace Spec Kit's project-level workflow. It does not run Spec Kit commands, checklists, hooks, or preset-installed skills.

Its contract with the selected task source is simple:

- the task source parses source artifacts and provides prompts plus completion operations
- `task-while` orchestrates implement, review, integrate, and persistence around that protocol

The standalone `batch` command is separate from this contract. It does not use task sources, task graphs, review/integrate stages, or git-first completion.

## Runtime Layout

`run` keeps runtime state under:

```text
<source-entry>/<id>/.while/
```

Important files:

- `state.json`
- `graph.json`
- `report.json`
- `events.jsonl`
- `tasks/<taskHandle>/g<generation>/a<attempt>/implement.json`
- `tasks/<taskHandle>/g<generation>/a<attempt>/review.json`
- `tasks/<taskHandle>/g<generation>/a<attempt>/integrate.json`

`batch` keeps runtime files beside the YAML config:

```text
<config-dir>/
├── batch.yaml
├── state.json
└── results.json
```

`state.json` contains:

- `pending`
- `inProgress`
- `failed`

`failed` is the current round's failure buffer. When `pending` becomes empty, those paths are persisted back into `pending` and retried in the next round. Historical state entries whose files no longer exist are dropped when a new run starts.

`results.json` maps file paths relative to `workdir` to accepted structured output.

## Publishing

Before publishing:

```bash
pnpm lint
pnpm typecheck
AI_AGENT=1 pnpm test
AI_AGENT=1 pnpm tsx fixtures/smoke/codex-e2e.ts
npm pack --dry-run
```
