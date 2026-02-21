Execute this requirement immediately without asking questions.

## REQUIREMENT

# Human-readable schedule preview before commit

## Metadata
- **Category**: ui
- **Effort**: Unknown (N/A/3)
- **Impact**: Unknown (N/A/3)
- **Scan Type**: user_empathy_champion
- **Generated**: 2/21/2026, 11:41:35 PM

## Description
When creating a schedule or polling trigger, users select an interval in seconds but have no preview of when the first run will actually happen or what the recurring pattern looks like in human terms. Add a live preview line below the interval selector that says something like "Next run: today at 3:45 PM, then every 1 hour" with a mini timeline showing the next 3-5 scheduled runs as dots on a time axis. This gives users confidence before they click Create.

## Reasoning
Users configuring schedules feel anxious because seconds-based intervals are abstract. The current hint showing runs-per-day helps but does not anchor to real wall-clock times. A concrete preview reduces the cognitive gap between configuration and expected behavior, preventing the common anxiety of did I set this right?

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Trigger & Chain Builder

**Description**: Create and manage event-driven triggers that automatically start persona executions. Build trigger chains linking multiple events, configure webhooks and polling endpoints, visualize trigger flow with activity diagrams, and manage trigger lifecycle.
**Related Files**:
- `src/features/triggers/components/TriggerList.tsx`
- `src/features/triggers/components/TriggerAddForm.tsx`
- `src/features/triggers/components/TriggerConfig.tsx`
- `src/features/triggers/components/TriggerListItem.tsx`
- `src/features/triggers/components/ActivityDiagramModal.tsx`
- `src/features/triggers/components/TriggerFlowBuilder.tsx`
- `src/features/triggers/components/EventsPage.tsx`
- `src/api/triggers.ts`
- `src/stores/slices/triggerSlice.ts`
- `src-tauri/src/commands/tools/triggers.rs`
- `src-tauri/src/db/repos/resources/triggers.rs`
- `src-tauri/src/db/models/trigger.rs`
- `src-tauri/src/engine/chain.rs`
- `src-tauri/src/engine/webhook.rs`
- `src-tauri/src/engine/polling.rs`
- `src/lib/bindings/PersonaTrigger.ts`
- `src/lib/bindings/TriggerChainLink.ts`
- `src/lib/bindings/WebhookStatus.ts`
- `src/lib/utils/triggerConstants.ts`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

- **compact-ui-design**: Use `.claude/skills/compact-ui-design.md` for high-quality UI design references and patterns

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