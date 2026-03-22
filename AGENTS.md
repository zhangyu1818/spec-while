# AGENTS

## Purpose

This file defines how agents should collaborate **when working on the while repository itself**.

## Working Agreements

- Respond in Chinese when interacting with the user in this repository.
- Do not add code comments unless the user explicitly asks for them.
- Prefer `pnpm` for dependency management and script execution.
- Keep documentation aligned with the current implementation. If behavior changes, update the relevant docs in the same change.

## Repository Intent

This repository implements a task orchestrator. The codebase itself is not expected to run its own feature planning workflow during normal development. Most repository work falls into these areas:

- orchestration logic
- runtime persistence
- workspace resolution
- task graph normalization
- agent adapters
- prompt construction
- verification and tests

## Source of Truth

When documents disagree, resolve them in this order:

1. current code
2. tests that reflect current code behavior
3. `REQUIREMENT.md`
4. other documentation

## Architecture Expectations

Changes should preserve the current architectural split:

- core engine for state transitions and report derivation
- orchestrator for workflow execution
- runtime adapters for filesystem, workspace, and verifier behavior
- agent clients for provider integration

Avoid re-coupling state transitions to filesystem or subprocess logic.

## Testing Expectations

Favor tests that reflect real behavior:

- use real filesystem behavior when validating runtime persistence or workspace discovery
- use real verify commands when the scenario depends on subprocess execution
- use fakes only when isolating the orchestration core or agent boundary

Do not add assertions that only exist to increase coverage without protecting meaningful behavior.

## Change Discipline

When modifying behavior, keep these in sync when applicable:

- schema and exported types
- runtime storage layout
- command behavior
- documentation
- tests
