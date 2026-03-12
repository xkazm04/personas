Execute this requirement immediately without asking questions.

## REQUIREMENT

# Single-pass result aggregation with memoized selectors

## Metadata
- **Category**: performance
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:54:19 PM

## Description
AbResultsView, ArenaResultsView, EvalResultsGrid, and MatrixResultsView each iterate results 3 times (build maps, aggregate scores, build matrix). Consolidate into single-pass aggregation functions. Additionally, move aggregation logic into Zustand-level derived selectors using useShallow so results are computed once and shared across components, not recalculated per-panel render.

## Reasoning
Result views are the most visited UI in the lab � users check them repeatedly during and after runs. Triple iteration is wasteful at O(3n) and the lack of shared selectors means switching between panels or toggling details triggers full recalculation. At 250+ results (50 scenarios � 5 models), this creates perceptible lag on re-render.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Prompt Lab

**Description**: A/B testing, arena comparisons, evaluation matrices, prompt versioning with diffs, and experiment history for optimizing persona prompts.
**Related Files**:
- `src/api/agents/lab.ts`
- `src/stores/slices/agents/labSlice.ts`
- `src/features/agents/sub_lab/LabTab.tsx`
- `src/features/agents/sub_lab/components/ab/AbPanel.tsx`
- `src/features/agents/sub_lab/components/ab/AbResultsView.tsx`
- `src/features/agents/sub_lab/components/arena/ArenaPanel.tsx`
- `src/features/agents/sub_lab/components/arena/ArenaResultsView.tsx`
- `src/features/agents/sub_lab/components/eval/EvalPanel.tsx`
- `src/features/agents/sub_lab/components/eval/EvalRadarChart.tsx`
- `src/features/agents/sub_lab/components/eval/EvalResultsGrid.tsx`
- `src/features/agents/sub_lab/components/matrix/MatrixPanel.tsx`
- `src/features/agents/sub_lab/components/matrix/MatrixResultsView.tsx`
- `src/features/agents/sub_lab/components/shared/DraftDiffViewer.tsx`
- `src/features/agents/sub_lab/components/shared/LabProgress.tsx`
- `src/features/agents/sub_lab/components/shared/VersionsPanel.tsx`
- `src-tauri/src/commands/execution/lab.rs`
- `src-tauri/src/db/models/lab.rs`
- `src-tauri/src/db/repos/lab/ab.rs`
- `src-tauri/src/db/repos/lab/arena.rs`
- `src-tauri/src/db/repos/lab/eval.rs`
- `src-tauri/src/db/repos/lab/matrix.rs`

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