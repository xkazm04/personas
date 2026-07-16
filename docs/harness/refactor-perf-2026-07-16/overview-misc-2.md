# overview (misc 2) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 2 medium / 2 low)
> Context group: Observability & Monitoring | Files read: 10 | Missing: 0

## 1. Relative-time formatting re-implemented in both mission-control cards, one copy skipping UTC normalization
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_missionControl/cards/VaultRecentChangesCard.tsx:13 (also UpcomingRoutinesCard.tsx:13)
- **Scenario**: Both dashboard cards define private `formatTime`/`formatRelative` helpers with the same mins/hours/days bucketing that already exists canonically as `formatRelativeTime` in `src/lib/utils/formatters.ts:22`. Repo-wide grep shows 10+ sibling copies of this pattern.
- **Root cause**: Each card grew its own local formatter instead of extending the shared one (the shared version lacks a "future/overdue" mode, which UpcomingRoutinesCard needs).
- **Impact**: Drift hazard that is already real: the canonical helper routes through `normalizeTimestamp()` to fix SQLite's bare-UTC `datetime('now')` strings, but `VaultRecentChangesCard.formatTime` calls `new Date(iso)` directly — if `SyncLogEntry.createdAt` is a bare SQLite datetime, every row reads hours off for non-UTC users. Formatting conventions ("now" vs "just now", 24h vs 48h hour cutoff) also silently diverge between adjacent cards.
- **Fix sketch**: Route `VaultRecentChangesCard.formatTime` through `formatRelativeTime`/`normalizeTimestamp` (verify the `createdAt` wire format from `obsidianBrainGetSyncLog` first). For `UpcomingRoutinesCard`, add a small future-aware variant (e.g. `formatRelativeToNow(iso, nowMs)` returning `{label, overdue}`) next to `formatRelativeTime` in `lib/utils/formatters.ts` and delete both local copies.

## 2. UpcomingRoutinesCard polls the full fleet-wide trigger list every 30s to render 5 rows
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: over-fetching
- **File**: src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:59-90
- **Scenario**: The card stays mounted for the whole dashboard session and re-issues `listAllTriggers()` on a 30-second interval plus every visibility change. The query returns every trigger for every persona (all types, enabled or not); the component then filters client-side to enabled schedule-type triggers and slices to `MAX_ROWS = 5`.
- **Root cause**: The refetch cadence is deliberate (comment explains it rolls `next_trigger_at` forward), but the query shape wasn't narrowed when polling was added — it reuses the general-purpose "list everything" IPC call.
- **Impact**: Steady-state IPC + full-table SQLite read every 30s that scales with total trigger count (webhook, event, disabled triggers all included) while only 5 rows are ever displayed. On a fleet with many personas/triggers this is continuous background waste on the app's home screen — the hottest surface in the app.
- **Fix sketch**: Add a scoped Rust query (e.g. `list_upcoming_triggers(limit, types)` — `WHERE enabled = 1 AND trigger_type IN ('schedule','cron','polling') ORDER BY next_trigger_at ASC LIMIT 6`) and call that from the poll. Alternatively, keep `listAllTriggers` for the initial load and only re-poll the narrow query on the interval.

## 3. Five internal components needlessly exported from the 827-line DashboardHomeMissionControl.tsx
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/sub_missionControl/DashboardHomeMissionControl.tsx:380,446,522,679,756
- **Scenario**: `InstrumentsBay`, `TriagePane`, `VitalsConsole`, `StatusTicker`, and `ActivityStreamLog` are all declared with `export const` but a repo-wide grep finds no importer outside this file (no test/spec references either — only lint output and docs mention them).
- **Root cause**: Prototype-era exports ("Mission Control" variant, per the file header) that were never consumed after the variant won.
- **Impact**: Dead public surface: readers and tooling must assume external callers exist, which blocks safe refactors of their prop shapes and inflates the module's apparent API. The exports also mask that this is a 6-component, 827-line file that could be split along these exact seams.
- **Fix sketch**: Drop the `export` keyword from all five (verification: grep already shows zero cross-file imports). Optionally, as a follow-up, move `TriagePane`, `VitalsConsole`, and `ActivityStreamLog` into sibling files under `sub_missionControl/` to bring the main file under ~300 lines — but the export removal alone is the zero-risk win.

## 4. Pane/card header markup triplicated across the mission-control surface
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:165 (also VaultRecentChangesCard.tsx:65, DashboardHomeMissionControl.tsx:797)
- **Scenario**: `PaneHeader` (DashboardHomeMissionControl), `CardHeader` (UpcomingRoutinesCard), and an inline header block (VaultRecentChangesCard) all render the same `px-3 py-2 border-b border-primary/10 bg-primary/[0.04]` header with a tracked-mono label + optional subtitle; two of the three also append the same `ArrowRight` glyph.
- **Root cause**: The two lazy-loaded cards copied the pane header instead of importing it, presumably to avoid importing from the large parent module — which is itself a symptom of finding #3 (components not extracted to their own files).
- **Impact**: Visual drift risk on adjacent panes of the same screen (they must stay pixel-identical to read as one cockpit); three places to touch for any header styling change.
- **Fix sketch**: Extract one `PaneHeader` into `sub_missionControl/PaneHeader.tsx` (props: `label`, `subtitle?`, `trailing?`), import it in all three call sites, and delete `CardHeader` plus the inline copy. Pairs naturally with the file split in finding #3.
