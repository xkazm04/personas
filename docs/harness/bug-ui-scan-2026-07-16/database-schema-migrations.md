# Database Schema & Migrations — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. FK-hygiene rebuild of `persona_prompt_versions` silently drops five live columns and the one-production unique index
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/db/migrations/fk_hygiene.rs:237-265 (vs. src-tauri/src/db/migrations/initial.rs:82-90, 290-306)
- **Scenario**: A user upgrades from an install whose `persona_prompt_versions` table predates the FK retrofit. On boot, `initial::run()` first ALTERs the table to add `design_context`, `last_design_result`, `resolved_cells`, `icon`, `color` (and creates the `idx_ppv_one_production` unique partial index). Later in the same boot, `run_incremental` → `fk_hygiene::migrate_persona_prompt_versions` fires (FK count < 1) and rebuilds the table from a hard-coded 8-column shape that omits all five columns and lists only two of the three indexes.
- **Root cause**: `recreate_with_fk` pins a table shape frozen at ADR time, while `initial.rs` keeps additively evolving the same table every boot. The two migration layers disagree about the canonical column set, and the copy uses an explicit `columns_csv` that excludes the newer columns — so the rebuild "succeeds" (row counts match) while discarding column data.
- **Impact**: (a) Any snapshot data in the five columns on a legacy DB is permanently destroyed (the pre-boot backup is the only recovery). (b) For the remainder of that session the columns do not exist at all — `repos/execution/metrics.rs:110` and `commands/design/build_sessions.rs:2490` INSERT into `design_context, last_design_result, resolved_cells, icon, color` and will fail with "no such column" until the next restart re-ALTERs them (empty). (c) `idx_ppv_one_production` is gone for the session, so two `tag='production'` rows per persona can be created, violating the invariant the index enforces.
- **Fix sketch**: Make `recreate_with_fk` copy the intersection of old/new columns dynamically (read `pragma_table_info` of the old table), or update the prompt-versions rebuild shape + `index_sqls` to include every column/index that `initial.rs` establishes before `run_incremental` runs. Add a test that runs `initial::run` then forces the rebuild and asserts the five columns survive.

## 2. `recreate_with_fk` gates commit on a whole-database `pragma_foreign_key_check` — unrelated legacy orphans permanently brick startup
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/db/migrations/fk_hygiene.rs:137-142
- **Scenario**: A legacy DB still needs any fk_hygiene rebuild (e.g. `team_memories`, added to the sweep 2026-05-24, so even previously-migrated installs re-enter this path once). The same DB contains a pre-existing FK violation in a completely different table — exactly the situation `db/mod.rs` documents as real ("We've still observed orphans accumulate in real installs", mod.rs:260-270, e.g. `build_sessions` rows whose persona is gone). `pragma_foreign_key_check` with no argument scans the ENTIRE database, returns >0, and `recreate_with_fk` returns `Err`.
- **Root cause**: The post-rebuild verification is scoped to the wrong granularity: it was meant to catch violations the rebuild itself introduced, but it inherits every historical violation anywhere in the file. The compensating sweep (`cleanup_orphan_rows`, mod.rs:272-275) runs only AFTER `run_incremental` succeeds, so the state that fails the check is never repaired.
- **Impact**: `init_db` fails, the app refuses to start, and every subsequent boot fails identically (the orphan is durable). The user is locked out of all their data with no in-app remediation; migration abort intended as "leave the original table intact" becomes a permanent boot loop.
- **Fix sketch**: Scope the check to the rebuilt table: `SELECT COUNT(*) FROM pragma_foreign_key_check('<table_name>')`. Alternatively (or additionally) run the orphan sweep before fk_hygiene, or downgrade whole-DB violations outside the target table to a `tracing::error!` instead of an abort.

## 3. `QueryBuilder::offset` without `limit` binds a parameter that is never emitted — queries fail at runtime with a parameter-count error
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/query_builder.rs:281-289 (offset at 224-228)
- **Scenario**: A caller paginates with `qb.offset(page * size)` but conditionally skips `qb.limit(...)` (e.g. "no cap" mode), or calls `offset` before deciding on a limit. `build_clauses` handles only `has_limit && has_offset` and `has_limit` alone; the `has_offset`-only branch emits no SQL, yet `offset()` already pushed the value into `params`.
- **Root cause**: The builder's core invariant ("every pushed param has exactly one `?N` in the SQL") is broken by one asymmetric branch; the SQL text and the param vector are maintained independently and this path forgets the SQL half. A secondary fragility in the same block: `LIMIT ?{total-1} OFFSET ?{total}` assumes limit/offset were pushed last — any `where_*`/`set` call made after `limit()` silently mis-numbers the placeholders and binds the wrong values.
- **Impact**: `stmt.query_map(qb.params_ref()...)` fails with rusqlite `InvalidParameterCount` — the list endpoint errors out at runtime with no compile-time or build-time signal. In the reordering case, worse: the query runs with WHERE values swapped into LIMIT positions, returning wrong rows.
- **Fix sketch**: In `build_clauses`, emit `LIMIT -1 OFFSET ?{total}` for the offset-only case (SQLite's documented "no limit" idiom), or make `offset()` a no-op with a debug assert unless `has_limit`. Store limit/offset values in dedicated fields and push them into `params` only inside `build_clauses` so call order can't skew indices.

## 4. `validate_value` boolean allow-list has drifted: `autonomous_deliberation` and `autonomous_review_triage_high` accept garbage that consumers then read as `false`
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/settings_keys.rs:806-831 (keys at 342-344, 411-413)
- **Scenario**: An external writer (management API, MCP tool, or a frontend regression) writes `"1"`, `"TRUE"`, or `"yes"` to `autonomous_deliberation` or `autonomous_review_triage_high`. `validate_value` falls through to `_ => Ok(())` because neither key is in the `"true"|"false"` match arm (nor are `director_brain_enabled`, `health_digest_enabled`, `qwen_connector_tools`). The write persists; the consumer's `value == "true"` comparison yields `false`.
- **Root cause**: The typed contract is a manually maintained parallel list of keys, and it drifts as keys are added — the file itself records this exact failure mode already happening once (line 674: `AUTONOMOUS_DELIBERATION` "was missing here, so `set` rejected the write and the toggle could never be enabled" — it was then added to `ALLOWED_KEYS` but not to the boolean validation arm).
- **Impact**: Success theater at a trust boundary the module's doc-comment explicitly claims to close: the settings write returns Ok, the UI shows the autonomy toggle as saved, but deliberation / high-severity review triage silently never runs (or, for a gate read as "not false", behaves opposite to intent). For `autonomous_review_triage_high` this is an autonomy/safety-relevant toggle whose observed state and effective state diverge.
- **Fix sketch**: Add the missing boolean keys to the `"true"|"false"` arm. Longer-term, replace the parallel lists with a single registry table (key → default → validator) and add a unit test asserting every `*_DEFAULT: bool` key routes through the boolean validator.

## 5. User-DB incremental ALTERs and the episode `session_id` backfill swallow every error, not just "duplicate column"
- **Severity**: Low
- **Category**: bug
- **File**: src-tauri/src/db/mod.rs:396-455
- **Scenario**: On the boot that should apply the multiconv columns, one of the `let _ = conn.execute_batch(...)` ALTERs on `companion_session`/`companion_node`/`companion_background_job` fails for a real reason — `SQLITE_BUSY` past the 5s timeout (second app instance, external tool holding `personas_data.db`), disk-full, or I/O error. The failure is indistinguishable from the expected "duplicate column name" success path, so nothing is logged and init reports "User data database initialized successfully".
- **Root cause**: The idempotency idiom ("duplicate column is the success path") is implemented by discarding the error entirely instead of matching on it, and the same blanket `let _` was copied onto statements where failure is never expected (the `session_id` backfill UPDATE and the `idx_companion_node_session` CREATE INDEX).
- **Impact**: The session runs with a half-applied companion schema: multiconversation queries fail with "no such column: session_id", scheduled proactive messages lose their `scheduled_for` lane, and pre-existing episodes stay unscoped — all with zero log breadcrumb tying it to the swallowed ALTER. Self-heals on a later clean boot, but the in-session failures are unattributable.
- **Fix sketch**: Wrap the ALTERs in a helper that inspects the error and ignores only messages containing "duplicate column name", logging anything else at warn/error. Let the backfill UPDATE and CREATE INDEX propagate errors (`?`) — they have no expected failure mode.
