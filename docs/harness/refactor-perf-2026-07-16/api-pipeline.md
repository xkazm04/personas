# api/pipeline — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Core Libraries & State | Files read: 8 | Missing: 0

## 1. Dead API wrappers: `evictTeamMemories`, `cleanupDeadTriggerEvents`, `companionAssignTeam`
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/api/pipeline/teamMemories.ts:73 (also src/api/pipeline/triggers.ts:113, src/api/pipeline/assignments.ts:89)
- **Scenario**: Grep across all of `src/` (including `src/api/__tests__/`) finds zero callers for `evictTeamMemories` and `cleanupDeadTriggerEvents` — only their definitions. `companionAssignTeam` also has no frontend caller; the `companion_assign_team` command is invoked backend-side (Athena tool layer / `approve_deliberation_proposal` in Rust), and the only TS references are the generated command-name union and doc comments.
- **Root cause**: Wrappers were added for planned or since-removed UI (memory eviction UI, the Fix 1/4a cleanup sweep button, the Phase C1 chat entry point) but the consumers never landed or were moved to the Rust side.
- **Impact**: Dead exports mislead readers into thinking these flows have a frontend surface, and they silently drift from the Rust command signatures with no compile-time consumer to catch it.
- **Fix sketch**: Delete `evictTeamMemories` and `cleanupDeadTriggerEvents` (verify no dynamic `invoke("evict_team_memories")` / `invoke("cleanup_dead_trigger_events")` string callers first — none found in `src/`). For `companionAssignTeam`, confirm the companion/Athena chat layer really invokes the command from Rust only, then remove the TS wrapper or leave a pointer comment if it is intentionally reserved.

## 2. Hand-maintained mirrors of Rust wire structs instead of ts-rs bindings
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: type-drift
- **File**: src/api/pipeline/triggers.ts:100 (also triggers.ts:121, 162, 221–243; teams.ts:42)
- **Scenario**: Six response shapes are typed inline by hand — `TriggerCleanupResult`, `RenameEventTypeResult`, `CronPreview`, `DryRunSimulatedEvent`, `DryRunMatchedSubscription`, `DryRunResult` in triggers.ts and `HandoffWireResult` in teams.ts — while every sibling command in these same files uses generated `@/lib/bindings/*` types. A Rust-side field rename (e.g. in `HandoffWireResult`) compiles cleanly on both sides and only breaks at runtime as `undefined` fields in the UI.
- **Root cause**: The corresponding Rust structs lack `#[derive(TS)]` / ts-rs export (teams.ts:38 admits "not ts-rs-exported, so typed inline here"), so the wrappers reimplement them by hand.
- **Impact**: Silent contract drift between Rust and TS on seven wire formats; `DryRunResult` even resorts to an awkward inline `import("@/lib/bindings/TriggerValidationResult")` type to stitch a generated type into a hand-written one.
- **Fix sketch**: Add `#[derive(TS)]` + `#[ts(export)]` to the seven Rust structs, regenerate bindings, replace the inline interfaces with `import type { ... } from "@/lib/bindings/..."`. Purely mechanical; no behavior change.

## 3. Team-memory fetch orchestration duplicated in store slice and hook
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/api/pipeline/teamMemories.ts:11
- **Scenario**: Both `src/stores/slices/pipeline/teamSlice.ts:298-323` (`fetchTeamMemories`/`loadMoreTeamMemories`) and `src/features/teams/sub_teamMemory/useTeamMemories.ts:36-70` implement the identical `Promise.all([listTeamMemories, getTeamMemoryCount, getTeamMemoryStats])` + offset-paging pattern, each with its own state, staleness guard, and error handling.
- **Root cause**: The team-memory panel grew a local hook while the Zustand slice kept its older copy of the same orchestration; nothing consolidated them.
- **Impact**: Two parallel sources of truth for the same data — a fix to one (e.g. the staleness guard or filter semantics) will not reach the other. Bounded maintenance cost, no runtime bug observed.
- **Fix sketch**: Verify which consumers still use `teamSlice`'s memory state (cross-context check needed); if the panel hook is the live path, delete the slice's memory actions/state, otherwise fold the hook onto the slice. Either way, one orchestration should own the triple-fetch.

## 4. `getTeamMemoryStats` cannot replace `getTeamMemoryCount`, forcing a third IPC/SQL roundtrip per refresh
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: redundant-query
- **File**: src/api/pipeline/teamMemories.ts:55
- **Scenario**: Every memory-panel refresh (initial load, each category/search/run filter change, in both duplicated consumers from finding 3) fires three commands: `listTeamMemories`, `getTeamMemoryCount`, and `getTeamMemoryStats`. `TeamMemoryStats` already carries `total`, but the stats command takes no `runId` parameter, so callers must keep the separate count command for run-filtered views — and pay for both even when `runId` is unset (the common case).
- **Root cause**: The stats command's filter signature (`teamId, category, search`) diverged from the count/list signature (`teamId, runId, category, search`), so `stats.total` is not a drop-in replacement for the count.
- **Impact**: One extra IPC roundtrip plus one extra SQL `COUNT(*)` scan of `team_memories` on every refresh of a hot panel; the three queries also scan the same filtered set three times where one aggregated query could serve rows+count+stats.
- **Fix sketch**: Add `run_id` to `get_team_memory_stats` on the Rust side and have it honor the same filters as count/list; then drop `getTeamMemoryCount` from the refresh paths and read `stats.total`. Optionally fold count+stats into one command since they always travel together.

## 5. No batch variant of `listTeamMemoriesByRun` — per-run fan-out in the diff views
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/api/pipeline/teamMemories.ts:70
- **Scenario**: `useRunDiffSummaries.ts:30` does `Promise.all(recent.map((id) => listTeamMemoriesByRun(id)))` — one Tauri command and one SQL query per recent run — and `RunDiffView.tsx:47-48` issues two more. As run history grows, the summaries hook scales linearly in IPC roundtrips for data that is a single `WHERE run_id IN (...)` query.
- **Root cause**: The API only exposes a single-run lookup, so consumers loop over it; there is no `list_team_memories_by_runs(ids)` seam.
- **Impact**: N parallel IPC calls + N SQLite queries per diff-summary render; bounded today (recent-run list is small) but the pattern invites growth and each roundtrip carries Tauri serialization overhead.
- **Fix sketch**: Add a `list_team_memories_by_runs(run_ids: Vec<String>)` command backed by one `IN`-clause query (rusqlite `params_from_iter`), expose `listTeamMemoriesByRuns(ids: string[])` here, and switch `useRunDiffSummaries` (and optionally `RunDiffView`) to it, grouping client-side by `run_id`.
