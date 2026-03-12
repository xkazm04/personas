Execute this requirement immediately without asking questions.

## REQUIREMENT

# Add success/failure spark-line micro-chart to row

## Metadata
- **Category**: ui
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/12/2026, 9:23:49 AM

## Description
Add a 48x16px inline SVG sparkline next to the success/failure counts in the collapsed row metadata (line 69-73). Plot the last 10 executions as dots connected by a polyline � green for success, red for failure � using the execution history from pattern_data. Use opacity-60 for the line and opacity-90 for the terminal dot. Fall back gracefully to the current text-only display when history data is not available in pattern_data.

## Reasoning
Currently the row shows aggregate counts (total runs, avg cost) but no trend information. A sparkline answers the question users actually care about: is this pattern getting better or worse? This transforms the knowledge row from a static record into a living health indicator. The 48x16px footprint fits within the existing metadata line without layout changes.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Tracing & Knowledge Engine

**Description**: Execution tracing with spans, event bus core, evaluation engine, topology graphs, and knowledge graph.
**Related Files**:
- `src/api/overview/intelligence/knowledge.ts`
- `src/api/overview/intelligence/smartSearch.ts`
- `src/api/overview/intelligence/teamSynthesis.ts`
- `src-tauri/src/engine/trace.rs`
- `src-tauri/src/engine/bus.rs`
- `src-tauri/src/engine/eval.rs`
- `src-tauri/src/engine/topology.rs`
- `src-tauri/src/engine/topology_graph.rs`
- `src-tauri/src/engine/knowledge.rs`
- `src-tauri/src/engine/design.rs`
- `src-tauri/src/commands/execution/knowledge.rs`
- `src-tauri/src/commands/design/smart_search.rs`
- `src-tauri/src/commands/design/team_synthesis.rs`
- `src-tauri/src/db/models/knowledge.rs`
- `src-tauri/src/db/repos/execution/knowledge.rs`
- `src/features/overview/sub_knowledge/components/KnowledgeRow.tsx`

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