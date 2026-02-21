Execute this requirement immediately without asking questions.

## REQUIREMENT

# Live card preview in Create Persona modal

## Metadata
- **Category**: ui
- **Effort**: Unknown (N/A/3)
- **Impact**: Unknown (N/A/3)
- **Scan Type**: delight_designer
- **Generated**: 2/21/2026, 11:35:52 PM

## Description
CreatePersonaModal (CreatePersonaModal.tsx) asks for icon, name, description, and color but the user cannot see what the resulting card will look like until after creation. Add a live preview strip at the top of the modal content area that renders a miniature PersonaCard-like component using the current form values in real-time. As the user types a name, picks an icon, or changes the color, the preview updates instantly with a subtle crossfade animation. The preview should match the exact styling of the actual PersonaCard component to set accurate expectations.

## Reasoning
The disconnect between form inputs and final output creates uncertainty � users pick a color swatch but do not know how it will render against the card background until after committing. A live preview closes this feedback loop, which is a core UX principle (visibility of system status). It transforms a transactional form into a crafting experience, increasing user confidence and reducing the need to edit immediately after creation.

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