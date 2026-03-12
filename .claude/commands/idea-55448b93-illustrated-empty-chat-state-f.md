Execute this requirement immediately without asking questions.

## REQUIREMENT

# Illustrated empty chat state for ChatCreator

## Metadata
- **Category**: ui
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: brand_artist
- **Generated**: 3/12/2026, 1:25:25 PM

## Description
In ChatCreator.tsx, when messages.length === 0, the only guidance is a small text hint ("Describe what your agent should do to get started"). Replace this with a custom SVG illustration (approximately 200x140px) showing a stylized conversation bubble morphing into an agent silhouette, using the brand violet-to-blue gradient. The illustration should convey the idea of "describe and create" with warmth. Below the illustration, show 2-3 example prompt chips (e.g., "Monitor my GitHub PRs", "Summarize daily Slack channels") as clickable starter suggestions that pre-fill the textarea.

## Reasoning
The ChatCreator is the first experience for users who choose the conversational creation path. A blank textarea with tiny muted hint text feels uninviting and gives no visual cue about the product identity. An illustrated empty state with starter chips reduces blank-canvas anxiety, teaches by example, and makes the creation flow feel crafted � driving higher completion rates.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Persona CRUD & Editor

**Description**: Creating, editing, and managing AI persona identities including system prompt editing, health monitoring, model selection, and persona settings.
**Related Files**:
- `src/api/agents/personas.ts`
- `src/stores/slices/agents/personaSlice.ts`
- `src/stores/slices/agents/healthCheckSlice.ts`
- `src/features/agents/components/ChatCreator.tsx`
- `src/features/agents/components/CreationWizard.tsx`
- `src/features/agents/sub_editor/components/PersonaEditor.tsx`
- `src/features/agents/sub_editor/libs/EditorDocument.tsx`
- `src/features/agents/sub_health/components/HealthTab.tsx`
- `src/features/agents/sub_prompt/components/PromptSectionSidebar.tsx`
- `src/features/agents/sub_settings/components/SettingsStatusBar.tsx`
- `src/features/agents/sub_model_config/components/ModelSelector.tsx`
- `src/features/agents/sub_design/components/DesignTabPhaseContent.tsx`
- `src-tauri/src/commands/core/personas.rs`
- `src-tauri/src/commands/core/groups.rs`
- `src-tauri/src/commands/core/memories.rs`
- `src-tauri/src/db/models/persona.rs`
- `src-tauri/src/db/models/group.rs`
- `src-tauri/src/db/repos/core/personas.rs`
- `src-tauri/src/db/repos/core/groups.rs`
- `src-tauri/src/engine/compiler.rs`
- `src-tauri/src/engine/intent_compiler.rs`
- `src-tauri/src/engine/prompt.rs`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

- **leonardo**: Use `/leonardo` skill to generate images with Leonardo AI (Lucid Origin model). For illustrations, icons, empty state artwork, branded loaders, and visual assets. Do NOT hand-code SVG — generate with AI and convert to SVG if needed.
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