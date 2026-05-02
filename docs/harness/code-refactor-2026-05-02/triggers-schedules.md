# Code Refactor Scan — Triggers & Schedules

> Scanned: 2026-05-02 | Findings: 8 | Files reviewed: ~35

## Summary

The Triggers area has a large, internally-consistent **dead subgraph** under `src/features/triggers/sub_builder/` (canvas/nodes/edges/palettes/hooks/templates) — relics of an abandoned React Flow event-routing UI. The live `EventCanvas` now delegates entirely to `layouts/UnifiedRoutingView` and only `eventCanvasConstants.ts` plus the `layouts/` subset are still reached. Schedules is in much better shape; the main issues are an unused state field in `useScheduleActions`, a `useCronPreview` hook only exercised by tests (FrequencyEditor inlines its own preview logic), and small documentation-only constants in `eventBridge.ts`. `eventBridge`/`eventRegistry` themselves are healthy: every registered event name has a matching payload type and exhaustiveness assertions guard drift.

## 1. Dead React-Flow event-canvas subgraph (~20 files, ~1500 LOC)

- **Severity**: high
- **Category**: dead-code
- **File**: `C:/Users/kazda/kiro/personas/src/features/triggers/sub_builder/` (excluding `EventCanvas.tsx`, `libs/eventCanvasConstants.ts`, `layouts/UnifiedRoutingView.tsx`, `layouts/routing/*`, `layouts/routingHelpers.tsx`, `layouts/buildEventRows.ts`, `layouts/useRoutingState.ts`, `layouts/AddPersonaModal.tsx`, `layouts/DisconnectDialog.tsx`, `layouts/RenameEventDialog.tsx`)
- **Scenario**: `EventCanvas.tsx` delegates entirely to `UnifiedRoutingView` (`./routing/`). Nothing reaches the React-Flow node/edge/palette/template/debugger machinery. Verified via grep: every dead file's exports are only imported by other dead files in the same subtree. Live entry points use only `eventCanvasConstants` from this folder.
- **Root cause**: A previous incarnation of the Builder tab used React Flow with draggable event-source/persona-consumer nodes, edges, dry-run debugger, AI assistant, and template gallery. It was replaced by the row-based "RoutingView" but the prior implementation was never deleted.
- **Impact**: ~1500 LOC of stale code that misleads new readers (they will follow imports into a fully-formed canvas system that never renders), bloats search results, and pretends to be the source of truth for event-routing UX. Bundle impact is small because React lazy-imports `EventCanvas`, but the surface area is real.
- **Fix sketch**:
  - Delete: `EventCanvasToolbar.tsx`, `assistant/EventCanvasAssistant.tsx`, `debugger/EventDryRunBar.tsx`, `edges/EventEdge.tsx`, `edges/EdgeTooltip.tsx`, all of `nodes/`, all of `palettes/`, all of `templates/` (3 files), all of `hooks/` (5 files: `useCanvasParticles`, `useEventCanvasActions`, `useEventCanvasDragDrop`, `useEventCanvasState`, `useEventDryRun`), `libs/eventCanvasAutoLayout.ts`, `libs/eventCanvasReconcile.ts`.
  - Keep: `EventCanvas.tsx`, `libs/eventCanvasConstants.ts` (used by TestTab, RoutingView, groupRows, buildEventRows, routingHelpers), the entire `layouts/` tree.
  - Run a TS build after deletion to catch any imports the grep missed.

## 2. Two near-duplicate `HighlightedJson` components

- **Severity**: medium
- **Category**: duplication
- **File**: `C:/Users/kazda/kiro/personas/src/features/triggers/sub_live_stream/HighlightedJson.tsx` and `C:/Users/kazda/kiro/personas/src/features/overview/sub_events/HighlightedJson.tsx`
- **Scenario**: Both files implement a JSON syntax highlighter with the same regex-based tokenizer (keys/strings/numbers/booleans/null) and similar Tailwind color choices. The overview variant adds a per-line `<span>` wrapper plus a `CopyButton`; the trigger variant returns a flat `<pre>`. Each has its own `tokenize` / `colorizeJson` implementation that has already drifted (cyan-400 vs sky-400 for keys, different regex flag ordering, different newline handling).
- **Root cause**: Forked when `sub_events` got its line-numbered styling; nobody promoted the shared logic.
- **Impact**: Two implementations of the same regex behaviour to maintain. Subtle styling drift makes the same payload render differently across the two event-detail UIs. The corresponding `EventDetailModal` files (also two siblings) compound the duplication.
- **Fix sketch**:
  - Lift one canonical `HighlightedJson` into `src/features/shared/components/display/` taking optional `withCopyButton` and `lineWrapped` props.
  - Replace both imports; delete the loser.
  - While you're there, consider extracting the two `EventDetailModal.tsx` siblings into one parameterised component — they show the same fields with different chrome.

## 3. `useScheduleActions` exposes `cronPreview` state nobody reads

- **Severity**: medium
- **Category**: dead-code
- **File**: `C:/Users/kazda/kiro/personas/src/features/schedules/libs/useScheduleActions.ts:11-25, 146-155`
- **Scenario**: `ScheduleActionState.cronPreview` is initialised to `null` and updated inside `previewCron()` via two `setState` calls. No caller reads `state.cronPreview` — both `ScheduleTimeline` and `ScheduleRow` use only `state.executing`/`state.editing`, and `FrequencyEditor` consumes the `previewCron` callback's returned promise directly.
- **Root cause**: Probably an intermediate refactor where the editor pulled preview from hook state before being switched to await-the-call pattern.
- **Impact**: Two extra `setState` calls per cron-preview keystroke, an unused field on the public state type, and a confusing signal that consumers should be subscribing to it.
- **Fix sketch**:
  - Remove `cronPreview` from `ScheduleActionState` and the two `setState((s) => ({ ...s, cronPreview: ... }))` calls.
  - `previewCron` keeps its return value contract — callers already use the resolved promise.

## 4. `useCronPreview` hook exists only for its tests; FrequencyEditor inlines the same logic

- **Severity**: medium
- **Category**: duplication
- **File**: `C:/Users/kazda/kiro/personas/src/features/schedules/libs/useCronPreview.ts:37-77` and `C:/Users/kazda/kiro/personas/src/features/schedules/components/FrequencyEditor.tsx:64-76`
- **Scenario**: `useCronPreview()` is a clean debounced backend-cron-preview hook with stale-response guarding via `reqIdRef`. Production grep finds zero callers — only `useCronPreview.test.ts` exercises it. FrequencyEditor instead inlines a less-careful version (raw `setTimeout` + `setPreviewLoading` + `onPreviewCron` prop with no stale-id guard). The other two exports from the same file (`useCalendarEvents`, `useConflictPreview`) ARE used in production.
- **Root cause**: FrequencyEditor predated the hook extraction and never migrated. The hook was tested in advance of a planned cutover.
- **Impact**: Either the hook is dead (delete) or FrequencyEditor's inline preview has a stale-response bug the hook would fix. Right now we ship both.
- **Fix sketch**:
  - Migrate FrequencyEditor's preview useEffect to call `useCronPreview(cronInput, scheduleTz, 5, 400)` and drop the `onPreviewCron` prop chain (`onSave`/`onCancel` already cover the actions); the hook's `valid`/`error`/`description`/`runs` map directly to current local state.
  - Side effect: `previewCron` action in `useScheduleActions` becomes unused too — remove it (combines with finding #3).

## 5. `generateIntervalFireTimes` consciously duplicated in two files

- **Severity**: medium
- **Category**: duplication
- **File**: `C:/Users/kazda/kiro/personas/src/features/schedules/libs/useCronPreview.ts:242-263` (with comment: "Identical to the (deprecated) generateIntervalFireTimes in calendarHelpers")
- **Scenario**: An identical interval-fire-time generator was copied from `calendarHelpers.ts` to `useCronPreview.ts` to avoid a dependency on a "soon-to-be-removed legacy module." The comment in `calendarHelpers.ts:74-83` even says the cron parsers "were deleted on 2026-05-01." The migration apparently completed except for this one helper. Currently `useCronPreview.ts` defines and uses the local copy in three places (lines 194, 332, 355).
- **Root cause**: Mid-migration copy that the deletion pass missed.
- **Impact**: Two copies of an identical function; a future bug fix has to remember to update both, and the "(deprecated)" comment is no longer accurate (the calendarHelpers copy doesn't exist anymore).
- **Fix sketch**:
  - Either re-export `generateIntervalFireTimes` from `calendarHelpers.ts` (where it conceptually belongs alongside `CalendarEvent`/`CalendarDay`), or move it to a small `intervalFireTimes.ts` and import from both consumers.
  - Update the multi-line comment in `useCronPreview.ts:235-241` to point at the canonical home.

## 6. Two unused timing knobs in `EVENT_BRIDGE_TIMING`

- **Severity**: low
- **Category**: cleanup
- **File**: `C:/Users/kazda/kiro/personas/src/lib/eventBridge.ts:64-85`
- **Scenario**: `AUTH_LOGIN_TIMEOUT_MS: 120_000` is documentation-by-constant — its docstring explicitly says "the actual timer lives in `authStore`", and grep confirms it's never read. `TITLEBAR_NOTIFICATION_DEBOUNCE_MS: 0` is set but never consumed at runtime (only checked in a unit test that asserts it's 0). The other six entries in the table are real.
- **Root cause**: The "Named timing knobs" table was treated as a project-wide reference doc, but two entries describe behaviour that lives in different files / is intentionally absent.
- **Impact**: Small reader-confusion: a future maintainer changes `AUTH_LOGIN_TIMEOUT_MS` here and is surprised it has no effect.
- **Fix sketch**:
  - Either delete the two constants and move the doc to a comment block above `EVENT_BRIDGE_TIMING`, or keep them but rename the structure to `EVENT_BRIDGE_TIMING_REFERENCE` and split actually-used values into a separate const that is import-checked by the linter.

## 7. `useTriggerDetail` activity-load logic duplicated

- **Severity**: low
- **Category**: duplication
- **File**: `C:/Users/kazda/kiro/personas/src/features/triggers/hooks/useTriggerDetail.ts:91-124`
- **Scenario**: `toggleActivityLog` and `retryActivityLog` share 8 lines of essentially identical activity-fetching logic (set loading, clear error, call `ops.fetchActivity`, update log/error, toast on failure, clear loading). The only difference is `toggleActivityLog` early-returns when already open and toggles `activityOpen`.
- **Root cause**: The retry path was added after the toggle path and they never got refactored to share a helper.
- **Impact**: Future change (e.g. add pagination or a different error toast) has to be applied in two places.
- **Fix sketch**:
  - Extract a private `loadActivity = useCallback(async () => { ... })` inside the hook; have `toggleActivityLog` early-return and then call it, and have `retryActivityLog` just call it.

## 8. Dead `TriggerList` component and `formatRunTimeUTC` export

- **Severity**: low
- **Category**: dead-code
- **File**: `C:/Users/kazda/kiro/personas/src/features/triggers/sub_triggers/TriggerList.tsx` (200 LOC, whole file) and `C:/Users/kazda/kiro/personas/src/features/triggers/sub_triggers/TriggerSchedulePreview.tsx:32-39` (`formatRunTimeUTC`)
- **Scenario**: `TriggerList` is exported but unimported anywhere — the only `import TriggerList` in the codebase resolves to a different `TriggerList` from `plugins/dev-tools/sub_lifecycle/setup/FlowSteps.tsx`. The active triggers UI uses `TriggerListItem` directly inside `TriggerConfig.tsx`. Separately, `formatRunTimeUTC` is exported but never imported (`formatRunTime` is — UTC variant is dead).
- **Root cause**: `TriggerList` likely predated `TriggerConfig`'s direct rendering of items; `formatRunTimeUTC` was speculative.
- **Impact**: 200 LOC of plausible-looking code that the wrong reader will edit; a misleading export.
- **Fix sketch**:
  - Delete `sub_triggers/TriggerList.tsx`.
  - Delete `formatRunTimeUTC` from `TriggerSchedulePreview.tsx`.
  - Verify with `tsc --noEmit` that no dynamic re-exports break.

> Total: 8 findings (1 high, 5 medium, 2 low)
