Execute this requirement immediately without asking questions.

## REQUIREMENT

# Progressive disclosure for TuneStep sections

## Metadata
- **Category**: ui
- **Effort**: Unknown (4/3)
- **Impact**: Unknown (7/3)
- **Scan Type**: delight_designer
- **Generated**: 3/1/2026, 12:03:36 AM

## Description
The TuneStep crams 5 dense config sections (Template Config, Notifications, Human Review, Execution Limits, Trigger Setup) into a single scroll view with no priority hierarchy. Replace with collapsible accordion panels where only the first section with missing required fields auto-expands. Add a completion dot indicator on each section header showing configured vs total fields, so users see at-a-glance what needs attention without scanning everything.

## Reasoning
Users face unnecessary cognitive load scanning 5 identically-weighted sections when typically only 1-2 need customization. Progressive disclosure reduces visible surface area by ~70% while keeping everything accessible. The completion dots create a task-list feel that guides attention to what actually needs action, dramatically improving first-time-through speed.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Template Gallery & Adoption

**Description**: Browse, review, and adopt pre-built agent templates. Includes a built-in template gallery, AI-generated design reviews with scoring dimensions, batch/custom/predefined template modes, and a multi-step adoption wizard for creating agents from templates.
**Related Files**:
- `src/features/templates/components/DesignReviewsPage.tsx`
- `src/features/templates/animationPresets.ts`
- `src/features/templates/sub_builtin/BuiltinTemplatesTab.tsx`
- `src/features/templates/sub_generated/GeneratedReviewsTab.tsx`
- `src/features/templates/sub_generated/AdoptionWizardModal.tsx`
- `src/features/templates/sub_generated/CreateTemplateModal.tsx`
- `src/features/templates/sub_generated/RebuildModal.tsx`
- `src/features/templates/sub_generated/TemplateDetailModal.tsx`
- `src/features/templates/sub_generated/TemplateCard.tsx`
- `src/features/templates/sub_generated/TemplatePagination.tsx`
- `src/features/templates/sub_generated/TemplateSearchBar.tsx`
- `src/features/templates/sub_generated/ConnectorReadiness.tsx`
- `src/features/templates/sub_generated/DesignCheckbox.tsx`
- `src/features/templates/sub_generated/DesignTestResults.tsx`
- `src/features/templates/sub_generated/DesignResultPreview.tsx`
- `src/features/templates/sub_generated/DesignReviewRunner.tsx`
- `src/features/templates/sub_generated/DimensionRadial.tsx`
- `src/features/templates/sub_generated/BatchModePanel.tsx`
- `src/features/templates/sub_generated/CustomModePanel.tsx`
- `src/features/templates/sub_generated/PredefinedModePanel.tsx`
- `src/features/templates/sub_generated/AdoptConfirmStep.tsx`
- `src/features/templates/sub_generated/ReviewExpandedDetail.tsx`
- `src/features/templates/sub_generated/designRunnerConstants.ts`
- `src/features/templates/sub_generated/templateVariables.ts`
- `src/features/templates/sub_generated/useAdoptReducer.ts`
- `src/features/templates/sub_generated/useCreateTemplateReducer.ts`
- `src/features/templates/sub_generated/review/TemplateReviewStep.tsx`
- `src/features/templates/sub_generated/review/SelectionCheckbox.tsx`
- `src/features/templates/sub_generated/review/TriggerConfigPanel.tsx`
- `src/features/templates/sub_generated/steps/ChooseStep.tsx`
- `src/features/templates/sub_generated/steps/ConnectStep.tsx`
- `src/features/templates/sub_generated/steps/CreateStep.tsx`
- `src/features/templates/sub_generated/steps/TuneStep.tsx`
- `src/features/templates/sub_generated/steps/WizardSidebar.tsx`
- `src/features/templates/sub_generated/steps/index.ts`
- `src/hooks/design/useDesignReviews.ts`
- `src/hooks/design/useTemplateGallery.ts`
- `src/api/templateAdopt.ts`
- `src/api/reviews.ts`
- `src/lib/personas/builtinTemplates.ts`
- `src/lib/personas/categoryTemplates.ts`
- `src/lib/personas/seedTemplates.ts`
- `src/lib/personas/templateIndex.ts`
- `src/lib/types/templateTypes.ts`
- `src-tauri/src/commands/design/template_adopt.rs`
- `src-tauri/src/commands/design/reviews.rs`
- `src-tauri/src/db/repos/communication/reviews.rs`
- `src-tauri/src/db/models/review.rs`

**Post-Implementation**: After completing this requirement, evaluate if the context description or file paths need updates. Use the appropriate API/DB query to update the context if architectural changes were made.

## Recommended Skills

- **compact-ui-design**: Use `.claude/skills/compact-ui-design.md` for high-quality UI design references and patterns

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