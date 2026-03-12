Execute this requirement immediately without asking questions.

## REQUIREMENT

# Custom SVG execution lifecycle illustration set

## Metadata
- **Category**: ui
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: brand_artist
- **Generated**: 3/12/2026, 1:23:31 PM

## Description
Replace generic Lucide icons (Play, Square, Terminal) in InputExecuteCard, ProgressIndicator, and ExecutionMiniPlayer with a cohesive set of custom SVG illustrations that visually narrate execution lifecycle stages: idle (dormant agent), running (flowing data streams), completed (checkmark constellation), and failed (fractured circuit). Each illustration uses the brand violet-to-blue gradient palette at approximately 48x48px for hero placement and 16x16px for inline status. The idle state in MiniPlayer and ReplayTerminalPanel empty states should show a minimal line-art agent silhouette rather than generic Terminal icon.

## Reasoning
The execution flow is the most frequently viewed surface in the app � users watch runs in real-time. Generic play/stop/terminal icons make this feel like any other dev tool. Custom lifecycle illustrations create emotional connection and instant visual recognition of execution states, differentiating the product and reducing cognitive load when scanning execution status at a glance.

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