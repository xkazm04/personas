# UI Perfectionist — overview-dashboard-metrics
> Total: 6
> Severity: 1 critical, 2 high, 2 medium, 1 low

## 1. Annotation tooltips render `[object Object]` in chart `<title>` text
- **Severity**: critical
- **Category**: accessibility
- **File**: src/features/overview/sub_observability/components/MetricsCharts.tsx:86 (also :203)
- **Scenario**: Hovering an annotation marker on the "Cost Over Time" area chart or the "Execution Health" bar chart shows a native SVG tooltip reading e.g. `Deploy v2.1 * [object Object]` instead of the deploy time. The `<title>` is the only text alternative for these decorative `<circle>` markers, so screen-reader and hover users both get a broken string.
- **Root cause**: The `<title>` content is a template literal that interpolates a React element: `` `${annotation.label} * ${<AbsoluteTime timestamp={annotation.timestamp} />}` ``. `AbsoluteTime` returns a JSX `<span>`/`<Tooltip>` element (confirmed in AbsoluteTime.tsx:49-55), and an object inside a template literal stringifies to `[object Object]`. A React component can never be embedded in a string this way.
- **Impact**: inaccessible / error-blind — the marker's text alternative is meaningless, and the visible hover affordance is broken.
- **Fix sketch**: Format the timestamp to a string (the codebase already has `formatRelativeTime`/`Intl.DateTimeFormat`), e.g. `title={\`${annotation.label} · ${new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(Date.parse(annotation.timestamp))}\`}`. Apply at both :86 and :203. Also fix the literal `*` separator to a real `·`/`—`.

## 2. Two competing chart-card primitives split the dashboard's visual language
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/overview/sub_usage/components/MetricChart.tsx:42 (vs DashboardChartCard.tsx:50)
- **Scenario**: A user moving from Home → Observability → Certification sees three different chart "frames": Home charts use a `rounded-modal p-4 space-y-4` card with a tinted icon chip, an accent glow, a `typo-label` title and a `border-t` footer (`DashboardChartCard`); Observability charts use `rounded-modal p-4` with an `uppercase tracking-widest typo-heading` title and no glow/footer (`MetricChart`); Certification's `TrajectoryChart` hand-rolls a third frame (`h-48 bg-secondary/20 rounded-modal border p-3`, TrajectoryChart.tsx:31) with no header at all.
- **Root cause**: `DashboardChartCard` was introduced to unify Home charts (its own docstring says "later stages fold the heatmap, sparkline, and rotation panels onto the same primitive"), but Observability and Certification never adopted it; title casing, padding, glow, and empty-state handling diverge per area.
- **Impact**: inconsistency — chart cards read as belonging to different apps; title typography (`typo-label` vs `uppercase typo-heading`) is the most visible mismatch.
- **Fix sketch**: Promote `DashboardChartCard` to the single chart shell (move it to `features/overview/components/shared/`), give it a `titleStyle: 'label' | 'heading'` prop, and migrate `MetricChart` consumers and `TrajectoryChart` onto it. At minimum, align the title typography and card padding tokens across the two existing primitives now.

## 3. Two competing KPI/stat-card primitives — `StatCard` vs `KpiTile`
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/overview/sub_director/DirectorCoachingTab.tsx:211 (StatCard) vs sub_observability/components/ObservabilityDashboard.tsx:209 (KpiTile `card-rich`)
- **Scenario**: Director's KPI row (Value Rate, Avg Score, Cost/Value, In Scope) uses `StatCard`: a `rounded-card` tile with a uppercase `text-foreground/55` label on the left, a top tone "signal line", and a small icon chip on the right. Observability's KPI row (Total Cost, Executions, Success Rate, Active Personas) uses `KpiTile density="card-rich"`: a `rounded-modal` gradient tile with the icon on the LEFT, the sparkline top-right, and a trend delta below. Same conceptual element, two different layouts, corner radii, label colors, and icon placement.
- **Root cause**: `KpiTile`'s docstring claims it "replaces 3 hand-rolled stat-tile shapes," but `StatCard` is a parallel, separately-maintained KPI primitive that the Director adopted. The dashboard now has two canonical metric cards with no shared rule for which to use.
- **Impact**: inconsistency — KPI hierarchy and emphasis differ between two top-level sub-tabs that sit side by side in the same Overview area.
- **Fix sketch**: Pick one canonical KPI card (KpiTile already covers sparkline + trend + tones, so it is the stronger base) and migrate Director's four `StatCard`s to `KpiTile`, or fold `StatCard`'s tone-line treatment into `KpiTile` as a variant and delete the duplicate. Document the choice in the shared display catalog comment.

## 4. Certification charts/cards have no loading skeleton or empty state — and use a spinner instead of the dashboard's skeletons
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/overview/sub_certification/CertificationCommandCenter.tsx:109 and components/TrajectoryChart.tsx:30
- **Scenario**: On first load of the Certification tab the whole body collapses to a centered `LoadingSpinner` (CertificationCommandCenter.tsx:110), whereas Home/Observability paint card-shaped skeletons (OverviewPage.tsx:45-62, MetricChart `loading` slot). When a run history detail loads its `TrajectoryChart`, an empty `points` array still mounts the chart frame with empty axes (TrajectoryChart.tsx has no `isEmpty`/empty branch) — the user sees blank gridlines rather than a "no trajectory yet" message that the heatmap and pie chart provide via `EmptyState`.
- **Root cause**: Certification predates the skeleton + `EmptyState` conventions; it leans on `LoadingSpinner` for loading and renders charts unconditionally with zero-filled data (TrajectoryChart maps `p.teamScore ?? 0`).
- **Impact**: unpolished / error-blind — loading reads as a different app, and an empty trajectory looks like a charting bug rather than "no data".
- **Fix sketch**: Replace the centered spinner with the card-shaped skeleton pattern used elsewhere; in `TrajectoryChart`, early-return an `EmptyState variant="chart"` when `points.length < 2`.

## 5. Certification `TrajectoryChart` uses ad-hoc tooltip + axis styling, diverging from the shared chart tokens
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/overview/sub_certification/components/TrajectoryChart.tsx:46
- **Scenario**: The trajectory line chart's tooltip is a hand-built `contentStyle` object (`background: var(--color-secondary,#1e1e2e)`, `borderRadius: 8`, `fontSize: 11`) while every other dashboard chart uses the shared `<ChartTooltip />` glass component (MetricsCharts.tsx:17, TrafficErrorsChart.tsx:68). Its axis `fontSize` is a hard-coded `10` rather than the theme-scaled `useScaledFontSize()` used in Observability/Home, so on large-font accessibility settings the trajectory axes stay tiny while sibling charts scale up.
- **Root cause**: The chart was authored against raw recharts props instead of importing `ChartTooltip` and `useScaledFontSize` from `sub_usage/`.
- **Impact**: inconsistency / inaccessible — tooltip chrome differs from all other charts and axis labels ignore the user's font-scale preference.
- **Fix sketch**: Swap the inline `contentStyle` for `content={<ChartTooltip />}`, and replace the hard-coded `fontSize: 10` with `sf(10)` from `useScaledFontSize()` so axis text honors theme scaling.

## 6. Pie-slice percentages and KPI percentages use inconsistent formatting / no color-independent labels
- **Severity**: low
- **Category**: accessibility
- **File**: src/features/overview/sub_observability/components/MetricsCharts.tsx:147
- **Scenario**: The "Execution Distribution" pie labels read `${name} ${(percent*100).toFixed(0)}%` (0 decimals, e.g. `Athena 33%`), while the Success Rate KPI tile formats percentages to 1 decimal (`${n.toFixed(1)}%`, ObservabilityDashboard.tsx:211) and the heatmap WoW insight rounds to whole numbers — three different percent conventions on one screen. Separately, the pie's only series distinction is the 8-color `CHART_COLORS_PURPLE` ramp (adjacent slices `#8b5cf6`/`#a78bfa` are near-identical) with no legend, so the slices are distinguishable by color alone.
- **Root cause**: Each chart picks its own `toFixed` precision; the pie relies on inline `label` text plus color with no `<R.Legend>` and no shared percent formatter.
- **Impact**: inconsistency / inaccessible — mixed percent precision looks unconsidered, and color-only slice encoding fails users with low color discrimination.
- **Fix sketch**: Route percentages through one shared formatter (e.g. a `formatPercent(n, {precision})` helper) so the dashboard agrees on precision; add a `<R.Legend>` to the pie (matching the Execution Health legend at MetricsCharts.tsx:180) so each persona is named, not color-coded only.
