Execute this requirement immediately without asking questions.

## REQUIREMENT

# Ambient Event Mesh: OS-Level Haptic Triggers

## Metadata
- **Category**: functionality
- **Effort**: Unknown (10/3)
- **Impact**: Unknown (10/3)
- **Scan Type**: moonshot_architect
- **Generated**: 3/1/2026, 5:16:44 PM

## Description
Extend the trigger system beyond HTTP/cron into a full ambient event mesh that monitors OS-level signals, file system changes, clipboard content, application focus, and even hardware inputs (USB plug, Bluetooth proximity). A native Tauri plugin watches for ambient signals and translates them into typed events that flow through the existing event routing infrastructure. Users configure ambient triggers like when I save a .py file in VS Code, run the code reviewer persona or when I connect to the office WiFi, activate the standup persona. The mesh learns usage patterns over time and proactively suggests trigger configurations based on observed behavior � e.g., you always run the doc-writer after committing code, should I automate that?

## Reasoning
Current triggers are limited to HTTP (polling/webhook), time (cron/interval), and internal events (chain/subscription). Real productivity automation happens at the OS level � file saves, app switches, calendar events, device connections. An ambient event mesh would make Personas feel like a living assistant that reacts to your actual work patterns rather than requiring explicit invocation. No AI agent platform integrates at the OS level � this would be a category-defining capability that turns a desktop app into an intelligent automation layer.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Triggers & Event Routing

**Description**: Define event triggers that automatically activate agents. Configure trigger conditions, build event flows with visual diagrams, manage event subscriptions, and route events between agents in the system.
**Related Files**:
- `src/features/triggers/components/EventsPage.tsx`
- `src/features/triggers/components/TriggerList.tsx`
- `src/features/triggers/components/TriggerListItem.tsx`
- `src/features/triggers/components/TriggerAddForm.tsx`
- `src/features/triggers/components/TriggerConfig.tsx`
- `src/features/triggers/components/TriggerFlowBuilder.tsx`
- `src/features/triggers/components/EventSubscriptionsPanel.tsx`
- `src/features/triggers/components/ActivityDiagramModal.tsx`
- `src/api/triggers.ts`
- `src/api/events.ts`
- `src/stores/slices/triggerSlice.ts`
- `src/stores/slices/eventSlice.ts`
- `src/lib/utils/triggerConstants.ts`
- `src-tauri/src/commands/tools/triggers.rs`
- `src-tauri/src/commands/communication/events.rs`
- `src-tauri/src/db/repos/resources/triggers.rs`
- `src-tauri/src/db/repos/communication/events.rs`
- `src-tauri/src/db/models/trigger.rs`
- `src-tauri/src/db/models/event.rs`

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