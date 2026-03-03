Execute this requirement immediately without asking questions.

## REQUIREMENT

# Harmonize form label typography across context

## Metadata
- **Category**: ui
- **Effort**: Medium (2/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 1:36:10 AM

## Description
AddSubscriptionForm and NotificationChannelCard use text-sm font-mono text-muted-foreground/80 uppercase for field labels (e.g. EVENT TYPE, CREDENTIAL), while UseCaseModelOverrideForm uses text-sm font-medium text-foreground/80 (e.g. Provider, Model Name). The mono uppercase style reads as raw/technical debug output while the medium-weight style feels polished. Standardize all form labels on text-sm font-medium text-foreground/80 which matches the rest of the app, and reserve the mono uppercase pattern for section headers where it already works well.

## Reasoning
Typography inconsistency in closely related UI creates a jarring feeling of different authors stitching code together. Users configuring notification channels and model overrides in the same editing session encounter two different visual languages for the same concept (form label). Aligning on one pattern makes the entire editor feel cohesive.

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