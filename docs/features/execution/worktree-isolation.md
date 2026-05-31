# Per-Execution Git-Worktree Isolation — Design Note

> Status: shipped, **default OFF** (`execution_worktree_isolation` setting).
> Code: `engine/runner/mod.rs` (`run_execution`),
> `commands/infrastructure/dev_tools/workspace.rs` (`ExecutionWorkspace`),
> `db/settings_keys.rs` (the flag).

## The problem

A persona execution does **not** run inside the user's repo by working
directory. Two facts drive the whole design:

1. **The cwd is a scratch dir, not the repo.** `run_execution` spawns the CLI
   with its cwd set to a per-persona scratch directory under
   `std::env::temp_dir()` (`personas-workspace/<persona_id>`), *not* the
   project root. The cwd is for Claude-Code memory / sidecar files, not source.
2. **The repo is reached via `CODEBASE_ROOT_PATH`.** A persona pinned to a
   `dev_project` (via `devProjectId` in its `design_context`) has the project's
   `root_path` injected into the spawned CLI's env as `CODEBASE_ROOT_PATH`
   (alongside `CODEBASE_PROJECT_NAME` / `TECH_STACK` / `PROJECT_ID`). The
   persona's codebase MCP tools resolve **that** path. `CODEBASE_ROOT_PATH` is
   the real repo handle.

So when two executions for the same pinned repo run at once, they both point
`CODEBASE_ROOT_PATH` at the same directory and edit the same files —
clobbering each other.

## The fix

When `execution_worktree_isolation` is ON, each execution gets its own git
worktree forked from the repo's `HEAD`, on branch `personas/exec/<id>`, and
**both** of the things that decide "where does this execution work" are pointed
at the worktree:

- the spawned CLI's **cwd** (the `exec_dir` passed to `CliProcessDriver::spawn`), and
- the **`CODEBASE_ROOT_PATH`** env override (the actual repo handle — only this
  one of the `CODEBASE_*` vars is redirected; the rest stay project metadata).

Two concurrent executions therefore write disjoint working trees and never
collide.

## Why per-execution (not per-run)

There is already a `WorkspaceCoordinator` in `workspace.rs` built around a
**run-owner** model: one pipeline run creates a run worktree plus N member
worktrees, then integrates/cleans them up centrally. That shape is wrong here:

- The cascade execution path that spawns team-member executions has **no
  central run-owner** to instantiate a coordinator, allocate members, and tear
  it down. Executions are admitted individually through the engine queue.
- `WorkspaceCoordinator::new_for_run` creates **two** worktrees (a run worktree
  + a member worktree) — overkill for the single-execution case.

So Slice C adds a focused sibling, `ExecutionWorkspace`, that models exactly
one execution → one worktree → one branch, and reuses the coordinator's
already-proven `git_output` + `validate_id` helpers. Each execution
self-manages its own isolation lifecycle (`new_for_execution` at spawn,
`finalize` after the status emit).

## Why leave-as-branch (no auto-merge)

Finalize removes the worktree directory but **keeps** the branch
(`ExecutionIntegration::LeaveAsBranch`). Auto-merging the execution's branch
into the repo's base branch would **mutate the user's real repository without
consent** — exactly the kind of irreversible side effect a default-OFF,
safety-first feature must avoid. The execution leaves a reviewable branch; a
human decides whether and how to merge it. (`ExecutionIntegration` is an enum
specifically so a future, explicitly-opt-in `Merge` variant can be added
without reshaping the API — but it does not exist today.)

## Loss-prevention + best-effort finalize

- Before removing the worktree, finalize runs `git add -A` then
  `git commit --no-verify` (gpgsign disabled) so any **uncommitted** agent
  edits are committed onto the branch first. Removing a worktree with
  `--force` would otherwise discard them. (A clean tree makes `git commit`
  exit non-zero; that's expected and ignored.)
- Every git step in finalize is best-effort: failures are logged via
  `tracing::warn!` and `finalize` returns `Ok` regardless. A finalize failure
  must **never** fail or panic the execution, which has already completed and
  emitted its status by the time finalize runs.

## Fallback behavior

If the flag is on but the persona is not pinned to a git work tree, or the
worktree can't be created, `run_execution` logs the reason and falls back to
the normal shared per-persona scratch directory. Isolation is an enhancement,
never a hard dependency.
