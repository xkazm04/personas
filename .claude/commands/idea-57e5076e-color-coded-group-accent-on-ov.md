Execute this requirement immediately without asking questions.

## REQUIREMENT

# Color-coded group accent on overview grid cards

## Metadata
- **Category**: ui
- **Effort**: Unknown (N/A/3)
- **Impact**: Unknown (N/A/3)
- **Scan Type**: delight_designer
- **Generated**: 2/21/2026, 11:35:53 PM

## Description
GroupedAgentSidebar assigns colors to groups (GROUP_COLORS palette, rendered as 2x2px dots in headers), but PersonaOverviewPage cards show no group affiliation. Add a 3px left border accent to each card in the overview grid, colored by the personas group_id matching its group color. Ungrouped personas get no accent (transparent border). This requires looking up the group color from the groups array in the store using persona.group_id. The border should use a subtle gradient from the group color at full opacity to transparent, creating a refined indicator rather than a harsh stripe.

## Reasoning
The overview grid loses all organizational context from the sidebar grouping. Users who carefully organize agents into color-coded groups see that effort evaporate on the main dashboard. A left-border accent is a minimal visual signal (3px) that preserves scannability while encoding group membership. This creates visual consistency between the sidebar grouping and the grid view.

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