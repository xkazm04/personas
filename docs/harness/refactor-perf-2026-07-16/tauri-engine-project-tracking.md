# tauri:engine/project_tracking — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Backend Engine & Runtime | Files read: 9 | Missing: 0

## 1. Out-of-cadence consolidator re-feeds the full 24h event window, double-counting pulse deltas and re-billing Sonnet for already-consolidated events
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: redundant-reprocessing
- **File**: src-tauri/src/engine/project_tracking/push.rs:264
- **Scenario**: A CLI/skill POSTs `/project-tracking/cli-event` during an active session. `run_out_of_cadence_for_project` selects ALL events from the last 24h (`since = now - 24h`), ignoring `sub.last_pulse_at`, and hands them to `consolidator::run_for_project`. Each push (debounce allows one per 5 min, i.e. up to 12/hour/project) re-renders up to 24h of commits/runs/notes into the Sonnet prompt, and — because it never calls `update_last_pulse_at` — the hourly scheduled tick will also re-sweep overlapping ranges.
- **Root cause**: The push path uses a fixed 24h cutoff instead of the subscription's `last_pulse_at` watermark, and `pulse::upsert_today` treats `snapshot.counts()` as *deltas* to accumulate (`commit_count = commit_count + excluded.commit_count`).
- **Impact**: (a) Token waste on a paid LLM call — a busy day's events (up to 500 commits + 50 notes) get re-prompted on every push instead of just the new slice; (b) the day's `commit_count`/`run_count`/`note_count`/token columns inflate monotonically with each push because the same events are re-added as deltas — the pulse counters shown to Phase 5 become wrong by design, not just stale.
- **Fix sketch**: In `run_out_of_cadence_for_project`, compute `since = watch_since(&sub)` (same helper the scheduler uses) instead of the fixed 24h, and stamp `update_last_pulse_at` after a successful consolidation, mirroring `scheduler::run_project`. Alternatively, pass zero count-deltas for events whose ids were already consolidated (e.g. track a `consolidated_at` column or a per-tick high-water event rowid).

## 2. Watcher events inserted one-by-one: a pool checkout + autocommit INSERT per event
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/engine/project_tracking/scheduler.rs:156 (with events.rs:64)
- **Scenario**: On each hourly tick, `run_project` loops `insert_event` over every collected event. Each call does `pool.get()` (r2d2 checkout) plus a standalone autocommit `INSERT`. Caps allow 500 commits + 50 notes + run events per project per tick, and the first-enable 24h backfill routinely hits hundreds of rows across 10 tracked projects.
- **Root cause**: `events::insert_event` is a per-row API with no batch variant; the scheduler (and `push::do_push`) call it in a loop, so every row pays connection-checkout and its own SQLite commit/fsync.
- **Impact**: Hundreds of individual transactions per tick against the shared user DB — each commit is a WAL sync and briefly holds the write lock, contending with companion/brain writers on the same pool. Bounded (~550/project) but pure waste on a recurring path.
- **Fix sketch**: Add `events::insert_events(pool, project_id, &[EventPayload])` that takes one connection, opens one transaction, uses a cached prepared statement, and commits once. Have `run_project` call it with `all_events`; keep the single-row `insert_event` for the push path's lone Note.

## 3. Dead public API surface: count_events_since, pulse::now, pulse::list_recent, push_cli_event, _now
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/project_tracking/events.rs:96
- **Scenario**: Repo-wide grep finds no callers for: `events::count_events_since` (events.rs:96 — its doc claims "used by the scheduler to decide whether a tick has anything to consolidate", but the scheduler decides via `all_events.len()`), `pulse::now` (pulse.rs:172 — doc claims the consolidator uses it for `last_pulse_at` stamping; the scheduler calls `Utc::now()` directly), `pulse::list_recent` (pulse.rs:64 — Phase 5 ships and uses only `load_today`), `push::push_cli_event` (push.rs:73 — the "in-process helper"; the only entry point is the HTTP handler), and the explicitly `#[allow(dead_code)]` `_now()` placeholder in consolidator.rs:526 whose only stated purpose is keeping an import alive.
- **Root cause**: Phase-numbered speculative scaffolding was written ahead of consumers that either never materialized or were implemented differently (scheduler counts in-memory; prompt.rs uses `load_today`).
- **Impact**: ~80 lines of unused public API with doc comments that actively misdescribe the current call graph, misleading the next reader about how ticks short-circuit and how `last_pulse_at` is stamped. Not user-visible.
- **Fix sketch**: Delete `count_events_since`, `pulse::now`, `pulse::list_recent`, and `_now()` (plus the then-unused `DateTime<Utc>` import in consolidator.rs). For `push_cli_event`, confirm no skill/hook plans to call it imminently; if it stays, remove the stale doc claims — otherwise delete it and `PUSH_HANDLE.get()?`'s only non-HTTP consumer goes with it. `cargo check` will confirm nothing else breaks.

## 4. TickSnapshot.project_name is never read; basename-derivation logic is triplicated and inconsistent with the consolidator's DB lookup
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/project_tracking/consolidator.rs:66
- **Scenario**: Both callers of `TickSnapshot::from_events` (scheduler.rs:173-178, push.rs:287-292) carefully derive a `project_name` via `project_path.rsplit(['/', '\\']).next()` and stuff it into the snapshot — but `run_for_project` ignores the field entirely and issues its own `lookup_project_name` SQL query against `companion_known_project`. The same rsplit snippet appears a third time in companion/prompt.rs:1082-1087.
- **Root cause**: The consolidator was switched to a DB lookup (registry `name` column) without removing the snapshot field or the call-site derivation, leaving two divergent naming sources (path basename vs registry name) plus copy-pasted parsing.
- **Impact**: Dead field, a redundant per-tick SQL query's worth of confusion about which name wins, and three copies of path-parsing logic that can drift (prompt.rs's pulse header can show a different project name than the pulse narrative was generated under, when registry name != folder name).
- **Fix sketch**: Delete `project_name` from `TickSnapshot` and the rsplit blocks in scheduler.rs and push.rs. Pick one naming source — the registry `name` (already fetched by `lookup_project_name`) is authoritative — and expose a small `project_display_name(pool, &sub)` helper (or add `name` to `Subscription`/`list_enabled`'s SELECT, which already JOINs `companion_known_project`) so prompt.rs stops re-deriving from the path.

## 5. Subscription row-mapping closure duplicated verbatim between list_enabled and get
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/project_tracking/subscription.rs:49
- **Scenario**: `list_enabled` (lines 49-62) and `get` (lines 83-96) carry byte-identical 10-field row→`Subscription` closures and near-identical SELECT column lists; any schema change (e.g. adding `p.name` per finding 4) must be applied twice and a missed spot only fails at runtime as a column-index mismatch.
- **Root cause**: The second query was copy-pasted rather than extracting a `fn map_subscription_row(row: &rusqlite::Row) -> rusqlite::Result<Subscription>` like pulse.rs already does with `parse_row`.
- **Impact**: Maintenance hazard only — 30 duplicated lines and a silent drift risk on the next column addition.
- **Fix sketch**: Extract the closure into a private `map_subscription_row` fn plus a shared `const SUBSCRIPTION_COLUMNS: &str` for the SELECT list, and pass the fn to both `query_map` and `query_row`, mirroring the `parse_row` pattern in pulse.rs.
