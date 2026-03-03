Execute this requirement immediately without asking questions.

## REQUIREMENT

# Add number formatting to ChartTooltip values

## Metadata
- **Category**: ui
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 2:26:33 AM

## Description
ChartTooltip.tsx renders payload values as raw numbers without any formatting � large token counts appear as 1483291 instead of 1,483,291 and dollar amounts lack currency symbols. Add an optional formatter prop (defaulting to Intl.NumberFormat) that each MetricChart can override. Apply toLocaleString for numeric values and prepend the appropriate unit suffix (tokens, USD, ms) based on a new metricUnit field in chartConstants.ts.

## Reasoning
Dashboard charts are the primary way users understand their system performance and spend. Unformatted numbers create cognitive friction � users must mentally parse long digit strings to understand magnitude. Adding locale-aware formatting with unit labels makes tooltips instantly scannable and gives the charts a polished, premium feel that matches the rest of the UI.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Dashboard & Usage Analytics

**Description**: View system health overview, track execution metrics and budget, analyze usage patterns with filterable charts, manage manual review queues, and browse global execution history across all agents.
**Related Files**:
- `src/features/overview/components/DashboardHome.tsx`
- `src/features/overview/components/DetailModal.tsx`
- `src/features/overview/components/OverviewPage.tsx`
- `src/features/overview/components/SystemHealthPanel.tsx`
- `src/features/overview/sub_analytics/AnalyticsDashboard.tsx`
- `src/features/overview/sub_budget/BudgetSettingsPage.tsx`
- `src/features/overview/sub_events/EventLogList.tsx`
- `src/features/overview/sub_executions/ExecutionMetricsDashboard.tsx`
- `src/features/overview/sub_executions/ExecutionRow.tsx`
- `src/features/overview/sub_executions/GlobalExecutionList.tsx`
- `src/features/overview/sub_manual-review/ManualReviewList.tsx`
- `src/features/overview/sub_usage/DashboardFilters.tsx`
- `src/features/overview/sub_usage/UsageDashboard.tsx`
- `src/features/overview/sub_usage/charts/ChartTooltip.tsx`
- `src/features/overview/sub_usage/charts/MetricChart.tsx`
- `src/features/overview/sub_usage/charts/chartConstants.ts`
- `src/api/system.ts`
- `src/api/scheduler.ts`
- `src/stores/slices/overviewSlice.ts`
- `src/lib/utils/pricing.ts`
- `src/lib/utils/formatters.ts`

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