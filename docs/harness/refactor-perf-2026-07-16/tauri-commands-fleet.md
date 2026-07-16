# tauri:commands/fleet — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: Backend Data & Commands | Files read: 11 | Missing: 0

## 1. Dead line-cooker pipeline: `preview_lines` / `cook_lines` / `trim_lines` superseded by `render_screen`
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/commands/fleet/registry.rs:119
- **Scenario**: `preview_outputs` (registry.rs:669) — the only production consumer the preview path ever had — now calls `ring.render_screen(...)` (vt100 grid reconstruction, registry.rs:688). `OutputRing::preview_lines` has zero callers anywhere in `src-tauri/src`; `cook_lines` (~90 lines of hand-rolled ANSI cooking) and `trim_lines` are reachable only from `preview_lines` and 6 unit tests.
- **Root cause**: The Tier C vt100 screen model replaced the approximate line-cooker for grid previews, but the old implementation and its test suite were left in place.
- **Impact**: ~150 lines (impl + tests) of dead escape-sequence parsing logic in an already 1279-line file; future readers must reason about two preview renderers when only one runs. The doc comment on `render_screen` even still contrasts itself against the dead cooker.
- **Fix sketch**: Delete `preview_lines`, `cook_lines`, `trim_lines` and their tests (`cook_strips_ansi_and_splits_lines`, `cook_carriage_return_overwrites_current_line`, `cook_erase_display_clears_scrollback`, `cook_alt_screen_enter_clears`, `cook_caps_to_max_lines_keeping_tail`, plus the `cook_lines` assertion inside `render_screen_reconstructs_cursor_addressed_tui`). Verified no callers outside this file; no dynamic dispatch involved.

## 2. `FleetStatePayload` defined identically three times + hand-maintained state token strings duplicating the serde representation
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/fleet/hooks.rs:328
- **Scenario**: The `FLEET_SESSION_STATE` event payload struct `{ session_id, state, reason }` is declared in hooks.rs:346, stale.rs:157, and transcript.rs:39. On top of that, the state string itself is produced three different ways: `state_to_token()` in hooks.rs:328 (a hand-written match), raw literals `"running"` / `"stale"` / `"hibernated"` / `"idle"` in stale.rs and transcript.rs — all of which must stay byte-identical to `FleetSessionState`'s `#[serde(rename_all = "snake_case")]` representation (types.rs:24) that the frontend bindings are generated from.
- **Root cause**: Each module grew its own local payload struct instead of a shared one, and the string tokens were duplicated by hand rather than serializing the enum.
- **Impact**: Four independent places can drift when a variant is added or renamed; a typo in one literal ships a state token the frontend doesn't recognize, and nothing at compile time catches it.
- **Fix sketch**: Move one `FleetStatePayload` into types.rs (or an `events.rs` helper) with `state: FleetSessionState` — the enum is already `Serialize + Copy` and serializes to exactly the snake_case tokens — plus a small `emit_session_state(app, id, state, reason)` helper. Delete `state_to_token` and the three local structs; all emit sites route through the helper.

## 3. Dead `FleetRegistry::has_active_cwd` and never-constructed `FleetHookEvent` DTO
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/commands/fleet/registry.rs:435
- **Scenario**: `has_active_cwd` ("drives the duplicate-spawn guard") has zero callers — the guard it served was deliberately removed (`pty.rs:245` comment: multiple sessions per cwd are allowed). `FleetHookEvent` (types.rs:192) is never constructed or deserialized anywhere in Rust — `receive_hook` extracts fields from raw `serde_json::Value` instead — and its generated TS binding (`src/lib/bindings/FleetHookEvent.ts`) is imported by nothing.
- **Root cause**: Leftovers from earlier phases: the spawn-guard policy changed, and the hook receiver switched to opportunistic `Value` extraction, but the supporting API/type stayed.
- **Impact**: Misleading doc comments (a reader may believe a duplicate-spawn guard exists) and one dead ts-rs export regenerated on every bindings run.
- **Fix sketch**: Delete `has_active_cwd`. Delete `FleetHookEvent` + its `#[ts(export)]`, regenerate bindings so `FleetHookEvent.ts` disappears, and update the hooks.rs module doc that still references it (hooks.rs:14). Verified no callers/imports repo-wide; both are static, non-dynamic symbols.

## 4. `fleet_recent_transcripts` fully re-reads and re-parses up to 50 multi-MB transcripts on every call, with a `Vec<String>` line copy
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: repeated-full-parse
- **File**: src-tauri/src/commands/fleet/transcript_read.rs:476
- **Scenario**: Every visit to the Fleet Activity page (and each manual refresh) calls `fleet_recent_transcripts`, which `read_to_string`s each of the newest ≤50 `.jsonl` transcripts (long CC sessions are routinely 5–20 MB) and serde-parses every line from scratch — even though nothing changed since the last call. It also materializes `content.lines().map(to_string).collect::<Vec<String>>()`, duplicating the entire file content in memory just to satisfy `summarize_lines(&[String])`.
- **Root cause**: The command predates the incremental rollup machinery (`ingest_delta` / `metadata_for`) and never adopted it; the `&[String]` signature forces the per-line clone.
- **Impact**: Potentially hundreds of MB read + JSON-parsed and transiently ~2× file-size heap per file on a user-facing action; the same bytes are re-parsed on every open despite the transcripts being append-only.
- **Fix sketch**: Reuse the existing delta path: for each candidate file derive the id from the stem, call `ingest_delta(id, &path)` then `metadata_for(...)` — first call pays a one-time full fold, later calls fold only appended bytes. Independently, change the fold entry point to accept `impl Iterator<Item = &str>` (or fold `content.lines()` directly) so the `Vec<String>` copy disappears for all callers including `fleet_read_transcript`.

## 5. `find_transcript` re-scans the whole `~/.claude/projects` directory tree per session on hot polling paths
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/fleet/transcript_read.rs:265
- **Scenario**: The staleness ticker calls `transcript_size(csid)` for every non-terminal session every 30 s (stale.rs:296), and the grid's efficiency bar calls `fleet_token_summary` with all bound session ids on its poll; each call runs `find_transcript`, which `read_dir`s `~/.claude/projects` and stats `<dir>/<id>.jsonl` in every project subdirectory. A long-time Claude Code user easily has 100+ project dirs; with 16 sessions that is ~1,600+ metadata syscalls per tick, repeated forever, plus the same again per token-summary/metadata poll.
- **Root cause**: A transcript's path never changes once created, but the id→path resolution is recomputed from a full directory sweep on every lookup.
- **Impact**: Steady background filesystem churn that scales as (sessions × project dirs × pollers) — pure waste after the first resolution, and it grows with exactly the fleet sizes (16+) the module is designed for.
- **Fix sketch**: Add a `OnceLock<Mutex<HashMap<String, PathBuf>>>` path cache in `transcript_read`: on hit, one `fs::metadata` verifies the file still exists (fall back to a rescan on miss/deletion). `ingest_delta`'s callers (the watcher already has the exact path) can prime the cache for free via `handle_event`.

## 6. `fleet_list_sessions` re-reads and re-parses `~/.claude/settings.json` on every refresh, which fires on every registry-changed event
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: repeated-io
- **File**: src-tauri/src/commands/fleet/commands.rs:264
- **Scenario**: The frontend's `fleetRefresh` calls `fleet_list_sessions` on every `FLEET_REGISTRY_CHANGED` event — which fires per state change, per OSC title change, per rename, per exit across the whole fleet — and each call runs `check_hooks`: a synchronous file read + full JSON parse of the user's settings.json, just to compute the `hooks_installed` boolean that changes roughly never (install/uninstall/port-rebind only).
- **Root cause**: Hook-install status was bundled into the session snapshot instead of being fetched on its own (rare) cadence; `fleet_check_hooks` already exists as a dedicated command.
- **Impact**: Bounded but constant needless disk IO + parse on the fleet's chattiest IPC path; an active 16-session fleet can trigger this many times per minute.
- **Fix sketch**: Cache the `FleetHookStatus` in a `OnceLock<Mutex<(Instant, bool)>>` with a short TTL (e.g. 30 s), and invalidate it inside `fleet_install_hooks` / `fleet_uninstall_hooks`. Alternatively drop `hooks_installed` from the snapshot and let the settings banner use `fleet_check_hooks` on its own page-mount cadence (frontend change required — verify `FleetHooksPill` usage).
