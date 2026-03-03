Execute this requirement immediately without asking questions.

## REQUIREMENT

# Check delete operation return values to prevent phantom deletes

## Metadata
- **Category**: code_quality
- **Effort**: Medium (2/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/3/2026, 12:32:57 AM

## Description
deleteSubscription (events.ts) and deleteConnector (connectors.ts) both return Promise<boolean>, but all callers ignore the boolean and immediately remove the item from local state. If the backend returns false (item not found, constraint violation, or partial failure), the UI shows the item as deleted while it persists in the database. Next time the user loads the page, the "deleted" item reappears � a phantom delete. Fix: check the boolean return in handleDelete (EventSubscriptionSettings.tsx line 40, UseCaseSubscriptionsSection.tsx) and only filter local state on true. Show an inline error toast on false.

## Reasoning
Phantom deletes are one of the most confusing bugs for users � they delete something, it disappears, and then it comes back. This erodes trust in the UI and causes duplicate cleanup attempts. The fix is minimal (add an if-check on the returned boolean) and makes delete operations honest about their outcome.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Agent Connectors & Use Cases

**Description**: Wire agents to external services via event subscriptions and notification channels. Define use cases with model overrides, test runners, and channel-specific behavior.
**Related Files**:
- `src/features/agents/sub_editor/sub_connectors/AddChannelButton.tsx`
- `src/features/agents/sub_editor/sub_connectors/AddSubscriptionForm.tsx`
- `src/features/agents/sub_editor/sub_connectors/ConnectorStatusCard.tsx`
- `src/features/agents/sub_editor/sub_connectors/CredentialPicker.tsx`
- `src/features/agents/sub_editor/sub_connectors/EventSubscriptionSettings.tsx`
- `src/features/agents/sub_editor/sub_connectors/NotificationChannelCard.tsx`
- `src/features/agents/sub_editor/sub_connectors/NotificationChannelSettings.tsx`
- `src/features/agents/sub_editor/sub_connectors/PersonaConnectorsTab.tsx`
- `src/features/agents/sub_editor/sub_connectors/ToolsSection.tsx`
- `src/features/agents/sub_editor/sub_connectors/UseCaseSubscriptionsSection.tsx`
- `src/features/agents/sub_editor/sub_connectors/connectorTypes.ts`
- `src/features/agents/sub_editor/sub_connectors/index.ts`
- `src/features/agents/sub_editor/sub_connectors/useConnectorStatuses.ts`
- `src/features/agents/sub_editor/sub_use_cases/DefaultModelSection.tsx`
- `src/features/agents/sub_editor/sub_use_cases/PersonaUseCasesTab.tsx`
- `src/features/agents/sub_editor/sub_use_cases/UseCaseActiveItems.tsx`
- `src/features/agents/sub_editor/sub_use_cases/UseCaseChannelDropdown.tsx`
- `src/features/agents/sub_editor/sub_use_cases/UseCaseDetailPanel.tsx`
- `src/features/agents/sub_editor/sub_use_cases/UseCaseListPanel.tsx`
- `src/features/agents/sub_editor/sub_use_cases/UseCaseModelDropdown.tsx`
- `src/features/agents/sub_editor/sub_use_cases/UseCaseModelOverride.tsx`
- `src/features/agents/sub_editor/sub_use_cases/UseCaseModelOverrideForm.tsx`
- `src/features/agents/sub_editor/sub_use_cases/UseCaseSubscriptionForm.tsx`
- `src/features/agents/sub_editor/sub_use_cases/UseCaseSubscriptions.tsx`
- `src/features/agents/sub_editor/sub_use_cases/UseCaseTabHeader.tsx`
- `src/features/agents/sub_editor/sub_use_cases/UseCaseTestRunner.tsx`
- `src/features/agents/sub_editor/sub_use_cases/index.ts`
- `src/features/agents/sub_editor/sub_use_cases/useCaseDetailHelpers.ts`
- `src/features/agents/sub_editor/sub_use_cases/useCaseHelpers.ts`
- `src/api/connectors.ts`
- `src/api/events.ts`
- `src/stores/slices/eventSlice.ts`
- `src/lib/credentials/connectorRoles.ts`

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