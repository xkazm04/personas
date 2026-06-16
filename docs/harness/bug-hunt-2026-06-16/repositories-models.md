# Bug Hunter — Repositories & Models

> Total: 5 findings (0 critical, 2 high, 2 medium, 1 low)
> Context: repositories-models | Group: Data & Persistence

## 1. Persona name-uniqueness check is a TOCTOU race with no DB constraint behind it
- **Severity**: High
- **Category**: Race condition (read-modify-write without transaction / serialization)
- **File**: `src-tauri/src/db/repos/core/personas.rs:593` (also `update_name` at `:937`)
- **Scenario**: `create()` loops `SELECT 1 FROM personas WHERE project_id=? AND name=?` to find a non-colliding name, then INSERTs the chosen name. The SELECT and INSERT run on a *pooled* connection with **no enclosing transaction**, and the `personas` table (schema.rs:12-38) has **no UNIQUE constraint on `(project_id, name)`** — the only enforcement is this loop. Two concurrent build sessions (or a build session + a manual create) that generate the same generic name ("Email Triage Manager") both read "no collision", both compute suffix `(2)`, and both INSERT. SQLite's single-writer serializes the two INSERTs but neither sees the other's row during its own SELECT, so both succeed.
- **Root cause**: Uniqueness is enforced optimistically across two separate statements with the verification window open; the backing table lacks the UNIQUE index that would make the INSERT fail-and-retry. The code comment even documents that this exact duplication was observed ("five identically-named personas in the DB") — the fix addressed the single-threaded case but not the concurrent one.
- **Impact**: Duplicate persona names within a project reappear under concurrency — the precise failure the code was written to prevent. Users can no longer disambiguate agents in the sidebar; downstream name-based lookups become ambiguous.
- **Fix sketch**: Add `CREATE UNIQUE INDEX idx_personas_project_name ON personas(project_id, name)`, wrap the check+insert in a single `conn.transaction()`, and on a unique-violation from the INSERT re-enter the suffix loop (insert-and-catch instead of look-before-leap).

## 2. Multi-row maintenance sweeps (`cleanup_old_executions`, `sweep_zombie_executions`) run without a transaction → partial completion + interleaving
- **Severity**: Medium
- **Category**: Latent failure (transaction missing across multi-statement mutation)
- **File**: `src-tauri/src/db/repos/execution/executions.rs:1556` (`cleanup_old_executions`); `:1452` (`sweep_zombie_executions`)
- **Scenario**: `cleanup_old_executions` iterates per-persona: it computes a `keep_threshold` with one `SELECT ... LIMIT 1 OFFSET ?`, then issues a separate `DELETE`. Each statement is its own implicit (autocommit) transaction. If the process is killed, or a `pool.get()` error / SQLITE_BUSY surfaces mid-loop, some personas are pruned and others are not — and the loop returns an `Err` discarding the count of what was already committed. `sweep_zombie_executions` similarly does an UPDATE then a follow-up superseded-check `SELECT` per row across many rows with no outer transaction.
- **Root cause**: These are bulk read-modify-write operations treated as a sequence of independent autocommit statements. There is no `BEGIN ... COMMIT` wrapping the per-persona loop, so atomicity and a consistent snapshot are both absent.
- **Impact**: Non-atomic retention enforcement — disk usage and the activity feed can be left in an inconsistent half-pruned state after a crash; a transient `SQLITE_BUSY` aborts the whole sweep with partial side effects already durable.
- **Fix sketch**: Acquire one `conn`, open `conn.transaction()`, run the whole per-persona loop inside it, and `commit()` once at the end (rollback on error). Bonus: it also gives a consistent read snapshot so the `keep_threshold`/DELETE pair can't be disturbed by a concurrent insert.

## 3. `row_mapper!` `[opt]` and the many `.ok().flatten()` column reads silently swallow real DB/decode errors as `None`/defaults
- **Severity**: Medium
- **Category**: Silent failure (error mapped away, masks corruption)
- **File**: `src-tauri/src/db/macros.rs:116` (`@get … opt → row.get(...).ok().flatten()`); used pervasively, e.g. `personas.rs:395-423`, `executions.rs:24,40,50`
- **Scenario**: `[opt]` expands to `$row.get(col).ok().flatten()`. The intent is "column may not exist on an un-migrated DB", but `.ok()` discards **every** error variant — including `InvalidColumnType` (e.g. a value that doesn't fit the target Rust type) and a genuine `SqliteFailure`. A column that exists but holds an unexpected type, or a transient read error, silently becomes `None` (or the hardcoded default like `"working"` / `0` / `"ready"`). For `persona.trust_level`, `gateway_exposure`, `setup_status`, etc. a corrupt value reads back as the benign default with no log line.
- **Root cause**: The macro conflates "column absent" (which `.ok()` is meant to tolerate) with "column present but unreadable" (which should propagate). `rusqlite` does not distinguish these cleanly at the call site, so the blanket `.ok()` hides both.
- **Impact**: Data corruption and schema drift become invisible at the read boundary; a persona silently flips to `LocalOnly` exposure / `Verified` trust / `working` status instead of erroring, which can mask security-relevant misconfiguration and makes field bugs undiagnosable.
- **Fix sketch**: In the macro, only treat the specific "no such column" error as `None`; propagate all other errors. E.g. match on the error and fall back to default solely for `rusqlite::Error::InvalidColumnName`, returning `Err` otherwise — and emit a `tracing::warn!` when defaulting.

## 4. `collect_rows` drops individual corrupt rows from list results — list endpoints silently return incomplete data
- **Severity**: Medium
- **Category**: Silent failure (partial result presented as complete)
- **File**: `src-tauri/src/db/repos/utils.rs:5`; callers include `crud_get_all!` (`macros.rs:187`) and `personas.rs:444,512,524,543`
- **Scenario**: `collect_rows` maps each row and, on a per-row mapping error, logs a `warn` and **skips** the row, returning `Ok(Vec)` of the survivors. A single row whose `model_profile`/JSON column fails to deserialize, or whose `enabled`/`sensitive` integer is NULL (the mapper does `row.get::<_, i32>("enabled")? != 0`, which errors on NULL), causes that persona/execution to vanish from `get_all`/`get_enabled`/`get_summaries`. The caller and UI receive a successful response with no indication that rows are missing.
- **Root cause**: Resilience-by-skipping was chosen over fail-fast, but there is no signal back to the caller (no skipped-count in the return type) — so "one corrupt row" is indistinguishable from "that entity doesn't exist" at every layer above the repo.
- **Impact**: An agent silently disappears from the sidebar/list while still existing in the DB (and possibly still executing). Operators cannot tell a list is truncated; a scheduler iterating `get_enabled()` would silently stop running the affected persona.
- **Fix sketch**: Return the skipped count to callers (e.g. `(Vec<T>, usize)`) and surface a non-fatal warning to the UI when > 0; or make the row mappers NULL-tolerant (`Option<i32>().unwrap_or(0)`) so well-known nullable columns don't trigger a skip in the first place.

## 5. `blast_radius` chain-dependency check interpolates the persona id into an un-escaped `LIKE` pattern
- **Severity**: Low
- **Category**: Edge case (unescaped LIKE wildcard / substring false-positive)
- **File**: `src-tauri/src/db/repos/core/personas.rs:1432` (persona); mirrored in `resources/credentials.rs:522` (`cd.services LIKE '%'||ptd.name||'%'`)
- **Scenario**: `let pattern = format!("%{}%", id); ... WHERE pt.config LIKE ?1`. The value is correctly bound as a parameter (no SQL injection), but it is used as a raw `LIKE` pattern with no `ESCAPE` clause. The match is an un-anchored substring search against the JSON `config` text, so the id matches anywhere — including inside another field's value, a longer id that contains this id as a substring, or (in the credentials variant) a tool `name` that contains `%`/`_` matches far too broadly. The repo even ships a safe helper (`query_builder::where_like_escape_any`) that this path doesn't use.
- **Root cause**: Substring `LIKE` over a JSON blob instead of structured JSON extraction (`json_extract`/`json_each`), with no wildcard escaping on the interpolated value.
- **Impact**: The delete-confirmation "blast radius" can over-report or mis-attribute chain/credential dependents (false positives), undermining trust in the destructive-action warning. Advisory display only — no data loss.
- **Fix sketch**: Parse `config` as JSON and compare the chain target id exactly (`json_extract(config, '$.target_persona_id') = ?1`), or at minimum route through `where_like_escape` and escape `%`/`_` in the bound value.
