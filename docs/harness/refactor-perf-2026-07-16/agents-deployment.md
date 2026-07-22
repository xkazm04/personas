# agents/deployment — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Agent Lab & Evolution | Files read: 29 | Missing: 0

## 1. useDeploymentHealth effect loops forever: unstable array dep + unconditional setState
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_deployment/hooks/useDeploymentHealth.ts:101
- **Scenario**: Open the Unified Deployment Dashboard with at least one cloud deployment. `uniquePersonaIds` is rebuilt (`[...new Set(...)].sort()`) on every render and is in the effect dep array, so the effect re-runs after every render. In the "no fetch needed" branch (line 44-51) it always calls `setHealthMap(mapped)` with a freshly allocated object, which triggers another render, which re-runs the effect, which sets state again — an unbounded render→effect→setState cycle that spins continuously while the dashboard is mounted.
- **Root cause**: A new-array identity (`uniquePersonaIds`) in the dependency list combined with a setState that never bails out (new object literal each pass, and `mapped[entry.id] = data` contents are identical but the wrapper object is not).
- **Impact**: Continuous CPU churn on the dashboard's hot path (re-renders the whole table, sparklines, and summary memos every cycle); also amplifies every other cost in this tree (sorting, filtering, sparkline useMemo re-evaluation via new `daily` array references — those references DO stay cached, but the parent render itself repeats). Battery/fan burn in a desktop Tauri app.
- **Fix sketch**: Drop `uniquePersonaIds` from the dep array (derive it inside the effect from `stableKey`, or keep it in a ref) so the effect keys only on the two string keys. In the re-map branch, compare against the previous map (or track a `mappedKeyRef` of `deploymentIdsKey`) and skip `setHealthMap` when nothing changed. Alternatively compute `healthMap` with `useMemo` from `statsCache` + rows and reserve the effect purely for fetching.

## 2. Test-result badge and busy-action wrapper duplicated between DeploymentTable and DeploymentCard
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_deployment/components/DeploymentTable.tsx:152
- **Scenario**: The PASS/FAIL inline test badge (emerald/red chip with duration `Numeric`, error tooltip, dismiss `X`) is hand-rolled twice: DeploymentTable.tsx:152-175 and cloud/DeploymentCard.tsx:182-216, with slightly different layouts already drifting (table shows cost only in the title attr, card shows a `Numeric` cost). Likewise `handleAction = async (id, action) => { setBusyId(id); try { await action(); } finally { setBusyId(null); } }` exists verbatim in UnifiedDeploymentDashboard.tsx:111 and DeploymentCard.tsx:47.
- **Root cause**: The unified dashboard and the cloud Deployments tab both render deployment rows/cards and each grew its own copy of the shared test-result affordance instead of extracting it.
- **Impact**: Any change to test-result presentation (e.g. adding token counts, a11y labels) must be made twice; the two copies have already diverged in what they show for cost.
- **Fix sketch**: Extract a `TestResultBadge({ result, onDismiss })` component next to `useDeploymentTest` (it already owns the `TestResult` type) and use it in both places. Extract the busy-wrapper as a tiny `useBusyAction()` hook returning `{ busyId, run }`, used by both the dashboard and the card.

## 3. cloudSchedulesHelpers: dead exported props type and module-level English-only i18n snapshot
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/agents/sub_deployment/components/cloud/cloudSchedulesHelpers.tsx:19
- **Scenario**: `CloudSchedulesPanelProps` is exported here but CloudSchedulesPanel.tsx:19 declares its own identical local `Props` interface — the exported type has no consumer in this context (cross-context callers unlikely for a panel-props type, but verify). Additionally the module pins `const t = en` (line 13), so `CRON_PRESETS`, `triggerTypeLabel`, and `healthBadge` render English labels regardless of the active locale, while every component around them uses `useTranslation()`.
- **Root cause**: Helpers were split out of the panel and the props type was left behind; module-scope constants can't call the hook, so the author froze the English catalog instead of parameterizing.
- **Impact**: Dead export invites drift (someone edits the exported type expecting the panel to change); the `const t = en` snapshot silently breaks localization for the schedules surface and sets a copy-paste precedent.
- **Fix sketch**: Delete `CloudSchedulesPanelProps` and have the panel keep its local `Props` (or vice versa — one definition). Make the helpers take `t` as a parameter (`triggerTypeLabel(t, type)`) or return label keys, and turn `CRON_PRESETS` into label-key + cron pairs resolved at render time in CreateTriggerForm.

## 4. DailyBreakdownChart re-renders the entire SVG on every mousemove
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/agents/sub_deployment/components/cloud/DailyBreakdownChart.tsx:112
- **Scenario**: Hovering the History chart fires `setTooltipPos` on every `mousemove` over a bar's hover zone. Each state update re-renders the whole component: with the 90-day period that is ~90 `<g>` groups (two rects + text each) plus the cost polyline recomputed per pointer event (~60/sec), and `getBoundingClientRect()` is called per event (layout read).
- **Root cause**: Tooltip position lives in React state and the bar/line JSX is not isolated from it, so pointer-tracking state invalidates the full chart render.
- **Impact**: Visible jank on hover for larger periods, wasted CPU on a panel that also polls; bounded (only while hovering) so not High.
- **Fix sketch**: Split the tooltip into its own child that owns `hoverIdx`/`tooltipPos` state, or drive tooltip position imperatively via a ref (`tooltipEl.style.transform`) from the mousemove handler while keeping only `hoverIdx` in state (opacity change per bar). Cache the svg bounding rect on mouseenter instead of per move.

## 5. CloudHistoryPanel imports helpers only to alias them unused
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/agents/sub_deployment/components/cloud/CloudHistoryPanel.tsx:13
- **Scenario**: `statusIcon as _statusIcon` and `timeAgo as _timeAgo` are imported and never referenced — the underscore rename exists only to dodge the unused-import lint rule after the row rendering moved into CloudExecutionRow.
- **Root cause**: Leftover from extracting CloudExecutionRow; the imports were silenced instead of removed.
- **Impact**: Pure noise: misleads readers into thinking the panel formats rows itself and normalizes lint-suppression-by-rename.
- **Fix sketch**: Change line 13 to `import { formatDuration, formatCost } from './CloudHistoryHelpers';` and drop the two aliased names.
