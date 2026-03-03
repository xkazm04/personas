Execute this requirement immediately without asking questions.

## REQUIREMENT

# Make drop zone keyboard-accessible with focus ring

## Metadata
- **Category**: ui
- **Effort**: Medium (2/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 1:55:18 AM

## Description
In N8nUploadStep.tsx, the drag-drop zone is a motion.div with onClick but no role="button", no tabIndex, and no onKeyDown handler � keyboard-only users cannot activate the file picker at all (WCAG 2.1 SC 2.1.1 failure). Add tabIndex={0}, role="button", aria-label="Drop workflow file or click to browse", and an onKeyDown handler that triggers the hidden input on Enter/Space. Apply a focus-visible ring: focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background. Also pair the URL input and paste textarea with proper aria-label attributes instead of relying on placeholder text alone, and add aria-hidden="true" to the PlatformLabels pipe separators that screen readers currently announce as "vertical bar".

## Reasoning
The file upload zone is the very first interaction in the n8n import wizard � if it is inaccessible, the entire feature is blocked for keyboard and screen reader users. This is a critical accessibility gap at the entry point of a core workflow. The fix is surgical (one file, ~15 lines) and brings the component to WCAG AA compliance while also improving the visual focus state for sighted keyboard users.

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