Execute this requirement immediately without asking questions.

## REQUIREMENT

# Chain triggers have no cycle detection — infinite loop

## Metadata
- **Category**: code_quality
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (9/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/1/2026, 12:19:58 AM

## Description
Chain triggers fire when a source persona completes an execution. Nothing prevents creating A→B and B→A chain triggers. When persona A completes, it fires B via chain trigger. B completes and fires A via chain trigger. This creates an infinite execution loop that rapidly exhausts the LLM budget. The trigger_scheduler_tick publishes events, event_bus_tick processes them into executions, which complete and trigger more chains. Add cycle detection in create_trigger that walks the chain graph and rejects edges that would form a cycle, or add a max-depth counter to chain event propagation in event_bus_tick.

## Reasoning
This is a budget-draining infinite loop with no built-in circuit breaker. A user who innocently creates bidirectional chain triggers (e.g., reviewer reviews coder, coder responds to reviewer) will trigger runaway LLM API calls. Each execution costs real money. The system will burn through the budget until manually stopped or the provider rate-limits the account. This is the single highest-risk bug in the triggers context.

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