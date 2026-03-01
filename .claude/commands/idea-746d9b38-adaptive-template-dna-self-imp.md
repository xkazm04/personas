Execute this requirement immediately without asking questions.

## REQUIREMENT

# Adaptive Template DNA: Self-Improving Gallery

## Metadata
- **Category**: functionality
- **Effort**: Unknown (9/3)
- **Impact**: Unknown (10/3)
- **Scan Type**: moonshot_architect
- **Generated**: 3/1/2026, 5:09:30 PM

## Description
Introduce a template DNA system where every adopted template carries a genome � a structured encoding of its behavioral traits (trigger patterns, connector dependencies, prompt strategies, error handling approaches). After each persona execution, the system collects performance telemetry (success rate, latency, user satisfaction from manual reviews, memory quality) and feeds it back to the template genome. Over time, templates evolve: high-performing genes propagate to related templates, low-performing traits are flagged and auto-revised. The gallery surface shows a live fitness score alongside the existing 9-dimension radial, and users can sort by real-world performance rather than structural completeness alone.

## Reasoning
The current scoring system (DimensionRadial) measures template structure, not real-world performance. A template can score 9/9 dimensions but fail miserably in production. Template DNA closes the feedback loop: templates that actually work rise to the top, and templates that struggle get automatically improved. This creates a self-healing gallery where quality compounds over time without manual curation. After thousands of executions, the gallery becomes an empirically-validated automation library � something no competitor has.

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