# spec-while

`spec-while` is a git-first task orchestrator for Spec Kit workspaces.

It reads `spec.md`, `plan.md`, and `tasks.md`, executes one task at a time with an agent, runs optional verify commands, reviews the result, and creates one git commit per completed task.

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

1. The implement agent receives the current task plus `spec.md`, `plan.md`, `tasksSnippet`, and scoped code context.
2. Optional verify commands run.
3. The review agent evaluates acceptance, spec/plan alignment, verify results, changed files, and overall risk.
4. If the task passes, `spec-while` updates `tasks.md`, creates a git commit, and only then marks the task as `done`.

Completion is git-first:

- one completed task = one git commit
- `.while` is runtime state and is not committed
- `rewind` restores both code and workflow state by resetting git and rebuilding `.while`

## `tasks.md` Expectations

`spec-while` consumes Spec Kit style tasks. Each task must define:

- `Paths`
- `Acceptance`
- `Review Rubric`
- `Max Iterations` or `Max Attempts`

`Verify` is optional. When omitted, the task still runs and review sees a no-op verify result.

Example:

```md
- [ ] T001 Implement greeting
  - Goal: Build the greeting helper
  - Paths: src/greeting.ts
  - Depends:
  - Acceptance:
    - greeting helper exists
  - Verify:
    - pnpm test -- greeting
  - Review Rubric:
    - keep naming clear
  - Max Iterations: 2
```

## Scope Model

- `Paths` define the expected primary scope for the task.
- They are used to load code context for implementation and to guide review.
- They are not a hard stop. Review can still approve a task that reasonably touches additional files.

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
- `tasks/<taskId>/g<generation>/a<attempt>/verify.json`
- `tasks/<taskId>/g<generation>/a<attempt>/review.json`

## Publishing

Before publishing:

```bash
pnpm lint
pnpm typecheck
AI_AGENT=1 pnpm test
AI_AGENT=1 pnpm tsx fixtures/smoke/codex-e2e.ts
npm pack --dry-run
```
