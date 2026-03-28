# REQUIREMENT

## Overview

`spec-while` is a single-feature, task-by-task orchestrator built around a task source protocol.

It consumes:

- the directory layout required by the selected task source
- the files required by the configured task source

The only public workflow configuration entry is `while.yaml`.

The built-in task sources are:

- `spec-kit`, which consumes `spec.md`, `plan.md`, and `tasks.md` under `specs/<feature>/`
- `openspec`, which consumes `proposal.md`, `design.md`, `tasks.md`, and `specs/**/*.md` under `openspec/changes/<change>/`

It does not execute the Spec Kit command runtime. It does not run Spec Kit hooks, checklists, or skill installations.

## Workflow Preset

An optional `while.yaml` at the workspace root configures task source and workflow behavior.

Current configuration surface:

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

Current support level:

- built-in sources are `spec-kit` and `openspec`
- `task.maxIterations` is a global retry budget applied to every task
- `direct` uses a local reviewer and local integrate
- `pull-request` uses a remote GitHub PR reviewer and squash merge integrate

## Workspace Resolution

The current working directory is the workspace root and must contain the source-specific root directory.

- `task.source: spec-kit` requires `cwd/specs`
- `task.source: openspec` requires `cwd/openspec/changes`

If the required source root does not exist, the CLI fails with a clear user-facing error.

Feature resolution order:

1. `--feature`
2. current git branch prefix for `spec-kit`
3. the only entry under the selected source root

For `task.source: openspec`, `--feature` identifies the OpenSpec change id.

## Commands

### `spec-while run`

- initializes `.while` for the feature when no state exists
- resumes from existing `.while/state.json` when state already exists
- requires a clean worktree
- supports `--until-task`

## Task Graph

The selected task source exposes task handles and dependencies, and the orchestrator derives a validated task topology from that protocol.

For the built-in `spec-kit` source, a valid task is any raw task line matching the generated Spec Kit list format, such as:

```md
- [ ] T001 Implement greeting
- [ ] T003 [P] Add tests
- [ ] T010 [P] [US1] Add scenario coverage
```

The built-in `spec-kit` source:

- preserves task order from `tasks.md`
- records the nearest `##` heading as the task phase label
- does not parse enhanced fields like `Depends`, `Acceptance`, `Review Rubric`, `Goal`, or `storyId`
- exposes no explicit dependencies from raw task lines, so built-in `spec-kit` tasks execute in file order unless later task sources provide dependency data

The built-in `openspec` source:

- parses checkbox task lines from `tasks.md`
- records the nearest `##` heading as the task group label
- uses explicit numbering such as `1.1` or `2.3` as the stable task handle
- falls back to an ordinal-only synthetic handle when no explicit numbering exists
- exposes no explicit dependencies, so tasks execute in file order
- aligns implement/review prompts with `openspec instructions apply --json`, while still keeping checkbox writes under `spec-while` integrate control

Validation rejects:

- duplicate task handles
- unknown dependencies
- dependency cycles
- missing required task lines
- invalid global retry counts

## Agent Contract

The orchestrator uses two agent roles:

- implement
- review

Implement receives:

- `generation`
- `attempt`
- previous findings
- a task-source-built prompt

Review phase context receives:

- `generation`
- `attempt`
- previous findings
- a task-source-built prompt
- implement result
- `actualChangedFiles`

## Workflow Semantics

For each runnable task:

1. start a new attempt
2. run implement
3. run review
4. if review is approved, enter integrate
5. if integrate succeeds, apply the task source completion marker, create a git commit, mark the task as `done`, and record integrate artifacts in `.while`

The zero gate for completion requires:

- review verdict `pass`
- no findings
- all acceptance checks passing

## Git-First Completion

`done` means:

- the task passed implement and review
- the integrate stage succeeded

Each completed task creates one commit with a source-provided subject. For the built-in `spec-kit` source, the format is:

```text
Task <taskId>: <task title>
```

For the built-in `openspec` source, the format is:

```text
Task <changeId>/<taskHandle>: <task title>
```

The commit includes source changes and the task source completion update.

In `pull-request` mode:

- review creates or reuses a task branch derived from `Task <taskId>: <title>`
- review creates a checkpoint commit with `checkpoint: Task <taskId>: <title> (attempt <n>)`
- review opens or reuses a PR against `main`
- review polls the PR every minute with no default timeout
- review collects a fully paginated live GraphQL PR snapshot before evaluating approval or active feedback
- the only supported remote reviewer actor is `chatgpt-codex-connector[bot]`
- approval requires the freshest `+1` reaction after the current checkpoint and no newer active feedback
- active feedback includes unresolved, non-outdated review threads plus reviewer-authored review summaries and discussion comments after the current checkpoint
- process restart during review or integrate re-enters the current pull-request stage instead of restarting `implement`
- if an open PR exists but the local task branch is missing, review/integrate restore the branch from `origin/<branch>`
- if the PR was already squash-merged before state was persisted, integrate treats the merged PR as already completed and finalizes local cleanup on resume
- integrate runs on the task branch, applies the task source completion marker when needed, squash-merges to `main`, then deletes the local task branch

The `.while` directory is excluded from task commits.

Completed task state stores `commitSha`.

## Scope and Verification

`actualChangedFiles` are derived from git diff against `HEAD`.

In `pull-request` mode, review changed-file context comes from the live PR snapshot rather than the local worktree diff.

## Runtime Storage

Each selected feature or change stores runtime data under:

```text
<source-entry>/<id>/.while/
```

The runtime layout includes:

- `state.json`
- `graph.json`
- `report.json`
- `events.jsonl`
- `tasks/<taskHandle>/g<generation>/a<attempt>/implement.json`
- `tasks/<taskHandle>/g<generation>/a<attempt>/review.json`
- `tasks/<taskHandle>/g<generation>/a<attempt>/integrate.json`

`.while` is runtime state, not the long-term source of truth.

For pull-request review recovery, the store must be able to reload the persisted `implement` artifact by `taskHandle + generation + attempt`.
