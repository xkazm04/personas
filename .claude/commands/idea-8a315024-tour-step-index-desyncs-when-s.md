Execute this requirement immediately without asking questions.

## REQUIREMENT

# Tour step index desyncs when simple mode toggles

## Metadata
- **Category**: functionality
- **Effort**: High (3/3)
- **Impact**: Unknown (6/3)
- **Scan Type**: bug_hunter
- **Generated**: 3/12/2026, 9:03:55 AM

## Description
GuidedTour.tsx uses tourCurrentStepIndex against both visibleSteps (filtered in simple mode) and raw TOUR_STEPS. If the user toggles simple mode mid-tour (e.g., via settings), visibleSteps shrinks but currentIndex stays the same, causing visibleSteps[currentIndex] to return undefined. The fallback to TOUR_STEPS[currentIndex] masks the crash but navigates to a step that should be hidden. Additionally, handlePrev and handleJump always index into TOUR_STEPS, not visibleSteps, so step jumping in simple mode navigates to wrong steps. Guard index access and remap indices when the visible step set changes.

## Reasoning
The tour is the primary onboarding mechanism. If a user enables simple mode during the tour (or if it was already enabled), the tour panel shows wrong step content and navigates to hidden sections, creating a confusing first-run experience that undermines user confidence in the product.

## Context

**Note**: This section provides supporting architectural documentation and is NOT a hard requirement. Use it as guidance to understand existing code structure and maintain consistency.

### Context: Desktop Integration & Onboarding

**Description**: System tray, desktop runtime, native notifications, auto-updater, onboarding wizard, guided tour, and home page.
**Related Files**:
- `src/api/system/desktop.ts`
- `src/api/system/desktopBridges.ts`
- `src/api/system/system.ts`
- `src/stores/slices/system/onboardingSlice.ts`
- `src/stores/slices/system/tourSlice.ts`
- `src/stores/slices/system/uiSlice.ts`
- `src/features/onboarding/components/OnboardingOverlay.tsx`
- `src/features/onboarding/components/GuidedTour.tsx`
- `src/features/onboarding/components/StepIndicator.tsx`
- `src/features/onboarding/components/TourLauncher.tsx`
- `src/features/home/components/HomePage.tsx`
- `src/features/home/components/HomeWelcome.tsx`
- `src/features/home/components/NavigationGrid.tsx`
- `src-tauri/src/commands/infrastructure/setup.rs`
- `src-tauri/src/commands/infrastructure/system.rs`
- `src-tauri/src/commands/credentials/desktop.rs`
- `src-tauri/src/commands/credentials/desktop_bridges.rs`
- `src-tauri/src/engine/desktop_runtime.rs`
- `src-tauri/src/engine/desktop_bridges.rs`
- `src-tauri/src/engine/desktop_discovery.rs`
- `src-tauri/src/tray.rs`
- `src-tauri/src/notifications.rs`
- `src/App.tsx`
- `src/main.tsx`

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