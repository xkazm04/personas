Execute this requirement immediately without asking questions.

## REQUIREMENT

# Add inline field validation to PreviewPhase credential form

## Metadata
- **Category**: ui
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 2:11:33 AM

## Description
In PreviewPhase, the Save button is gated by canSaveCredential (computed in the orchestrator) with a tooltip from getSaveDisabledReason, but the individual form fields show no validation state. Users discover they cannot save only through a disabled button and a tooltip � there is no inline "Required" message, no red border on empty required fields, and no blur-triggered validation. Add a validationErrors state computed from effectiveFields: for each required field that is empty or fails its pattern, store { fieldKey: errorMessage }. On field blur, set the field as "touched" and display the error below it using text-xs text-red-400/80 with a border-red-500/30 ring on the input. Only show errors for touched fields to avoid overwhelming on first render. Wire the same validation into canSaveCredential to keep them in sync.

## Reasoning
The current UX creates a frustrating guessing game: the user fills out fields, clicks Save, sees it is disabled, hovers for a tooltip, then hunts for which field is wrong. Inline validation transforms this into real-time guidance that prevents errors before the user even reaches the Save button. This is especially important for credential setup where field formats (API keys, client IDs, webhook URLs) have specific patterns that users may not get right on the first attempt. The pattern aligns with the existing CredentialSchemaForm approach in the vault forms system.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Credential Intelligence & Design

**Description**: AI-powered credential setup through design conversations and guided negotiation. Auto-discover credentials from connected services, detect anomalies, configure credential events, and get interactive setup instructions with step-by-step walkthroughs.
**Related Files**:
- `src/features/vault/sub_design/CredentialDesignModal.tsx`
- `src/features/vault/sub_design/AnalyzingPhase.tsx`
- `src/features/vault/sub_design/CredentialDesignContext.tsx`
- `src/features/vault/sub_design/CredentialDesignHelpers.ts`
- `src/features/vault/sub_design/DonePhase.tsx`
- `src/features/vault/sub_design/ErrorPhase.tsx`
- `src/features/vault/sub_design/IdlePhase.tsx`
- `src/features/vault/sub_design/InteractiveSetupInstructions.tsx`
- `src/features/vault/sub_design/PreviewPhase.tsx`
- `src/features/vault/sub_design/SetupStepCard.tsx`
- `src/features/vault/sub_design/setupInstructionHelpers.tsx`
- `src/features/vault/sub_design/setupMarkdownComponents.tsx`
- `src/features/vault/sub_design/useCredentialDesignOrchestrator.ts`
- `src/features/vault/sub_negotiator/NegotiatorGuidingPhase.tsx`
- `src/features/vault/sub_negotiator/NegotiatorPanel.tsx`
- `src/features/vault/sub_negotiator/NegotiatorPlanningPhase.tsx`
- `src/features/vault/sub_negotiator/NegotiatorStepCard.tsx`
- `src/features/vault/sub_negotiator/NegotiatorStepCardHelpers.tsx`
- `src/features/vault/sub_features/CredentialEventConfig.tsx`
- `src/features/vault/sub_features/CredentialIntelligence.tsx`
- `src/features/vault/sub_features/CredentialRotationSection.tsx`
- `src/features/vault/sub_features/AnomalyScorePanel.tsx`
- `src/features/vault/sub_features/EventConfigSubPanels.tsx`
- `src/features/vault/sub_features/RotationPolicyControls.tsx`
- `src/features/vault/sub_autoCred/AutoCredBrowser.tsx`
- `src/features/vault/sub_autoCred/AutoCredConsent.tsx`
- `src/features/vault/sub_autoCred/AutoCredPanel.tsx`
- `src/features/vault/sub_autoCred/AutoCredReview.tsx`
- `src/features/vault/sub_autoCred/types.ts`
- `src/features/vault/sub_autoCred/useAutoCredSession.ts`
- `src/features/vault/hooks/useCredentialOAuth.ts`
- `src/features/vault/hooks/useGoogleOAuth.ts`
- `src/api/credentialDesign.ts`
- `src/api/negotiator.ts`
- `src/hooks/design/useCredentialDesign.ts`
- `src/hooks/design/useCredentialNegotiator.ts`
- `src/hooks/design/useOAuthConsent.ts`
- `src/hooks/design/useOAuthPolling.ts`
- `src/hooks/design/useUniversalOAuth.ts`

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