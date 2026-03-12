Execute this requirement immediately without asking questions.

## REQUIREMENT

# Virtualize large result tables and paginate run history

## Metadata
- **Category**: ui
- **Effort**: Unknown (5/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:54:32 PM

## Description
Result tables in AbResultsView, ArenaResultsView, EvalResultsGrid, and MatrixResultsView render all rows to the DOM without virtualization. With 50+ scenarios � multiple models, this creates 250+ DOM rows causing layout thrash on scroll. Implement windowed rendering (e.g., @tanstack/react-virtual) for result tables. Additionally, the resultsMap in labSlice grows unbounded � add pagination to run history fetches and evict old results from the store.

## Reasoning
The lab is designed for heavy experimentation � power users will accumulate dozens of runs with hundreds of results each. Without virtualization, the DOM grows linearly with experiment scale, causing scroll jank and memory pressure. Pagination prevents the Zustand store from becoming a memory leak over long sessions. These changes make the lab feel responsive regardless of experiment volume.

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