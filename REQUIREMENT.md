# REQUIREMENT

## Overview

`spec-while` is a single-feature, task-by-task orchestrator for Spec Kit workspaces.

It consumes:

- `spec.md`
- `plan.md`
- `tasks.md`
- the `specs/<feature>/...` directory layout

It does not execute the Spec Kit command runtime. It does not run Spec Kit hooks, checklists, or skill installations.

## Workspace Resolution

The workspace root must contain a `specs/` directory.

Resolution order:

1. `--workspace`
2. upward search from `cwd`

Feature resolution order:

1. `--feature`
2. `SPECIFY_FEATURE`
3. current git branch prefix
4. the only feature directory under `specs/`

## Commands

### `spec-while run`

- initializes `.while` for the feature when no state exists
- resumes from existing `.while/state.json` when state already exists
- requires a clean worktree
- supports `--until-task`

### `spec-while rewind --task <taskId>`

- requires the target task to be `done`
- requires a clean worktree
- resets git to the parent of the task commit
- deletes and rebuilds the feature `.while` directory

## Task Graph

`tasks.md` is normalized into a task graph.

Each task must define:

- `Paths`
- `Acceptance`
- `Review Rubric`
- `Max Iterations` or `Max Attempts`

Optional fields include:

- `Goal`
- `Depends`
- `Verify`
- `storyId`

Validation rejects:

- duplicate task ids
- unknown dependencies
- dependency cycles
- missing required fields
- invalid attempt counts

## Agent Contract

The orchestrator uses two agent roles:

- implement
- review

Implement receives:

- the current task
- `generation`
- `attempt`
- previous findings
- `spec`
- `plan`
- `tasksSnippet`
- scoped `codeContext`

Review receives:

- the current task
- `generation`
- `attempt`
- previous findings
- `spec`
- `plan`
- `tasksSnippet`
- implement result
- verify result
- `actualChangedFiles`

## Workflow Semantics

For each runnable task:

1. start a new attempt
2. run implement
3. run optional verify commands
4. run review
5. if the task passes, update `tasks.md`, create a git commit, and then mark the task as `done`

The zero gate for completion requires:

- review verdict `pass`
- no findings
- all acceptance checks passing
- verify passing

If no verify commands are configured, verify is treated as a successful no-op result.

## Git-First Completion

`done` means:

- the task passed implement, verify, and review
- the task commit succeeded

Each completed task creates one commit with this message format:

```text
Task <taskId>: <task title>
```

The commit includes source changes and the updated `tasks.md`.

The `.while` directory is excluded from task commits.

Completed task state stores `commitSha`.

## Rewind Semantics

`rewind` reverts both code and workflow state.

After git reset:

- tasks whose `commitSha` is still an ancestor of `HEAD` are restored as `done`
- all rolled-back tasks return to `pending`
- the explicitly rewound task and every rolled-back task enter a new `generation`
- `attempt` resets to `0` for those tasks

`tasks.md` checkboxes are restored by git history, not by manual string edits.

## Scope and Verification

`paths` remain part of each task definition, but they are a soft scope:

- they limit implementation code context
- they guide review
- they do not act as a hard failure gate

`actualChangedFiles` are derived from git diff against `HEAD`.

`Verify` is optional:

- when present, commands run in order
- when absent, verify returns a successful no-op result

## Runtime Storage

Each feature stores runtime data under:

```text
specs/<feature>/.while/
```

The runtime layout includes:

- `state.json`
- `graph.json`
- `report.json`
- `events.jsonl`
- `tasks/<taskId>/g<generation>/a<attempt>/implement.json`
- `tasks/<taskId>/g<generation>/a<attempt>/verify.json`
- `tasks/<taskId>/g<generation>/a<attempt>/review.json`

`.while` is runtime state, not the long-term source of truth.
