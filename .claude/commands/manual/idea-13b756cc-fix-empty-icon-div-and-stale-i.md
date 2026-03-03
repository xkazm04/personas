Execute this requirement immediately without asking questions.

## REQUIREMENT

# Fix empty icon div and stale init guard in AutoCred flow

## Metadata
- **Category**: code_quality
- **Effort**: Medium (2/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 2:11:55 AM

## Description
Two issues in the AutoCred sub-system: (1) In AutoCredReview.tsx line 72-74, the connector icon header div renders a colored box with backgroundColor and borderColor from designResult.connector.color but contains no icon element � it is a self-closing empty <div/>. AutoCredConsent correctly renders <Globe className="w-6 h-6"/> inside an identical header div. Add the same icon (or a <Plug> icon matching the credential context) inside the AutoCredReview header. (2) In useAutoCredSession.ts, the init useEffect depends on designResult.connector.name rather than the full designResult object. If the design result is re-analyzed with the same connector name but different fields (e.g., user refines the design), init is not re-called, leaving stale field definitions in the session. Change the dependency to designResult.connector.name + a hash of designResult.connector.fields to catch field-level changes.

## Reasoning
The empty icon div is a visual regression that makes the AutoCredReview header look broken compared to AutoCredConsent � users see a colored square with no icon where every other card in the vault has one. The stale init guard is a latent data-integrity issue: if the AI generates different fields on a second analysis of the same connector, the AutoCred session will prompt for the old fields, causing field mismatches that silently produce incomplete credentials. Both fixes are surgical and confined to the AutoCred module.

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