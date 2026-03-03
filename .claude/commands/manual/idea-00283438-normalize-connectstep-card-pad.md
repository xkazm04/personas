Execute this requirement immediately without asking questions.

## REQUIREMENT

# Normalize ConnectStep card padding and extract grid helper

## Metadata
- **Category**: ui
- **Effort**: Medium (2/3)
- **Impact**: Unknown (4/3)
- **Scan Type**: ui_perfectionist
- **Generated**: 3/3/2026, 2:03:05 AM

## Description
In ConnectStep.tsx, ComponentCard uses p-3 with text-xs font-semibold labels while StandaloneConnectorTile uses p-2.5 with text-xs font-medium labels � these adjacent card types have visually mismatched density. The dynamic grid column count is computed via a 5-level nested ternary (lines 497-503, repeated at 533-539) that is unreadable and duplicated. Standardize both card types to p-3 with text-xs font-semibold for visual harmony. Extract a gridColsClass(count: number) utility that returns the appropriate Tailwind grid-cols-{1..5} class string, and use it in both grid locations. Also fix the SuccessBridgeChip timing: the chip auto-dismisses at 1500ms but the emerald ring persists for 1800ms � align both to 1500ms so the visual feedback disappears atomically.

## Reasoning
ConnectStep is the most connector-dense screen in the entire wizard � users compare multiple credential cards side by side to wire up their agent. Inconsistent padding between role-grouped and standalone cards creates a subtle visual hierarchy that does not correspond to any actual difference in importance, making the screen feel slightly disordered. The duplicated 5-level ternary is a readability hazard for contributors. The 300ms timing gap between chip dismissal and ring removal is a minor but noticeable visual glitch that breaks the feeling of precision.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Template Gallery & Adoption

**Description**: Browse generated agent templates, view design reviews with dimensional scoring, and adopt templates through a multi-step wizard with connector provisioning, trigger configuration, and inline credential setup.
**Related Files**:
- `src/features/templates/components/DesignReviewsPage.tsx`
- `src/features/templates/animationPresets.ts`
- `src/features/templates/sub_generated/AdoptConfirmStep.tsx`
- `src/features/templates/sub_generated/AdoptionWizardContext.tsx`
- `src/features/templates/sub_generated/AdoptionWizardModal.tsx`
- `src/features/templates/sub_generated/ConnectorPipeline.tsx`
- `src/features/templates/sub_generated/ConnectorReadiness.tsx`
- `src/features/templates/sub_generated/CreateTemplateModal.tsx`
- `src/features/templates/sub_generated/DesignCheckbox.tsx`
- `src/features/templates/sub_generated/DesignResultPreview.tsx`
- `src/features/templates/sub_generated/DesignReviewRunner.tsx`
- `src/features/templates/sub_generated/DesignTestResults.tsx`
- `src/features/templates/sub_generated/DimensionRadial.tsx`
- `src/features/templates/sub_generated/GeneratedReviewsTab.tsx`
- `src/features/templates/sub_generated/RebuildModal.tsx`
- `src/features/templates/sub_generated/ReviewExpandedDetail.tsx`
- `src/features/templates/sub_generated/SandboxWarningBanner.tsx`
- `src/features/templates/sub_generated/ScanResultsBanner.tsx`
- `src/features/templates/sub_generated/TeamSynthesisPanel.tsx`
- `src/features/templates/sub_generated/TemplateCard.tsx`
- `src/features/templates/sub_generated/TemplateDetailModal.tsx`
- `src/features/templates/sub_generated/TemplatePagination.tsx`
- `src/features/templates/sub_generated/TemplatePreviewModal.tsx`
- `src/features/templates/sub_generated/TemplateSearchBar.tsx`
- `src/features/templates/sub_generated/TemplateSourcePanel.tsx`
- `src/features/templates/sub_generated/TrustBadge.tsx`
- `src/features/templates/sub_generated/designRunnerConstants.ts`
- `src/features/templates/sub_generated/templateVariables.ts`
- `src/features/templates/sub_generated/useAdoptReducer.ts`
- `src/features/templates/sub_generated/useAsyncTransform.ts`
- `src/features/templates/sub_generated/useCreateTemplateReducer.ts`
- `src/features/templates/sub_generated/useModalStack.ts`
- `src/features/templates/sub_generated/review/SelectionCheckbox.tsx`
- `src/features/templates/sub_generated/review/TemplateReviewStep.tsx`
- `src/features/templates/sub_generated/review/TriggerConfigPanel.tsx`
- `src/features/templates/sub_generated/steps/ChooseStep.tsx`
- `src/features/templates/sub_generated/steps/ConnectStep.tsx`
- `src/features/templates/sub_generated/steps/CreateStep.tsx`
- `src/features/templates/sub_generated/steps/InlineCredentialPanel.tsx`
- `src/features/templates/sub_generated/steps/QuickAdoptConfirm.tsx`
- `src/features/templates/sub_generated/steps/TuneStep.tsx`
- `src/features/templates/sub_generated/steps/WizardSidebar.tsx`
- `src/features/templates/sub_generated/steps/index.ts`
- `src/api/templateAdopt.ts`
- `src/api/reviews.ts`
- `src/hooks/design/useDesignReviews.ts`
- `src/hooks/design/useTemplateGallery.ts`
- `src/lib/templates/templateVerification.ts`
- `src/lib/templates/personaSafetyScanner.ts`
- `src/lib/personas/templateCatalog.ts`
- `src/lib/types/templateTypes.ts`

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