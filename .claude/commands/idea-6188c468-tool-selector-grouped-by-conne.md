Execute this requirement immediately without asking questions.

## REQUIREMENT

# Tool selector grouped by connector with bulk toggle

## Metadata
- **Category**: ui
- **Effort**: Unknown (N/A/3)
- **Impact**: Unknown (N/A/3)
- **Scan Type**: delight_designer
- **Generated**: 2/21/2026, 11:37:56 PM

## Description
ToolSelector (ToolSelector.tsx:206) renders a flat grid filtered by category chips, but many users think in terms of connectors (all Gmail tools, all Calendar tools) rather than abstract categories. Add a secondary grouping mode toggle (icon button: grid vs list) that groups tools by their requires_credential_type, showing the connector icon and label as a section header. Each group header gets a bulk toggle checkbox that assigns/removes all tools in that group at once. The credential status (CheckCircle/AlertCircle) moves to the group header, eliminating per-tool visual repetition. Keep the existing category filter as the default view.

## Reasoning
When users add a Gmail credential, they almost always want to enable all Gmail tools at once. The current one-by-one toggle across a grid is tedious with 8+ tools per connector. Bulk toggle by connector group eliminates this friction. The grouped view also makes credential gaps instantly visible at the section level rather than requiring users to scan individual tool cards.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Persona Editor

**Description**: Build and configure AI agent personas with a multi-tab editor for prompts, model selection, tool assignment, notification channels, and design wizard. Full agent configuration experience from prompt authoring to deployment settings.
**Related Files**:
- `src/features/agents/sub_editor/PersonaEditor.tsx`
- `src/features/agents/sub_editor/PersonaPromptEditor.tsx`
- `src/features/agents/sub_editor/PersonaSettingsTab.tsx`
- `src/features/agents/sub_editor/DesignTab.tsx`
- `src/features/agents/sub_editor/DesignWizard.tsx`
- `src/features/agents/sub_editor/DesignPhasePanel.tsx`
- `src/features/agents/sub_editor/DesignQuestionPanel.tsx`
- `src/features/agents/sub_editor/PhaseIndicator.tsx`
- `src/features/agents/sub_editor/PromptSectionTab.tsx`
- `src/features/agents/sub_editor/PromptVersionHistory.tsx`
- `src/features/agents/sub_editor/ToolSelector.tsx`
- `src/features/agents/sub_editor/WizardStepRenderer.tsx`
- `src/features/agents/sub_editor/wizardSteps.ts`
- `src/features/agents/sub_editor/PersonaDraft.ts`
- `src/features/agents/sub_editor/NotificationChannelSettings.tsx`
- `src/features/agents/sub_editor/model-config/ModelSelector.tsx`
- `src/features/agents/sub_editor/model-config/LiteLLMConfigField.tsx`
- `src/features/agents/sub_editor/model-config/OllamaApiKeyField.tsx`
- `src/features/agents/sub_editor/model-config/OllamaCloudPresets.ts`
- `src/api/personas.ts`
- `src/api/tools.ts`
- `src/stores/slices/personaSlice.ts`
- `src-tauri/src/commands/core/personas.rs`
- `src-tauri/src/db/repos/core/personas.rs`
- `src-tauri/src/db/models/persona.rs`

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