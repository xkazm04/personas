Execute this requirement immediately without asking questions.

## REQUIREMENT

# Extract workflow structure validation from N8nUploadStep

## Metadata
- **Category**: maintenance
- **Effort**: Medium (2/3)
- **Impact**: Unknown (4/3)
- **Scan Type**: code_refactor
- **Generated**: 3/3/2026, 9:24:44 PM

## Description
Move countElements and detectPlatformLabel from N8nUploadStep.tsx into workflowDetector.ts or a shared utility. Use these exported functions across file upload, paste, and URL fetch handlers.

## Reasoning
N8nUploadStep currently duplicates the logic to identify platform labels and element counts across three different input methods. Consolidating this cleans up the component and creates a single source of truth for structural validation.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: n8n Workflow Import

**Description**: Import n8n automation workflows by uploading JSON, parse nodes into agent entities, chat with AI to transform workflows, and edit resulting use cases and connector mappings.
**Related Files**:
- `src/features/templates/sub_n8n/N8nConfirmStep.tsx`
- `src/features/templates/sub_n8n/N8nEditStep.tsx`
- `src/features/templates/sub_n8n/N8nImportTab.tsx`
- `src/features/templates/sub_n8n/N8nParserResults.tsx`
- `src/features/templates/sub_n8n/N8nSessionList.tsx`
- `src/features/templates/sub_n8n/N8nStepIndicator.tsx`
- `src/features/templates/sub_n8n/N8nTransformChat.tsx`
- `src/features/templates/sub_n8n/N8nUploadStep.tsx`
- `src/features/templates/sub_n8n/N8nWizardFooter.tsx`
- `src/features/templates/sub_n8n/StreamingSections.tsx`
- `src/features/templates/sub_n8n/WorkflowThumbnail.tsx`
- `src/features/templates/sub_n8n/edit/N8nEntitiesTab.tsx`
- `src/features/templates/sub_n8n/edit/N8nUseCasesTab.tsx`
- `src/features/templates/sub_n8n/edit/connectorMatching.ts`
- `src/features/templates/sub_n8n/edit/protocolParser.ts`
- `src/features/templates/sub_n8n/edit/useConnectorStatuses.ts`
- `src/features/templates/sub_n8n/n8nTypes.ts`
- `src/features/templates/sub_n8n/useN8nImportReducer.ts`
- `src/features/templates/sub_n8n/useN8nSession.ts`
- `src/features/templates/sub_n8n/useN8nTest.ts`
- `src/features/templates/sub_n8n/useN8nTransform.ts`
- `src/features/templates/sub_n8n/useN8nWizard.ts`
- `src/api/n8nTransform.ts`
- `src/lib/personas/n8nParser.ts`
- `src/lib/personas/workflowParser.ts`
- `src/lib/personas/workflowDetector.ts`
- `src/lib/personas/zapierParser.ts`
- `src/lib/personas/githubActionsParser.ts`
- `src/lib/personas/makeParser.ts`

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