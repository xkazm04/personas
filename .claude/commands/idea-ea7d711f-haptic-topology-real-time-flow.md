Execute this requirement immediately without asking questions.

## REQUIREMENT

# Haptic Topology: Real-Time Flow Pulse Visualization

## Metadata
- **Category**: ui
- **Effort**: Unknown (5/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: moonshot_architect
- **Generated**: 3/1/2026, 4:24:58 PM

## Description
Transform the static canvas into a "living" organism where edges pulse with light and sound based on actual data volume and execution speed. Visual turbulence in the data stream allows users to identify system health through sensory patterns.

## Reasoning
Understanding complex asynchronous flows is mentally taxing. This makes the invisible visible and intuitive, allowing engineers to identify system bottlenecks through sensory, haptic-enhanced feedback.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Team Pipeline Builder

**Description**: Visually design multi-agent pipelines on a React Flow canvas. Drag persona nodes, connect them with edges, configure team topology, and use the AI optimizer to improve pipeline efficiency. Manage team configurations and orchestrate agent collaboration.
**Related Files**:
- `src/features/pipeline/components/TeamCanvas.tsx`
- `src/features/pipeline/components/TeamConfigPanel.tsx`
- `src/features/pipeline/components/TeamList.tsx`
- `src/features/pipeline/sub_canvas/PersonaNode.tsx`
- `src/features/pipeline/sub_canvas/ConnectionEdge.tsx`
- `src/features/pipeline/sub_canvas/GhostEdge.tsx`
- `src/features/pipeline/sub_canvas/NodeContextMenu.tsx`
- `src/features/pipeline/sub_canvas/EdgeDeleteTooltip.tsx`
- `src/features/pipeline/sub_canvas/CanvasAssistant.tsx`
- `src/features/pipeline/sub_canvas/OptimizerPanel.tsx`
- `src/features/pipeline/sub_canvas/PipelineControls.tsx`
- `src/features/pipeline/sub_canvas/TeamToolbar.tsx`
- `src/features/pipeline/sub_canvas/teamConstants.tsx`
- `src/api/teams.ts`
- `src/stores/slices/teamSlice.ts`
- `src-tauri/src/commands/teams/teams.rs`
- `src-tauri/src/db/repos/resources/teams.rs`
- `src-tauri/src/db/models/team.rs`
- `src-tauri/src/engine/topology.rs`
- `src-tauri/src/engine/optimizer.rs`

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