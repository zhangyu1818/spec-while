# spec-while

`spec-while` is a git-first task orchestrator for Spec Kit workspaces.

It reads workflow settings from `while.yaml`, consumes `spec.md`, `plan.md`, and `tasks.md`, executes one task at a time, reviews the result, integrates approved work, and creates one git commit per completed task.

## Requirements

- Node.js 18 or newer
- A git repository with an initial commit
- A Spec Kit workspace with `specs/<feature>/spec.md`, `plan.md`, and `tasks.md`
- A clean worktree before `run` or `rewind`

## Install

```bash
pnpm add -D spec-while
```

Run it with:

```bash
pnpm exec spec-while run
```

## Configuration

`while.yaml` is the only public workflow configuration entry. When it is absent, the CLI runs `workflow.mode: direct` with `codex` for both roles.

```yaml
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

Runs the current feature workflow from the existing `.while` state or initializes a new one.

```bash
pnpm exec spec-while run --workspace /path/to/workspace --feature 001-demo
```

Useful flags:

- `--workspace <path>`: resolve the workspace root explicitly
- `--feature <featureId>`: select the feature explicitly
- `--until-task <taskId>`: stop after the target task reaches `done`
- `--verbose`: stream agent events to `stderr`

### `spec-while rewind`

Rewinds code and workflow state to the point before a completed task.

```bash
pnpm exec spec-while rewind --workspace /path/to/workspace --feature 001-demo --task T001
```

`rewind` performs a hard git reset to the parent of the task commit, deletes the current `.while` directory for that feature, and rebuilds workflow state from the rewound repository state.

## Task Lifecycle

Each task follows this lifecycle:

1. The implement role receives the current task plus `spec.md`, `plan.md`, and `tasksSnippet`.
2. The reviewer evaluates acceptance, spec/plan alignment, changed files, and overall risk.
3. If review is approved, `spec-while` updates `tasks.md`, creates the final integration commit, marks the task as `done`, and records integrate artifacts under `.while`.

In `pull-request` mode:

- review creates or reuses `task/<slug>` and an open PR against `main`
- if an open PR exists but the local task branch is missing, review restores the branch from `origin/task/<slug>`
- review creates a checkpoint commit with `checkpoint: Task <taskId>: <title> (attempt <n>)`
- review polls every minute with no default timeout
- review evaluates approval from a fully paginated live GraphQL PR snapshot
- approval is driven by the freshest `chatgpt-codex-connector[bot]` signal after the checkpoint commit
- process restart re-enters `review` or `integrate` and continues the same PR flow
- integrate checks `tasks.md`, creates the final `Task <taskId>: <title>` commit when needed, squash-merges, returns to `main`, and deletes the local task branch

Completion is git-first:

- one completed task = one git commit
- `.while` is runtime state and is not committed
- `rewind` restores both code and workflow state by resetting git and rebuilding `.while`

## `tasks.md` Expectations

`spec-while` consumes Spec Kit style tasks. Each task must define:

- `Acceptance`
- `Review Rubric`
- `Max Iterations` or `Max Attempts`

Example:

```md
- [ ] T001 Implement greeting
  - Goal: Build the greeting helper
  - Depends:
  - Acceptance:
    - greeting helper exists
  - Review Rubric:
    - keep naming clear
  - Max Iterations: 2
```

## What `spec-while` Does Not Do

`spec-while` does not replace Spec Kit's project-level workflow. It does not run Spec Kit commands, checklists, hooks, or preset-installed skills.

Its contract with Spec Kit is simple:

- Spec Kit produces planning artifacts
- `spec-while` executes tasks from those artifacts

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
- `tasks/<taskId>/g<generation>/a<attempt>/implement.json`
- `tasks/<taskId>/g<generation>/a<attempt>/review.json`
- `tasks/<taskId>/g<generation>/a<attempt>/integrate.json`

## Publishing

Before publishing:

```bash
pnpm lint
pnpm typecheck
AI_AGENT=1 pnpm test
AI_AGENT=1 pnpm tsx fixtures/smoke/codex-e2e.ts
npm pack --dry-run
```
