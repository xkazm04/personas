# agents (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 3 medium / 2 low)
> Context group: Persona Authoring & Design | Files read: 21 | Missing: 0

## 1. Quick Answer popover mounts the polling data layer twice
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: duplicate-polling
- **File**: src/features/agents/quick-answer/QuickAnswerPopover.tsx:24
- **Scenario**: `QuickAnswerPopover` calls `usePendingInteractions()` just to read `total` for the header chip, and then renders `QuickAnswerBody`, which calls `usePendingInteractions()` again. Each call mounts `useMonitorData`, which does an on-mount reload of reviews/messages/persona summaries, an on-connect cloud-reviews fetch, and registers a `usePolling(reloadReviews, POLLING_CONFIG.dashboardRefresh.interval)` loop.
- **Root cause**: The body was extracted from the popover to be embeddable elsewhere (per its own doc comment), but the popover kept its own hook instance for the count instead of hoisting the data once.
- **Impact**: While the popover is open, every review/message poll and cloud fetch runs twice (2x Tauri IPC / network), and two independent state trees update, doubling re-render work on each poll tick. The popover is the designed "fast path" surface, so this is the hot path of the feature.
- **Fix sketch**: Hoist a single `usePendingInteractions()` into `QuickAnswerPopover` and pass the data down (give `QuickAnswerBody` an optional `data` prop, keeping its internal hook only for the embedded-panel host), or have `QuickAnswerBody` report the count upward via an `onTotalChange` callback. Either way exactly one `useMonitorData` instance should exist per open popover.

## 2. ActivityTab fetches fleet-wide events/messages and filters client-side, starving the selected persona
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: over-fetch
- **File**: src/features/agents/sub_activity/ActivityTab.tsx:47-57
- **Scenario**: `loadData` calls `listEvents(100)` and `listMessages(50)` with no persona scope, then filters by `source_id/target_persona_id === personaId` and `m.persona_id === personaId` in JS. On a busy fleet, the newest 100 events / 50 messages may contain zero rows for the selected persona.
- **Root cause**: The global list endpoints are reused with a cap-then-filter pattern instead of persona-scoped queries, unlike the sibling calls (`listExecutions(personaId, 50)`, `listMemories(personaId, ...)`) which are already scoped.
- **Impact**: Wasted payload (up to 150 rows serialized over IPC per refresh, most discarded) and a correctness-adjacent gap: a persona's Events/Messages tabs can silently show nothing once other personas' activity pushes its rows past the cap, which reads as "no activity".
- **Fix sketch**: Add/use persona-scoped variants (`listEvents(personaId, 100)`, `listMessages(personaId, 50)`) backed by a `WHERE persona_id = ?` / `source_id = ? OR target_persona_id = ?` query in the Rust command (indexed columns), and drop the client-side filters. The rest of the mapping code stays unchanged.

## 3. ActivityList remounts the entire table on every load toggle via a changing `key`
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_activity/ActivityList.tsx:170
- **Scenario**: The wrapper div uses `key={isLoading ? 'loading' : 'ready'}`, so every refresh (manual refresh button, any modal `onDataChanged`) flips the key twice and React unmounts/remounts the whole `UnifiedTable` subtree — all row DOM is destroyed and rebuilt, and any internal table state (e.g. active sort column) resets.
- **Root cause**: The key was added to retrigger the `animate-fade-slide-in` CSS animation on load transitions; a keyed remount is the heaviest possible way to do that.
- **Impact**: For a typical ~250-item merged list this is a full DOM teardown + rebuild per refresh (twice: entering and leaving loading), visible as jank and lost sort state, on an interaction users hit often (approve review → onDataChanged → remount).
- **Fix sketch**: Drop the dynamic `key` and keep the opacity transition (already present via `transition-opacity`). If the fade-in on fresh data is wanted, key on `personaId` instead (remount only when switching personas), or retrigger the animation class via a `useEffect` toggling a class name without remounting.

## 4. Duplicated weekday constants — third copy of DAYS/DAY_LABELS in quickConfigTypes
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/shared/quickConfig/quickConfigTypes.ts:10-23
- **Scenario**: `quickConfigTypes.ts` defines its own `DAYS` (7-day key/label toggle array) and `DAY_LABELS` (key → full name map). `src/lib/utils/dayOfWeek.ts` already exports a canonical `DAYS: readonly DayInfo[]` and its header comment explicitly tracks a second copy in `agents/sub_use_cases/scheduleHelpers.ts` — this file is an untracked third copy.
- **Root cause**: The quick-config composer grew its own local constants instead of importing the shared day-of-week module.
- **Impact**: Three sources of truth for weekday keys/labels; a change to day ordering or labels (e.g. locale-aware labels) must be found and applied in three places, and the serialized build-prompt text (`DAY_LABELS[d] ?? d`) can silently drift from what the UI toggles show.
- **Fix sketch**: Extend `lib/utils/dayOfWeek.ts` `DayInfo` to carry the short toggle label and full name if it doesn't already, re-export or derive `DAY_LABELS` from it, and replace the local constants here (and in `scheduleHelpers.ts`, per its own TODO-comment) with imports. Verify with a grep for `DAY_LABELS` before deleting.

## 5. PipelineDots: `key` is on the inner div, not the mapped Tooltip element
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: react-key
- **File**: src/features/agents/executionPlayer/PipelineDots.tsx:38-41
- **Scenario**: The element returned from `PIPELINE_STAGES.map(...)` is `<Tooltip>`, but `key={stage}` sits on the child `<div>` inside it. React warns "Each child in a list should have a unique key" on every render of the mini player.
- **Root cause**: The key was attached to the visual dot instead of the top-level mapped element when the Tooltip wrapper was introduced.
- **Impact**: Dev-console warning noise on a component that renders on every execution-output tick; reconciliation falls back to index order (harmless here since `PIPELINE_STAGES` is static, so purely a cleanliness/lint issue).
- **Fix sketch**: Move `key={stage}` from the inner `<div>` to the `<Tooltip>` element.

## 6. INPUT_CLS style constant duplicated and stranded in a "types" file
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/agents/shared/quickConfig/quickConfigTypes.ts:27
- **Scenario**: `quickConfigTypes.ts` exports `INPUT_CLS`, a Tailwind input class string, alongside actual types; `src/features/settings/sub_engine/components/ModelRoutingSection.tsx:11` defines a second near-identical `INPUT_CLS`, and the app already has a design-token seam (`@/lib/utils/designTokens` exports `INPUT_FIELD`/`inputFieldClass`, used by PersonaSettingsTab in this same context).
- **Root cause**: Local convenience constants predating (or bypassing) the shared `designTokens` module; the serializer/helper functions living in a `*Types.ts` file compound the grab-bag feel.
- **Impact**: Input styling drifts per-surface (this variant differs from `INPUT_FIELD` in height/focus treatment), and contributors looking for types get UI constants and prompt-serialization logic.
- **Fix sketch**: Fold `INPUT_CLS` consumers onto `designTokens` (add a compact variant there if the h-9 sizing is intentional) and delete both local copies. Optionally split `quickConfigTypes.ts` into `quickConfigTypes.ts` (types only) and `quickConfigSerialize.ts` (serialize/describe helpers) — low urgency, do only when touching the file anyway.
