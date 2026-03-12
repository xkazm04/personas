Execute this requirement immediately without asking questions.

## REQUIREMENT

# Memoize connector readiness in gallery card renders

## Metadata
- **Category**: performance
- **Effort**: Medium (2/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: perf_optimizer
- **Generated**: 3/12/2026, 3:28:27 PM

## Description
deriveConnectorReadiness() is called without useMemo in useTemplateCardData.ts for every card on every render. It performs O(n*m) lookups where readinessStatuses.find() runs inside connectors.map() in TemplateCardBody. Wrap the readiness derivation in useMemo with stable dependencies, and replace the .find() lookups with a Map keyed by connector name for O(1) access.

## Reasoning
With 50+ gallery cards each containing 3-8 connectors, the current O(n*m) pattern generates thousands of unnecessary iterations per render cycle. Converting to memoized O(n) with Map lookups makes the gallery feel instant when scrolling or filtering, especially on lower-end devices.

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