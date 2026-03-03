Execute this requirement immediately without asking questions.

## REQUIREMENT

# Harmonize empty states and border-radius across edit tabs

## Metadata
- **Category**: ui
- **Effort**: Medium (2/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 1:55:50 AM

## Description
N8nEntitiesTab and N8nUseCasesTab are sibling tabs in the edit step but use visually inconsistent patterns. Empty state: EntitiesTab shows bare text ("No entities selected. Go back to the Analyze step...") with no icon, while UseCasesTab renders a ListChecks icon with two lines of text and a centered layout. Unify both to use the UseCasesTab pattern: a text-muted-foreground/40 icon (w-10 h-10), a text-sm font-medium title, and a text-xs text-muted-foreground/60 subtitle, all centered in py-12. Border-radius: connector cards in EntitiesTab use rounded-xl while tool/trigger tags use rounded-2xl. Standardize all card-level containers to rounded-xl and all inline badges to rounded-lg, matching the existing N8nWizardFooter button pattern. Also normalize the opacity inconsistency in UseCasesTab where capability badges use bg-{color}-500/8 while category badges use bg-{color}-500/10 � standardize on /10 throughout.

## Reasoning
Users tab between Entities and Use Cases frequently during the edit step. Inconsistent empty states, border radii, and badge opacities between these sibling panels create a subtle sense of visual incoherence that undermines trust in the tool. Harmonizing these patterns is a low-effort change (CSS-only, no logic changes) that makes the edit experience feel like a unified, professionally designed surface rather than two independently authored components.

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