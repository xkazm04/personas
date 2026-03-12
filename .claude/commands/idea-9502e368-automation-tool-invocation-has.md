Execute this requirement immediately without asking questions.

## REQUIREMENT

# Automation tool invocation has no timeout guard

## Metadata
- **Category**: code_quality
- **Effort**: Low (1/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/12/2026, 3:30:30 PM

## Description
In tool_runner.rs, invoke_script and invoke_api are wrapped in tokio::time::timeout(DIRECT_TOOL_TIMEOUT), but invoke_automation_tool (line 85) is called without any timeout wrapper. While the inner webhook call has its own timeout_ms, the overall function path through automation_repo::get_by_id and invoke_automation has no outer bound. A slow DB query plus a webhook at max timeout can exceed reasonable limits, and if the automation uses github_dispatch the entire path has no timeout at all. Wrap the automation branch in the same DIRECT_TOOL_TIMEOUT.

## Reasoning
Inconsistent timeout application means automation-backed tools can block the tool runner indefinitely. This is especially dangerous during LLM orchestration where a hung tool call blocks the entire agent execution chain. The fix is a one-line timeout wrapper matching the existing pattern.

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