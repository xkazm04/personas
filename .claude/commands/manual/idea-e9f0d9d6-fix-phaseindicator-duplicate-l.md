Execute this requirement immediately without asking questions.

## REQUIREMENT

# Fix PhaseIndicator duplicate layoutId causing animation glitch

## Metadata
- **Category**: code_quality
- **Effort**: Medium (2/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 1:48:34 AM

## Description
In PhaseIndicator.tsx, layoutId="phase-dot-highlight" is applied to every dot inside the STAGES.map() loop. Framer Motion requires layoutId to be unique per animated element � when multiple elements claim the same layoutId, the layout animation targets are ambiguous and Framer Motion logs warnings. Conditionally apply layoutId only to the active stage dot: {isActive && layoutId: "phase-dot-highlight"} as a spread, and remove it from the static class. Also fix the hybrid animation issue where the empty animate={{}} prop on the active dot partially overrides the Tailwind transition-colors duration-300 utility, causing potential double-animation on the dot color change.

## Reasoning
The PhaseIndicator is visible during every design interaction and animates on every phase change. The duplicate layoutId means Framer Motion is making an arbitrary choice about which dot to morph from/to, which can produce visual glitches (wrong dot expanding, or no animation at all). Fixing this ensures the polished ring-morph animation works as intended and eliminates console warnings.

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