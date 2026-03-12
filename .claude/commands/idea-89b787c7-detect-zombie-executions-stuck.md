Execute this requirement immediately without asking questions.

## REQUIREMENT

# Detect zombie executions stuck in running state

## Metadata
- **Category**: functionality
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: observability_scout
- **Generated**: 3/12/2026, 9:21:56 AM

## Description
Add a periodic check (e.g. every 5 minutes via setInterval in the execution slice or a Rust-side background task) that queries executions with status=running whose started_at is older than the persona timeout_ms (or a sensible default like 30 min). Transition detected zombies to incomplete status with an error message noting the stall, and emit a Tauri event so the frontend can surface a warning.

## Reasoning
The frontend 30-min safety timeout only covers evaluation-style runs and requires the browser to stay open. If the app is closed or restarted while a run is in progress, the execution stays in running state forever. These zombies pollute the dashboard, block budget calculations, and confuse users who see a permanently-running execution.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Agent Execution & Replay

**Description**: Execution visualization, run lifecycle, replay with timeline scrubber, cost tracking, comparison views, and mini-player.
**Related Files**:
- `src/api/agents/executions.ts`
- `src/stores/slices/agents/executionSlice.ts`
- `src/stores/slices/agents/runLifecycle.ts`
- `src/stores/slices/agents/miniPlayerSlice.ts`
- `src/stores/slices/agents/budgetEnforcementSlice.ts`
- `src/features/agents/sub_executions/runner/InputExecuteCard.tsx`
- `src/features/agents/sub_executions/runner/PhaseTimeline.tsx`
- `src/features/agents/sub_executions/runner/ProgressIndicator.tsx`
- `src/features/agents/sub_executions/replay/ReplayTerminalPanel.tsx`
- `src/features/agents/sub_executions/replay/TimelineScrubber.tsx`
- `src/features/agents/sub_executions/replay/ReplayCostPanel.tsx`
- `src/features/agents/sub_executions/comparison/MetricDeltaCard.tsx`
- `src/features/agents/sub_executions/comparison/OutputDiffSection.tsx`
- `src/features/agents/sub_executions/detail/HealingCard.tsx`
- `src/features/agents/sub_executions/trace/StageBar.tsx`
- `src/features/agents/components/ChatThread.tsx`
- `src/features/execution/components/ExecutionMiniPlayer.tsx`
- `src-tauri/src/commands/execution/executions.rs`
- `src-tauri/src/db/models/execution.rs`
- `src-tauri/src/db/repos/execution/executions.rs`
- `src-tauri/src/db/repos/execution/traces.rs`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

- **leonardo**: Use `/leonardo` skill to generate images with Leonardo AI (Lucid Origin model). For illustrations, icons, empty state artwork, branded loaders, and visual assets. Do NOT hand-code SVG — generate with AI and convert to SVG if needed.

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