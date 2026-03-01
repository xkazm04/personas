Execute this requirement immediately without asking questions.

## REQUIREMENT

# Zero-Config Magic: Connector-Aware Auto-Adoption

## Metadata
- **Category**: user_benefit
- **Effort**: Unknown (8/3)
- **Impact**: Unknown (9/3)
- **Scan Type**: moonshot_architect
- **Generated**: 3/1/2026, 5:09:21 PM

## Description
Implement a zero-configuration adoption path that analyzes the users existing credential vault, installed connectors, and previous persona configurations to auto-fill the entire 5-step wizard. When a user clicks Adopt on any template, the system instantly resolves credential mappings from the vault (using connector role matching and service_type similarity), pre-selects the optimal use cases based on which connectors are ready, auto-fills template variables from previous adoptions of similar templates, and presents a single confirmation screen instead of 5 steps. The wizard still exists for power users who want control, but the default experience is: click Adopt, review one screen, click Create.

## Reasoning
The current 5-step wizard is thorough but friction-heavy. Most users have the same connectors across all their personas. A system that learns from the users vault and history could reduce adoption time from 5-10 minutes to under 30 seconds. This is the kind of magical experience that creates word-of-mouth � users would describe it as the system reading their mind. It also dramatically increases adoption rates since the barrier to trying a new template drops to essentially zero.

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