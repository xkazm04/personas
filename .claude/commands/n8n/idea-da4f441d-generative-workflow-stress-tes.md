Execute this requirement immediately without asking questions.

## REQUIREMENT

# Generative Workflow Stress Testing & Chaos Monkey

## Metadata
- **Category**: code_quality
- **Effort**: Unknown (6/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: moonshot_architect
- **Generated**: 3/1/2026, 4:22:50 PM

## Description
Before deployment, the persona undergoes a high-speed synthetic stress test. The system generates thousands of variations of input data (including malformed, malicious, or extreme edge cases) to identify where the workflow might fail, providing a Reliability Score and automatically suggesting Defensive Nodes (retries, circuit breakers).

## Reasoning
Reliability is the #1 concern for production agents. This Chaos Monkey for Workflows ensures that imported logic is production-ready before it ever touches real data.

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