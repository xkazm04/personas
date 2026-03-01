Execute this requirement immediately without asking questions.

## REQUIREMENT

# Haptic Topology: Real-Time Flow Visualization

## Metadata
- **Category**: ui
- **Effort**: Unknown (9/3)
- **Impact**: Unknown (8/3)
- **Scan Type**: moonshot_architect
- **Generated**: 3/1/2026, 5:06:40 PM

## Description
Replace the current static workflow thumbnail with an interactive 3D topology visualization powered by WebGL/Three.js. During the transform phase, nodes light up as they are being analyzed � the user watches the AI walk through their workflow in real-time, seeing each node transform from its original n8n representation into the corresponding persona tool/trigger/connector. The visualization is haptic � nodes pulse, connections flow with particle effects showing data direction, and completed transforms crystallize into the final persona shape. Users can click any node mid-transform to see the AI reasoning for that specific transformation decision.

## Reasoning
The current transform phase is a black box with a spinner. The haptic topology turns waiting time into discovery time � users understand their workflow better by watching the AI analyze it. This creates an emotional connection (users describe it as magical) and eliminates the anxiety of a long transform. No automation tool has ever visualized the intelligence behind the transformation. This is the feature people would share on Twitter.

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