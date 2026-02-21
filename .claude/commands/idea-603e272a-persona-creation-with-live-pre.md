Execute this requirement immediately without asking questions.

## REQUIREMENT

# Persona creation with live preview and guidance

## Metadata
- **Category**: user_benefit
- **Effort**: Unknown (N/A/3)
- **Impact**: Unknown (N/A/3)
- **Scan Type**: user_empathy_champion
- **Generated**: 2/21/2026, 11:45:28 PM

## Description
The CreatePersonaModal asks for name, description, icon, and color but provides no preview of what the finished persona card will look like, no guidance on what makes a good persona, and no connection to what happens next. Add a real-time preview panel on the right side of the modal that renders a miniature PersonaCard as the user types. Below the form, add a subtle "What happens next?" hint explaining that after creation they can configure prompts, add triggers, and connect tools. This transforms the modal from a data entry form into a creative experience.

## Reasoning
Users creating their first persona feel uncertain about whether they are doing it right. The current modal is purely transactional � fill fields, click Create. A live preview provides immediate visual feedback that builds excitement ("this is MY agent"), while the what-happens-next hint reduces post-creation confusion. Users should feel like they are birthing something, not filling out a form.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Agent Roster & Onboarding

**Description**: Browse, create, group, and onboard new AI personas. Includes persona cards grid, group-based sidebar navigation, creation modal, and step-by-step onboarding wizard with health checks and template selection.
**Related Files**:
- `src/features/agents/components/PersonaOverviewPage.tsx`
- `src/features/agents/components/PersonaCard.tsx`
- `src/features/agents/components/CreatePersonaModal.tsx`
- `src/features/agents/components/GroupedAgentSidebar.tsx`
- `src/features/agents/components/OnboardingWizard.tsx`
- `src/features/agents/components/onboarding/OnboardingHealthCheck.tsx`
- `src/features/agents/components/onboarding/OnboardingTemplateStep.tsx`
- `src/api/groups.ts`
- `src/stores/slices/groupSlice.ts`
- `src/stores/slices/toolSlice.ts`
- `src-tauri/src/commands/core/groups.rs`
- `src-tauri/src/commands/tools/tools.rs`
- `src-tauri/src/db/repos/core/groups.rs`
- `src-tauri/src/db/repos/resources/tools.rs`
- `src-tauri/src/db/models/group.rs`
- `src-tauri/src/db/models/tool.rs`

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