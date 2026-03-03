Execute this requirement immediately without asking questions.

## REQUIREMENT

# Add local isCreating guard to prevent double persona creation

## Metadata
- **Category**: code_quality
- **Effort**: Low (1/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/3/2026, 12:44:37 AM

## Description
ChatCreator.tsx handleSend (line 157) guards against concurrent sends using isThinking (derived from design.phase). But design.phase updates asynchronously after startIntentCompilation is called � there is a window between the handleSend call and the phase transitioning to "analyzing" where a fast double-click creates two personas. The same race exists in BuilderStep handleGenerate via isGenerating state. Fix: add a local isCreatingRef = useRef(false) that is set synchronously at the top of handleSend before any async work, and check it as the first guard. Reset it in the catch block and when draftPersonaId is set.

## Reasoning
Double-persona creation is a classic race condition that produces two identical agents from one user interaction. The user sees one agent created but a second zombie lurks in the sidebar. Combined with the orphaned draft issue, this compounds the data pollution problem. A synchronous ref guard eliminates the race window entirely.

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