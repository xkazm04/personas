# Bug-UI Scan Fix Wave 4 — Theme C: uncancelled timeouts → duplicate/zombie work

> 4 commits, 4 findings closed (all High).
> Baseline preserved: cargo check 0 errors; affected-module Rust tests pass / 0 fail; tsc 0; vitest 2358/2358 unaffected.

## Commits

| # | Commit | Finding closed | Files |
|---|---|---|---|
| 1 | `b3495455c` fix(artist): kill the CLI child on creative-session timeout | artist-studio #1 (High) | commands/artist/mod.rs |
| 2 | `89187c647` fix(team-assignment): cancel the execution on step timeout | team-assignment #2 (High) | engine/team_assignment_orchestrator.rs |
| 3 | `efd2d259e` fix(design): make scoped cancel_design_analysis actually cancel | design-reviews #1 (High) | commands/design/analysis.rs |
| 4 | `099f9e3ca` fix(director): size invoke timeouts for the eval+cleanup double run | director-leadership #3 (High) | src/api/director.ts |

## What was fixed

1. **Artist creative-session timeout was dead code.** The 600s timeout wrapped only the stdout loop; the timeout path fell through to an unconditional `child.wait()` that never returned for a wedged CLI/blender-mcp child — status stuck "running", subprocesses leaked. Now kill-then-reap on the timeout path before returning the error.

2. **Team-assignment step timeout left the execution alive.** `run_step` wrote the step `failed` on timeout but never cancelled the underlying execution, so a retry spawned a second concurrent execution of the same step (conflicting PRs, doubled spend). Now `engine.cancel_execution(exec.id, …)` runs before the failed-write. *(Retry-side non-terminal guard deferred as secondary hardening.)*

3. **Design cancel was a no-op (API-family mismatch).** `spawn_design_run` registers with the single-process domain API (`begin_run`/`set_pid`), but the scoped cancel used the multi-run API (`cancel_run`/`take_run_pid`) against a map that was never populated — so cancel neither set the flag nor found the PID, the CLI kept burning tokens, and `run_design_analysis` overwrote `last_design_result` with the discarded result. Routed the scoped branch through `cancel("design")`, guarded by `get_id("design") == id`.

4. **Director timeouts undersized for the double run.** A single target runs eval (≤360s) + memory-cleanup (≤360s) > the 420s ceiling; a premature reject doesn't cancel the backend, so a retry spawned a duplicate cycle. Raised single-target to 900s and made the batch scale with persona count. *(Backend review-idempotency deferred as secondary hardening.)*

## Verification

| Gate | Before | After |
|---|---|---|
| cargo check (desktop) | 0 errors | 0 errors |
| Rust tests (artist 32, team_assignment 14, design 142) | — | all pass / 0 fail |
| tsc | 0 | 0 |
| vitest | 2358/2358 | 2358/2358 (unaffected; no director test files) |

## Patterns established (catalogue items 12–13)

12. **A timeout must terminate the work, not just stop watching it** — a read/poll-loop timeout that returns while the child process / engine execution keeps running is inverted success theater; kill the child (or `engine.cancel_execution`) on the timeout path, and only then write the terminal status. A retry otherwise duplicates live work.
13. **Cancel must use the SAME registry API the spawn registered with** — a run registered via the single-process domain API can't be cancelled via the multi-run API (different key space); the cancel silently no-ops. When two registry APIs coexist, pin spawn+cancel to one and guard the scoped cancel on an id match.

## What remains

Themes D–K open. Suggested next: **Wave 5 — Theme D (surface swallowed failures / success-theater)**: ConfirmDialog no-feedback, relay `connected:true`, error-registry "Try again", spinner dead-ends (vault/dashboard/cockpit), pipeline empty stdout.

## Cumulative (Waves 1–4)

17 findings closed (4 Critical + 13 High), 0 regressions, on `vibeman/bug-ui-scan-2026-07-16-fixes`. tsc 0 · vitest 2358/2358 · cargo check 0 throughout.
