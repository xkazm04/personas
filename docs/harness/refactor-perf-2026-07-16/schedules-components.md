# schedules/components — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Execution & Orchestration | Files read: 11 | Missing: 0

## 1. Every 30s poll re-renders the entire unvirtualized ScheduleRow list
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/schedules/components/ScheduleTimeline.tsx:148
- **Scenario**: The refresh scheduler re-fetches `cronAgents` every 30s (plus on OVERDUE_TRIGGERS_FIRED). Each fetch produces a new array, so `entries`/`sorted`/`grouped` all recompute and every `ScheduleRow` re-renders and re-reconciles — `ScheduleRow` is not memoized, and even if it were, `renderEntries` hands each row 8 fresh inline closures plus `existingEntries={entries}` (a new array every render), defeating memo. The row's own comment acknowledges "5000+ DOM nodes at scale".
- **Root cause**: `content-visibility:auto` on ScheduleRow only skips paint/layout; React reconciliation of all rows (each with modals, dropdown menu markup, PersonaIcon, badges) still runs on every poll tick. No `React.memo` and no stable per-row callbacks.
- **Impact**: At tens-to-hundreds of scheduled agents, a full-tree reconcile fires twice a minute for the lifetime of the view (and on every keystroke-adjacent state change like toggling a filter), producing visible jank on the hot Schedules tab.
- **Fix sketch**: Wrap `ScheduleRow` in `React.memo`. In `ScheduleTimeline`, stabilize callbacks by passing the agent-agnostic action fns (`manualExecute`, `toggleEnabled`, …) plus `entry` and letting the row bind, or memoize a per-trigger-id callback map. Consider passing `existingEntries` only while the frequency editor is open (it is only consumed by `FrequencyEditor`), e.g. lift the editor state/modal to the timeline level or fetch entries via a stable getter.

## 2. RecentRunRow and RunRow are near-duplicate components with identical deep-link logic
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/schedules/components/ScheduleRecentRuns.tsx:97
- **Scenario**: `RecentRunRow` (ScheduleRecentRuns.tsx:97-146) and `RunRow` (ScheduleRowHistoryPanel.tsx:190-238) render the same status pill (`STATUS_CONFIG`/`STATUS_LABELS`), the same `formatRelative(started_at ?? created_at)` + duration line, and byte-identical "View in Activity" navigation (`setPendingExecutionFocus` → `setOverviewTab('executions')` → `setSidebarSection('overview')`, same explanatory comment pasted in both).
- **Root cause**: Stage-2 history panel was built first; the "Last 24 hours" section copied the row instead of extracting a shared component.
- **Impact**: Any change to run-row presentation or the deep-link contract (e.g. a store rename) must be made twice; the two surfaces have already started to drift (retry badge and persona name exist only in one, cost label only in the other).
- **Fix sketch**: Extract a shared `ExecutionRunRow` (or at least a `useExecutionDeepLink(executionId)` hook + shared `<StatusPill status>` component) into `../libs` or a shared component file. Feed surface-specific extras (persona name, retry_at, cost) via optional props/slots.

## 3. STATUS_CONFIG / STATUS_LABELS shared constants live inside a component file
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/schedules/components/ScheduleRowHistoryPanel.tsx:244
- **Scenario**: ~100 lines of pure status-mapping data (`StatusConfigEntry`, `UNKNOWN_STATUS`, `STATUS_CONFIG`, `STATUS_LABELS`) are exported from `ScheduleRowHistoryPanel.tsx` and imported by `ScheduleRecentRuns.tsx`, creating a component→component data dependency.
- **Root cause**: The constants were exported "for reuse" (the file says so) instead of being moved to the feature's `libs/` where `scheduleHelpers.ts` already holds shared logic.
- **Impact**: Importing a component file for constants pulls the whole panel (icons, sparkline, stores) into any future consumer's module graph, and hides where the canonical status vocabulary lives; the multi-spelling mapping ('completed'/'succeeded'/'success', 'cancelled'/'canceled') is exactly the kind of contract other surfaces will need.
- **Fix sketch**: Move the types and the three exports into `src/features/schedules/libs/executionStatus.ts` (or a shared display module, since other features likely render the same statuses). Re-export from the panel temporarily if needed to avoid a wide diff.

## 4. BackfillModal and FrequencyEditor duplicate the entire modal chrome
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/schedules/components/BackfillModal.tsx:67
- **Scenario**: Both modals hand-roll the same shell: `fixed inset-0 z-50 … bg-black/50 surface-blur-modal` overlay, `w-[520px] max-w-[calc(100%-2rem)] rounded-2xl shadow-elevation-4` panel, identical header layout (icon chip + title + persona_name + X button) and footer button row — only the accent color (amber vs blue) differs.
- **Root cause**: Second modal was written by copying the first rather than extracting a `ScheduleModalShell` (and no click-outside/Escape handling exists on either, so neither can lean on a shared behavior either).
- **Impact**: Styling or a11y improvements (focus trap, Escape-to-close — currently absent from both) must be duplicated; the two modals will drift visually over time.
- **Fix sketch**: Extract a small `ModalShell({ icon, accent, title, subtitle, footer, children, onClose })` used by both (check `features/shared/components` first — if a shared modal/dialog primitive already exists elsewhere in the app, adopt it instead of adding a new one). This is also the natural place to add Escape handling once.

## 5. ScheduleRecentRuns polls every 60s regardless of visibility
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: polling
- **File**: src/features/schedules/components/ScheduleRecentRuns.tsx:44
- **Scenario**: The parent `ScheduleTimeline` carefully gates its own 30s refresh loop behind `useElementVisible`, but `ScheduleRecentRuns` runs its own unconditional `setInterval(fetchRuns, 60_000)` from mount, so `listRecentScheduleRuns(24)` keeps hitting the backend while the window is minimized or the element is scrolled/hidden (as long as the grouped view stays mounted).
- **Root cause**: The child was written with its own fetch loop and never inherited the parent's visibility gate.
- **Impact**: Bounded waste — one IPC + SQLite query per minute per mounted timeline — but it directly contradicts the visibility-gating pattern the parent established, and desktop apps sit minimized for hours.
- **Fix sketch**: Either lift the fetch into `ScheduleTimeline`'s existing coalesced refresh (pass `runs` down as a prop), or pass the parent's `isVisible` down and include it in the effect deps like the parent does (`if (!isVisible) return;`).
