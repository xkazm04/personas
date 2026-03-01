Execute this requirement immediately without asking questions.

## REQUIREMENT

# Trigger double-fires on overlapping scheduler ticks

## Metadata
- **Category**: code_quality
- **Effort**: Medium (2/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/1/2026, 12:20:22 AM

## Description
trigger_scheduler_tick (background.rs:280-342) fetches all due triggers via get_due, processes them sequentially, and calls mark_triggered to advance next_trigger_at. If a tick takes longer than 5 seconds (the scheduler interval), the next tick starts while the previous is still processing. Both ticks fetch the same due triggers from the database (next_trigger_at has not been updated yet), and both publish events for the same trigger. The mark_triggered call succeeds for both because it uses an unconditional UPDATE. Add an atomic compare-and-swap pattern: UPDATE ... SET next_trigger_at = ?1 WHERE id = ?2 AND next_trigger_at = ?3 (old value), so the second tick sees 0 rows affected and skips the trigger.

## Reasoning
A trigger that fires twice means the associated persona runs twice, doubling LLM cost and potentially producing duplicate side effects (e.g., sending two Slack messages, creating two tickets). This is especially likely for triggers with expensive personas that take >5 seconds to process, which is exactly the case for LLM-powered agents. The CAS fix is a one-line SQL change that makes double-fire impossible.

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