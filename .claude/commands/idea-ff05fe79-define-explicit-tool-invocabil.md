Execute this requirement immediately without asking questions.

## REQUIREMENT

# Define explicit tool invocability contract

## Metadata
- **Category**: maintenance
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ambiguity_guardian
- **Generated**: 3/12/2026, 4:02:00 PM

## Description
tool_runner.rs routes execution based on three overlapping signals: category=="automation", script_path presence, and implementation_guide presence. When multiple conditions are true simultaneously the winner is determined by if/else ordering, not a documented rule. Add a validate_invocable() method on Tool that enforces exactly one execution strategy is set, called on create/update. Return a typed ToolKind enum (Script, Api, Automation, Mcp) so the runner can match exhaustively.

## Reasoning
A tool with both script_path and implementation_guide set will silently use script_path because it appears first in the if-chain. A tool with neither set falls into a confusing error path. Making invocability an explicit, validated property eliminates an entire class of "why did my tool not run?" debugging sessions.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Agent Tools & Connectors

**Description**: Tool management, automation config, notification channels, and connector setup including MCP tool integration.
**Related Files**:
- `src/api/agents/tools.ts`
- `src/api/agents/automations.ts`
- `src/api/agents/mcpTools.ts`
- `src/stores/slices/agents/toolSlice.ts`
- `src/stores/slices/vault/automationSlice.ts`
- `src/features/agents/sub_tools/components/ToolSelector.tsx`
- `src/features/agents/sub_tools/components/ToolCard.tsx`
- `src/features/agents/sub_tools/components/ToolImpactPanel.tsx`
- `src/features/agents/sub_tool_runner/components/ToolRunnerPanel.tsx`
- `src/features/agents/sub_connectors/components/automation/AutomationSetupModal.tsx`
- `src/features/agents/sub_connectors/components/automation/AutomationsSection.tsx`
- `src/features/agents/sub_connectors/channels/NotificationChannelSettings.tsx`
- `src-tauri/src/commands/tools/tools.rs`
- `src-tauri/src/commands/tools/automations.rs`
- `src-tauri/src/commands/tools/automation_design.rs`
- `src-tauri/src/commands/credentials/mcp_tools.rs`
- `src-tauri/src/db/models/tool.rs`
- `src-tauri/src/db/models/automation.rs`
- `src-tauri/src/db/repos/resources/tools.rs`
- `src-tauri/src/db/repos/resources/automations.rs`
- `src-tauri/src/engine/tool_runner.rs`
- `src-tauri/src/engine/automation_runner.rs`
- `src-tauri/src/engine/mcp_tools.rs`
- `src-tauri/src/engine/connector_strategy.rs`

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