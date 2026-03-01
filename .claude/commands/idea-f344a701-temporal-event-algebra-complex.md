Execute this requirement immediately without asking questions.

## REQUIREMENT

# Temporal Event Algebra: Complex Event Processing

## Metadata
- **Category**: functionality
- **Effort**: Unknown (10/3)
- **Impact**: Unknown (10/3)
- **Scan Type**: moonshot_architect
- **Generated**: 3/1/2026, 5:16:53 PM

## Description
Replace the simple event matching system (exact type + wildcard source filter) with a full temporal event algebra that supports composite conditions, windowed aggregation, and causal ordering. Users write event expressions like WHEN (file_changed AND code_review_passed) WITHIN 5m THEN deploy or WHEN 3x build_failed IN 10m FROM same_repo THEN alert. The algebra compiles to an efficient state machine that evaluates against the event stream in real-time, with a visual expression builder that renders the temporal logic as an interactive timeline diagram. The state machine persists across restarts, tracking partial matches and their expiration windows.

## Reasoning
The current event system matches single events to single subscriptions � no temporal reasoning, no composite conditions, no windowed aggregation. Real-world automation requires understanding sequences of events, not just individual ones. A temporal event algebra would make Personas competitive with enterprise CEP (Complex Event Processing) systems like Esper or Apache Flink, but accessible to non-engineers through the visual builder. This transforms the trigger system from a simple if-this-then-that into a full reactive programming model.

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