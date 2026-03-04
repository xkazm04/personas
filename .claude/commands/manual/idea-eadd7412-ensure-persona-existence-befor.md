Execute this requirement immediately without asking questions.

## REQUIREMENT

# Ensure persona existence before selection after adoption

## Metadata
- **Category**: code_quality
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/3/2026, 9:06:25 PM

## Description
In confirmSave, selectPersona(id) is called immediately after fetchPersonas(). If the store update is asynchronous, selectPersona might fail to find the new ID. Ensure the persona is present in state before selection.

## Reasoning
Prevents intermittent "Persona not found" errors immediately after successful adoption, a classic race condition between API and local state.

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