Execute this requirement immediately without asking questions.

## REQUIREMENT

# Unify violet/purple palette and codify border-radius scale

## Metadata
- **Category**: ui
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 1:49:03 AM

## Description
DesignQuestionPanel uses purple-500 (#a855f7) while DesignWizard, WizardStepIndicator, WizardStepRenderer, and DraftEditStep tabs all use violet-500 (#8b5cf6) for the same semantic concept (AI design surface). The existing --color-accent token maps to violet but is not used by the question panel. Replace all purple-500 references in DesignQuestionPanel with the accent token via bg-accent/10, border-accent/25, text-accent. Separately, codify the implicit border-radius hierarchy as CSS custom properties: --radius-container: 1rem (rounded-2xl for panels), --radius-interactive: 0.75rem (rounded-xl for inputs/primary buttons), --radius-secondary: 0.5rem (rounded-lg for secondary buttons/badges), --radius-pill: 9999px (rounded-full for chips). Apply these across the 38 context files to eliminate the current ad-hoc mixing.

## Reasoning
The violet/purple split is subtle but creates visual dissonance: the question panel reads as a slightly different shade of AI than the wizard that spawned it, breaking the sense of a unified design engine. The border-radius inconsistency (rounded-lg on cancel buttons vs rounded-xl on primary buttons vs rounded-2xl on panels) is currently an implied convention with exceptions � codifying it as tokens prevents further drift and makes the design system self-documenting for future contributors.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: AI Design Conversations

**Description**: Engage in AI-powered design conversations to iteratively build and refine agent configurations. Ask questions, analyze intent, preview changes, and apply AI-generated designs to agent prompts and settings.
**Related Files**:
- `src/features/agents/sub_editor/sub_design/DesignConversationHistory.tsx`
- `src/features/agents/sub_editor/sub_design/DesignPhaseAnalyzing.tsx`
- `src/features/agents/sub_editor/sub_design/DesignPhaseApplied.tsx`
- `src/features/agents/sub_editor/sub_design/DesignPhaseAppliedDetails.tsx`
- `src/features/agents/sub_editor/sub_design/DesignPhaseApplying.tsx`
- `src/features/agents/sub_editor/sub_design/DesignPhasePanel.tsx`
- `src/features/agents/sub_editor/sub_design/DesignPhasePanelSaved.tsx`
- `src/features/agents/sub_editor/sub_design/DesignPhasePreview.tsx`
- `src/features/agents/sub_editor/sub_design/DesignPhaseRefining.tsx`
- `src/features/agents/sub_editor/sub_design/DesignQuestionPanel.tsx`
- `src/features/agents/sub_editor/sub_design/DesignTab.tsx`
- `src/features/agents/sub_editor/sub_design/DesignTabHelpers.ts`
- `src/features/agents/sub_editor/sub_design/DesignTabPhaseContent.tsx`
- `src/features/agents/sub_editor/sub_design/DesignWizard.tsx`
- `src/features/agents/sub_editor/sub_design/IntentResultExtras.tsx`
- `src/features/agents/sub_editor/sub_design/PhaseIndicator.tsx`
- `src/features/agents/sub_editor/sub_design/WizardStepIndicator.tsx`
- `src/features/agents/sub_editor/sub_design/WizardStepRenderer.tsx`
- `src/features/agents/sub_editor/sub_design/index.ts`
- `src/features/agents/sub_editor/sub_design/useDesignTabState.ts`
- `src/features/agents/sub_editor/sub_design/wizardCompiler.ts`
- `src/features/agents/sub_editor/sub_design/wizardSteps.ts`
- `src/features/shared/components/draft-editor/DesignContextViewer.tsx`
- `src/features/shared/components/draft-editor/DraftEditStep.tsx`
- `src/features/shared/components/draft-editor/DraftIdentityTab.tsx`
- `src/features/shared/components/draft-editor/DraftJsonTab.tsx`
- `src/features/shared/components/draft-editor/DraftPromptTab.tsx`
- `src/features/shared/components/draft-editor/DraftSettingsTab.tsx`
- `src/features/shared/components/draft-editor/SectionEditor.tsx`
- `src/features/shared/components/draft-editor/index.ts`
- `src/features/shared/components/DesignInput.tsx`
- `src/features/shared/components/DesignConnectorGrid.tsx`
- `src/api/design.ts`
- `src/hooks/design/useDesignAnalysis.ts`
- `src/hooks/design/useDesignConversation.ts`
- `src/hooks/design/useAiArtifactFlow.ts`
- `src/hooks/design/useTauriStream.ts`
- `src/lib/types/designTypes.ts`

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