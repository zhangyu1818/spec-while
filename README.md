# spec-while

`spec-while` is a git-first task orchestrator built around a task source protocol.

It reads workflow settings from `while.yaml`, opens the configured task source, executes one task at a time, reviews the result, integrates approved work, and creates one git commit per completed task. The current built-in task source is `spec-kit`, which consumes `spec.md`, `plan.md`, and `tasks.md` under `specs/<feature>/`.

## Requirements

- Node.js 18 or newer
- A git repository with an initial commit
- A workspace with `specs/<feature>/`
- The files required by the selected task source
- A clean worktree before `run`

Current built-in source requirements:

- `task.source: spec-kit`
- `specs/<feature>/spec.md`
- `specs/<feature>/plan.md`
- `specs/<feature>/tasks.md`

## Install

```bash
pnpm add -D spec-while
```

Run it with:

```bash
pnpm exec spec-while run
```

## Configuration

`while.yaml` is the only public workflow configuration entry. When it is absent, the CLI runs `task.source: spec-kit`, `task.maxIterations: 5`, and `workflow.mode: direct` with `codex` for both roles.

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

### `spec-while run`

Runs the current feature workflow from the existing `.while` state or initializes a new one. Run it from the workspace root so the current directory contains `specs/`.

```bash
cd /path/to/workspace
pnpm exec spec-while run --feature 001-demo
```

Useful flags:

- `--feature <featureId>`: select the feature explicitly
- `--until-task <taskSelector>`: stop after the target task reaches `done`
- `--verbose`: stream agent events to `stderr`

## Task Lifecycle

Each task follows this lifecycle:

1. The implement role receives a task-source-built prompt for the current task.
2. The reviewer evaluates the task-source-built review prompt plus changed-file context and overall risk.
3. If review is approved, `spec-while` asks the task source to apply its completion marker, creates the final integration commit, and records integrate artifacts under `.while`.

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

Task retry budget is configured globally in `while.yaml`:

```yaml
task:
  maxIterations: 2
```

## What `spec-while` Does Not Do

`spec-while` does not replace Spec Kit's project-level workflow. It does not run Spec Kit commands, checklists, hooks, or preset-installed skills.

Its contract with the selected task source is simple:

- the task source parses source artifacts and provides prompts plus completion operations
- `spec-while` orchestrates implement, review, integrate, and persistence around that protocol

## Runtime Layout

Each feature keeps runtime state under:

```text
specs/<feature>/.while/
```

Important files:

- `state.json`
- `graph.json`
- `report.json`
- `events.jsonl`
- `tasks/<taskHandle>/g<generation>/a<attempt>/implement.json`
- `tasks/<taskHandle>/g<generation>/a<attempt>/review.json`
- `tasks/<taskHandle>/g<generation>/a<attempt>/integrate.json`

## Publishing

Before publishing:

```bash
pnpm lint
pnpm typecheck
AI_AGENT=1 pnpm test
AI_AGENT=1 pnpm tsx fixtures/smoke/codex-e2e.ts
npm pack --dry-run
```
