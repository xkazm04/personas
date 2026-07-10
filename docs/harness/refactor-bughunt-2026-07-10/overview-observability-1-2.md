> Context: overview/observability [1/2]
> Total: 9
> Critical: 0  High: 2  Medium: 3  Low: 4

## 1. Resolve button in issue list also opens the detail modal (event bubbles)
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case
- **File**: src/features/overview/sub_observability/components/IssuesList.tsx:55-107
- **Scenario**: The whole row `<div>` has `onClick={() => onSelectIssue(issue)}` (line 62). The inner "Resolve" button (line 101-106) calls `onResolve(issue.id)` but never calls `e.stopPropagation()`. Clicking Resolve fires `onResolve` AND bubbles to the row's `onSelectIssue`, so the detail modal pops open for the very issue the user just resolved. The title `<button>` (line 90-95) has the same double-invocation (button `onSelectIssue` + row `onSelectIssue`).
- **Root cause**: Nested interactive elements inside a clickable container without stopping propagation.
- **Impact**: UX — every Resolve click opens a modal over a just-resolved issue; feels like a glitch, can trigger a redundant resolve/select round-trip.
- **Fix sketch**: In the Resolve and title button handlers, take the event and call `e.stopPropagation()` before invoking `onResolve`/`onSelectIssue` (e.g. `onClick={(e) => { e.stopPropagation(); onResolve(issue.id); }}`).

## 2. Live healing stream listens on the wrong persona when "All personas" is selected
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case
- **File**: src/features/overview/sub_observability/components/ObservabilityDashboard.tsx:95 ; src/features/overview/sub_observability/libs/useHealingPanelState.ts:33
- **Scenario**: The overlay subscribes with `useAiHealingStream(d.selectedPersonaId ?? '')` (line 95), i.e. an empty persona id when the filter is "All personas" (the default, since `selectedPersonaId` starts null). But `handleRunAnalysis` triggers healing for `selectedPersonaId || personas[0]?.id` (useHealingPanelState:33) — a real persona. So when no persona is selected and the user clicks Run Analysis, the backend heals `personas[0]` while the live stream is subscribed to `''` and receives no events → the `AiHealingStreamOverlay` never appears (or shows an empty stream).
- **Root cause**: Two independent fallbacks for "which persona": the stream falls back to `''`, the trigger falls back to `personas[0].id`. They diverge.
- **Impact**: UX / observability — the marquee live-healing overlay silently no-shows on the default filter state.
- **Fix sketch**: Compute one effective id (`const healingPersonaId = d.selectedPersonaId || d.personas[0]?.id`) and pass the same value to both `useAiHealingStream(...)` and `handleRunAnalysis`.

## 3. Elapsed timer carries over from a prior healing session (stale startRef)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/features/overview/sub_observability/components/AiHealingStreamOverlay.tsx:8-37
- **Scenario**: `useElapsedTime` sets `startRef.current` on first activation and deliberately never resets it to `null` after completion ("keep the final elapsed value visible"). If the overlay stays mounted across a `completed → started` transition (it does: `showHealingOverlay = phase !== 'idle' && !dismissed`, and dismissed is reset on `started`), the new session re-enters `active`, sees `startRef.current !== null`, and keeps the OLD start timestamp. Elapsed for the second session is then `now - oldStart` — potentially many minutes.
- **Root cause**: `startRef` is only cleared on unmount, not on a fresh active edge, so back-to-back sessions share a start time.
- **Impact**: UX — wildly inflated "elapsed" on consecutive heals without a dismiss in between.
- **Fix sketch**: Reset `startRef.current = Date.now()` whenever `active` transitions false→true (or reset to null on the `!active` branch only once the phase returns to idle), rather than preserving it indefinitely.

## 4. Relative-time formatters duplicated across 4+ components
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/overview/sub_observability/components/HealingTimeline.tsx:33-39 ; IpcPerformancePanel.tsx:54-61 ; IssuesList.tsx:49-50 ; AlertRulesPanel.tsx:207-212 ; AnomalyDrilldownPanel.tsx:38-44
- **Scenario**: Five near-identical "Ns / Nm / Nh / Nd ago" (and "before/after") helpers: `formatTimestamp` (HealingTimeline), `ageLabel` (IpcPerformancePanel), the inline `ageLabel` in IssuesList, `agoText` in AlertRulesPanel's `EvalHealthIndicator`, and `formatOffset` in AnomalyDrilldownPanel. Verified each computes `Date.now() - ts` and buckets by the same 60s/3600s/86400s thresholds.
- **Root cause**: Each component grew its own copy instead of importing a shared util.
- **Impact**: Maintainability — inconsistent rounding (`Math.round` vs `Math.floor`) and no shared invalid-date handling; four places to change for one format tweak.
- **Fix sketch**: Add a `formatRelativeAge(ts)` (and `formatSignedOffset`) to `@/lib/utils/formatters` and replace the five local copies.

## 5. Healing-issue status badge block duplicated (breaker / retrying / auto-fixed / severity)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/overview/sub_observability/components/IssuesList.tsx:66-89 ; HealingIssueModal.tsx:138-159
- **Scenario**: Both render the same four-way conditional badge (`is_circuit_breaker` → breaker, `status==='auto_fix_pending'` → retrying, `auto_fixed && resolved` → auto-fixed, else severity) plus the "retry" chip when `execution_id` is set, with identical class vocabulary. HealingTimeline's ChainCard repeats a subset (breaker/severity chips, lines 75-92).
- **Root cause**: No shared presentational component for a healing-issue status; each surface re-implements the branch ladder.
- **Impact**: Maintainability — a new status or a color change must be edited in 2-3 places and can drift.
- **Fix sketch**: Extract `<HealingIssueStatusBadge issue={issue} size=.. />` (and optionally a `<RetryChip>`) into the sub_observability components dir; consume from IssuesList, HealingIssueModal, and ChainCard.

## 6. Keyboard focus index not reset when the issue list is filtered/shortened
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/overview/sub_observability/components/IssuesList.tsx:15-64
- **Scenario**: `focusedIndex` persists across `issues` prop changes. Switch the filter chip from All (5 rows) to Auto-fixed (1 row) while `focusedIndex === 3`: now no row satisfies `tabIndex={focusedIndex === index ? 0 : -1}`, so the listbox has no tab stop, and `aria-selected` points at a nonexistent index. `rowRefs.current` also retains stale entries beyond the new length.
- **Root cause**: `focusedIndex` is component state independent of the `issues` array identity; no reset effect.
- **Impact**: UX / a11y — momentary loss of keyboard focusability after filtering (recovers on next ArrowUp/Down).
- **Fix sketch**: Add `useEffect(() => setFocusedIndex(-1), [issues])` (or clamp to `issues.length - 1`) and truncate `rowRefs.current.length = issues.length`.

## 7. Elapsed clock schedules a requestAnimationFrame loop for a per-second display
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: performance
- **File**: src/features/overview/sub_observability/components/AiHealingStreamOverlay.tsx:13-34
- **Scenario**: `tick` reschedules `requestAnimationFrame(tick)` every frame (~60 fps) while healing is active, each frame calling `Date.now()` and `setElapsed(Math.floor(... / 1000))`. React bails out of re-render when the integer second is unchanged, but the rAF callback still fires ~60×/s for the entire heal duration purely to update a seconds counter.
- **Root cause**: Using rAF for a 1 Hz clock.
- **Impact**: Minor CPU/battery churn during long heals.
- **Fix sketch**: Replace the rAF loop with `setInterval(() => setElapsed(...), 1000)` (clear on cleanup), or gate the rAF update to only run when the whole-second value changes.

## 8. Invalid/absent timestamps produce NaN in age helpers (no guard)
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/overview/sub_observability/components/AlertRulesPanel.tsx:207-212 ; HealingTimeline.tsx:33-39 ; IssuesList.tsx:49-50
- **Scenario**: `EvalHealthIndicator` computes `age = Date.now() - new Date(health.lastEvalAt).getTime()` (guarded only by `if (!health.lastEvalAt)`; a malformed string still yields NaN → renders "NaNs ago"). `formatTimestamp`/`ageLabel` likewise `new Date(ts)` without `Number.isNaN` checks, unlike `toChartDate` (chartAnnotations.ts:39) which does guard. If the backend ever emits a non-ISO or empty timestamp, the UI shows "NaNh ago".
- **Root cause**: Date parsing without validating `getTime()`, inconsistently with the guarded helper next door.
- **Impact**: UX — occasional "NaN" labels; cosmetic but looks broken.
- **Fix sketch**: In the shared `formatRelativeAge` from finding #4, early-return a dash/em-space when `Number.isNaN(parsed.getTime())`.

## 9. Annotation ReferenceLine label render block duplicated verbatim across two charts
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/overview/sub_observability/components/MetricsCharts.tsx:74-91, 192-209
- **Scenario**: The cost `AreaChart` and the health `BarChart` each map `visibleAnnotations` to a `<R.ReferenceLine>` whose `label` renders an identical `<g><title>{label · formatted-timestamp}</title><circle r={2.2}.../></g>`, including the same `Number.isFinite(Date.parse(...))` inline formatter. Only the React `key` prefix differs.
- **Root cause**: Copy-paste of the annotation marker between the two chart definitions.
- **Impact**: Maintainability — annotation marker styling/format must be edited in two spots.
- **Fix sketch**: Extract a `renderAnnotationRefLine(annotation, index, keyPrefix)` helper (or a small component) local to MetricsCharts and call it from both charts.
