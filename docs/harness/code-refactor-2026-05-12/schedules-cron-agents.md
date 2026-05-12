# Code-refactor scan — Schedules & Cron Agents

> Total: 8 findings (2 high, 3 medium, 3 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: 3 listed paths don't exist. Actual locations:
> - `src/api/schedules.ts` → `src/api/pipeline/scheduler.ts`
> - `src/stores/slices/scheduleSlice.ts` → no dedicated slice; state lives in `src/stores/slices/overview/cronAgentsSlice.ts` (accessed via `useOverviewStore`)
> - `src-tauri/src/commands/schedules.rs` → `src-tauri/src/commands/execution/scheduler.rs`
> - `src-tauri/src/db/models/schedule.rs` → does not exist; model is inlined in `src-tauri/src/db/repos/core/curation_schedule.rs`
> - `src-tauri/src/db/repos/schedules` → `src-tauri/src/db/repos/core/curation_schedule.rs` (single file, not a directory)
> Additional scheduler surfaces found by name-grep: `src-tauri/src/engine/scheduler.rs` (trigger evaluator), `src-tauri/src/engine/curation_scheduler.rs` (memory curation), `src-tauri/src/engine/cron.rs` (cron parser), `src-tauri/src/engine/project_tracking/scheduler.rs` (out-of-scope: project tracking).

## 1. Orphaned legacy `CronAgentsPage.tsx` at the top level — entire file dead
- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/overview/sub_cron_agents/CronAgentsPage.tsx:1-191`
- **Scenario**: Two files named `CronAgentsPage.tsx` exist: one at `sub_cron_agents/CronAgentsPage.tsx` (191 LOC, older) and one at `sub_cron_agents/components/CronAgentsPage.tsx` (85 LOC, newer). The directory `index.ts` re-exports only the `components/` variant (lines 1-2 of `index.ts`). A repo-wide grep for `sub_cron_agents/CronAgentsPage` returns zero importers and no relative-path import (`./CronAgentsPage`) exists in the directory.
- **Root cause**: When the page was refactored into `components/CronAgentsPage.tsx` + `components/CronAgentCard.tsx`, the original top-level file was never deleted.
- **Impact**: 191 LOC of unmaintained UI (different `AgentRow`, locally-redefined `formatInterval`, no seed button, no `useCallback`). Confuses readers; risk of drift if someone edits the wrong file.
- **Fix sketch**: Delete `src/features/overview/sub_cron_agents/CronAgentsPage.tsx`. No imports point to it.

## 2. `CRON_PRESETS` duplicated across 5 separate cron-preset arrays
- **Severity**: high
- **Category**: duplication
- **File**: `src/features/schedules/libs/scheduleHelpers.ts:112-122`
- **Scenario**: Five distinct cron-preset arrays are inlined per-feature:
  1. `src/features/schedules/libs/scheduleHelpers.ts:112` — `CRON_PRESETS` (9 entries, `{label, cron}`)
  2. `src/features/agents/sub_use_cases/libs/scheduleHelpers.ts:32` — `SCHEDULE_PRESETS` (12 entries, `{label, cron, category}`)
  3. `src/features/triggers/sub_triggers/TriggerScheduleConfig.tsx:117` — `CRON_PRESETS` (8 entries, `{label, value}`)
  4. `src/features/deployment/components/cloud/cloudSchedulesHelpers.tsx:27` — `CRON_PRESETS` (8 entries, `{label, cron}`, i18n keys)
  5. `src/features/overview/sub_memories/components/CurationScheduleModal.tsx:19` — `CRON_PRESETS` (4 entries, `{value, labelKey}`)
  Heavy overlap: `0 9 * * *`, `0 0 * * *`, `0 */6 * * *`, `0 9 * * 1-5`, `*/15 * * * *`, `0 * * * *` all appear in 3+ of these lists. Field-name conventions differ (`cron` vs `value`) so a single source of truth would require a normalizer.
- **Root cause**: Each feature copy-pasted a starter list. There's no shared `lib/constants/cronPresets.ts`.
- **Impact**: ~50 lines duplicated; adding/correcting a preset (e.g. the timezone-aware "Daily 9am UTC" → "Daily 9am local" wording) requires 5 edits. Different label styles ("Every 15 min" vs "Every 15 minutes") leak into the UI as inconsistency.
- **Fix sketch**: Create `src/lib/constants/cronPresets.ts` exporting a canonical `CRON_PRESETS: { id: string; cron: string; labelKey: string; categories?: string[] }[]`. Each consumer maps to its local shape (`{label, value}` etc.) via a thin adapter. Curation modal can subset by `categories.includes('curation')`.

## 3. `AgentRow` schedule-card component duplicated across 3 sites
- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/overview/sub_cron_agents/components/CronAgentCard.tsx:21-110`
- **Scenario**: A persona+schedule list-row component is implemented three times with the same PersonaIcon → name+headless-badge → `Clock` icon + schedule string → next/last run column → `HealthIcon` + ratio layout:
  1. `src/features/overview/sub_cron_agents/components/CronAgentCard.tsx:21-110` (`AgentRow`)
  2. `src/features/schedules/components/ScheduleRow.tsx:55-162` (richer: adds action buttons + FrequencyEditor modal)
  3. `src/features/overview/sub_cron_agents/CronAgentsPage.tsx:94-183` (third, inline copy — see finding #1, dead)
  Health-color/icon logic (`failureRate === 0 ? emerald : < 0.6 ? amber : red`) is repeated verbatim in (1) and (3); a similar structure with named consts lives in `ScheduleRow.tsx:37-43` (`HEALTH_CONFIG`) and `scheduleHelpers.ts:27-32`.
- **Root cause**: Two pages display the same data with different action affordances, and no shared `<ScheduleCard>` primitive was extracted.
- **Impact**: ~110 LOC duplicated (or ~170 counting the dead orphan); a UI consistency fix (e.g. timezone badge wording, headless badge color) needs 2-3 edits.
- **Fix sketch**: Extract `src/features/shared/schedule/ScheduleCardRow.tsx` taking `{ entry: ScheduleEntry, actions?: ReactNode }`. `ScheduleRow.tsx` passes its action buttons via the slot; `CronAgentCard.tsx` passes nothing. Drop the duplicate `healthColor`/`HealthIcon` ladder in favour of `HEALTH_CONFIG` from `scheduleHelpers.ts`.

## 4. Stale `#[allow(dead_code)]` on actively-used `matches` and `next_fire_time`
- **Severity**: medium
- **Category**: cruft
- **File**: `src-tauri/src/engine/cron.rs:208,239`
- **Scenario**: Both `matches` (line 209) and `next_fire_time` (line 240) carry `#[allow(dead_code)]`. A repo-wide grep proves both are used:
  - `next_fire_time` → called from `src-tauri/src/engine/curation_scheduler.rs:92` (production path) and `:181` (test).
  - `matches` → called transitively by `next_fire_time` (lines 247, etc.) and directly by tests in this module.
- **Root cause**: When the timezone-aware variants (`next_fire_time_local`, `next_fire_time_in_tz`) landed, all trigger callers migrated to them, but the legacy UTC variant was left alive for the curation scheduler. The `#[allow(dead_code)]` attribute was added prematurely and never reverted.
- **Impact**: Misleading signal to readers ("this is dead, can delete"). A well-meaning cleanup PR could legitimately delete `next_fire_time` and break the curation scheduler. The attribute defeats `cargo check`'s dead-code warning for this module.
- **Fix sketch**: Remove the `#[allow(dead_code)]` line above both functions. No code change required.

## 5. `formatInterval` triplicated across the codebase with three different output formats
- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/overview/sub_cron_agents/libs/cronHelpers.ts:1-6`
- **Scenario**: Three independent implementations of `formatInterval(seconds: number)` exist with intentionally different outputs:
  1. `src/features/overview/sub_cron_agents/libs/cronHelpers.ts:1-6` — compact: `"30s"`, `"5m"`, `"2h"`, `"1d"`
  2. `src/features/overview/sub_cron_agents/CronAgentsPage.tsx:185-190` — byte-identical copy of (1), in the orphan file (see finding #1)
  3. `src/lib/utils/formatters.ts:174-182` — verbose: `"30 seconds"`, `"1 hour 30 minutes"` (no day handling)
  The compact form leaks across features via `scheduleHelpers.ts:2` re-exporting it, but the verbose form is in `lib/utils` (the conventional home for shared formatters).
- **Root cause**: Two unrelated PRs needed "format seconds as human duration" and each rolled its own. The semantic split (compact vs verbose) is arguable but never declared.
- **Impact**: Documentation drift; users see "5m" on the cron page and "5 minutes" on a deployment row. Hard to find the right helper.
- **Fix sketch**: Move both to `lib/utils/formatters.ts` as `formatIntervalCompact` and `formatIntervalVerbose`. Re-export `formatIntervalCompact` from `cronHelpers.ts` for one release to avoid churn. Delete the orphan-page copy as part of finding #1.

## 6. `useCronPreview.ts` keeps a private `generateIntervalFireTimes` after the "legacy module" never got removed
- **Severity**: low
- **Category**: cruft
- **File**: `src/features/schedules/libs/useCronPreview.ts:240-263`
- **Scenario**: `generateIntervalFireTimes` is defined in `useCronPreview.ts:242-263` with a comment (`"Identical to the (deprecated) generateIntervalFireTimes in calendarHelpers, included here so the new hook does not depend on the about-to-be-removed legacy module."`). The legacy version was already deleted from `calendarHelpers.ts` (compare with the comment block at `calendarHelpers.ts:72-83` marking the cron functions removed on 2026-05-01). The "about-to-be-removed" justification is stale.
- **Root cause**: The migration completed but the rationale comment for the temporary inline copy was never updated.
- **Impact**: Misleading docstring; reader has to grep `calendarHelpers.ts` to confirm. 22 lines that could either stay (with a clearer comment) or be exported by `calendarHelpers.ts`.
- **Fix sketch**: Either (a) move `generateIntervalFireTimes` back to `calendarHelpers.ts` and export it (single home), or (b) keep it here and replace the comment block at lines 235-241 with `"Interval triggers fire every N seconds and are zone-agnostic; no backend round-trip needed."`.

## 7. `EventTooltip.tsx` exported but no importers
- **Severity**: low
- **Category**: dead-code
- **File**: `src/features/schedules/components/EventTooltip.tsx:1-63`
- **Scenario**: `EventTooltip` is defined and exported (line 6) but a repo-wide grep for `EventTooltip` returns only the file itself — zero callers in `WeekView.tsx`, `MonthView.tsx`, `ScheduleCalendar.tsx`, or `EventBlock.tsx`. Its `ConflictGroup`-aware tooltip logic is duplicated inline by the cell-conflict pill in `WeekView.tsx:104-112` (which renders just the count, not the "overlaps with X, Y, Z" detail).
- **Root cause**: Likely intended for hover-tooltips on `<EventBlock>` but wired up only as a cell-level badge; the component-as-tooltip path was never built.
- **Impact**: 63 LOC + i18n keys (`scheduled`, `overlaps_with`) maintained for a UI that never ships.
- **Fix sketch**: Either delete `EventTooltip.tsx` and the orphaned i18n keys, or wire it up in `EventBlock.tsx` as the hover/focus tooltip the comment-history suggests. Per scan-discipline rules, recommend delete unless the wire-up is on the near roadmap.

## 8. Stale "scheduler engine UI" cruft comments and `index.ts` re-export
- **Severity**: low
- **Category**: cruft
- **File**: `src/features/schedules/index.ts:1-2`
- **Scenario**: Three small cruft items in the schedules feature:
  - `src/features/schedules/index.ts:1-2` — re-exports `ScheduleTimeline` as both a named export and the default, but a grep shows the only consumer (`src/features/personas/PersonasPage.tsx:40`) imports the deep path `@/features/schedules/components/ScheduleTimeline`. The `index.ts` is functionally dead.
  - `src/features/schedules/components/ScheduleTimeline.tsx:281-284` — 4-line comment about "Skipped-execution recovery was removed" referencing a 2026-05-01 ADR. The code it describes is gone; the comment now sits above the unrelated view-switching JSX.
  - `src/features/schedules/libs/useScheduleActions.ts:157-160` — 4-line comment about "batchRecover was removed" with the same ADR reference. Same shape: explains absent code.
- **Root cause**: When the scheduler gained backend `max_backfill`, the frontend recovery affordances were ripped out but each removal site left a tombstone comment for context.
- **Impact**: Three tombstones per ADR is overkill; once the ADR exists, the code doesn't need to apologise for being shorter. The dead `index.ts` is a minor footgun (newcomer imports the named export, gets an extra round-trip through a 2-line file).
- **Fix sketch**: Delete `src/features/schedules/index.ts` (or update `PersonasPage.tsx:40` to import from it for consistency, then drop the deep path in the comment-removal commit). Trim the two tombstone comments to a single line each (`// Backfill is server-side now (ADR 2026-05-01-schedules-overdue-backfill).`) or remove entirely since the ADR is queryable.
