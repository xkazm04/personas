Execute this requirement immediately without asking questions.

## REQUIREMENT

# AnalyticsCharts renders 6+ Recharts instances without memoization or virtualization

## Metadata
- **Category**: rendering
- **Effort**: Medium (2/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:49:19 PM

## Description
In AnalyticsCharts.tsx (lines 24-147), the component renders up to 6 heavy Recharts chart components (AreaChart, ComposedChart, AreaChart for tools, PieChart, LineChart, BarChart) in a single render pass with no React.memo boundary. The parent AnalyticsDashboard.tsx passes chartData, areaData, pieData, latencyData, and barData as new object references on every render. While useChartSeries.ts does memoize individual series, the AnalyticsCharts component itself is not wrapped in React.memo, so any parent re-render (e.g. healing workflow state changes from HealthIssuesPanel, auto-refresh toggle) triggers a full re-render of all 6 charts. Each Recharts ResponsiveContainer + chart is expensive (DOM measurement + SVG re-render). Wrap AnalyticsCharts in React.memo with a shallow comparison, and consider splitting each chart into its own memoized component.

## Reasoning
Recharts components are among the most expensive React components to re-render due to SVG DOM manipulation. The AnalyticsDashboard re-renders on healing state changes (lines 129-143), auto-refresh toggle, error banner display, and cost anomaly updates. Each re-render forces all 6 charts to reconcile. With React.memo on AnalyticsCharts (or individual chart wrappers), charts would only re-render when their specific data props change, potentially eliminating 50%+ of unnecessary chart re-renders.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Dashboard & Analytics

**Description**: Analytics dashboard with charts, alerts, health panels, saved views, execution metrics, usage/cost charts, and fleet optimization.
**Related Files**:
- `src/api/overview/observability.ts`
- `src/api/overview/savedViews.ts`
- `src/stores/slices/overview/overviewSlice.ts`
- `src/stores/slices/overview/alertSlice.ts`
- `src/features/overview/sub_analytics/components/AnalyticsDashboard.tsx`
- `src/features/overview/sub_analytics/components/AnalyticsCharts.tsx`
- `src/features/overview/sub_analytics/components/AnalyticsSummaryCards.tsx`
- `src/features/overview/sub_analytics/components/HealthIssuesPanel.tsx`
- `src/features/overview/sub_analytics/components/SavedViewsDropdown.tsx`
- `src/features/overview/sub_executions/components/ExecutionMetricsDashboard.tsx`
- `src/features/overview/sub_executions/components/MetricsCharts.tsx`
- `src/features/overview/sub_usage/components/MetricChart.tsx`
- `src/features/overview/sub_observability/components/ObservabilityDashboard.tsx`
- `src/features/overview/sub_observability/components/SpendOverview.tsx`
- `src/features/overview/sub_observability/components/AlertRulesPanel.tsx`
- `src/features/overview/components/dashboard/cards/FleetOptimizationCard.tsx`
- `src/features/overview/components/dashboard/cards/KnowledgeHub.tsx`
- `src-tauri/src/commands/communication/observability.rs`
- `src-tauri/src/commands/core/saved_views.rs`
- `src-tauri/src/db/models/observability.rs`
- `src-tauri/src/db/models/saved_views.rs`
- `src-tauri/src/db/repos/execution/metrics.rs`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

- **leonardo**: Use `/leonardo` skill to generate images with Leonardo AI (Lucid Origin model). For illustrations, icons, empty state artwork, branded loaders, and visual assets. Do NOT hand-code SVG — generate with AI and convert to SVG if needed.
- **compact-ui-design**: Use `.claude/skills/compact-ui-design.md` for high-quality UI design references and patterns

## Notes

This requirement was generated from an AI-evaluated project idea. No specific goal is associated with this idea.

## DURING IMPLEMENTATION

- Use `get_memory` MCP tool when you encounter unfamiliar code or need context about patterns/files
- Use `report_progress` MCP tool at each major phase (analyzing, planning, implementing, testing, validating)
- Use `get_related_tasks` MCP tool before modifying shared files to check for parallel task conflicts

## AFTER IMPLEMENTATION

1. Log your implementation using the `log_implementation` MCP tool with:
   - requirementName: the requirement filename (without .md)
   - title: 2-6 word summary
   - overview: 1-2 paragraphs describing what was done

2. Check for test scenario using `check_test_scenario` MCP tool
   - If hasScenario is true, call `capture_screenshot` tool
   - If hasScenario is false, skip screenshot

3. Verify: `npx tsc --noEmit` (fix any type errors)

Begin implementation now.