Execute this requirement immediately without asking questions.

## REQUIREMENT

# Sliding pill indicator for wizard mode toggles

## Metadata
- **Category**: ui
- **Effort**: Medium (2/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 1:43:09 AM

## Description
CreationWizard.tsx Build/Chat toggle (lines 60-83) and OnboardingTemplateStep category filters (lines 116-138) both snap between active/inactive background colors without animation. Add a Framer Motion layoutId background pill: render a motion.div with layoutId="wizard-mode-pill" (or "template-filter-pill") using absolute positioning behind the active button, styled with bg-primary/10 rounded-xl. Spring config: { type: "spring", stiffness: 500, damping: 30 }. This matches the tab underline pattern used in PersonaEditor.

## Reasoning
The creation wizard is the first interaction for new users. The mode toggle and template filter are primary navigation controls. Smooth sliding selection creates a feeling of responsiveness and spatial coherence that static color changes cannot match. This pattern is already established in the editor tabs � extending it here creates system-wide consistency.

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