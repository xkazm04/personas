# overview/observability [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 3 medium / 2 low)
> Context group: Observability & Monitoring | Files read: 18 | Missing: 0

## 1. `useAnnotationComposer` memo is defeated every render, cascading into full Recharts re-renders
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_observability/libs/useAnnotationData.ts:117 (with src/features/overview/sub_observability/libs/chartAnnotations.ts:96)
- **Scenario**: Every render of `ObservabilityDashboard` (frequent: store updates, elapsed-time ticks, polling refresh) passes a brand-new array literal `[promptAnnotations, rotationAnnotations, healingAnnotations]` into `useAnnotationComposer`, whose `useMemo` lists `sources` as a dependency.
- **Root cause**: `sources` is a fresh array reference each render, so the composer's `useMemo` never hits its cache — it re-runs merge/filter/sort/dedup and, worse, returns a NEW `chartAnnotations` array reference every render. That reference flows into the `annotations` prop of `memo(MetricsCharts)`, defeating its memoization; both SVG-heavy Recharts charts (AreaChart + BarChart with N ReferenceLines each) re-render on every dashboard render.
- **Impact**: The explicit `memo()` on `MetricsCharts` and all the hoisted-tooltip work in that file are inert; the most expensive components in the tab redraw on every unrelated state change (e.g. the healing overlay's per-second timer, IPC metric updates).
- **Fix sketch**: In `useAnnotationData`, memoize the sources array: `const sources = useMemo(() => [promptAnnotations, rotationAnnotations, healingAnnotations], [promptAnnotations, rotationAnnotations, healingAnnotations]);` and pass that. Alternatively change `useAnnotationComposer` to spread the inner arrays into its dependency list (or accept a stable tuple). Either restores reference stability of `chartAnnotations` and revives the `MetricsCharts` memo.

## 2. `handleFailureBarClick` depends on the entire unstable `d` object — the "stable callback" is not stable
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_observability/components/ObservabilityDashboard.tsx:124
- **Scenario**: The comment says "Stable callback so MetricsCharts memo isn't defeated by inline arrow", but the `useCallback` dependency is `[d]`, and `d` is the object literal returned fresh from `useObservabilityData()` on every render.
- **Root cause**: `useObservabilityData` returns a new object each call, so `[d]` invalidates the callback every render; `onFailureBarClick` changes identity each render, independently defeating the `MetricsCharts` memo (compounding finding #1).
- **Impact**: Even after fixing #1, `MetricsCharts` would keep re-rendering; the intent documented in the code is silently not achieved.
- **Fix sketch**: Depend on the two stable functions actually used: `useCallback((date) => { d.setFailureDrilldownDate(date); d.setOverviewTab('knowledge'); }, [d.setFailureDrilldownDate, d.setOverviewTab])`. Both come from stores/context and are referentially stable. Same pattern review applies to `handleAnomalyClick` (`[drilldown, ...]` — `drilldown` is also likely a fresh object; depend on `drilldown.openDrilldown`).

## 3. `useElapsedTime` runs a 60fps requestAnimationFrame loop for a 1-second counter
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/overview/sub_observability/components/AiHealingStreamOverlay.tsx:13
- **Scenario**: While an AI healing session is active (can last minutes), `tick` re-schedules itself via `requestAnimationFrame`, calling `Date.now()` + `setElapsed` ~60 times per second to display a value that only changes once per second.
- **Root cause**: rAF chosen for a second-resolution timer; React bails out on identical state so the visible re-render is 1/s, but the callback + setState machinery still fires every frame for the overlay's lifetime.
- **Impact**: Continuous needless main-thread wakeups during exactly the window when the app is already busy (LLM healing stream + log auto-scroll). Bounded, but pure waste.
- **Fix sketch**: Replace the rAF loop with `setInterval(() => setElapsed(...), 1000)` (cleared in the same effect), or `setInterval(250)` if sub-second start alignment matters. Keeps identical UX at ~1/240th of the callback rate.

## 4. Annotation `ReferenceLine` renderer copy-pasted between the two charts
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_observability/components/MetricsCharts.tsx:74 (duplicated at :192)
- **Scenario**: The ~18-line annotation `ReferenceLine` block — key construction, stroke/dash styling, and the `label` render function with the `Intl.DateTimeFormat` tooltip title and marker circle — appears verbatim in both the cost AreaChart and the execution-health BarChart.
- **Root cause**: The block was duplicated when the second chart gained annotations instead of extracting a shared renderer.
- **Impact**: Any styling or tooltip-format change must be made twice; the two copies already only differ by the key prefix (`cost-annotation-` vs `health-annotation-`), which is a drift accident waiting to happen.
- **Fix sketch**: Extract `const renderAnnotationLines = (R, annotations, keyPrefix) => annotations.map(...)` (or a small `AnnotationReferenceLines` helper taking `R`) inside the file and call it from both charts. Also hoist the `new Intl.DateTimeFormat(...)` out of the per-annotation label closure — it is constructed per annotation per render.

## 5. Four hand-rolled "Xs/Xm/Xh/Xd ago" relative-time formatters within this one context
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_observability/components/HealingTimeline.tsx:33 (also AlertRulesPanel.tsx:207, IpcPerformancePanel.tsx:54, IssuesList.tsx:49)
- **Scenario**: `formatTimestamp` (HealingTimeline), `agoText` in `EvalHealthIndicator` (AlertRulesPanel), `ageLabel` (IpcPerformancePanel), and the inline `age`/`ageLabel` computation in IssuesList all reimplement relative-age formatting with slightly different thresholds/rounding ("just now" vs "0s ago", `Math.round` vs `Math.floor`).
- **Root cause**: Each component grew its own formatter instead of a shared `formatRelativeAge(tsMs | iso)` util; matches the app-wide date-formatter duplication already catalogued in the refactor backlog.
- **Impact**: Inconsistent output for the same age across panels sitting on the same screen, four spots to touch for i18n of these strings (none currently localized), and continued copy-paste pressure.
- **Fix sketch**: Add one `formatRelativeAge(timestamp: number | string): string` to `@/lib/utils/formatters` (which the context already imports for `formatDuration`), accepting ms-number or ISO string, and replace all four call sites. Keep the "just now" floor behavior as the canonical variant.

## 6. Healing status-badge trio (breaker / retrying / auto-fixed / severity) duplicated between list and modal
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/overview/sub_observability/components/IssuesList.tsx:66 (duplicated in HealingIssueModal.tsx:138)
- **Scenario**: Both `IssuesList` rows and `HealingIssueModal`'s `ModalContent` derive `isAutoFixed` / `isAutoFixPending` / `isCircuitBreaker` from the same `PersonaHealingIssue` fields and render the same 4-way badge cascade (breaker → retrying → auto-fixed → severity) plus the same conditional "retry" cyan badge, with only size/class differences.
- **Root cause**: Badge logic lives inline in each consumer instead of a shared `HealingIssueStatusBadge issue={...} size=...` component.
- **Impact**: The derivation rules (e.g. `auto_fixed && status === 'resolved'`) exist twice; a status-model change (new status value) must be mirrored in both or the list and its detail modal disagree.
- **Fix sketch**: Extract a small `HealingIssueStatusBadges({ issue, size })` component (or at least a `deriveHealingIssueFlags(issue)` helper) into this feature's components folder and use it from both `IssuesList` and `HealingIssueModal`. Purely mechanical; no behavior change.
