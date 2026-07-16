# tauri:commands/infrastructure [3/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 2 medium / 2 low)
> Context group: Backend Data & Commands | Files read: 8 | Missing: 0

## 1. Git-checkpoint Tauri commands have no frontend callers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/commands/infrastructure/git_checkpoint.rs:24
- **Scenario**: All four commands (`dev_checkpoint_stage`, `dev_list_run_checkpoints`, `dev_fork_from_checkpoint`, `dev_rollback_to_checkpoint`) are registered in lib.rs:2840-2843 and appear in the generated command-name union, but a repo-wide grep finds zero `invoke(...)` call sites in `src/` — the only frontend hit is the generated type in `src/lib/commandNames.generated.ts`. The engine module `engine/git_checkpoint.rs` is itself only called from these commands and its own tests.
- **Root cause**: fabro F5 feature (docs/plans/fabro-lessons-implementation.md:220) shipped its backend surface but the UI (or engine-pipeline caller) that drives it was never wired up.
- **Impact**: ~130 LOC of exposed, auth-gated IPC surface (including `git reset --hard` semantics) that is currently unreachable — maintenance and audit overhead with no user value; also enlarges the privileged command surface for no reason.
- **Fix sketch**: Confirm with the fabro F5 plan owner whether the UI wiring is imminent. If not, remove the four command wrappers and their lib.rs registrations (keep `engine/git_checkpoint.rs` if the dev-tools pipeline will call it engine-side), or land the caller. Verification needed: dynamic invocation from the dev-tools agent runner outside `src/` was not found but should be double-checked before deletion.

## 2. Mixed auth-gating styles across the infrastructure commands
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: consistency
- **File**: src-tauri/src/commands/infrastructure/qwen_engine.rs:37
- **Scenario**: Within this one context, three auth idioms coexist: hand-rolled `require_auth_sync(&state)?` (qwen_engine.rs, llm_spend.rs, git_checkpoint.rs), hand-rolled async `require_auth(&state).await?` (autopilot.rs:25), and the declarative `#[requires(privileged)]` / `#[requires(cloud)]` macro (cloud_sync.rs). The macro is the dominant codebase pattern (~210 occurrences across 41 files, including `#[requires(auth)]` in commands/core/personas.rs).
- **Root cause**: Files predating (or written in parallel with) the `personas_macros::requires` attribute were never migrated.
- **Impact**: The manual style is easy to forget when adding a new command to these files (a one-line omission silently ships an ungated IPC command), and reviewers must check two conventions instead of one.
- **Fix sketch**: Migrate the manual call sites to `#[requires(auth)]` (matching the tier `require_auth`/`require_auth_sync` enforces), then remove the now-unused imports. Mechanical change; each command body loses its first line. Verify the macro's `auth` tier is semantically identical to `require_auth_sync` before converting the sync commands.

## 3. git_checkpoint module doc contradicts the implementation
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: stale-comment
- **File**: src-tauri/src/commands/infrastructure/git_checkpoint.rs:6
- **Scenario**: The module doc says "The stage→SHA index is returned to the caller to persist; a future enhancement can move it into a `dev_run_checkpoints` table" — but `dev_checkpoint_stage` already persists into `dev_run_checkpoints` (line 38), and `dev_list_run_checkpoints` reads it back.
- **Root cause**: The "future enhancement" landed without updating the module header written when persistence was caller-side.
- **Impact**: Misleads readers about where checkpoint state lives — the exact kind of doc that gets trusted during an incident (rollback/fork debugging).
- **Fix sketch**: Rewrite the header sentence to state that stage→SHA records are persisted in `dev_run_checkpoints` at checkpoint time and queryable via `dev_list_run_checkpoints`.

## 4. Binary probe spawns a `--version` process even for binaries proven absent
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: wasted-spawn
- **File**: src-tauri/src/commands/infrastructure/system/binary_probe.rs:47
- **Scenario**: On every cache miss `get_or_probe` runs both `command_exists_in_path` (a `where`/`which` spawn) and `command_version` (a direct spawn) unconditionally. The health check loops 4 Windows candidates for Claude plus `node`/`nodejs` (health.rs:359, 424) and byom's `test_provider_connection` loops all provider candidates twice (byom.rs:156, 172-174), so each TTL window a machine with missing binaries pays a failed process spawn per absent candidate on top of the unavoidable PATH scan.
- **Root cause**: The two probes are independent calls with no short-circuit; a binary that `where`/`which` cannot find will (almost always) fail the direct spawn too.
- **Impact**: Bounded — a failed CreateProcess/exec is milliseconds — but it doubles process spawns on the health-check path, which the doc itself identifies as slow on Windows with large PATHs. Concurrent cache misses also duplicate the whole probe (no in-flight dedup), stacking the cost.
- **Fix sketch**: In `get_or_probe`, skip `command_version` when `exists_in_path` is false and cache `version: None`. If there is a known case where the direct spawn resolves a binary that `where` misses (e.g. App Paths registry entries), keep the fallback but only for that platform. Optionally hold a per-command in-flight guard so concurrent misses share one probe.
