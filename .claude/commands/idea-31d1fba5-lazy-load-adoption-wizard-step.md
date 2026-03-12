Execute this requirement immediately without asking questions.

## REQUIREMENT

# Lazy-load adoption wizard step content on navigation

## Metadata
- **Category**: performance
- **Effort**: High (3/3)
- **Impact**: Unknown (5/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:28:34 PM

## Description
AdoptionWizardModal.tsx renders all wizard steps (CreateIdentityCard, TuneStep, TemplateReviewStep, AdoptConfirmStep) simultaneously and toggles visibility. Instead, use React.lazy with Suspense per step so only the active step component bundle loads. Combine with skeleton placeholders during step transitions to maintain perceived speed.

## Reasoning
The adoption wizard is opened infrequently but pulls in heavy components like DesignResultPreview and ScanResultsBanner. Lazy-loading steps reduces initial modal open time and memory footprint. Users only proceed through 4 steps sequentially, so loading on-demand is natural and eliminates wasted work for users who abandon early.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Template Gallery & Adoption

**Description**: Template gallery with search, filtering, preview modals, adoption wizard with multi-step flow, design preview, and template feedback.
**Related Files**:
- `src/api/templates/templateAdopt.ts`
- `src/api/templates/templateFeedback.ts`
- `src/api/templates/design.ts`
- `src/features/templates/sub_generated/gallery/cards/renderers/TemplateCard.tsx`
- `src/features/templates/sub_generated/gallery/cards/renderers/TemplateCardBody.tsx`
- `src/features/templates/sub_generated/gallery/modals/TemplatePreviewModal.tsx`
- `src/features/templates/sub_generated/gallery/search/filters/FilterChips.tsx`
- `src/features/templates/sub_generated/gallery/explore/RecommendedCarousel.tsx`
- `src/features/templates/sub_generated/adoption/AdoptionWizardModal.tsx`
- `src/features/templates/sub_generated/adoption/AdoptConfirmStep.tsx`
- `src/features/templates/sub_generated/adoption/review/TemplateReviewStep.tsx`
- `src/features/templates/sub_generated/adoption/steps/create/CreateIdentityCard.tsx`
- `src/features/templates/sub_generated/adoption/steps/tune/TuneStep.tsx`
- `src/features/templates/sub_generated/design-preview/DesignResultPreview.tsx`
- `src/features/templates/sub_generated/generation/modals/CreateTemplateModal.tsx`
- `src/features/templates/sub_generated/shared/TrustBadge.tsx`
- `src/features/templates/sub_generated/shared/ScanResultsBanner.tsx`
- `src/features/templates/components/DesignReviewsPage.tsx`
- `src-tauri/src/commands/design/template_adopt.rs`
- `src-tauri/src/commands/design/template_feedback.rs`
- `src-tauri/src/commands/design/reviews.rs`
- `src-tauri/src/db/models/template_feedback.rs`
- `src-tauri/src/db/repos/communication/template_feedback.rs`

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