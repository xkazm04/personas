# tauri:daemon (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 1 high / 1 medium / 1 low)
> Context group: Core Libraries & State | Files read: 2 | Missing: 0

## 1. Non-headless event ping-pong: daemon re-claims and releases the same events every 5s tick, and can starve headless events
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: churn-starvation
- **File**: src-tauri/src/daemon/runtime.rs:76 (claim), :118-121 (release back to pending)
- **Scenario**: `consume_headless_events` claims the 5 oldest pending events (`claim_pending` orders by `created_at ASC` with no headless filter — verified in `src-tauri/src/db/repos/communication/events.rs:237-253`), then releases non-headless ones back to `pending`. Released events keep their `created_at`, so the very same rows are re-claimed on the next 5s tick, forever, until the windowed app processes them. If the windowed app is closed and ≥5 of the oldest pending events target non-headless personas, headless events behind them are never claimed at all.
- **Root cause**: The claim query has no knowledge of persona headlessness; the daemon filters after claiming and returns rejects to the same queue position it drew them from.
- **Impact**: Steady-state write churn every 5s while idle — 1 `UPDATE...RETURNING` + up to 5 `persona.get_by_id` lookups + 5 `update_status` calls (each of which does its own SELECT validation), i.e. ~11 statements/tick doing zero work, plus WAL growth from constant status flips pending→processing→pending. Worse, a full window of non-headless events blocks daemon-owned headless triggers indefinitely — the daemon's core job silently stops.
- **Fix sketch**: Push the filter into SQL: add a `claim_pending_headless(pool, limit)` variant that joins `personas` on `target_persona_id` and claims only `WHERE p.headless = 1` (events with NULL target can be claimed too since the daemon marks them Delivered). This removes the ping-pong writes and the starvation in one change. Alternatively, `ORDER BY` a bump-on-release column so rejected events go to the back of the queue — but the JOIN filter is simpler and strictly better here.

## 2. `daemon_tick`'s `_owns` parameter is dead — the lock's ownership claim is never enforced at execution time
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/daemon/runtime.rs:46
- **Scenario**: `daemon_bin.rs:199` passes the CLI-configured `--owns` list into every tick, but `daemon_tick` binds it as `_owns` and never reads it. The lock file advertises the claim (the windowed UI yields per `owns[]`, via `trigger_type_to_kind` in `engine/background.rs:1362`), yet the daemon side consumes all pending events regardless of which trigger kind produced them.
- **Root cause**: Phase-0 scaffolding — the parameter was threaded through in anticipation of kind-scoped consumption that was never implemented.
- **Impact**: Maintenance hazard: the ownership protocol is asymmetric (UI honors `owns[]`, daemon ignores it), and the dead parameter falsely suggests the filtering exists. A daemon started with a narrow `--owns cron` still executes events fired by kinds it did not claim.
- **Fix sketch**: Either implement the filter — resolve each claimed event's originating trigger kind and release events for unclaimed kinds back to pending (can be combined with finding #1's SQL-side filter) — or delete the parameter from `daemon_tick`'s signature and the `daemon_bin.rs` call site, with a comment on `LockFileContents::owns` noting enforcement is UI-side only.

## 3. Hand-mirrored per-source policy filter duplicates `AmbientContextFusion`'s logic and will drift when a source is added
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/daemon/runtime.rs:306-314
- **Scenario**: `inject_ambient_for_daemon` re-implements the source→policy-flag mapping (`"clipboard" => policy.clipboard`, etc.) that the windowed app's `AmbientContextFusion` applies in-memory; the comment itself says "Mirror the per-source policy filter." Adding a fourth signal source (e.g. a notifications monitor) requires remembering to update both copies or the daemon silently drops (`_ => false`) the new source.
- **Root cause**: The filter predicate lives in fusion's method rather than on `SensoryPolicy`, so the daemon path string-matches by hand.
- **Impact**: Bounded but real drift risk between the two execution paths that the module docs explicitly promise render "byte-identical" prompts.
- **Fix sketch**: Add `SensoryPolicy::allows_source(&self, source: &str) -> bool` in `engine/ambient_context.rs` containing the match, and call it from both `AmbientContextFusion` and `inject_ambient_for_daemon`. The `_ => false` default stays in one place.
