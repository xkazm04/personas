# tauri:commands/communication — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 3 medium / 1 low)
> Context group: Backend Data & Commands | Files read: 10 | Missing: 0

## 1. Production-tag demote/promote logic duplicated — one copy race-safe, the other not
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/communication/observability/prompt_lab.rs:49 (vs :82)
- **Scenario**: `tag_prompt_version` (promote path, lines 64-77) and `rollback_prompt_version` (lines 82-134) both implement "demote current production, promote target". The rollback copy was hardened into a single transaction with a blanket `WHERE tag = 'production'` demote specifically to close a two-production-tags race; the tag copy still does read → conditional demote → promote as three separate autocommit statements, and even swallows a failed demote with `let _ =`.
- **Root cause**: The race fix was applied to one call site instead of extracting the shared "make this version production" operation.
- **Impact**: A concurrent tag/rollback (or a demote failure) can leave two versions tagged `production`, which downstream `get_production_version` consumers resolve arbitrarily; and any future fix must be remembered in two places.
- **Fix sketch**: Extract a `set_production_version(conn, persona_id, version_id)` helper in the repo that runs the blanket demote + promote inside one transaction (the exact SQL already in `rollback_prompt_version:111-119`), and call it from both commands. `tag_prompt_version`'s production branch becomes a one-liner and inherits the atomicity for free.

## 2. `seed_mock_event` lacks the release-build guard `seed_mock_message` has; mock_seed comment is stale
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/commands/communication/events.rs:334 (and mock_seed.rs:85-88)
- **Scenario**: `seed_mock_message` (messages.rs:144-149) explicitly errors in non-debug builds, but its sibling `seed_mock_event` is registered in `invoke_handler` (lib.rs:2050) with no `cfg(debug_assertions)` gate — a release build can inject fake `webhook_received` / `health_check_failed` events (with `project_id = "mock"`) straight into the production event stream, where they flow through CDC, triggers, and the skipped-stats dashboard.
- **Root cause**: The dev-seed guard pattern was applied to one of the two seed commands only. Additionally, mock_seed.rs:85-86's comment claims `seed_mock_messages` "is currently unwired in invoke_handler", which is false — `seed_mock_message` is wired at lib.rs:2049; the `#[allow(dead_code)]` on `MOCK_MESSAGE_TEMPLATES` is actually needed only because the release-build `cfg` removes the consuming block.
- **Impact**: Dev-only data-fabrication surface shipped in release builds; the stale comment misleads the next maintainer into thinking the templates are safe to delete.
- **Fix sketch**: Add the same `#[cfg(not(debug_assertions))] return Err(...)` guard at the top of `seed_mock_event` (or gate both registrations behind `cfg(debug_assertions)` in lib.rs). Rewrite the mock_seed.rs comment to state the real reason for `allow(dead_code)`: the consumer is compiled out in release.

## 3. `monthly_period_start_utc` carries 25 lines of dead timezone-offset machinery
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/commands/communication/observability/metrics.rs:214-241
- **Scenario**: The function accepts `utc_offset_minutes` and computes a local-timezone month boundary via `FixedOffset`, `from_local_datetime().earliest()`, and a manual fallback — but its only caller (`get_all_monthly_spend_with_conn:185`) passes `None`, and the surrounding doc comments (lines 106-114, 178-184) state the offset is *intentionally* ignored so the badge matches the UTC server budget gate.
- **Root cause**: When the UTC-boundary decision was made, the caller was changed to pass `None` but the offset-aware implementation was left behind.
- **Impact**: ~25 lines of unreachable branch logic that actively contradicts the stated invariant ("boundary is UTC") — a future reader may re-wire the offset believing it's supported, silently desyncing the badge from the budget gate.
- **Fix sketch**: Collapse the function to `chrono::Utc::now()` truncated to start-of-month (`with_day(1)` + midnight) formatted as `%Y-%m-%dT%H:%M:%S`, drop the parameter, and drop `_utc_offset_minutes` from `get_all_monthly_spend_with_conn` (keep the ignored `utc_offset_minutes` only on the public `#[tauri::command]` for IPC backward compatibility).

## 4. `get_prompt_versions_bulk` is one IPC but still N pool checkouts + N queries, with unbounded input
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/communication/observability/prompt_lab.rs:32-44
- **Scenario**: The command exists precisely to batch the observability chart-annotation loader, yet it loops `repo::get_prompt_versions` per persona — each iteration does its own `pool.get()` (r2d2 checkout) and its own `SELECT ... WHERE persona_id = ?` (repo metrics.rs:203). With dozens of personas on the observability dashboard this runs on every chart load; `persona_ids` also has no length cap, unlike the DLQ bulk commands which enforce `MAX_BULK_DLQ_BATCH`.
- **Root cause**: The batching stopped at the IPC layer; the data layer was reused per-item instead of getting a set-based query.
- **Impact**: N pool checkouts contend with concurrent commands on the shared pool, and N statement executions where one would do — the exact per-persona overhead the "Architect perf scan Phase D" comment says this command was built to eliminate. Unbounded input lets one call monopolize the pool.
- **Fix sketch**: Add a repo function that takes the id slice and runs a single query — either `WHERE persona_id IN (...)` with a window function (`ROW_NUMBER() OVER (PARTITION BY persona_id ORDER BY version_number DESC) <= ?limit`) or, minimally, hold ONE connection and loop `prepare_cached` statements on it. Cap `persona_ids.len()` (e.g. 200) mirroring the DLQ bulk commands.
