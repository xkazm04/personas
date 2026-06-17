# Test Mastery — Repositories & Models
> Total: 8 findings (2 critical, 4 high, 1 medium, 1 low)

## 1. Cancel-clobber / zombie-resurrection CAS guards are untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/execution/executions.rs:831-912 (`update_status_if_not_final`), 706-775 (`update_status_if_running`), 593-630 (`set_claude_session_id`/`set_model_used_actual`/`set_cache_tokens`)
- **Current test state**: none (only `claim_for_instance`, partition, and plain CRUD are covered)
- **Scenario**: A completed/failed result landing in the window just after the user clicks Stop must NOT overwrite a `cancelled` row back to `completed` (lost-cancel + success theater). The split `WHERE` clause — cancel may enrich `running`|`cancelled`, every other status only advances `running` — is the entire protection and has zero assertions. A refactor that drops the `status IN ('running','cancelled')` branch, or that lets `set_claude_session_id` write without the `status='running'` guard, would silently resurrect terminal rows and ship green.
- **Root cause**: The CAS logic was added as a documented data-loss fix (see W6 memory: "lost-cancel + success theater") but no regression test was written; the file's tests stop at the happy-path lifecycle.
- **Impact**: A user's explicit cancel is silently reverted to "completed", or a terminal execution flips back to `running` and becomes a permanent zombie — corrupts billing/SLA truth and erodes trust in Stop.
- **Fix sketch**: Three deterministic tests on a `init_test_db()` pool: (a) row at `cancelled`, call `update_status_if_not_final(Completed)` → assert returns `false` AND status stays `cancelled`; (b) row at `cancelled`, call with `status=cancelled` + metrics → returns `true`, metrics enriched, status still `cancelled`; (c) row at `completed`, call `set_claude_session_id` → assert `claude_session_id` unchanged (guard held). Invariant: **terminal status is a sink; only same-status cancel-enrichment is allowed.**

## 2. Idempotency dedup on execution create is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/execution/executions.rs:420-491 (`create_with_idempotency`, `get_by_idempotency_key`)
- **Current test state**: none
- **Scenario**: A non-leader driver (MCP/REST) that retries an enqueue with the same idempotency key must get back the EXISTING execution, not a second one. A regression (e.g. key not consulted, or consulted before the row is committed) double-creates the run → the persona executes twice and is billed twice. `synthesize_review.rs:100` already depends on this path in production but nothing asserts the dedup.
- **Root cause**: The dedup branch returns early on a key hit, but `create()` passes `None`, so the happy path tests never exercise a key collision.
- **Impact**: Duplicate executions = double API spend + double side effects (notifications, writes) for retried/at-least-once callers.
- **Fix sketch**: Test: `create_with_idempotency(..., Some("k1"), false)` twice → assert both calls return the SAME `id` and `get_recent` shows exactly one row; then a third call with `Some("k2")` → distinct id. Invariant: **same idempotency key ⇒ exactly one execution row, returned on every call.**

## 3. CredentialLedger pure-logic methods have no tests (LLM-generatable batch)
- **Severity**: high
- **Category**: llm-generatable
- **File**: src-tauri/src/db/models/credential_ledger.rs:120-254 (`parse`, `increment_refresh_backoff`, `clear_refresh_backoff`, `record_oauth_refresh`, `is_in_refresh_backoff`, `resolve_tolerance`, `merge_health`/`merge_oauth`/`merge_usage`)
- **Current test state**: none (`grep "mod tests"` → 0)
- **Scenario**: This typed ledger drives OAuth refresh backoff, re-auth gating, healthcheck/anomaly tolerance and usage metering. `increment_refresh_backoff` indexes `backoff_steps[step_idx]` with `.min(len-1)` — an off-by-one or an empty-steps slice would panic or pick the wrong delay; `resolve_tolerance` maps env→threshold (prod 0.05 vs default 0.8) and clamps; `merge_oauth` must touch ONLY oauth fields. All pure, all deterministic, all high-value — ideal for a generated batch that asserts invariants (not snapshots).
- **Root cause**: Pure model methods were added incrementally; no test module was ever created on the model file.
- **Impact**: A bad backoff/tolerance regression silently weakens credential security (e.g. retries a dead token forever, or trips prod anomaly tolerance to dev levels).
- **Fix sketch**: LLM-generatable `#[cfg(test)] mod tests`. Invariants to assert: backoff fail_count is **strictly monotonic** and `step_idx` saturates at the last step (never panics, even for the longest streak); `clear_refresh_backoff` then `is_in_refresh_backoff()==false`; `record_oauth_refresh` increments count, sets expiry, and clears `needs_reauth`; `resolve_tolerance` returns 0.05 for "prod"/"production", 0.8 default, and clamps an out-of-range `anomaly_tolerance` into 0..=1; `merge_oauth` leaves health/usage fields byte-identical. Pin a fixed `backoff_steps` slice for determinism.

## 4. Ledger-wipe safety guard `sanitize_ledger_json` is untested
- **Severity**: high
- **Category**: missing-assertion
- **File**: src-tauri/src/db/repos/resources/credentials.rs:619-626 (`sanitize_ledger_json`), used by `update_metadata`, `patch_metadata_on_conn`, `update_ledger`, `append_healthcheck_metadata`, `increment_refresh_backoff_atomic`
- **Current test state**: none
- **Scenario**: `sanitize_secrets` is a regex log-redactor, not JSON-aware; applied to metadata containing keys like `session_id`/`auth_type` it can produce invalid JSON, and the next `CredentialLedger::parse` falls back to `Default`, **wiping the entire ledger** (OAuth expiry/backoff, healthcheck history, usage counters). The guard returns the ORIGINAL string whenever sanitization breaks JSON. This was a documented data-loss bug (W5 ledger-wipe); the fix has no test, so a future "simplify" that drops the validity check silently reintroduces total ledger loss.
- **Root cause**: The function is private and the fix shipped without a regression test.
- **Impact**: A metadata write destroys OAuth/healthcheck state → credentials silently lose refresh tokens / re-auth flags; agents start failing auth with no trace.
- **Fix sketch**: Make `sanitize_ledger_json` testable (it's same-module, so `#[cfg(test)]` in the file works). Tests: (a) input that the redactor would corrupt → assert output is **still valid JSON and equals the original** (no wipe); (b) plain JSON with no secret-shaped substrings → passes through; (c) round-trip via `update_ledger` writing a ledger with `session_id` in `custom`, then `read_ledger` → assert oauth/healthcheck fields survive. Invariant: **a metadata write can never make the persisted blob unparseable.**

## 5. `is_field_sensitive` security classifier is untested (LLM-generatable)
- **Severity**: high
- **Category**: llm-generatable
- **File**: src-tauri/src/db/repos/resources/credentials.rs:61-100 (`is_field_sensitive`, `sensitivity_map_for_connector`, `NON_SENSITIVE_KEYS`), 1390-1407 (`classify_field_type`)
- **Current test state**: none (CRUD tests pass `&HashMap::new()`, so no field is ever classified)
- **Scenario**: This decides whether a credential field is encrypted (AES-GCM nonce) or stored as **queryable plaintext**. The contract is "default to sensitive when unknown" and "connector schema flag wins over the heuristic". A regression that flips the fallback to `false`, or that lowercases inconsistently, would store API keys/tokens in plaintext. Pure function, trivially testable, maximum blast radius.
- **Root cause**: Classification logic only runs when fields are present; the existing tests never supply fields.
- **Impact**: Secrets persisted in plaintext in the local vault — the exact failure the per-field encryption migration exists to prevent.
- **Fix sketch**: LLM-generatable table tests. Invariants: an unknown key with `map=None` ⇒ `true` (sensitive-by-default); a key in `NON_SENSITIVE_KEYS` (case-insensitive, e.g. `"BASE_URL"`) ⇒ `false`; an explicit connector-schema `sensitive=Some(false)` for `api_key` **overrides** the heuristic; absent connector flag defaults to `true`. Add `classify_field_type` cases (`*token*`→`secret`, `port`→`number`, `*url*`→`url`). Invariant: **fields are encrypted unless explicitly proven safe; the safe-list is the only escape hatch.**

## 6. `delete()` cascade + `get_monthly_spend` / circuit-breaker streak unasserted
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/resources/credentials.rs:428-466 (`delete` cascade), src-tauri/src/db/repos/execution/executions.rs:1417-1439 (`get_monthly_spend`), 953-983 (`count_consecutive_real_failures`)
- **Current test state**: none for the orphan-cascade assertions, spend filtering, or the streak-reset logic
- **Scenario**: (a) `delete` manually cascades to 6 dependent tables in one tx (orphan prevention even without `PRAGMA foreign_keys`); the credential CRUD test deletes a credential with no dependents, so it never proves the cascade. (b) `get_monthly_spend` must SUM `cancelled` runs (credits already spent) but EXCLUDE `_ops` chat rows and rows before month start — a wrong filter under- or over-bills budget enforcement. (c) `count_consecutive_real_failures` must RESET on an interleaved success and must EXCLUDE rate/usage/session-limit failures — the whole point of the rewrite (the old code permanently read "N consecutive"); a regex regression re-trips the breaker on a quota storm.
- **Root cause**: These are billing/safety-critical SQL predicates with subtle COALESCE/LIKE/date conditions and no fixtures that populate the edge rows.
- **Impact**: Budget enforcement bills the wrong amount; circuit breaker either never fires or fires spuriously on environmental failures, disabling healthy personas.
- **Fix sketch**: (a) create a credential with an event + field, `delete`, assert `get_fields`/`get_events_by_credential` return empty. (b) seed completed+cancelled+`_ops`+last-month rows, assert spend = sum of in-month billable only. (c) seed `[failed, failed, completed, failed]` newest-first and a `failed` with "rate limit" message → assert streak counts only real, post-success failures. Invariants: **no orphans after delete; spend counts every billable run exactly once; breaker streak resets on success and ignores environmental failures.**

## 7. Macro-generated `lab_crud!` state-transition guard and `crud_update!` partial-update have no direct coverage
- **Severity**: medium
- **Category**: test-structure
- **File**: src-tauri/src/db/macros.rs:425-475 (`lab_crud! update_run_status` → `validate_transition`), 250-311 (`crud_update!`)
- **Current test state**: none directly; correctness rides on whatever each generated repo happens to test
- **Scenario**: `update_run_status` enforces a lab-run state machine via `validate_transition` and rejects illegal transitions with `AppError::Validation`. `crud_update!` builds a dynamic SET clause and skips `None` fields (partial update must not null untouched columns). Both are generated into many repos; a macro edit (e.g. param-index drift in `crud_update!`, or dropping the transition check) breaks every consumer at once but no single test pins the macro contract.
- **Root cause**: Macros are tested only transitively; no representative consumer test asserts the transition rejection or the "None leaves column untouched" property.
- **Impact**: A macro change silently corrupts updates across dozens of tables, or lets a lab run jump to an illegal terminal state.
- **Fix sketch**: One representative test per macro contract (place in a repo that already uses it): `update_run_status` from a terminal state to `running` ⇒ `Err(Validation)`; `crud_update!`-generated `update` with only `name=Some` ⇒ other columns unchanged. Invariant: **partial update never nulls untouched columns; illegal lab transitions are rejected, not silently applied.**

## 8. `collect_rows` row-skip resilience has no test
- **Severity**: low
- **Category**: missing-assertion
- **File**: src-tauri/src/db/repos/utils.rs:5-30 (`collect_rows`)
- **Current test state**: none
- **Scenario**: `collect_rows` deliberately swallows individual corrupted rows (logs + skips) so list endpoints stay resilient. It's used by every `crud_get_all!` and by `get_retry_chains_batch`. The behavior is intentional but unasserted, so a change from "skip one bad row" to "drop the whole list on first error" (or vice-versa) would pass silently and either hide data or crash lists.
- **Root cause**: Small utility added for resilience without a unit test.
- **Impact**: Low — a behavioral drift would degrade list endpoints but not corrupt data; worth pinning because it's a cross-cutting helper.
- **Fix sketch**: Feed an iterator of `[Ok(1), Err(..), Ok(3)]` → assert result is `[1, 3]` (skips the error, keeps the rest). Invariant: **one unmappable row never discards the well-formed rows.**
