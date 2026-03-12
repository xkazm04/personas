Execute this requirement immediately without asking questions.

## REQUIREMENT

# Eliminate O(n squared) tool co-occurrence computation

## Metadata
- **Category**: performance
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:29:13 PM

## Description
useToolImpactData.ts lines 100-211 computes tool co-occurrence with nested loops: for each execution with n tools, it iterates n*n times to build the co-usage map. With 500 executions averaging 5 tools each, this produces ~12,500 iterations per render. Refactor to compute co-occurrences incrementally using a single pass with combination pairs (n*(n-1)/2 per execution), and add a staleness check to skip recomputation when the execution list has not changed.

## Reasoning
This useMemo runs on every dependency change including credential updates and persona selection � not just execution changes. The O(n squared) inner loop is the heaviest computation in the tool selector and blocks the React render thread. Reducing to O(n*k) with combination pairs and adding dirty-checking would cut computation by 50%+ and prevent unnecessary recalculations.

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