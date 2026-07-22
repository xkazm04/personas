# tauri:commands/companion [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 1 findings (0 critical / 0 high / 0 medium / 1 low)
> Context group: Backend Data & Commands | Files read: 2 | Missing: 0

## 1. Sync Tauri commands run blocking SQLite pool access on the main thread
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: main-thread-blocking
- **File**: src-tauri/src/commands/companion/plugins.rs:13
- **Scenario**: `companion_list_plugin_toggles` and `companion_set_plugin_enabled` are non-async `#[tauri::command]` fns, which Tauri executes on the main thread. `plugins::list` / `plugins::set_enabled` call `pool.get()` on the r2d2 SQLite pool; if the pool is momentarily exhausted (e.g. the companion dispatcher is mid-write on the same `user_db` pool), the main thread blocks until a connection frees or the r2d2 acquire timeout fires, freezing the whole window.
- **Root cause**: Sync command signature + blocking connection acquisition. Contrast decisions.rs in this same context, which is `async fn` and therefore runs on the async task pool.
- **Impact**: Normally microseconds (tiny table, indexed reads), so cost is only visible under pool contention — bounded, cold path (plugin toggles are a settings-surface action). Note this is a codebase-wide pattern (`require_auth_sync` appears ~888 times across 99 command files), so any real fix belongs in a dedicated architectural pass, not this context alone.
- **Fix sketch**: Either make the two commands `async fn` (matching decisions.rs) or annotate `#[tauri::command(async)]` so they run off the main thread; the bodies need no changes since `plugins::list`/`set_enabled` take `&UserDbPool` directly. If addressed, do it as part of a sweep over all `require_auth_sync` commands rather than piecemeal here.

No code-refactor findings: both files are minimal, documented wrappers with no dead code, duplication, or debug leftovers; both commands are registered in lib.rs and invoked from src/api/companion.ts. The decisions query path is bounded (limit clamped 1–500) and served by `idx_companion_design_decision_context`.
