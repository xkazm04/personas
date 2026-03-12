Execute this requirement immediately without asking questions.

## REQUIREMENT

# Lightweight session list query excludes raw JSON

## Metadata
- **Category**: performance
- **Effort**: Medium (2/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:43:17 PM

## Description
The list_n8n_sessions repo function uses SELECT * which returns raw_workflow_json (up to 10MB per session) for every row. N8nSessionList only displays workflow_name, status, step, and updated_at. Adding a list_summaries query that excludes raw_workflow_json, parser_result, draft_json, user_answers, and questions_json would dramatically reduce IPC payload size and memory pressure.

## Reasoning
This is the entry point for the n8n import tab -- every time a user opens it, all raw workflow JSONs are deserialized and transferred over Tauri IPC. With 5 sessions averaging 1MB each, this is 5MB of unnecessary data transfer that delays the session list rendering by hundreds of milliseconds.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: n8n Transform & Platforms

**Description**: n8n workflow import, AI-powered transformation to personas, streaming sessions, platform definitions, and design conversations.
**Related Files**:
- `src/api/templates/n8nTransform.ts`
- `src/api/templates/platformDefinitions.ts`
- `src/features/templates/sub_n8n/steps/upload/N8nUploadStep.tsx`
- `src/features/templates/sub_n8n/steps/N8nEditStep.tsx`
- `src/features/templates/sub_n8n/steps/N8nSessionList.tsx`
- `src/features/templates/sub_n8n/steps/confirm/N8nConfirmStep.tsx`
- `src/features/templates/sub_n8n/widgets/N8nTransformChat.tsx`
- `src/features/templates/sub_n8n/widgets/StreamingSections.tsx`
- `src/features/templates/sub_n8n/widgets/CredentialGapPanel.tsx`
- `src/features/templates/sub_n8n/edit/N8nEntitiesTab.tsx`
- `src-tauri/src/commands/design/n8n_transform/mod.rs`
- `src-tauri/src/commands/design/n8n_transform/streaming.rs`
- `src-tauri/src/commands/design/n8n_transform/cli_runner.rs`
- `src-tauri/src/commands/design/n8n_sessions.rs`
- `src-tauri/src/commands/design/platform_definitions.rs`
- `src-tauri/src/commands/design/conversations.rs`
- `src-tauri/src/commands/design/analysis.rs`
- `src-tauri/src/db/models/n8n_session.rs`
- `src-tauri/src/db/models/design_conversation.rs`
- `src-tauri/src/db/models/platform_definition.rs`
- `src-tauri/src/db/repos/resources/n8n_sessions.rs`
- `src-tauri/src/db/repos/core/design_conversations.rs`
- `src-tauri/src/engine/platforms/n8n.rs`

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