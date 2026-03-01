Execute this requirement immediately without asking questions.

## REQUIREMENT

# Actionable empty states with guided next steps

## Metadata
- **Category**: ui
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: delight_designer
- **Generated**: 2/28/2026, 11:50:28 PM

## Description
Empty states across the Prompt Lab are passive descriptions rather than actionable guides. The Compare tab shows Select two versions in small gray text with no direct affordance. UseCaseHistory shows No executions yet with no way to trigger one. AutoRollbackSettings shows a dash when errorRate is null with no explanation. Replace each with a structured empty state: centered icon, descriptive heading, explanatory subtext, and a primary CTA button. For Compare: a Start comparing button that highlights the A/B buttons. For History: a Run this use case button. For AutoRollback: a progress indicator showing executions needed.

## Reasoning
Passive empty states are dead ends. Every empty state is a teaching moment and an activation opportunity. The Compare tab instructions are particularly problematic: users must read small gray text, understand the A/B concept, navigate to the version list, find the A/B buttons, and click them. An actionable CTA collapses this multi-step discovery into a single click. GitHub and Notion both use structured empty states with prominent CTAs and their activation rates reflect this investment.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Prompt Lab & Use Cases

**Description**: Define use cases for agents and iterate on prompts in a testing lab. Includes version tracking, A/B prompt testing, diff viewing, auto-rollback settings, and per-use-case model overrides and subscription config.
**Related Files**:
- `src/features/agents/sub_editor/PromptLabTab.tsx`
- `src/features/agents/sub_editor/PersonaUseCasesTab.tsx`
- `src/features/agents/sub_editor/prompt-lab/AbTestPanel.tsx`
- `src/features/agents/sub_editor/prompt-lab/AutoRollbackSettings.tsx`
- `src/features/agents/sub_editor/prompt-lab/DiffViewer.tsx`
- `src/features/agents/sub_editor/prompt-lab/VersionItem.tsx`
- `src/features/agents/sub_editor/prompt-lab/promptLabUtils.ts`
- `src/features/agents/sub_editor/use-cases/UseCaseDetailPanel.tsx`
- `src/features/agents/sub_editor/use-cases/UseCaseListPanel.tsx`
- `src/features/agents/sub_editor/use-cases/UseCaseModelOverride.tsx`
- `src/features/agents/sub_editor/use-cases/UseCaseSubscriptions.tsx`
- `src/features/agents/sub_editor/use-cases/UseCaseTestRunner.tsx`
- `src/features/agents/sub_editor/use-cases/DefaultModelSection.tsx`
- `src/features/agents/sub_editor/use-cases/useCaseHelpers.ts`
- `src/features/shared/components/UseCasesList.tsx`
- `src/features/shared/components/UseCaseRow.tsx`
- `src/features/shared/components/UseCaseHistory.tsx`
- `src/features/shared/components/UseCaseExecutionPanel.tsx`
- `src/features/shared/components/PromptTabsPreview.tsx`
- `src/lib/personas/promptMigration.ts`
- `src/lib/personas/utils.ts`

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