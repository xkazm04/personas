Execute this requirement immediately without asking questions.

## REQUIREMENT

# validate_config silently accepts invalid JSON

## Metadata
- **Category**: code_quality
- **Effort**: Low (1/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/1/2026, 12:20:13 AM

## Description
In triggers.rs repo (line 22-43), validate_config wraps JSON parsing in if let Ok(parsed). If serde_json::from_str fails (malformed JSON), the function silently returns Ok(()). This means a trigger with config set to "{broken json" is accepted and stored in the database. Later, when the scheduler calls parse_config(), the invalid JSON is silently treated as null, causing the trigger to fire with no config (no cron, no interval, no endpoint). This produces confusing behavior where triggers appear configured but execute as if they have no settings. Change the outer if-let to return an error on parse failure when config is non-empty.

## Reasoning
This is a classic silent-failure bug where validation gives a false sense of safety. Users who paste malformed JSON into the config field (e.g., missing a closing brace after editing) get no error at creation time. The trigger is stored, appears in the UI as configured, but when the scheduler picks it up, parse_config returns defaults. The user sees the trigger fire with wrong behavior and has no idea the config was rejected.

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