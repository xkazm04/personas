Execute this requirement immediately without asking questions.

## REQUIREMENT

# AlertRulesPanel creates 6 separate usePersonaStore subscriptions causing redundant re-renders

## Metadata
- **Category**: state-management
- **Effort**: Medium (2/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:49:41 PM

## Description
In AlertRulesPanel.tsx (lines 228-234), the component creates 6 individual usePersonaStore selectors: alertRules, addAlertRule, updateAlertRule, deleteAlertRule, toggleAlertRule, personas, and alertEvalHealth. Each selector subscribes independently to the store. When any store slice updates (e.g. a global execution fetch, persona update, or unrelated state change), each selector runs its equality check. More critically, the action selectors (addAlertRule, updateAlertRule, etc.) return stable function references from zustand, but the component still subscribes to ALL store changes for each. Additionally, ObservabilityDashboard.tsx (line 19) uses an inline filter: s.alertHistory.filter(a => !a.dismissed) which creates a new array reference on every store change, forcing the ObservabilityDashboard to re-render on ANY store update, not just alert changes.

## Reasoning
The inline .filter() on line 19 of ObservabilityDashboard.tsx is the most impactful issue: it creates a new array on every zustand notification, causing the entire ObservabilityDashboard (with all its charts and healing panels) to re-render whenever any unrelated store slice changes. Moving this to a memoized selector or using zustand shallow equality would prevent cascade re-renders of the most expensive component tree in the overview section.

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