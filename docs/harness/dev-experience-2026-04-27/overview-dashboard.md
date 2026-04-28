# Overview Dashboard — Dev Experience Scan

> Total: 11 · Critical: 2 · High: 4 · Medium: 4 · Low: 1
> Scope: client-side only
> Date: 2026-04-27

---

## 1. Three parallel dead module trees ship to bundle and confuse navigation

- **Severity**: Critical
- **Category**: code-organization
- **File**: `src/features/overview/sub_executions/components/*` (5 files), `src/features/overview/sub_timeline/components/UnifiedActivityTimeline.tsx`, `src/features/overview/sub_analytics/components/AnalyticsDashboard.tsx`, `src/features/overview/sub_realtime/RealtimeVisualizerPage.tsx` + 5 flat siblings, `components/dashboard/widgets/RecentActivityList.tsx`, `components/dashboard/widgets/DashboardHeaderBadges.tsx`, `components/dashboard/cards/RemoteControlCard.tsx`
- **Scenario**: `OverviewPage` was consolidated into `DashboardHomeMissionControl` (per the comment in `DashboardWithSubtabs.tsx`: *"previously hosted Overview/Analytics/Realtime/Timeline subtabs"*). The replaced views were never deleted. `sub_executions/components/GlobalExecutionList.tsx` and `sub_activity/components/GlobalExecutionList.tsx` are near-duplicates with the older one (`sub_executions`) imported only from itself; `sub_realtime/RealtimeVisualizerPage.tsx` differs from `sub_realtime/components/views/RealtimeVisualizerPage.tsx` and the index re-exports the latter — both ship.
- **Root cause**: Refactor-by-addition without delete pass. Sub-folder index files still re-export dead trees (`sub_analytics/index.ts` exports `AnalyticsDashboard`, `sub_executions/index.ts` exports the old list/dashboard).
- **Impact**: Greps return wrong file first; new hires edit the dead copy and ship a no-op PR; 15+ files (~2k LOC) of phantom code; `bundle-baseline.json` still tracks `RealtimeVisualizerPage: 56.3` so the tree-shaker can't drop it.
- **Fix sketch**: Run a `knip` / `ts-prune` pass scoped to `src/features/overview/**`, delete unimported files, kill the `sub_executions/`, `sub_timeline/`, top-level `sub_realtime/*.tsx` flats, and the three orphan widgets. Add a CI check (the project already has `eslint-rules/`) to forbid two files with the same basename inside `features/overview` unless one is a `.test.ts`.

---

## 2. Five parallel "stat tile" components that all do icon + label + value + color

- **Severity**: High
- **Category**: code-organization
- **File**: `components/dashboard/widgets/DashboardHeaderBadges.tsx`, `components/dashboard/DashboardHomeMissionControl.tsx:435 (StatTile)`, `sub_activity/components/MetricsCards.tsx:20 (SummaryCard)`, `sub_observability/components/OverviewStatCard.tsx`, `sub_analytics/components/AnalyticsSummaryCards.tsx`, `sub_realtime/RealtimeStatsBar.tsx` (inline AnimatedNumber blocks)
- **Scenario**: Every dashboard surface re-implements the same KPI tile with its own colorMap, `bg/border/text` token table, animated counter wiring, optional sparkline, optional trend arrow. `OverviewStatCard` has 7 colors, `SummaryCard` has 4, `StatTile` has hardcoded Tailwind classes per call site, `DashboardHeaderBadges` ships a starter-tier vs full-tier branch.
- **Root cause**: No shared `<KpiTile>` primitive. Each subtab author starts from scratch because the existing variants don't compose (`SummaryCard` uses `colorMap.split(' ')`, `OverviewStatCard` has a separate `iconBgMap`).
- **Impact**: Every cosmetic change to KPIs requires touching 5 files. Color tokens drift (`bg-emerald-500/15` vs `/10`, `border/20` vs `/25`). Animation behaviour varies (some use `AnimatedCounter`, some `useAnimatedNumber`, some none).
- **Fix sketch**: Extract one `KpiTile` in `features/overview/components/shared/` accepting `{ icon, label, value, color, format?, trend?, sparkline?, density?: 'badge' | 'card' | 'console' }`. Migrate the four live consumers, delete the rest. Single source of truth for the color token map.

---

## 3. Three different "success rate" formulas with a comment-only registry

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/overview/utils/metricIdentity.ts`, `sub_analytics/libs/useOverviewMetrics.ts:99`, `sub_observability/libs/useObservabilityData.ts:94`, `components/dashboard/DashboardHomeMissionControl.tsx:80`, `stores/slices/overview/alertSlice.ts:50` (`evaluateRule`)
- **Scenario**: `metricIdentity.ts` defines three named identities (`dashboardRecentExecutions`, `analyticsSummary`, `executionDashboardSummary`) so different windows produce different numbers from "the same KPI." But `useObservabilityData` computes `(success/total*100).toFixed(1)` inline ignoring the registry; `alertSlice.evaluateRule` reads `successfulExecutions/totalExecutions*100` directly with its own zero-guard. The `health` slice uses `dashboard.overall_success_rate` directly. Same metric, four formulas.
- **Root cause**: `resolveMetricPercent` is opt-in and undocumented in `README.md`. The decision rubric in the README doesn't mention it.
- **Impact**: Bug class — Mission Control shows 91%, Analytics shows 90.7%, the alert rule fires at 89% but the Stat Page header still says "healthy." Users have raised this kind of drift before (per project memory `feedback_ux_quality.md`).
- **Fix sketch**: Make `resolveMetricPercent` the only path: ESLint rule banning `successfulExecutions / totalExecutions` arithmetic outside `metricIdentity.ts` and `alertSlice` (or move alert rule eval to call `resolveMetricPercent`). Add a unit test asserting the three identities produce identical numbers when fed the same totals.

---

## 4. One hand-rolled Recharts boilerplate per chart × 18 charts

- **Severity**: High
- **Category**: code-organization
- **File**: `sub_analytics/components/AnalyticsCharts.tsx`, `sub_activity/components/MetricsCharts.tsx`, `sub_observability/components/MetricsCharts.tsx`, `components/dashboard/widgets/AnalyticsInserts.tsx`, `components/dashboard/widgets/TrafficErrorsChart.tsx`
- **Scenario**: 18 instances of `<CartesianGrid strokeDasharray="3 3" stroke={getGridStroke()} /><XAxis ... fontSize={sf(10)} /><YAxis ... /><Tooltip content={<ChartTooltip />} />`. `MetricChart` was extracted as a card wrapper but doesn't own the axes/grid/tooltip. Each call site re-imports `getGridStroke`, `getAxisTickFill`, `useScaledFontSize`, `ChartTooltip`.
- **Root cause**: The shared primitive (`MetricChart`) only wraps the outer card and `<ResponsiveContainer>`. The repetitive part — axes, grid, tooltip, font scaling — lives in the children.
- **Impact**: Adding a chart is 25 lines of boilerplate. A theme tweak (e.g. `strokeDasharray`) requires 18 edits. New devs miss `useScaledFontSize` and chart text doesn't honor accessibility scaling.
- **Fix sketch**: Promote `MetricChart` into a `MetricChart.Themed` variant that wires `<CartesianGrid>`, `<XAxis dataKey>`, `<YAxis>`, `<Tooltip>` from props (`xKey`, `yFormatter`, `gridless?`). Keep the primitive form for one-offs.

---

## 5. Feature-scoped `i18n/` folder violates its own README anti-patterns list

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/overview/i18n/{en,zh,ar,hi,ru,id,es,fr,bn,ja,vi,de,ko,cs}.ts` + `useOverviewTranslation.ts`
- **Scenario**: `README.md` line 73 lists "Adding a feature-scoped `i18n/` under a sub-folder" as an explicit anti-pattern: *"All new strings go into `src/i18n/en.ts` per the root CLAUDE.md."* Yet `features/overview/i18n/` exists with 14 locale files and a custom hook used by 4 files. 99 other files in the same tree use the canonical `@/i18n/useTranslation`.
- **Root cause**: Anti-pattern was documented but not enforced or removed.
- **Impact**: New translators ask which file to edit. Bundle includes 14 locale chunks twice. Two slices of strings drift in tone ("all clear" vs "no events").
- **Fix sketch**: Add an ESLint rule (project has `eslint-rules/` already) banning `import * from '@/features/*/i18n/'`. Migrate the 4 outlier files to `@/i18n/useTranslation`, delete `features/overview/i18n/`.

---

## 6. `useExecutionDashboardPipeline` debounces with 250ms but ignores in-flight coalescing

- **Severity**: Medium
- **Category**: dev-loop-friction
- **File**: `src/hooks/overview/useExecutionDashboardPipeline.ts:106-116`
- **Scenario**: Debounce timer resets on every filter change but a fast click sequence (day=7 → day=30 → day=90) still queues 3 pipelines if the user clicks faster than the previous wave completes. Wave 1 starts before wave 2 of the previous click finishes, causing a `setOverviewTab` re-render mid-fetch. The `useOverviewMetrics.refreshAllSafe` shows the correct pattern (in-flight ref + queued flag) but the canonical pipeline doesn't use it.
- **Root cause**: Two parallel refresh implementations — pipeline hook (debounce only) vs `useOverviewMetrics` (proper coalescing). They don't share infra.
- **Impact**: When DevTools throttles to 4× CPU, day-range scrubbing shows stale numbers for 1–2 seconds while the correct request silently finishes second. Hard to repro without throttling, hard to debug without reading both files.
- **Fix sketch**: Lift the in-flight/queued ref pattern into `lib/utils/coalesceFetch.ts` (analogous to existing `deduplicateFetch.ts`). Use it in both hooks and document in the pipeline doc-comment.

---

## 7. Dashboard pipeline yields with `setTimeout(r, 0)` between waves — racy with strict-mode unmount

- **Severity**: Medium
- **Category**: dev-loop-friction
- **File**: `src/hooks/overview/useExecutionDashboardPipeline.ts:94`, `stores/slices/overview/personaHealthSlice.ts:274`
- **Scenario**: Both files use `await new Promise(r => setTimeout(r, 0))` to yield to React paint. The pipeline checks `signal.cancelled` after the yield, but `mountedRef.current` is mutated in the cleanup *after* the timeout has fired. Under StrictMode double-mount in dev, wave 1 of the first effect can land while wave 2 of the second effect is mid-flight, both writing to the same store.
- **Root cause**: `mountedRef.current = { cancelled: false }` is shared by all effect runs (declared once via `useRef`); cancellation flips an object on the ref but the ref *itself* never resets between StrictMode pairs.
- **Impact**: Phantom errors on cold reload in dev: "Pipeline failed: globalExecutions" appears once, then disappears 250ms later. Devs spend ~10 min hunting before realising it's StrictMode noise.
- **Fix sketch**: Replace the shared `mountedRef` with a per-effect `AbortController`. Pass the signal to `fetchExecutionDashboard` etc. so the actual `tauriInvoke` aborts. Document in the pipeline doc-comment why the `setTimeout(0)` is needed (or remove it — Tauri IPC already yields).

---

## 8. `OverviewFilterContext` deprecates `useOverviewFilters` but two new files added in this scan still call it

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/overview/components/dashboard/OverviewFilterContext.tsx:36`, `sub_analytics/components/AnalyticsDashboard.tsx:18`, `sub_observability/libs/useObservabilityData.ts:30`
- **Scenario**: The combined `useOverviewFilters` is `@deprecated` with the comment *"Use OverviewFilterValues & OverviewFilterActions separately."* But the code still calls it from two of the heaviest consumers. Each call re-renders the consumer whenever any filter value changes (purpose of the split).
- **Root cause**: Deprecation tag added without a migration. No ESLint `@deprecated` warning surfaced in the project's lint config.
- **Impact**: Filter scrubs cause unnecessary re-renders in AnalyticsDashboard (~30 children). Devs reach for the deprecated hook because it's the most ergonomic.
- **Fix sketch**: Either (a) actually delete `useOverviewFilters` and migrate the 2 callers to the split hooks, or (b) drop the deprecation. Right now it's the worst of both worlds. Enable `eslint-plugin-deprecation` if (a).

---

## 9. Only one test file in 251 source files (`sub_health/libs/compositeHealthScore.test.ts`)

- **Severity**: High
- **Category**: testing
- **File**: `src/features/overview/**` (251 `.ts/.tsx` files, 1 `.test.ts`)
- **Scenario**: The pure functions in `utils/computeTrends.ts`, `utils/metricIdentity.ts`, `stores/slices/overview/personaHealthSlice.ts:detectFailureTrend/computeHeartbeatScore/generateRoutingRecommendations`, `lib/fleet/fleetOptimizer.ts` (consumed by FleetOptimizationCard), and `alertSlice.evaluateRule` are all untested despite being the bug-prone heart of the dashboard.
- **Root cause**: No test scaffolding for the overview feature. The one existing `compositeHealthScore.test.ts` proves the path is open but nothing has been added since.
- **Impact**: Refactors of the metric registry (finding 3) or trend math (finding 6 in this report's predecessor scans) are pure regression-by-vibes. The only way to verify correctness is to run the app and eyeball numbers against a known database.
- **Fix sketch**: Add a `__tests__/` co-located with each `libs/` folder. Start with `metricIdentity.test.ts` (4 cases), `computeTrends.test.ts` (5 cases), `alertSlice.evaluateRule.test.ts` (one per metric). Wire into existing Vitest config. Target 60% coverage on `**/libs/*.ts` only — leave components for later.

---

## 10. `lazyRetry` import everywhere but no shared factory for "lazy + suspense + error boundary"

- **Severity**: Low
- **Category**: code-organization
- **File**: `components/dashboard/OverviewPage.tsx:12-21`, `components/dashboard/DashboardHomeMissionControl.tsx:38-40`, `sub_health/components/PersonaHealthDashboard.tsx:16,20`
- **Scenario**: `OverviewPage` lazy-loads 9 subtabs; `DashboardHomeMissionControl` lazy-loads 3 cards; `PersonaHealthDashboard` lazy-loads 2 sub-views. Each one re-implements `<ErrorBoundary><Suspense fallback={...}><LazyXxx /></Suspense></ErrorBoundary>` differently — some omit the error boundary, some use `<SuspenseFallback />`, some `<div>Loading...</div>`, some `null`.
- **Root cause**: No shared `<LazyView>` helper. `lazyRetry` is just a wrapper around `React.lazy` with retry-on-import-error.
- **Impact**: When a chunk fails to load, three different UX outcomes depending on which branch the user hit. Inconsistent loading experience makes the app feel unfinished.
- **Fix sketch**: Add `LazyView({ name, importer, fallback?: 'spinner'|'skeleton'|null })` in `features/shared/`. Standardize fallback to a brand skeleton. Saves ~50 lines and centralizes the error boundary policy.

---

## 11. README rubric isn't enforced; `sub_executions` parallel folder violates the very anti-pattern it warns about

- **Severity**: Medium
- **Category**: documentation
- **File**: `src/features/overview/README.md` line 61–66, vs. `src/features/overview/sub_executions/`
- **Scenario**: README rubric says: *"Does it render `UnifiedSpan` trees... do not re-implement tree flattening — import from `features/agents/sub_executions/libs/traceHelpers`."* Yet the codebase has its own `features/overview/sub_executions/` (now dead, see finding 1) which once duplicated this. The README doesn't mention the *overview* `sub_executions` exists, leaving readers confused which `sub_executions` it refers to.
- **Root cause**: README written before the dead-folder cleanup; namespace collision with `features/agents/sub_executions/`.
- **Impact**: Developers grep for `sub_executions` and hit the wrong path. Onboarding cost: 10–20 min for the first contributor to the overview feature.
- **Fix sketch**: After deleting the dead `overview/sub_executions/` (finding 1), update README to fully-qualify all references (`features/agents/sub_executions`). Add a "where things live" table at the top mapping the user-facing tab → folder.
