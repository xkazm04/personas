# Test Mastery — Credential Vault CRUD
> Total: 7 findings (2 critical, 3 high, 2 medium, 0 low)

## 1. `is_mutation` SQL safe-mode classifier has no direct coverage of its keyword set
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/db_query.rs:274-294 (also the `classify_db_query` IPC command at src-tauri/src/commands/credentials/db_schema.rs:139-142 and the write-mode guard at db_query.rs:367)
- **Current test state**: exists-but-weak — only `is_sqlite_read` has tests (db_query.rs:2674-2685, two CTE cases). `is_mutation` — the function that the renderer calls via `classify_db_query` to decide whether to warn before running, AND the gate inside `execute_query` that rejects writes when `allow_mutation=false` — has **zero** direct tests of its own keyword table.
- **Scenario**: A regression that drops `DELETE`/`UPDATE`/`DROP`/`TRUNCATE` from the mutation set, mis-handles a Redis write (`DEL`, `SET`, `HSET`), or breaks the `__UNCLOSED_COMMENT__` fail-safe (db_query.rs:277) would let a destructive statement run against a user's production Supabase/Neon/PlanetScale DB while the UI shows it as a harmless read. The two existing CTE tests target `is_sqlite_read` (a different function) and would all still pass.
- **Root cause**: The classifier was hardened incrementally (CTE bug-hunt 2026-06-07) but the base read/write/Redis keyword behavior was never pinned. `is_mutation` and `is_sqlite_read` diverge (`SHOW`/`DESCRIBE` are reads only in `is_mutation`) and that divergence is unasserted.
- **Impact**: Silent data loss / unauthorized writes against an external customer database — the single highest blast-radius path in this context.
- **Fix sketch**: LLM-generatable table-driven test in db_query.rs `mod tests`. Invariant: every keyword in the read allow-list classifies as non-mutation and everything else as a mutation. Cover `SELECT/SHOW/DESCRIBE/EXPLAIN/PRAGMA/VALUES/WITH(read)` → false; `INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE/GRANT` → true; Redis `GET/MGET/HGETALL` → false, `SET/DEL/HSET/LPUSH` → true; comment-only `-- x` → false; unclosed `/* …` → true (fail-safe); leading-whitespace/lowercase. Assert `is_mutation` and `is_sqlite_read` agree on the shared SQLite verbs.

## 2. `create_credential` "healthcheck_passed is a UX hint, not proof" security fix is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/credentials/crud.rs:57-102 (the whole `commands/credentials/crud.rs` has no `#[cfg(test)]`)
- **Current test state**: none — there are no command-layer tests; only repo-level tests exist (credentials.rs:1409).
- **Scenario**: The comment block at crud.rs:57-62 documents a real prior exploit (bug-hunt 2026-06-07 #3): any IPC caller could stamp a fabricated "Connection verified" badge by passing `healthcheck_passed: true`. The fix forces `healthcheck_passed: None` into the DB input and only treats the flag as a *request* to run a server-side probe. Nothing asserts that a client-supplied `healthcheck_passed: true` never lands in the stored ledger as `healthcheck_last_success` without an actual probe. The same blind spot covers the session-decrypt failure paths (crud.rs:44-48, 130-135, 327-334, 426-431) that must return `Internal("Decryption failed")` and never persist a half-written credential.
- **Root cause**: The command layer mixes IPC plumbing with the security-relevant down-grade of `healthcheck_passed`; it was fixed by inspection, not pinned by a test, so a future refactor that forwards `..input` wholesale (re-introducing the field) is invisible.
- **Impact**: Users trust a forged "healthy/verified" badge on a credential that was never validated; reauth/anomaly logic keys off `healthcheck_last_success`.
- **Fix sketch**: Add command-layer tests (or a focused unit on the `db_input` construction) asserting the created credential's stored ledger has `healthcheck_last_success == None` when no probe ran, even when the input carried `healthcheck_passed: Some(true)`. Add a test that a session-decrypt failure returns `Err(Internal)` and creates **no** credential row.

## 3. `validate_ddl_only` (template-adoption destructive-SQL guard) has no test
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/db_query.rs:301-340 (reached via `execute_db_query(..., ddl_only=true)` at db_schema.rs:178-207)
- **Current test state**: none.
- **Scenario**: This guard is the only thing stopping a hallucinated AI proposal or careless edit during template-adoption DataStep from running `DROP TABLE`/`DELETE`/`ALTER` against the built-in personas database. A regression in the `CREATE TABLE/INDEX/VIEW/TRIGGER` allow-list or the `BEGIN/COMMIT` transaction-control branch (e.g. an over-broad `starts_with("CREATE")` that lets `CREATE … AS SELECT … DROP`, or accidentally allowing `DELETE`) destroys operational data with no failing test.
- **Root cause**: Pure validator added for a specific safety scenario but never pinned; its prefix-matching logic (IF NOT EXISTS / TEMP / TEMPORARY handling, line 322-332) is exactly the kind of string parsing that silently rots.
- **Impact**: Data loss in the app's own SQLite DB during onboarding/template flows.
- **Fix sketch**: LLM-generatable. Invariant: only safe `CREATE TABLE/INDEX/UNIQUE INDEX/VIEW/TRIGGER/TEMP` and tx-control pass; all DML and destructive DDL are rejected with `AppError::Validation`. Cases: `CREATE TABLE x(...)` ok; `CREATE INDEX`, `CREATE TEMP TABLE`, `BEGIN`/`COMMIT`/`ROLLBACK` ok; `DROP TABLE`, `DELETE FROM`, `UPDATE`, `ALTER TABLE`, `TRUNCATE`, empty string (ok), and a mixed-case `dRoP` all rejected/handled.

## 4. `sanitize_ledger_json` ledger-wipe guard is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/resources/credentials.rs:619-626 (used by `update_metadata`, `patch_metadata_on_conn`, `increment_refresh_backoff_atomic`, `append_healthcheck_metadata`, `update_ledger`)
- **Current test state**: none for this function (the surrounding repo test at credentials.rs:1414 covers basic CRUD but never touches metadata sanitization).
- **Scenario**: The function's own doc-comment describes a real data-destruction bug: `sanitize_secrets` is a non-JSON-aware regex redactor that can turn valid ledger JSON (`"session_id":"abc"`) into invalid JSON, after which `CredentialLedger::parse` silently falls back to `Default` and wipes OAuth expiry/backoff, healthcheck history, and usage counters. The guard re-parses the sanitized string and falls back to the original when it is no longer valid JSON. If a refactor reorders that check (or trusts the sanitizer), every metadata write becomes a potential silent ledger wipe — and no test fails.
- **Root cause**: A subtle invariant ("a metadata write must never produce invalid JSON / must never lose ledger fields") enforced by one fragile re-parse, with no regression test guarding it.
- **Impact**: Loss of OAuth refresh state → daily 401s; loss of healthcheck/anomaly history → false health signals.
- **Fix sketch**: LLM-generatable unit. Invariant: `sanitize_ledger_json(meta)` always returns valid JSON, and when sanitization would corrupt the JSON it returns the original byte-for-byte. Feed a ledger string containing keys the redactor matches (`session_id`, `auth_type`, `healthcheck_config`) and assert the result still `serde_json::from_str`s and round-trips all original keys.

## 5. `CredentialLedger` business-logic methods (backoff/tolerance/OAuth) have zero tests
- **Severity**: high
- **Category**: llm-generatable
- **File**: src-tauri/src/db/models/credential_ledger.rs:120-254 (entire file has no `#[cfg(test)]`)
- **Current test state**: none.
- **Scenario**: `increment_refresh_backoff` (line 207) computes exponential OAuth backoff and is the core of refresh-storm protection; `resolve_tolerance` (line 175) drives the anomaly-failure threshold per environment; `is_in_refresh_backoff`/`oauth_expires_at` gate whether the proactive refresh engine acts; `record_oauth_refresh`/`clear_needs_reauth` maintain reauth state. A regression (off-by-one in `step_idx`, wrong env→threshold mapping, tolerance not clamped to 0..1, `record_oauth_refresh` forgetting to clear `needs_reauth`) silently breaks token keepalive or anomaly scoring with no failing test.
- **Root cause**: Pure, deterministic, dependency-free methods — ideal unit-test targets — were never tested; coverage stopped at the repo I/O layer.
- **Impact**: OAuth tokens die un-refreshed (daily-401) or refresh storms hammer providers; anomaly thresholds misfire.
- **Fix sketch**: LLM-generatable batch asserting business invariants (not snapshots): `increment_refresh_backoff` returns monotonically non-decreasing backoff that saturates at the last step and increments fail-count by exactly 1; `resolve_tolerance` returns 0.05 for prod, 0.50 for dev/staging, 0.8 default, and clamps an explicit out-of-range tolerance into [0,1]; `record_oauth_refresh` bumps count, sets expiry, and clears `needs_reauth`; `parse(None)`/`parse(invalid)` → `Default`. Use a fixed/injected clock or assert ordering/relative-only for `is_in_refresh_backoff` to stay deterministic.

## 6. Credential field-sensitivity classifiers are untested (secret-leak risk)
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src-tauri/src/db/repos/resources/credentials.rs:61-100 (`sensitivity_map_for_connector`, `is_field_sensitive`) and 1378-1407 (`classify_field_type`, `normalize_field_key`)
- **Current test state**: none — the repo test never exercises sensitivity classification (it passes an empty field map at credentials.rs:1430).
- **Scenario**: `is_field_sensitive` decides whether a field is stored encrypted or as queryable plaintext. The security-critical default is "any key NOT in `NON_SENSITIVE_KEYS` is sensitive" (line 99) and "schema field with no explicit flag defaults to sensitive" (line 78). If a refactor flips the fallback to default-plaintext, a `password`/`api_key`/`token` could be written unencrypted (`iv == ""`). `normalize_field_key` maps legacy camelCase (`refreshToken`→`refresh_token`) on every read; breaking it makes OAuth fields invisible to the runner.
- **Root cause**: Pure mapping/classification functions central to "secrets at rest are encrypted" with no invariant tests.
- **Impact**: Plaintext secret at rest (vault's core promise) or broken OAuth field lookup.
- **Fix sketch**: LLM-generatable. Invariants: unknown key with no schema → sensitive (true); a key explicitly `NON_SENSITIVE_KEYS` (e.g. `base_url`, `port`, case-insensitive) → false; schema `sensitive:false` overrides the heuristic; schema field with no flag → sensitive. For `normalize_field_key`, assert each legacy alias maps to snake_case and unknown keys pass through. For `classify_field_type`, assert `password/token/secret/key`→`secret`, `url/endpoint/host`→`url`, `port`→`number`.

## 7. `update_with_fields` "clear-to-empty actually deletes encrypted rows" invariant not asserted
- **Severity**: medium
- **Category**: missing-assertion
- **File**: src-tauri/src/db/repos/resources/credentials.rs:388-420 (the `Some(empty map)` vs `None` semantics)
- **Current test state**: exists-but-weak — `test_credential_crud` (credentials.rs:1414) updates name/blob columns but never passes a field map, so the `Some(field_map)` DELETE-then-reinsert branch and the `Some(empty)` "revoke a leaked key" case are never executed.
- **Scenario**: The comment at line 389-392 spells out the security intent: `Some(empty)` must DELETE the old `credential_fields` rows (so revoking a leaked key removes the decryptable secret), while `None` leaves fields untouched. A regression that treats empty-map as "no change" silently retains a revoked secret in the vault, decryptable forever.
- **Root cause**: The two-state field semantics (authoritative-set vs leave-alone) is load-bearing but only documented, not tested.
- **Impact**: Revoked/rotated secret persists at rest after the user believed they cleared it.
- **Fix sketch**: Repo test: create a credential with one sensitive field (assert a `credential_fields` row with non-empty iv exists), call `update_with_fields(..., Some(empty HashMap))`, assert `get_fields` returns empty; then a separate call with `None` after re-adding a field asserts the field survives. Reuses the existing in-memory `init_test_db` harness.
