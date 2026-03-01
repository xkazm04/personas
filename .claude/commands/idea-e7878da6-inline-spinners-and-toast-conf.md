Execute this requirement immediately without asking questions.

## REQUIREMENT

# Inline spinners and toast confirmations for async ops

## Metadata
- **Category**: ui
- **Effort**: High (3/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: delight_designer
- **Generated**: 2/28/2026, 11:50:27 PM

## Description
Tag promotion, rollback, and A/B test operations in VersionItem and AbTestPanel disable all buttons coarsely but show no per-operation loading indicator or success confirmation. Add a Loader2 spin icon inside the specific button being acted on, keeping other buttons interactive. On success, show a brief auto-dismiss toast confirming the action. On error, show a larger inline error panel near the action rather than the current tiny text-xs text-red-400 message that is easy to miss.

## Reasoning
Silent success is the most common UX antipattern in this context. Users click Promote, the button disables briefly, and the version list updates above with no confirmation. This creates anxiety and re-clicking. The coarse disable-all approach also blocks legitimate parallel actions like comparing versions while a tag operation is in flight. Vercel and Linear both provide inline loading plus toast confirmation for every mutative action.

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