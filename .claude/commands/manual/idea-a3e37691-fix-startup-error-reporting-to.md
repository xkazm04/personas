Execute this requirement immediately without asking questions.

## REQUIREMENT

# Fix startup error reporting to include all 5 parallel fetches

## Metadata
- **Category**: code_quality
- **Effort**: Low (1/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/3/2026, 12:44:29 AM

## Description
PersonasPage.tsx (lines 42-56) runs 5 parallel startup fetches via Promise.allSettled but only checks the first 3 results (results.slice(0, 3)) against STARTUP_LABELS which has only 3 entries. fetchPendingReviewCount (index 3) and fetchGroups (index 4) failures are never reported in the startup error message. If groups fail to load, the sidebar silently shows no groups with no indication of why. Fix: extend STARTUP_LABELS to cover all 5 fetches, or restructure to check all results. Additionally, groupSlice.fetchGroups (line 33-39) silently swallows all errors with an empty catch � surface the error to the store so it can be reported.

## Reasoning
Groups are a core organizational feature. When fetchGroups fails silently, users see an empty sidebar with no groups and no error explanation. They may assume their groups were deleted when the network simply hiccupped. The fix is trivial � add 2 entries to STARTUP_LABELS and add error surfacing to groupSlice � but the impact is high for reliability trust.

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