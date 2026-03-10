Execute this requirement immediately without asking questions.

## REQUIREMENT

# Split useToolSelectorState 24-property god hook

## Metadata
- **Category**: maintenance
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: code_refactor
- **Generated**: 3/9/2026, 11:13:40 PM

## Description
useToolSelectorState returns 24 properties in a single destructured object, mixing persona data, search state, selection state, and action handlers. Split into 3-4 focused hooks: useToolSelectorPersona (persona, toolDefs, credentials), useToolSelectorSearch (query, filteredTools, categories), useToolSelectorSelection (selectedCategory, viewMode, justToggledId), and useToolSelectorHandlers (toggle, undo, clearAll, bulkToggle). ToolSelector.tsx composes them.

## Reasoning
A 24-property return value makes the hook impossible to reason about � callers cannot tell which properties are related or which trigger re-renders together. Splitting into focused hooks improves testability, reduces unnecessary re-renders (components only subscribe to what they need), and makes each concern independently maintainable.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Agent Editor & Configuration

**Description**: Configure agent model settings, edit system prompts with section management, select tools, and manage agent settings including budget controls and custom model configs.
**Related Files**:
- `src/features/agents/sub_editor/EditorBanners.tsx`
- `src/features/agents/sub_editor/EditorDocument.tsx`
- `src/features/agents/sub_editor/EditorTabBar.tsx`
- `src/features/agents/sub_editor/PersonaDraft.ts`
- `src/features/agents/sub_editor/PersonaEditor.tsx`
- `src/features/agents/sub_editor/PersonaEditorHeader.tsx`
- `src/features/agents/sub_editor/useEditorSave.ts`
- `src/features/agents/sub_editor/sub_model_config/BudgetControls.tsx`
- `src/features/agents/sub_editor/sub_model_config/CustomModelConfigForm.tsx`
- `src/features/agents/sub_editor/sub_model_config/LiteLLMConfigField.tsx`
- `src/features/agents/sub_editor/sub_model_config/ModelSelector.tsx`
- `src/features/agents/sub_editor/sub_model_config/OllamaApiKeyField.tsx`
- `src/features/agents/sub_editor/sub_model_config/OllamaCloudPresets.ts`
- `src/features/agents/sub_editor/sub_model_config/ProviderCredentialField.tsx`
- `src/features/agents/sub_editor/sub_model_config/SaveConfigButton.tsx`
- `src/features/agents/sub_editor/sub_model_config/index.ts`
- `src/features/agents/sub_editor/sub_prompt/CustomSectionsPanel.tsx`
- `src/features/agents/sub_editor/sub_prompt/PersonaPromptEditor.tsx`
- `src/features/agents/sub_editor/sub_prompt/PromptSectionSidebar.tsx`
- `src/features/agents/sub_editor/sub_prompt/index.ts`
- `src/features/agents/sub_editor/sub_settings/PersonaSettingsTab.tsx`
- `src/features/agents/sub_editor/sub_settings/index.ts`
- `src/features/agents/sub_editor/sub_tools/ToolCardItems.tsx`
- `src/features/agents/sub_editor/sub_tools/ToolCategoryList.tsx`
- `src/features/agents/sub_editor/sub_tools/ToolSearchFilter.tsx`
- `src/features/agents/sub_editor/sub_tools/ToolSelector.tsx`
- `src/features/agents/sub_editor/sub_tools/index.ts`
- `src/features/agents/sub_editor/sub_tools/useToolSelectorState.ts`
- `src/api/tools.ts`
- `src/api/settings.ts`
- `src/stores/slices/toolSlice.ts`
- `src/lib/compiler/personaCompiler.ts`
- `src/hooks/design/usePersonaCompiler.ts`

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