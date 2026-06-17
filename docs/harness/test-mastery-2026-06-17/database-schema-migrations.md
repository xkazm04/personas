# Test Mastery — Database Schema & Migrations
> Total: 7 findings (2 critical, 3 high, 1 medium, 1 low)

## 1. Incremental migration idempotency is completely untested (re-run / fresh-vs-legacy)
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/db/migrations/incremental.rs:145-4640 (`run_incremental`, ~80 steps); src-tauri/src/db/mod.rs:1260-1280 (`init_test_db`)
- **Current test state**: none — `incremental.rs` (4976 lines) contains zero `#[test]`. `init_test_db()` runs `run` + `run_incremental` ONCE; nothing runs it twice or asserts the schema shape after.
- **Scenario**: `run_incremental` is invoked on *every app boot*. Many steps mutate data and rebuild tables (`persona_executions`, `persona_triggers`, `n8n_transform_sessions`, `credential_rotation_policies`, `retire_persona_groups`). Each has a hand-written `already_applied`/`has_column`/`sql.contains('…')` guard. If any guard is wrong, the step re-fires every boot — re-running a DROP COLUMN, a `DELETE … WHERE rn=1` dedup, or a full table rebuild — silently corrupting or losing user data on the second launch. Today nothing would catch a broken guard.
- **Root cause**: No test calls `run_incremental` a second time on the same connection and asserts (a) it succeeds and (b) row counts / column sets are unchanged. The `retire_persona_groups` step is especially exposed: `already_applied: |_| Ok(false)` (ALWAYS runs), relying only on inner `has_column`/`IF EXISTS` guards — exactly the pattern a test must pin.
- **Impact**: Data loss or boot-time panic shipped to every install on the *second* launch — the worst kind of regression because the first-boot test suite passes.
- **Fix sketch**: Add `#[cfg(test)] mod tests` in `incremental.rs`: `init_test_db()` then call `migrations::run_incremental(&conn)` again — assert `Ok`. Snapshot `SELECT name,sql FROM sqlite_master ORDER BY name` before/after the second run and assert byte-equal (schema is stable). Seed a handful of rows in rebuilt tables (`persona_executions`, `persona_triggers`) before the re-run and assert row counts are preserved. This single test guards all ~80 steps' idempotency.

## 2. Credential blob→field migration (secrets path) has no test
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/db/migrations/helpers.rs:9-195 (`migrate_blob_credentials_to_fields`, `clear_legacy_credential_blobs`, `assert_credential_blob_invariant`)
- **Current test state**: none — `helpers.rs` has zero `#[test]`; only `classify_field_type` is implicitly exercisable.
- **Scenario**: This is the one-way migration that decrypts each credential's monolithic `encrypted_data` blob, splits it into per-field `credential_fields` rows (re-encrypting sensitive fields, storing non-sensitive ones as plaintext), then *empties the legacy blob*. A bug that mis-classifies a sensitive key as non-sensitive would write a secret as plaintext; a bug in the decrypt/re-encrypt round-trip would silently drop or corrupt a credential (the loop `continue`s past failures, blob is later cleared). No test verifies the round-trip, the sensitive/non-sensitive split, or idempotency (only credentials with no field rows are processed).
- **Root cause**: Migration mixes crypto + DB writes; treated as "infra glue" and never given a unit test, despite being a secrets-handling, irreversible (`clear_legacy_credential_blobs`) data write.
- **Fix sketch**: Test (a) insert a credential whose blob is a JSON object of `{api_key, base_url, refresh_token}`; run the migration; assert a `secret`-classified row is `is_sensitive=1` with a non-empty `iv` that decrypts back to the original, and `base_url` is stored plaintext (`is_sensitive=0`, empty iv). (b) Re-run the migration → assert no duplicate field rows (idempotent). (c) After migration, assert `assert_credential_blob_invariant` finds zero violations and the blob columns are empty. (d) Round-trip invariant: decrypted field value == original blob value for every key — the business invariant is *no secret is lost or downgraded to plaintext*.

## 3. `cleanup_orphan_rows` startup data-deletion sweep is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/mod.rs:292-333 (`cleanup_orphan_rows`)
- **Current test state**: none — `db/mod.rs` `#[cfg(test)]` block only defines `init_test_db`; no `#[test]` for this DELETE sweep.
- **Scenario**: On every `init_db`, this runs `DELETE FROM <table> WHERE persona_id NOT IN (SELECT id FROM personas)` across 12 tables. Two failure modes slip through today: (1) the list drifts out of sync with the schema (a table renamed/dropped → `Err` swallowed as `debug!`, orphans silently retained), and (2) the inverse — a table whose `persona_id` is legitimately nullable for non-orphan reasons could have *valid* rows deleted if the column semantics change. There's no assertion that a genuine orphan is removed AND a valid (parented) row is preserved.
- **Root cause**: Best-effort sweep with per-table error swallowing; never pinned with a positive+negative test.
- **Fix sketch**: For 2-3 representative tables (`persona_executions`, `persona_memories`): insert one row with a valid `persona_id` and one with a dangling `persona_id` *while FK enforcement is off* (mimicking the accumulated-orphan scenario the code targets), call `cleanup_orphan_rows`, assert the dangling row is gone and the valid row survives. Add a guard test that every table name in `ORPHAN_TABLES` exists in a freshly-migrated DB (catches list drift) — invariant: *the sweep never errors-and-skips on a real schema*.

## 4. `persona_executions` table-rebuild migration: no test that data survives the rebuild
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/migrations/incremental.rs:86-141 (`rebuild_executions_table_with_incomplete_status`) + call site 2831-2849
- **Current test state**: none. The FK-hygiene rebuilds (`fk_hygiene.rs`) are well tested, but this executions rebuild — which disables FKs, drops and recreates the table from its own DDL, copies via `INSERT … SELECT *`, replays indexes/triggers, and rebuilds the FTS index — has no coverage.
- **Scenario**: Six tables CASCADE-reference `persona_executions`. The rebuild relies on `FkDisabledGuard` so the `DROP TABLE` doesn't cascade-wipe children, and on `SELECT *` column-order matching. If the guard fails or column order drifts, the rebuild empties child tables (manual_reviews, tool_usage, etc.) or shifts column values. Unlike the FK-hygiene helper, there is no row-count-before==after check in this function and no test exercising it.
- **Root cause**: The rebuild path only fires on *legacy* DBs (fresh DBs already have the widened CHECK via schema.rs), so `init_test_db` never reaches it — the hardest path to hit is also the only untested one.
- **Fix sketch**: Build a legacy-shaped DB: create `persona_executions` with the *old* CHECK (no `'incomplete'`), insert an execution plus a child `persona_manual_reviews` row, then call `rebuild_executions_table_with_incomplete_status`. Assert: execution row preserved, child review row preserved (FK guard worked), the new CHECK now accepts `status='incomplete'` (insert succeeds), and the FTS index returns the row. Invariant: *widening the CHECK loses no rows in the table or its CASCADE children.*

## 5. No quality gate / test asserting `ALLOWED_KEYS` ⊇ every declared settings constant
- **Severity**: high
- **Category**: quality-gate
- **File**: src-tauri/src/db/settings_keys.rs:482-545 (`ALLOWED_KEYS`) vs. the ~60 `pub const … _KEY/_PREFIX` declarations above it
- **Current test state**: exists-but-weak. `settings_keys.rs` tests validate a *sample* of keys, but several declared, actively-used keys are absent from `ALLOWED_KEYS` (e.g. `ATHENA_WAKE_WINDOW_MINUTES`, `LITELLM_*`, `QUALITY_GATE_CONFIG`, `MONTHLY_COST_CEILING_USD` — wait, present — but `COMPANION_MSG_TRIAGE_CURSOR`, `AUTONOMOUS_REVIEW_TRIAGE_HIGH`, `AUTONOMOUS_*` newer flags). A const that's declared and written via `set` but missing from `ALLOWED_KEYS` is rejected by `validate_key` at runtime — a silent feature breakage.
- **Scenario**: A developer adds a new settings key constant + a subscription that writes it, but forgets to append it to `ALLOWED_KEYS`. `validate_key` (enforced in `repos::core::settings::set`) rejects it → the feature silently never persists its setting. No test catches the omission.
- **Root cause**: `ALLOWED_KEYS` is a manually-maintained parallel list to the const declarations; nothing enforces they stay in sync.
- **Fix sketch**: This is partly llm-generatable. Add a test that, for every exact (non-prefix, non-`_DEFAULT`) key constant the module exposes, asserts `validate_key(KEY).is_ok()`. (Since Rust has no const reflection, enumerate them explicitly in the test or via a `const KNOWN_KEYS: &[&str]` audit list the test diffs against `ALLOWED_KEYS`.) Invariant: *every settings key that code can write must validate.* Also add the symmetric `validate_value` round-trip for all bool/numeric-typed keys.

## 6. `QueryBuilder` LIMIT/OFFSET index arithmetic untested for the LIMIT-without-OFFSET and OFFSET-without-LIMIT paths
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/db/query_builder.rs:269-291 (`build_clauses` LIMIT/OFFSET index math)
- **Current test state**: exists-but-weak. Tests cover empty, LIMIT+OFFSET together, and LIMIT-only, but the `has_offset && !has_limit` branch is never exercised, and there's no test that the generated `?N` indices actually match the bound-param positions when WHERE conditions precede LIMIT/OFFSET with a non-trivial count.
- **Scenario**: `build_clauses` computes `LIMIT ?{total-1} OFFSET ?{total}` from `self.params.len()`. If a caller pushes OFFSET without LIMIT (legal via the API), the offset param is silently dropped from the SQL while still bound — producing a `column index out of range` rusqlite error or, worse, a wrong-parameter bind. SQL-injection-safe builders are business-critical: an off-by-one here mis-binds a `persona_id` filter to a LIMIT slot.
- **Root cause**: The index arithmetic is positional and assumes LIMIT precedes OFFSET in push order; the degenerate combinations aren't pinned.
- **Fix sketch**: llm-generatable. Add cases: (a) WHERE + LIMIT-only → assert placeholder index == param count and the bound value lines up; (b) OFFSET-only → assert documented behavior (either it's a no-op or it emits a clause — pin whichever is intended) so the silent-drop can't regress unnoticed; (c) two WHERE conditions + LIMIT + OFFSET → assert exact SQL `… WHERE a=?1 AND b=?2 … LIMIT ?3 OFFSET ?4`. Invariant: *every bound param has exactly one matching placeholder at the right ordinal.*

## 7. `classify_field_type` / `is_valid_prefix_suffix` edge cases under-asserted
- **Severity**: low
- **Category**: llm-generatable
- **File**: src-tauri/src/db/migrations/helpers.rs:346-363 (`classify_field_type`); src-tauri/src/db/settings_keys.rs:568-573 (`is_valid_prefix_suffix`)
- **Current test state**: `classify_field_type` — none (pure function, never directly tested). `is_valid_prefix_suffix` — covered indirectly via `validate_key` tests but not for boundary inputs.
- **Scenario**: `classify_field_type` decides whether a credential field key maps to `secret`/`url`/`identity`/`number`/`text`, which drives the `is_sensitive` default in the blob migration (finding #2). A mis-classification (`"apikey"` not containing `"key"`? `"user_token"` → secret vs identity ordering) flows straight into whether a secret is encrypted. It's a pure deterministic mapping — ideal for a generated table-driven test.
- **Root cause**: Pure helper buried in a migration module; assumed correct.
- **Fix sketch**: llm-generatable table test: `[("api_key","secret"),("client_secret","secret"),("base_url","url"),("port","number"),("username","identity"),("region","text"), …]`. Invariant: *classification matches the sensitivity contract the blob migration depends on.* For `is_valid_prefix_suffix`, add unicode/empty/leading-dash boundary cases.
