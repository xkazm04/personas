# tauri:commands/companion [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 3 medium / 1 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. Dev-project resolution block copy-pasted five times in approvals.rs
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/companion/approvals.rs:1492 (also 1565, 1938, 3094, 3198)
- **Scenario**: Any change to how a project is resolved (new match key, different fallback policy, the stale-id note) must be re-applied in five places; they have already diverged — `execute_enqueue_dev_job` grew the "requested X didn't match — using most-recent" note and slash-normalization fix, while `execute_scan_kpis`/`execute_propose_kpi` silently fall back with no note, and `execute_run_browser_test` carries its own variant returning `(test_env_url, name)`.
- **Root cause**: The candidate-collection loop (`project_id`/`project_name`/`name`/`path`, top-level + nested `params`) plus the identical `SELECT id FROM dev_projects WHERE id = ?1 OR name = ?1 OR replace(root_path,'\\','/') = replace(?1,'\\','/')` query plus the most-recent fallback were pasted per executor instead of extracted when the second caller appeared.
- **Impact**: ~50 lines × 5 sites (~250 LOC) of drift-prone logic on the path every Athena dev-tools action takes; the silent-fallback inconsistency means some executors can scan/open the *wrong* project without telling the user while others warn.
- **Fix sketch**: Extract `fn resolve_dev_project(conn: &Connection, params: &serde_json::Value) -> Result<(String, /*matched*/ bool), AppError>` (candidate collection + query + most-recent fallback + matched flag), and a thin wrapper returning the full project row. Replace all five sites; keep the stale-id note behavior everywhere via the `matched` flag.

## 2. approvals.rs is a 4,536-line god module mixing ~40 executors with unrelated concerns
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src-tauri/src/commands/companion/approvals.rs:1
- **Scenario**: Adding one new approval action means editing a file that also contains the autoapprove gate, the fleet confidence matrix, the multiselect TUI keystroke planner, fleet-digest SQL, daily-brief digest SQL, and three LLM directive builders; reviews and merges on this file collide constantly.
- **Root cause**: Every new phase (D, F, G, J, KPI, dev-mode, C2/C3) appended its executors and their helper plumbing into the same file instead of a submodule per domain.
- **Impact**: Highest-churn file in the companion command surface; navigation and conflict cost grows with every phase, and helpers like `gather_fleet_digest`/`build_daily_brief_directive` (pure digest/prompt builders, not approval logic) are invisible to their natural owners.
- **Fix sketch**: Keep `approvals.rs` as the command + dispatch + gate layer (the two `match action` blocks, `load_pending`/`finalize_approval`, autoapprove logic), and move executors into `approvals/{memory,fleet,dev_tools,kpi,team}.rs` submodules. Move `gather_fleet_digest`/`gather_daily_brief_digest` + directive builders next to the proactive-turn code they feed. Mechanical move, no behavior change.

## 3. Duplicated "deliver proactive card now" block in fleet_bridge.rs
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/companion/fleet_bridge.rs:767 (and 918-950)
- **Scenario**: `surface_fleet_orb_note` and the D6 tail of `reconcile_if_dispatched` both perform the identical enqueue_external → mark_delivered → clone-with-status-"delivered" → wrap in `ProactiveDelivery` → emit `PROACTIVE_EVENT` sequence with matching warn-logging; a fix to one (e.g. handling `mark_delivered` failure by not emitting) will be missed in the other.
- **Root cause**: The orb-note path was added later by copying the reconciler's snappy-delivery block instead of extracting it.
- **Impact**: ~30 duplicated lines in one file on the notification-delivery path; behavioral drift here surfaces as inconsistent orb/card behavior that is hard to trace.
- **Fix sketch**: Extract `fn deliver_nudge_now(app, pool, nudge: Nudge) -> Result<(), _>` encapsulating enqueue + mark_delivered + emit (including the Ok(None) dedupe no-op), and call it from both sites.

## 4. Brain Viewer episode list does up to 200 synchronous full-file disk reads per render
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/companion/brain.rs:288
- **Scenario**: Opening the Brain Viewer's Episodes tab calls `companion_list_brain_items("episode")`, which after the SQL query loops over up to 200 rows and does `std::fs::read_to_string` on each episode's full markdown body — solely to extract the one `role:` frontmatter line. This runs inside a **sync** Tauri command, so the whole IPC handler blocks on 200 file reads (episode bodies can be long chat turns), every time the tab is opened or refreshed.
- **Root cause**: `role` isn't stored on the `companion_node` row, so the list view re-derives it from disk frontmatter per item instead of persisting it at append time.
- **Impact**: Hundreds of milliseconds of blocking file I/O per viewer open on a warm cache, worse cold or on a large brain; scales linearly with the 200-row cap and reads far more bytes than needed (whole body vs first ~100 bytes).
- **Fix sketch**: Persist `role` as a column on `companion_node` when the episode is appended (backfill lazily: fall back to the file read only when the column is NULL, then write it back). Cheaper interim fix: read only the first ~256 bytes of each file (`File::open` + `take(256)`) since frontmatter is at the top, and mark the command async or move the loop off the IPC thread.

## 5. gather_fleet_digest runs queries inside nested loops (per team × per goal)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/companion/approvals.rs:1780
- **Scenario**: A whole-fleet `analyze_fleet` iterates every enabled team; per team it runs the executions aggregate, an assignment count, a `personas.design_context` JSON scan, a goals list, and then **two more queries per goal** (to-dos SUM/COUNT and blocker COUNT) plus a last-signal lookup — roughly `teams × (5 + goals × 2)` statements, e.g. ~150 queries for 10 teams × 5 goals.
- **Root cause**: The digest was built incrementally by adding one query per fact needed, instead of aggregating per-team/per-goal facts in set-based SQL.
- **Impact**: Bounded (goals capped at 5, teams typically small) but each pass holds a pooled connection through a long serial query chain on the operational DB; it delays the proactive-turn spawn and contends with hot-path writes while it runs.
- **Fix sketch**: Fold the per-goal to-do and blocker counts into the goals query with LEFT JOIN + GROUP BY (`SELECT g.id, ..., SUM(i.done), COUNT(i.id), COUNT(DISTINCT d.id) FROM dev_goals g LEFT JOIN dev_goal_items i ... LEFT JOIN dev_goal_dependencies d ... GROUP BY g.id`), and compute the per-team execution aggregate for all teams in one GROUP BY query keyed on team id before the loop.

## 6. decision_signatures map grows without pruning
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src-tauri/src/commands/companion/fleet_bridge.rs:181
- **Scenario**: Every fleet session Athena is woken for inserts a `session_id → screen-hash` entry into the static `decision_signatures()` map; entries are never removed, even after the session exits. Over a long-lived desktop run with many spawned/exited fleet sessions the map grows monotonically.
- **Root cause**: The sibling `attention_throttle()` map has an explicit `retain` GC on insert; `decision_signatures()` was added later without the same sweep, and there's no session-exit cleanup hook.
- **Impact**: Small per entry (UUID string + u64) so this is slow growth, not a hot leak — but it's unbounded, and stale entries also mean `screen_matches_last_decision` can compare against a hash from a long-dead session that reused nothing.
- **Fix sketch**: Remove the session's entry when `FleetEventKind::Exited` is processed in `companion_record_fleet_event` (one `sigs.remove(&input.session_id)`), or apply the same `retain`-style GC as the throttle map using a companion timestamp.
