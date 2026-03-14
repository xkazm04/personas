---
phase: 04-visual-polish-and-performance
plan: 01
subsystem: ui
tags: [css, animations, keyframes, glow, color-mix, pseudo-elements, reduced-motion]

# Dependency graph
requires:
  - phase: 02-unified-matrix-build-surface
    provides: CellStateConfig interface and CELL_STATE_CLASSES mapping
provides:
  - CSS keyframes for glow-pulse, glow-breathe, emerald-flash, spin-glow animations
  - Pseudo-element glow base class with compositor-only opacity animation
  - Edge shimmer class with rotating conic-gradient mask
  - 8 theme-tinted glow color classes using color-mix
  - cellGlowColors.ts mapping cell keys to glow color CSS classes
  - Extended CellStateConfig with glow and watermarkOpacity fields
affects: [04-02, 04-03]

# Tech tracking
tech-stack:
  added: []
  patterns: [pseudo-element-overlay-glow, compositor-only-opacity-animation, color-mix-theme-tinting, conic-gradient-edge-shimmer]

key-files:
  created:
    - src/features/agents/components/matrix/cellGlowColors.ts
    - src/features/agents/components/matrix/__tests__/cellGlowColors.test.ts
    - src/features/agents/components/matrix/__tests__/cellStateClasses.test.ts
  modified:
    - src/styles/globals.css
    - src/features/agents/components/matrix/cellStateClasses.ts

key-decisions:
  - "Pseudo-element glow uses static box-shadow with animated opacity for compositor-only performance (no paint per frame)"
  - "Edge shimmer uses conic-gradient with mask-composite exclude for 1.5px border shimmer effect"
  - "Reduced-motion overrides disable animation timing while preserving static glow opacity values"

patterns-established:
  - "Glow overlay pattern: .cell-glow base + state modifier (e.g., .cell-glow-filling) + color class (e.g., .cell-glow-violet)"
  - "Theme tinting via color-mix(in srgb, base-color 70%, var(--primary) 30%) for consistent brand integration"

requirements-completed: [VISL-01, VISL-02, VISL-04]

# Metrics
duration: 5min
completed: 2026-03-14
---

# Phase 04 Plan 01: CSS Glow Foundation Summary

**CSS glow system with 4 keyframes, pseudo-element overlays, 8 theme-tinted color classes, and extended CellStateConfig mappings**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-14T19:24:17Z
- **Completed:** 2026-03-14T19:29:06Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Built complete CSS animation foundation with 4 keyframes (glow-pulse, glow-breathe, emerald-flash, spin-glow)
- Implemented compositor-only pseudo-element glow pattern avoiding box-shadow animation for performance
- Created 8 theme-tinted glow color classes using color-mix with --primary integration
- Extended CellStateConfig with glow and watermarkOpacity fields across all 7 cell states
- Added edge shimmer effect with rotating conic-gradient mask composite
- Added reduced-motion overrides preserving static glow while disabling animation timing

## Task Commits

Each task was committed atomically:

1. **Task 1: CSS keyframes, pseudo-element glow classes, and glow color utility classes** - `f31a997` (feat)
2. **Task 2 RED: Failing tests for cellGlowColors and cellStateClasses** - `4d1047e` (test)
3. **Task 2 GREEN: cellGlowColors mapping and CellStateConfig extension** - `33da38d` (feat)

## Files Created/Modified
- `src/styles/globals.css` - 4 keyframes, glow base/state classes, edge shimmer, 8 color classes, utility animations, reduced-motion overrides
- `src/features/agents/components/matrix/cellGlowColors.ts` - Cell key to glow color CSS class mapping (8 entries)
- `src/features/agents/components/matrix/cellStateClasses.ts` - Extended CellStateConfig with glow and watermarkOpacity fields
- `src/features/agents/components/matrix/__tests__/cellGlowColors.test.ts` - 10 tests for glow color mappings
- `src/features/agents/components/matrix/__tests__/cellStateClasses.test.ts` - 14 tests for glow and watermarkOpacity fields

## Decisions Made
- Used pseudo-element ::before for glow with static box-shadow and animated opacity only (compositor-only, no paint per frame)
- Edge shimmer uses ::after with conic-gradient and mask-composite: exclude for thin border rotation effect
- Reduced-motion overrides set animation-duration/delay to 0s while keeping static opacity values intact (per user decision: "instant transitions, keep glow")

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TS error in devTools.ts (unrelated to plan changes) prevented full `tsc -b && vite build` verification; CSS validity confirmed through vite processing and all 169 matrix tests passing

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CSS glow foundation complete; Plan 02 can wire glow classes into matrix cell components
- cellGlowColors.ts provides the mapping for attaching color classes to cells by key
- CellStateConfig.glow and .watermarkOpacity ready for consumption in GhostedCellRenderer and MatrixCellRenderer

---
*Phase: 04-visual-polish-and-performance*
*Completed: 2026-03-14*
