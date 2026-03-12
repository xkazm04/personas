Execute this requirement immediately without asking questions.

## REQUIREMENT

# Parallel fetch waterfall in fetchObservabilityMetrics: summary + chart + tool usage + healing all sequential per filter change

## Metadata
- **Category**: data-fetching
- **Effort**: Unknown (5/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:49:08 PM

## Description
In overviewSlice.ts (line 242), fetchObservabilityMetrics uses Promise.all for summary+chartData, but the AnalyticsDashboard triggers THREE independent fetches sequentially via useOverviewMetrics (line 33-37 in useOverviewMetrics.ts): fetchObservabilityMetrics, fetchToolUsage, and fetchHealingIssues. These are correctly parallelized. However, the ExecutionMetricsDashboard (useExecutionMetrics.ts) fetches executionDashboard data SEPARATELY from the analytics dashboard, meaning when both views share the Overview context, the same time period data is fetched twice via different endpoints (get_metrics_summary+get_metrics_chart_data AND get_execution_dashboard) that query the same persona_executions table with overlapping aggregations. The Rust backend (metrics.rs lines 235-282 and 627-889) runs two separate full-table scans on persona_executions for overlapping date ranges. Consolidate into a single backend endpoint that returns both summary metrics and execution dashboard data in one query pass.

## Reasoning
The get_summary query (metrics.rs:241-249) and get_execution_dashboard (metrics.rs:636-649) both scan persona_executions for the same date range. The dashboard fetches both via separate IPC calls. For 30-day ranges with thousands of executions, this doubles SQLite I/O. A unified endpoint would halve database load on every filter change or auto-refresh cycle (every 30s when enabled).

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

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills.

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