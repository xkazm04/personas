Execute this requirement immediately without asking questions.

## REQUIREMENT

# Rust delete_persona ignores execution cancellation errors

## Metadata
- **Category**: code_quality
- **Effort**: High (3/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/12/2026, 8:59:04 AM

## Description
In personas.rs delete_persona(), get_running errors are silently swallowed with if-let-Ok, and individual cancel_execution calls have no error handling. If the engine fails to cancel a running execution, the persona is still deleted from the DB, leaving an orphaned execution that references a non-existent persona_id. This can cause panics or infinite retry loops in the engine. Add error logging for cancellation failures and consider making deletion conditional on successful cancellation, or at minimum mark orphaned executions as cancelled in the DB.

## Reasoning
A persona with active executions is exactly the case where deletion is most dangerous. Silent cancellation failures mean the engine continues running with a persona that no longer exists in the DB, leading to cascading NotFound errors on every status update or result persist. This is the 2 AM wake-up call scenario � an orphaned execution stuck in a retry loop generating error noise.

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