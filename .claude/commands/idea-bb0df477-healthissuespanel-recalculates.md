Execute this requirement immediately without asking questions.

## REQUIREMENT

# HealthIssuesPanel recalculates Date.now()-based age labels and regex on every render without memoization

## Metadata
- **Category**: rendering
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:50:15 PM

## Description
In HealthIssuesPanel.tsx (lines 125-168), each healing issue row computes age via Date.now() and new Date(issue.created_at).getTime() inline during render (line 127). With potentially dozens of issues, this creates new Date objects and performs arithmetic on every render. More importantly, the regex test for circuit breakers (line 131) executes per-item on every render, recompiling the regex pattern for every issue on every render. The same pattern exists in MetricsCharts.tsx anomaly ReferenceLine filter (line 44): chartData.filter() creates new ReferenceLine elements inline inside an AreaChart on every render, which forces Recharts to diff the entire SVG tree.

## Reasoning
The per-render regex compilation and Date arithmetic are individually cheap but compound with issue count and re-render frequency (auto-refresh every 30s, plus healing state changes). The MetricsCharts anomaly filter is more impactful: creating ReferenceLine JSX elements inline inside AreaChart prevents Recharts from recognizing stable children, forcing full SVG reconciliation. Extracting the ReferenceLine array into a useMemo and pre-computing the regex match plus age labels would reduce render cost proportionally to issue count.

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