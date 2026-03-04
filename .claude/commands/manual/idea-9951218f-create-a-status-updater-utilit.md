Execute this requirement immediately without asking questions.

## REQUIREMENT

# Create a status updater utility in useConnectorStatus

## Metadata
- **Category**: code_quality
- **Effort**: Medium (2/3)
- **Impact**: Unknown (4/3)
- **Scan Type**: code_refactor
- **Generated**: 3/3/2026, 9:18:09 PM

## Description
The useConnectorStatuses hook has multiple instances of state updates that map over the array. Extract this into an internal updateStatus(name, updates) helper function within the hook.

## Reasoning
This boilerplate array mapping clutters the testConnector and handleLinkCredential functions. A dedicated updater makes the state transitions declarative and much easier to read.

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