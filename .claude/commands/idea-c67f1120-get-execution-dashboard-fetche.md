Execute this requirement immediately without asking questions.

## REQUIREMENT

# get_execution_dashboard fetches all raw rows into memory for percentile computation instead of using SQL window functions

## Metadata
- **Category**: backend-query
- **Effort**: Unknown (6/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:49:32 PM

## Description
In metrics.rs (lines 627-889), get_execution_dashboard fetches ALL individual execution rows into a Vec<DashboardRawRow> (line 651-664), then buckets them by date in Rust, computes percentiles in-memory (lines 699-700), and builds per-persona cost breakdowns via HashMap iterations (lines 703-718). For a fleet with thousands of daily executions over 30-90 days, this loads tens of thousands of rows into memory. SQLite supports window functions (PERCENTILE_CONT is unavailable, but NTILE or subquery-based percentile approximations work). The date bucketing, GROUP BY aggregation, and persona cost breakdown could all be done in SQL, returning only ~30-90 rows (one per date) instead of thousands of raw rows. The same pattern exists in get_prompt_performance (lines 482-510).

## Reasoning
For a 90-day range with 100 executions/day, the current approach transfers 9000 rows across the SQLite FFI boundary, allocates 9000 DashboardRawRow structs, then iterates them multiple times (bucketing, percentile sorting per bucket, persona aggregation, anomaly detection). Moving aggregation to SQL would reduce memory allocation by 100x and eliminate the multi-pass iteration. This directly impacts dashboard load time, which is on the critical path for every page load and auto-refresh.

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