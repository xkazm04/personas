Execute this requirement immediately without asking questions.

## REQUIREMENT

# Model Performance Radar Chart

## Metadata
- **Category**: ui
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 9:06:34 PM

## Description
Implement a radar chart visualization in the EvalResultsGrid that compares model performance across multiple dimensions like Tool Accuracy, Output Quality, and Protocol Compliance.

## Reasoning
Tables and grids are good for precise numbers but poor for identifying overall character of a model character. A radar chart provides an immediate, intuitive comparison of trade-offs.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Lab, Testing & Evaluation

**Description**: Run A/B tests, arena comparisons, evaluation grids, and matrix tests on prompt versions. Manage test suites with scenarios and mock tools, compare results, and track prompt performance over time.
**Related Files**:
- `src/features/agents/sub_lab/AbPanel.tsx`
- `src/features/agents/sub_lab/AbResultsView.tsx`
- `src/features/agents/sub_lab/ArenaPanel.tsx`
- `src/features/agents/sub_lab/ArenaResultsView.tsx`
- `src/features/agents/sub_lab/DiffViewer.tsx`
- `src/features/agents/sub_lab/DraftDiffViewer.tsx`
- `src/features/agents/sub_lab/EvalPanel.tsx`
- `src/features/agents/sub_lab/EvalResultsGrid.tsx`
- `src/features/agents/sub_lab/LabProgress.tsx`
- `src/features/agents/sub_lab/LabTab.tsx`
- `src/features/agents/sub_lab/MatrixPanel.tsx`
- `src/features/agents/sub_lab/MatrixResultsView.tsx`
- `src/features/agents/sub_lab/VersionItem.tsx`
- `src/features/agents/sub_lab/VersionsPanel.tsx`
- `src/features/agents/sub_lab/labUtils.ts`
- `src/features/agents/sub_editor/sub_prompt_lab/AbTestPanel.tsx`
- `src/features/agents/sub_editor/sub_prompt_lab/AutoRollbackSettings.tsx`
- `src/features/agents/sub_editor/sub_prompt_lab/DiffViewer.tsx`
- `src/features/agents/sub_editor/sub_prompt_lab/PerformanceCharts.tsx`
- `src/features/agents/sub_editor/sub_prompt_lab/PerformanceWidgets.tsx`
- `src/features/agents/sub_editor/sub_prompt_lab/PromptLabTab.tsx`
- `src/features/agents/sub_editor/sub_prompt_lab/PromptPerformanceDashboard.tsx`
- `src/features/agents/sub_editor/sub_prompt_lab/VersionItem.tsx`
- `src/features/agents/sub_editor/sub_prompt_lab/index.ts`
- `src/features/agents/sub_editor/sub_prompt_lab/performanceHelpers.ts`
- `src/features/agents/sub_editor/sub_prompt_lab/promptLabUtils.ts`
- `src/features/agents/sub_editor/sub_prompt_lab/usePromptVersions.ts`
- `src/features/agents/sub_tests/PersonaTestsTab.tsx`
- `src/features/agents/sub_tests/TestComparisonTable.tsx`
- `src/features/agents/sub_tests/TestSuiteManager.tsx`
- `src/features/agents/sub_tests/testUtils.ts`
- `src/api/lab.ts`
- `src/api/testSuites.ts`
- `src/api/tests.ts`
- `src/hooks/lab/useLabEvents.ts`
- `src/hooks/tests/usePersonaTests.ts`
- `src/stores/slices/labSlice.ts`
- `src/stores/slices/testSlice.ts`
- `src/lib/eval/evalFramework.ts`

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