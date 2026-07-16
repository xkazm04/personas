# tauri:db/repos [2/6] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. recipes::update builds SET clause and param list from two separately-maintained field lists

- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/repos/resources/recipes.rs:130
- **Scenario**: `update()` uses `push_field!` to build the 15-field SET clause (lines 130–159), then a hand-written chain of 15 `if let Some(ref v)` blocks (lines 169–213) re-lists the exact same fields in the exact same order to build `param_values`. Anyone adding/reordering a field in one list but not the other silently shifts every subsequent positional parameter.
- **Root cause**: This file predates (or missed) the `push_field_param!` macro that sibling repos (`skills.rs`, `db_schema.rs`, `automations.rs`, `connectors.rs`) use, which appends to `sets` and `param_values` in one atomic step.
- **Impact**: Real maintenance hazard: a single missed branch writes the wrong value into the wrong column (e.g. `icon` into `color`) with no compile error and no SQL error — data corruption discoverable only by eyeballing rows. ~45 lines of pure duplication.
- **Fix sketch**: Replace each `push_field!(...)` + matching `if let` pair with one `push_field_param!(input.X, "X", sets, param_idx, param_values, clone)` call, mirroring `skills::update_skill`. Delete the manual `param_values` block. Behavior is identical; the field list becomes single-source.

## 2. research_lab.rs bypasses the repo macro conventions — six hand-rolled row mappers, most duplicated twice

- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/repos/research_lab.rs:23
- **Scenario**: Every other repo in this context uses `row_mapper!` (name-based) and shared mappers. `research_lab.rs` instead hand-writes index-based mappers, and duplicates them: the `ResearchProject` mapper appears inline in both `list_projects` (line 23) and `get_project` (line 47); `ResearchHypothesis` in `list_hypotheses` and `create_hypothesis`; likewise `ResearchExperiment`, `ResearchFinding`, `ResearchReport`, `ResearchExperimentRun` — while `ResearchSource` already got the extracted `row_to_source` + `SOURCE_COLUMNS` treatment (line 147), proving the intended pattern.
- **Root cause**: File was written before the `row_mapper!`/column-const conventions and only `create_source` was retrofitted.
- **Impact**: ~150 lines of copy-paste; adding a column to any research table requires touching 2–3 mapper copies plus the SELECT lists, and index-based `row.get(N)` makes a missed edit a runtime `InvalidColumnType` instead of a compile error. Also `timed_query!` instrumentation, applied everywhere else, is absent here, so these queries are invisible to the query-timing telemetry.
- **Fix sketch**: Extract one `fn row_to_X` per entity (name-based `row.get("col")` like the rest of the codebase, or `row_mapper!` where no custom logic is needed) and a `X_COLUMNS` const per table, following the existing `row_to_source` precedent in the same file. Wrap the public fns in `timed_query!` while touching them.

## 3. research_lab create_* functions check out a second pool connection just to re-read the inserted row

- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/db/repos/research_lab.rs:340
- **Scenario**: `create_hypothesis` (line 340), `create_experiment` (line 445), `create_finding` (line 508), and `create_report` (line 565) do `let conn = pool.get()?` for the INSERT and then `let conn2 = pool.get()?` for the follow-up SELECT, even though `conn` is still in scope and usable.
- **Root cause**: Copy-paste of an early pattern; the second checkout was never cleaned up.
- **Impact**: Each create burns a second r2d2 checkout for no reason — under pool pressure (max_size is small) this can block behind other writers, and it doubles the connection-acquisition cost on every create. Cheap to fix, zero risk.
- **Fix sketch**: Reuse `conn` for the read-back (`conn.query_row(...)`), or better, use `INSERT ... RETURNING *` as `recipes::create_with_id` and `external_api_keys::create` already do, eliminating the second query entirely.

## 4. skills::get_persona_skills issues one components query (and one pool checkout) per skill — N+1

- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/db/repos/resources/skills.rs:335
- **Scenario**: `get_persona_skills` fetches the persona's skills in one query, then loops calling `get_components_for_skill(pool, &skill.id)` — each iteration checks out its own pooled connection, opens its own `timed_query!` span, and runs a separate SELECT. This runs on the prompt-assembly path (skills are injected into execution prompts), so it fires on every triggered execution.
- **Root cause**: Per-skill helper reused inside a loop instead of a single batched join/IN query.
- **Impact**: For a persona with N skills: N+1 queries and N+1 pool checkouts per execution. Bounded (N is typically small), but it is pure per-execution overhead on a hot path, and pool checkouts can stall behind concurrent writers.
- **Fix sketch**: Single second query: `SELECT sc.* FROM skill_components sc JOIN persona_skills ps ON ps.skill_id = sc.skill_id WHERE ps.persona_id = ?1 AND ps.enabled = 1 ORDER BY sc.skill_id, sc.created_at`, then group rows into a `HashMap<skill_id, Vec<SkillComponent>>` and zip with the skills list. Keep `get_components_for_skill` for the single-skill callers.

## 5. shared_events::upsert_catalog_batch runs N autocommit upserts with no transaction

- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: missing-batching
- **File**: src-tauri/src/db/repos/communication/shared_events.rs:75
- **Scenario**: The catalog-sync path loops `conn.execute(INSERT ... ON CONFLICT ...)` once per entry on a bare connection. Each statement is its own implicit transaction, so SQLite performs a WAL commit (fsync) per catalog entry; the SQL string is also re-prepared every iteration.
- **Root cause**: Batch helper written without the transaction + `prepare_cached` pattern that `exposure::batch_upsert_provenance` (same context) already demonstrates.
- **Impact**: A catalog refresh of N entries costs N commits instead of 1 — easily 10–50× slower for realistic catalogs, and it holds the write lock repeatedly, stalling concurrent relay/subscription writes. It is also non-atomic: a failure mid-loop leaves a half-updated catalog with no error indicating which half.
- **Fix sketch**: `let tx = conn.unchecked_transaction()?;` (or `pool.get()?` as `mut` + `conn.transaction()?`), `tx.prepare_cached(SQL)` once, execute per entry, `tx.commit()?`. Mirrors `batch_upsert_provenance` in exposure.rs.

## 6. research_lab::get_dashboard_stats runs seven sequential COUNT queries over the same tables

- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: missing-batching
- **File**: src-tauri/src/db/repos/research_lab.rs:588
- **Scenario**: Dashboard load performs 7 separate `query_row` round-trips (total/active projects + 5 table counts). Each is a full statement prepare/execute on the same connection.
- **Root cause**: Incremental accretion of one-counter-at-a-time queries.
- **Impact**: Bounded (COUNTs on small tables), but the dashboard is a user-visible load path and 7 round-trips is 6 more than needed; the two `research_projects` scans in particular are the same table scanned twice.
- **Fix sketch**: Collapse into one statement using scalar subqueries: `SELECT (SELECT COUNT(*) FROM research_projects), (SELECT COUNT(*) FROM research_projects WHERE status NOT IN ('complete')), (SELECT COUNT(*) FROM research_sources), ...` and read the 7 columns from a single row. Alternatively merge the two project counts via `SUM(CASE WHEN ...)` in one pass.
