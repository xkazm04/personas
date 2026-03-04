Execute this requirement immediately without asking questions.

## REQUIREMENT

# Sensitivity Flag and Masking for Persona Descriptions in Hover Previews

## Metadata
- **Category**: ui
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: security_protector
- **Generated**: 3/3/2026, 9:25:58 PM

## Description
Add a 'Sensitive' flag to persona settings that, when enabled, masks the description and detailed stats in the PersonaHoverPreview component. Users would need to click to 'Reveal' the details in the preview.

## Reasoning
Hover previews can lead to accidental information exposure during screen sharing or in shared environments. Descriptions often contain business-sensitive context or internal instructions that shouldn't be visible at a glance.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Agent Navigation & Onboarding

**Description**: Browse, search, and organize AI agents. Create new agents through guided wizards, drag-and-drop into groups, and onboard from templates.
**Related Files**:
- `src/features/agents/components/ChatCreator.tsx`
- `src/features/agents/components/CreationWizard.tsx`
- `src/features/agents/components/GroupedAgentSidebar.tsx`
- `src/features/agents/components/PersonaHoverPreview.tsx`
- `src/features/agents/components/PersonaOverviewPage.tsx`
- `src/features/agents/components/onboarding/ConfigurationPopup.tsx`
- `src/features/agents/components/onboarding/OnboardingTemplateStep.tsx`
- `src/features/agents/components/sub_sidebar/DraggablePersonaCard.tsx`
- `src/features/agents/components/sub_sidebar/DroppableGroup.tsx`
- `src/features/agents/components/sub_sidebar/PersonaContextMenu.tsx`
- `src/features/agents/components/sub_sidebar/SearchFilterBar.tsx`
- `src/features/agents/components/sub_sidebar/usePersonaFilters.ts`
- `src/features/personas/PersonasPage.tsx`
- `src/api/personas.ts`
- `src/api/groups.ts`
- `src/stores/slices/personaSlice.ts`
- `src/stores/slices/groupSlice.ts`
- `src/lib/personas/utils.ts`
- `src/lib/personas/seedTemplates.ts`

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