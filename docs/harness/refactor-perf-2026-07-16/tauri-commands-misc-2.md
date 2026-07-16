# tauri:commands (misc 2) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Backend Data & Commands | Files read: 9 | Missing: 0

## 1. `triggers.rs` is a 1975-line multi-domain module mixing 9 unrelated concerns
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src-tauri/src/commands/tools/triggers.rs:1
- **Scenario**: Any change to trigger validation, cron previewing, the webhook inspector, cron agents, builder event-linking, cleanup sweeps, or composite observability lands in the same file; reviewers must page through ~2000 lines and merge conflicts concentrate here.
- **Root cause**: The file accreted at least nine sections (its own `// ===` banners): CRUD+validation, `validate_trigger` (530 lines by itself), cron preview + `cron_to_human` helpers, builder persona↔event linking, cleanup/backfill, chain visualization, webhook status, dry-run, cron agents, webhook request inspector, config warnings, composite partial-matches.
- **Impact**: Highest-churn command file in this context; the section banners already prove the module boundaries exist but aren't enforced, so unrelated features keep coupling (e.g. `cron_to_human` is private and pinned here even though `list_cron_agents` is a different feature).
- **Fix sketch**: Split along the existing banners into a `triggers/` directory: `crud.rs`, `validation.rs` (validate_trigger + dry_run), `cron.rs` (preview, fire-times-in-range, cron_to_human + format helpers), `cron_agents.rs`, `webhook_inspector.rs`, `builder_links.rs`, `warnings.rs`. Re-export from `triggers/mod.rs` so `lib.rs` invoke_handler paths stay unchanged. Pure move — no behavior change.

## 2. `delete_automation` detects in-flight runs by fetching 50 rows and scanning in Rust
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: fetch-then-filter
- **File**: src-tauri/src/commands/tools/automations.rs:119
- **Scenario**: Deleting an automation loads up to 50 full `AutomationRun` rows (including payload/response columns) just to answer a boolean. Worse: the query is `ORDER BY ... LIMIT 50` newest-first, so a stuck `pending`/`running` row older than the 50 most recent runs is invisible and the delete proceeds while that run is still nominally in flight.
- **Root cause**: Reuses the list-style `repo::get_runs_by_automation(&db, &id, Some(50))` for an existence check instead of an SQL predicate.
- **Impact**: Wasted row materialization on every delete, and a bounded-window correctness hole — the in-flight guard silently degrades once an automation has >50 runs with a stale pending row (exactly the automations most likely to have stuck rows).
- **Fix sketch**: Add `repo::has_active_runs(pool, id) -> Result<bool>` doing `SELECT EXISTS(SELECT 1 FROM automation_runs WHERE automation_id = ?1 AND status IN ('pending','running'))` and use it in `delete_automation`. Mirrors the existing `teams::has_running_pipeline` pattern (teams.rs repo line 702).

## 3. `list_cron_agents` runs two correlated COUNT subqueries per trigger row and re-counts the same persona
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/tools/triggers.rs:1481
- **Scenario**: The Cron Agents panel query executes `(SELECT COUNT(*) FROM persona_executions WHERE persona_id = p.id AND created_at >= ?)` twice per schedule-trigger row; a persona with several schedule triggers has its 24h execution history counted 2×N times per refresh, and the panel refreshes periodically.
- **Root cause**: Correlated scalar subqueries in the SELECT list instead of a single grouped aggregate joined once per persona. Additionally the counts don't exclude `is_simulation` rows nor restrict to schedule-triggered executions, so the stats disagree with `list_recent_schedule_runs` (line 1600–1601), which filters both.
- **Impact**: Bounded (indexes `idx_pe_persona_created` exist) but repeated work that scales with triggers × executions-in-24h, plus inconsistent numbers between the two panels that share a screen.
- **Fix sketch**: Replace the two subqueries with one `LEFT JOIN (SELECT persona_id, COUNT(*) total, SUM(status='failed') failed FROM persona_executions WHERE created_at >= ?1 AND COALESCE(is_simulation,0)=0 GROUP BY persona_id) s ON s.persona_id = p.id`. One aggregate pass regardless of trigger count, and the simulation filter aligns the stats with `list_recent_schedule_runs`.

## 4. Stale "unwired" comment + unnecessary `#[allow(dead_code)]` on the mock cron seeder
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/commands/tools/triggers.rs:1628
- **Scenario**: The block comment says "pending: seed command unwired in invoke_handler; cascade flags the table", but `seed_mock_cron_agent` IS registered in the invoke_handler (src-tauri/src/lib.rs:2048), and `MOCK_CRON_EXPRESSIONS` is used at line 1682, making the `#[allow(dead_code)]` a no-op.
- **Root cause**: The command was wired up after the comment/attribute were written and the leftovers were never removed.
- **Impact**: Actively misleading — a reader (or a future dead-code sweep) will conclude the command is unreachable and may delete or "re-wire" it. The `allow` also masks the const from real dead-code detection if usage is ever removed.
- **Fix sketch**: Delete the stale two-line comment and the `#[allow(dead_code)]` attribute. Optionally note instead that the command is debug-build-gated at runtime.

## 5. Timezone-aware next-fire-time computation duplicated three times in `triggers.rs`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/tools/triggers.rs:323
- **Scenario**: The exact `match tz { Some(zone) => next_fire_time_in_tz(...), None => next_fire_time_local(...) }` pattern (plus the preceding `timezone.parse::<chrono_tz::Tz>().ok()`) appears in `validate_trigger`'s schedule branch (lines 322–333), `preview_cron_schedule` (lines 853–864), and `cron_fire_times_in_range` (lines 928–941).
- **Root cause**: Each cron-related command re-inlines the tz-fallback dispatch instead of the cron engine exposing a single entry point.
- **Impact**: A change to timezone fallback semantics (e.g. defaulting to a stored app timezone instead of system-local) must be applied in three places; two would drift silently since only preview is exercised by the editor UI.
- **Fix sketch**: Add `engine::cron::next_fire_time(schedule, from, tz: Option<chrono_tz::Tz>)` encapsulating the Some/None dispatch (and optionally a `parse_tz(Option<&str>)` helper), then replace the three inline matches with calls to it.
