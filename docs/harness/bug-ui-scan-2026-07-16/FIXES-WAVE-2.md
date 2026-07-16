# Bug-UI Scan Fix Wave 2 — Theme A: crash-orphaned `running` rows

> 4 commits, 5 findings closed (all High).
> Baseline preserved: cargo check 0 errors; affected-module Rust tests 239 pass / 0 fail; tsc 0 (no TS touched); vitest 2358/2358 unaffected.

## Commits

| # | Commit | Findings closed | Files |
|---|---|---|---|
| 1 | `ae422185a` fix(startup): recover crash-orphaned lab runs and companion approvals | agent-lab #2, approvals-decisions #1 (2×High) | db/repos/lab/mod.rs, commands/companion/approvals.rs, lib.rs |
| 2 | `235356828` fix(executions): stamp started_at on every claim | repositories-models #1 (High) | db/repos/execution/executions.rs |
| 3 | `e732cffdc` fix(healing): validate session id before acquiring the healing slot | self-healing #1 (High) | commands/execution/healing.rs |
| 4 | `1cdada274` fix(automations): serialize delete with triggers, drop bounded snapshot | dev-tools #1 (High) | commands/tools/automations.rs, db/repos/resources/automations.rs |

## What was fixed

1. **Lab runs re-hydrate as phantoms after a crash.** The four `lab_*_runs` tables had no recovery sweep; a dead run stayed `running` and `get_all_active_progress` re-hydrated it (launch disabled, cancel shown, orbit lit) on every persona re-selection. Added `recover_interrupted_lab_runs` at startup. (Corrected the report's `error_message` → the tables' actual `error` column.)

2. **Companion approvals silently vanish after a crash.** `approve_action` flips `pending→running` before awaiting the executor; a crash there leaves it `running` forever while the pending list shows only `pending`. Added `recover_interrupted_approvals` resetting `running→pending` so the un-run decision resurfaces (still consent-freshness gated — a long-stale one shows but can't fire).

3. **Zombie sweep kills legitimately re-claimed runs.** `claim_for_instance` preserved the first attempt's `started_at` across a running→queued→running re-claim via `COALESCE`, so the sweep saw a >30-min-old timestamp on a healthy fresh run, flipped it to `incomplete`, and the real result was then dropped by `update_status_if_running`. A claim IS a run start — stamp `started_at` unconditionally.

4. **Healing slot leaked forever.** `trigger_ai_healing` acquired the per-persona healing slot, then validated `claude_session_id` with a `?`-return that never released it — so a heal on a session-less execution permanently locked the persona out of both AI healing and auto-rollback until restart. Moved the validation ahead of the acquire.

5. **`delete_automation` race + wedge.** It derived in-flight state from a `LIMIT 50` snapshot and never took the `INFLIGHT_TRIGGERS` guard, so a delete could race a live outbound webhook, miss a run older than 50 rows, and be wedged forever by a crash-orphaned `running` row. Now serializes on the guard and counts active runs directly via `count_active_runs` (ignoring rows past a 30-min staleness TTL).

## Verification

| Gate | Before | After |
|---|---|---|
| cargo check (desktop) | 0 errors | 0 errors |
| Rust tests (approvals/lab/executions/healing/automations) | — | 239 pass / 0 fail |
| tsc | 0 | 0 (no TS touched) |
| vitest | 2358/2358 | 2358/2358 (unaffected) |

## Patterns established (catalogue items 5–8)

5. **Every `running`-state table needs a startup sweep** (reinforces #4 from Wave 1) — lab runs, approvals, pipeline runs, executions, jobs, n8n sessions all follow the same reaper shape; when adding a new async-task-backed status table, add the sweep in the same lib.rs startup block.
6. **Acquire the concurrency primitive last, after all fallible validation** — any `?`-return between acquiring an in-memory slot/guard and spawning its releaser leaks it permanently. Validate everything fallible first. (healing)
7. **Write-once vs current-attempt timestamp mismatch** — a `COALESCE(col, ?)` "write once" field read elsewhere as "when the current attempt began" corrupts any row that cycles through the state twice. Stamp it per-attempt. (executions)
8. **Derive liveness from the actual concurrency primitive, not a bounded DB snapshot** — a `LIMIT N` "is anything running?" check races and misses; take/test the same guard the writers hold, count unbounded, and TTL-out crash-orphans so a dead row can't wedge an operation forever. (automations)

## What remains

Themes B–K open. Suggested next: **Wave 3 — Theme B + C (OAuth refresh-token bricking + uncancelled timeouts spawning duplicate work)**.
