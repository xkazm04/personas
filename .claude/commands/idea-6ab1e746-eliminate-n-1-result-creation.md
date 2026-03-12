Execute this requirement immediately without asking questions.

## REQUIREMENT

# Eliminate N+1 result creation with RETURNING clause

## Metadata
- **Category**: performance
- **Effort**: High (3/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:54:05 PM

## Description
Every lab result insertion (ab.rs:179, arena.rs:164, eval.rs, matrix.rs) does INSERT then immediately SELECT by ID to return the created row � doubling DB round-trips per result. Replace with SQLite RETURNING clause (available since 3.35) to get the inserted row in a single statement. For a 50-scenario � 3-model run, this eliminates 150 unnecessary queries.

## Reasoning
Result creation is on the hottest path during lab runs � called hundreds of times per experiment. Cutting DB round-trips in half directly reduces run duration and SQLite lock contention. This is a low-risk, high-reward mechanical refactor across four repository files.

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