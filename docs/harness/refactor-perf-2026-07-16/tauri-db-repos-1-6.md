# tauri:db/repos [1/6] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 4 medium / 0 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. Write-path memory dedup does a full per-persona table scan on every insert
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/db/repos/core/memories.rs:879
- **Scenario**: `find_normalized_duplicate` is called from `memories::create` (line 318) on EVERY memory insert — a hot path fired by dispatch.rs after executions. It selects `id, content, use_case_id` for ALL non-core/non-archive rows of the persona and runs `normalize_for_dedup` (whitespace-split + lowercase of the full content) over each row in Rust. A chatty persona with a few thousand memories pays O(n · content_len) string work plus a multi-MB row fetch per single insert.
- **Root cause**: Dedup compares a derived value (normalized content) that is not stored, so SQL cannot filter — every candidate row must be pulled and re-normalized in Rust each time.
- **Impact**: Memory writes degrade linearly with memory count; batch flows already worked around it (`batch_create` preloads once), but the single-row `create` path — the one dispatch uses — re-scans per call. This is also duplicated work: the same rows are re-normalized on every insert.
- **Fix sketch**: Persist the normalized form: add a `content_norm` column (or generated column) populated on write, backfill once, and index `(persona_id, use_case_id, content_norm)`. `find_normalized_duplicate` becomes a single indexed point lookup: `SELECT id ... WHERE persona_id=? AND tier NOT IN ('core','archive') AND content_norm=?`. The documented "semantic-dedup hook point" survives — only the equality test moves into SQL.

## 2. Hand-rolled two-list dynamic UPDATE pattern duplicated across repos despite existing macros
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/repos/dev_tools.rs:322
- **Scenario**: `update_project` (dev_tools.rs:322-404, 13 fields), `update_goal` (dev_tools.rs:648-694), `triggers::update` (resources/triggers.rs:373-409), `events::update_subscription` (communication/events.rs:1533-1562), and twin.rs `update_profile`/`update_channel` (twin.rs:175-224, 764-793) all build a dynamic SET clause with `push_field!` and then repeat every field a second time in a manual `if let Some(v) { param_values.push(...) }` chain. The codebase already has `push_field_param!` (db/macros.rs, used in 8 repo files) and `crud_update!` (used by teams.rs, credentials.rs) that fold the two lists into one.
- **Root cause**: Older update functions predate the macros and were never migrated; new fields keep being added to both lists by hand (update_project alone repeats 13 field names twice).
- **Impact**: The SET-clause list and the param list must stay in perfect order-sync manually. A single missed or reordered entry does not fail — it silently binds a value to the wrong column (data corruption class bug), and the pattern is copy-pasted into each new repo. ~250 lines of pure boilerplate across the five sites.
- **Fix sketch**: Convert `update_project`, `update_goal`, `triggers::update`, `update_subscription`, and the twin.rs updaters to `push_field_param!` (which appends the SQL fragment and the boxed param in one statement), or to `crud_update!` where the shape fits. Mechanical change, no behavior difference; each conversion deletes the whole second if-let chain.

## 3. Goal/goal-item reorder issues one autocommit UPDATE per row with no transaction
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/db/repos/dev_tools.rs:709
- **Scenario**: `reorder_goals` (line 709) and `reorder_goal_items` (line 878) loop over the id list and call `conn.execute` per id. Each execute is its own implicit transaction, so a drag-reorder of a 50-goal board performs 50 separate WAL commits (and 50 `chrono::Utc::now().to_rfc3339()` allocations). It also isn't atomic: a failure mid-loop leaves the list half-reordered with duplicate `order_index` values.
- **Root cause**: Missing `unchecked_transaction()`/`transaction()` wrapper around the loop; the same file wraps comparable multi-row writes (e.g. team_assignments::create) in transactions.
- **Impact**: Interactive drag-and-drop latency scales with list size (each commit is an fsync-class operation), and a crash mid-reorder corrupts ordering state that the UI then renders nondeterministically.
- **Fix sketch**: `let tx = conn.unchecked_transaction()?;` around the loop, prepare the UPDATE statement once (`tx.prepare_cached`), compute `now` once, execute per id, then `tx.commit()`. Same shape as `batch_update_importance` in memories.rs.

## 4. Duplicate `strip_html_tags` and triplicate `escape_like` helpers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/repos/core/memories.rs:22
- **Scenario**: `memories.rs:22` defines a private `strip_html_tags` that is byte-for-byte identical to the public `crate::validation::strip_html_tags` (validation/mod.rs:17) — teams.rs already calls the shared one. Separately, an identical private `escape_like` (LIKE-metacharacter escaper) is defined three times: memories.rs:64, communication/reviews.rs:12, resources/team_memories.rs:18.
- **Root cause**: Helpers were copy-pasted into each repo instead of importing the shared implementation / hoisting to a common module.
- **Impact**: A future hardening fix to the entity-decoding order or the LIKE-escape rules (both are security-adjacent: XSS strip and LIKE-injection escaping) must be found and applied in 3-4 places; miss one and the repos silently diverge.
- **Fix sketch**: Delete `memories.rs::strip_html_tags` and import `crate::validation::strip_html_tags` (identical behavior, zero risk). Move `escape_like` into `db::repos::utils` (next to `collect_rows`) and import it from the three call sites.

## 5. `get_reviews_paginated` coverage filter loads and maps the entire table per page
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: unbounded-query
- **File**: src-tauri/src/db/repos/communication/reviews.rs:523
- **Scenario**: When `coverage_filter` is `full`/`partial`, the function runs `SELECT *` over every WHERE-matched `persona_design_reviews` row (no LIMIT), maps each into the full `PersonaDesignReview` struct — including the large `design_result`/`structural_evaluation`/`use_case_flows` JSON blobs — then filters and paginates in Rust. This repeats on every page navigation and every filter tweak in the template gallery.
- **Root cause**: Coverage is computed from the `connectors_used` JSON array vs. the user's credential set, which the SQL layer can't express, so the code falls back to fetch-everything.
- **Impact**: With a few thousand templates (seed catalog + AI-generated + per-run upserts), each gallery page load deserializes megabytes of JSON it immediately throws away; memory and latency scale with table size, not page size.
- **Fix sketch**: Two-phase it: first select only `(id, connectors_used)` (tiny rows), compute the covered id set in Rust, then fetch just the current page via `WHERE id IN (...)` with the existing ORDER BY. Alternatively push the check into SQL with `json_each(connectors_used)` against a temp table of credential service types. Either drops the transfer from full-blob-table to page-sized.

## 6. `dev_tools.rs` is a 5,856-line god module spanning nine unrelated table families
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src-tauri/src/db/repos/dev_tools.rs:1
- **Scenario**: The repo layer is otherwise organized into domain folders (`core/`, `execution/`, `communication/`, `resources/`, `orchestration/`) with files of 700-3,300 lines, but dev_tools.rs alone holds projects, goals, goal-items/UAT gates, standards, scans, ideas, tasks, triage rules, KPIs, dependencies, and the portfolio/attention rollups — 5,856 lines, ~1.8x the next-largest file.
- **Root cause**: Every dev-project feature wave appended to the same file instead of following the existing per-domain module convention.
- **Impact**: Any two agents/PRs touching different dev-tool features conflict in one file; navigation and review cost is disproportionate; the row-mapper/CRUD blocks for unrelated tables interleave (goals code appears at lines 538-1,050 and again at 1,055-1,400+).
- **Fix sketch**: Mechanical split into `db/repos/dev/{projects,goals,ideas_scans,tasks,kpis,portfolio}.rs` with a `dev/mod.rs` re-exporting the current paths (`pub use`) so no caller changes are required. No logic changes — cut on the existing `// ===` section banners, which already delineate the table families.
