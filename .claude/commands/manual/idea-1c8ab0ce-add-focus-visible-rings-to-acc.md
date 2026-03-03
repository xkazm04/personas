Execute this requirement immediately without asking questions.

## REQUIREMENT

# Add focus-visible rings to accordion expand buttons

## Metadata
- **Category**: ui
- **Effort**: Low (1/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 1:36:04 AM

## Description
ToolsSection expand button (line 22), Direct Tool Testing toggle (PersonaUseCasesTab line 162), and EventSubscriptionSettings subscription rows all lack visible keyboard focus indicators. They use <button> elements but rely on invisible browser defaults. Add focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none focus-visible:rounded-xl to all interactive accordion triggers. Also add aria-expanded attributes to communicate open/closed state to assistive technology.

## Reasoning
Keyboard navigation is broken in practice for these panels � users tabbing through the editor see no visual indicator when focus lands on an expand/collapse trigger. This is a WCAG 2.4.7 (Focus Visible) issue that affects keyboard and switch-access users. The fix is a single Tailwind class addition per button, making it trivially low-effort.

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