Execute this requirement immediately without asking questions.

## REQUIREMENT

# Clarify rollback semantics when version has partial data

## Metadata
- **Category**: maintenance
- **Effort**: High (3/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 3/12/2026, 3:52:57 PM

## Description
lab_rollback_version applies structured_prompt and system_prompt from the target version to the persona, but both fields are Option. If a version has structured_prompt=Some but system_prompt=None, only the structured prompt is updated � the existing system_prompt on the persona is silently preserved. This creates an inconsistent hybrid where the persona has prompt A structured fields and prompt B system prompt. Add explicit handling: either require both fields are present for rollback, or explicitly clear the field not present in the version.

## Reasoning
The behavior when a version record has only one of the two prompt fields populated is undefined and depends on accident of storage. A user who rolls back to "v3" expects to get exactly what v3 was, not a Frankenstein of v3 structured + current system prompt. This is the kind of subtle bug that only surfaces when someone investigates why their persona is behaving differently than expected after rollback.

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