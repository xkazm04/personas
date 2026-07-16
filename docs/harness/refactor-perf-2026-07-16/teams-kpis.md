# teams/kpis — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 2 medium / 3 low)
> Context group: Execution & Orchestration | Files read: 11 | Missing: 3

Missing files (stale context map): `ContextKpiDashboard.tsx`, `KPIDetailDrawer.tsx`, `KPIExplainer.tsx` — replaced by `KpiDetailModal.tsx` / `kpiDetailParts.tsx` / `useKpiDetail.ts` / `KpiSignalBoard.tsx` / `kpiDistance.tsx`, which exist in the directory but are not in the spec.

## 1. SQLite-timestamp parsing (`replace(' ', 'T')`) hand-rolled in 3+ files

- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_kpis/kpiMath.ts:55 (also kpiMath.ts:127, KpiSteeringPanel.tsx:30, KPIDashboard.tsx:128)
- **Scenario**: Every consumer of a DB timestamp re-implements `new Date(s.replace(' ', 'T')).getTime()`. KpiSteeringPanel at least extracted a local `ts()` helper; kpiMath and KPIDashboard inline it. The next caller (there are already detail-modal files in this folder outside the spec) will copy it again, and one copy will eventually forget the `replace` or the UTC nuance and silently diverge on track/pace verdicts.
- **Root cause**: No shared `parseDbTimestamp(s: string): number` utility for the SQLite `YYYY-MM-DD HH:MM:SS` format, so each file re-derives the ISO-ification.
- **Impact**: Maintenance hazard on the code path that decides "is this KPI off-track" (drives autopilot goal derivation); a divergent copy produces wrong pace verdicts with no error.
- **Fix sketch**: Add `parseDbTimestamp` (or reuse an existing one — the personas codebase very likely has this pattern elsewhere too, worth a repo-wide grep for `replace(' ', 'T')`) in a shared `lib/` date util; replace the four call sites in this context. Keep `ts()` in KpiSteeringPanel as a re-export or delete it.

## 2. Trend-chart row assembly is O(timestamps × series × points)

- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: quadratic-algorithm
- **File**: src/features/teams/sub_kpis/KPIDashboard.tsx:137-144
- **Scenario**: `trendModel` builds one row per distinct timestamp, and for each row does `s.pts.find((p) => p.t === ts)` per series — a linear scan of every series' points for every timestamp. With daily-cadence KPIs measured for months across many projects (the dashboard is explicitly cross-project, "All" is the default filter), stamps ≈ series × points, so this is effectively cubic-ish in measurement volume and reruns on every `kpiTrends` store update (which `fetchKpiTrends` triggers on every page mount).
- **Root cause**: Point lookup by timestamp uses `Array.find` inside a nested loop instead of a per-series `Map<number, number>`.
- **Impact**: Bounded today (small data) but the growth curve is wrong for an append-only measurement series; at ~20 KPIs × 200 measurements this is ~16M comparisons inside a useMemo on the main thread.
- **Fix sketch**: Precompute `const byT = new Map(s.pts.map(p => [p.t, p.v]))` per series once, then `row[s.kpi.id] = byT.get(ts)` guarded for undefined. One-line change per loop, same output.

## 3. `projectName` id→name lookup builder duplicated verbatim

- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_kpis/KPIDashboard.tsx:58-62 (dup: KPIProposalsQueue.tsx:31-35)
- **Scenario**: Both the dashboard and the proposals queue build the identical `useMemo` — Map from `projects`, closure returning `m.get(id) ?? '—'` — character for character, including the `'—'` fallback.
- **Root cause**: No shared `useProjectName()` hook (or selector) over the systemStore `projects` slice.
- **Impact**: Pure duplication; a future change to the fallback or to project display names must be made twice.
- **Fix sketch**: Extract `useProjectName(): (id: string) => string` into the store helpers or `features/shared`; replace both call sites. Worth a quick grep — the same pattern likely exists in other features reading `s.projects`.

## 4. Leftover dead computation + stale comment in `handleEvaluateDue`

- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/teams/sub_kpis/KPIsPage.tsx:58-61
- **Scenario**: `const n = Object.keys(results).length;` followed by `void n;` and a comment explaining why the count is *not* surfaced — the value is computed only to be discarded.
- **Root cause**: A success-toast was considered and removed, leaving the scaffolding behind.
- **Impact**: Noise; the `void n` idiom reads like suppressed lint debt and invites "what was this for?" archaeology.
- **Fix sketch**: Reduce the body to `await evaluateDueKpis(activeProjectId);` and keep one short comment ("dashboard re-render is the feedback"). Delete `results`/`n`.

## 5. `paceDescriptor` recomputed per trend line inside the chart render

- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/teams/sub_kpis/KPIDashboard.tsx:253
- **Scenario**: Each `<R.Line>` calls `paceDescriptor(kpi)` (which internally runs `kpiTrack` + date math with `Date.now()`) on every chart render, even though the same descriptors were already computed and memoized in `paced` at line 81. The `Legend` formatter also does an `Array.find` over series per legend item per render.
- **Root cause**: The chart render closure reaches for the raw `kpi` instead of the already-computed `paced` results.
- **Impact**: Redundant work on every re-render of a recharts chart (which re-renders on hover/tooltip activity); small absolute cost, but it duplicates the track computation the summary strip already did — a drift hazard as much as a perf one.
- **Fix sketch**: Build `const trackById = new Map(paced.map(p => [p.kpi.id, p.d.track]))` in a useMemo and use `TRACK_COLOR[trackById.get(kpi.id) ?? 'unmeasured']` for the stroke; likewise precompute a `nameById` map for the Legend formatter.
