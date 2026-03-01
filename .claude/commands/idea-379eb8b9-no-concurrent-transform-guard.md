Execute this requirement immediately without asking questions.

## REQUIREMENT

# No concurrent transform guard per session ID

## Metadata
- **Category**: code_quality
- **Effort**: High (3/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/1/2026, 12:15:04 AM

## Description
start_n8n_transform_background (cli_runner.rs:59-61) guards against duplicate transform_id but nothing prevents two transforms with different IDs targeting the same session_id. Both spawn tokio tasks that race to update session status and draft_json, causing one transform to silently overwrite the other. Add a session-level lock or check that the session is not already in transforming state before starting a new transform.

## Reasoning
If a user double-clicks or the frontend retries with a new transform ID, two background transforms run simultaneously on the same session. The second overwrites the first draft, or both write partial results, leaving the session in a corrupted state with mismatched draft and status. This is a data-loss scenario that is hard to debug.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: n8n Workflow Import

**Description**: Import and transform n8n automation workflows into Personas agents. Upload n8n JSON, parse workflow nodes, edit connectors/entities/use-cases, chat with AI to refine the transformation, and confirm the final persona generation.
**Related Files**:
- `src/features/templates/sub_n8n/N8nImportTab.tsx`
- `src/features/templates/sub_n8n/N8nUploadStep.tsx`
- `src/features/templates/sub_n8n/N8nEditStep.tsx`
- `src/features/templates/sub_n8n/N8nConfirmStep.tsx`
- `src/features/templates/sub_n8n/N8nSessionList.tsx`
- `src/features/templates/sub_n8n/N8nTransformChat.tsx`
- `src/features/templates/sub_n8n/N8nParserResults.tsx`
- `src/features/templates/sub_n8n/N8nStepIndicator.tsx`
- `src/features/templates/sub_n8n/WorkflowThumbnail.tsx`
- `src/features/templates/sub_n8n/N8nWizardFooter.tsx`
- `src/features/templates/sub_n8n/n8nTypes.ts`
- `src/features/templates/sub_n8n/useN8nImportReducer.ts`
- `src/features/templates/sub_n8n/edit/N8nConnectorsTab.tsx`
- `src/features/templates/sub_n8n/edit/N8nEntitiesTab.tsx`
- `src/features/templates/sub_n8n/edit/N8nUseCasesTab.tsx`
- `src/features/templates/sub_n8n/edit/protocolParser.ts`
- `src/api/n8nTransform.ts`
- `src/lib/personas/n8nParser.ts`
- `src-tauri/src/commands/design/n8n_sessions.rs`
- `src-tauri/src/commands/design/n8n_transform/mod.rs`
- `src-tauri/src/commands/design/n8n_transform/cli_runner.rs`
- `src-tauri/src/commands/design/n8n_transform/job_state.rs`
- `src-tauri/src/commands/design/n8n_transform/confirmation.rs`
- `src-tauri/src/commands/design/n8n_transform/prompts.rs`
- `src-tauri/src/commands/design/n8n_transform/types.rs`
- `src-tauri/src/db/repos/resources/n8n_sessions.rs`
- `src-tauri/src/db/models/n8n_session.rs`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

Use Claude Code skills as appropriate for implementation guidance. Check `.claude/skills/` directory for available skills.

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