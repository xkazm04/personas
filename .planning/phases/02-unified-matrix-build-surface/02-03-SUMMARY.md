---
phase: 02-unified-matrix-build-surface
plan: 03
subsystem: ui
tags: [react, framer-motion, tailwind, progressive-reveal, ghosted-cells, matrix, cell-state-machine]

# Dependency graph
requires:
  - phase: 02-unified-matrix-build-surface
    plan: 01
    provides: CELL_LABELS vocabulary, getCellStateClasses helper, CellBuildStatus type
  - phase: 02-unified-matrix-build-surface
    plan: 02
    provides: useMatrixBuild hook with cellStates and completeness
provides:
  - GhostedCellRenderer component for blueprint-style cell outlines during build
  - PersonaMatrix cell state awareness with progressive reveal driven by cellBuildStates prop
  - AnimatePresence-wrapped cell content transitions
  - CELL_LABELS integration replacing hardcoded label strings (3 renamed per VISL-05)
affects: [02-04 (spatial Q&A popover anchoring), 02-05 (mode retirement), progressive-reveal, build-surface]

# Tech tracking
tech-stack:
  added: []
  patterns: [ghosted-cell-rendering, state-machine-driven-cell-classes, animate-presence-content-mount, skeleton-cells-before-designResult]

key-files:
  created:
    - src/features/agents/components/matrix/GhostedCellRenderer.tsx
    - src/features/agents/components/matrix/__tests__/GhostedCellRenderer.test.tsx
    - src/features/agents/components/matrix/__tests__/completenessRing.test.ts
  modified:
    - src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx

key-decisions:
  - "GhostedCellRenderer renders hidden/revealed cells; MatrixCellRenderer delegates to it based on cellBuildStatus prop"
  - "Skeleton cells with CELL_LABELS created when cellBuildStates present but designResult is null, enabling ghosted outlines before CLI produces content"
  - "AnimatePresence wraps cell content with opacity+translate animation for smooth ghosted-to-active transitions"
  - "transition-all replaced with explicit transition-[opacity,transform,border-color,background-color] to avoid animating box-shadow (anti-pattern from research)"

patterns-established:
  - "Ghosted cell pattern: hidden/revealed statuses render GhostedCellRenderer; all other statuses render normal MatrixCellRenderer with state classes"
  - "State-class override: when cellBuildStatus provided, getCellStateClasses provides border/bg/opacity classes replacing defaults"
  - "Skeleton cells: CELL_LABELS + icons create renderable cells even before designResult arrives"

requirements-completed: [MTRX-02, MTRX-04, MTRX-08]

# Metrics
duration: 16min
completed: 2026-03-14
---

# Phase 2 Plan 03: Progressive Reveal Summary

**GhostedCellRenderer for blueprint cell outlines and PersonaMatrix cell state integration with CELL_LABELS vocabulary and AnimatePresence content transitions**

## Performance

- **Duration:** 16 min
- **Started:** 2026-03-14T10:53:23Z
- **Completed:** 2026-03-14T11:09:52Z
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 1

## Accomplishments
- GhostedCellRenderer renders blueprint-style ghosted outlines with faded labels and watermark icons for hidden/revealed build states
- PersonaMatrix now accepts cellBuildStates prop driving progressive cell reveal -- cells transition from ghosted outlines to active content as CLI resolves dimensions
- All 8 cell labels use CELL_LABELS from cellVocabulary.ts (3 renamed per VISL-05: Tasks, Apps & Services, When It Runs)
- AnimatePresence wraps cell content for smooth opacity+translate animation when cells transition from ghosted to active
- transition-all replaced with explicit property transition list across MatrixCellRenderer (anti-pattern fix)
- 17 new tests (9 GhostedCellRenderer + 8 completeness ring), all 75 matrix tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: GhostedCellRenderer component** - `ababa7c` (feat) -- TDD: test + implementation
2. **Task 2: Wire cell state machine and vocabulary into PersonaMatrix** - `0628522` (feat)
3. **Linter fixes** - `7a6e3a4` (chore) -- nullish coalescing fallbacks on CELL_LABELS lookups

## Files Created/Modified
- `src/features/agents/components/matrix/GhostedCellRenderer.tsx` - Blueprint-style ghosted cell renderer for hidden/revealed build states
- `src/features/agents/components/matrix/__tests__/GhostedCellRenderer.test.tsx` - 9 tests: label rendering, opacity, borders, watermark, transitions
- `src/features/agents/components/matrix/__tests__/completenessRing.test.ts` - 8 tests: completeness percentage from resolved cell counts
- `src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx` - Cell state awareness, CELL_LABELS integration, AnimatePresence, GhostedCellRenderer delegation, new props (cellBuildStates, pendingQuestions, onAnswerBuildQuestion)

## Decisions Made
- GhostedCellRenderer used as a separate component (not inline conditional) for clean separation of ghosted vs active rendering
- Skeleton cells created when cellBuildStates present but designResult is null -- this enables the ghosted outlines to appear immediately when a build starts, before the CLI has produced any content
- AnimatePresence with mode="wait" used for content mount animation (opacity 0->1, y 4->0) with 300ms ease-out timing
- `transition-all` replaced with explicit `transition-[opacity,transform,border-color,background-color]` to prevent box-shadow animation per research findings
- effectiveBuildLocked computed from both buildLocked prop and cellBuildStatus === 'filling' so cells in filling state are automatically locked

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- SVG elements in jsdom return SVGAnimatedString for className instead of string -- fixed test to use getAttribute('class') instead of className property
- Linter added nullish coalescing fallbacks to CELL_LABELS lookups in skeleton cells and a type cast for cellBuildStatus comparison -- committed as separate chore

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- PersonaMatrix now supports full progressive reveal flow -- cells start as ghosted outlines and come alive as CLI resolves dimensions
- pendingQuestions and onAnswerBuildQuestion props are wired through but not yet rendered as popovers (Plan 04 scope)
- Spatial Q&A popover anchoring can reference cellBuildStates to find highlighted cells
- All 7 existing edit cell components remain functional for resolved cells -- no edit capabilities removed

## Self-Check: PASSED

- [x] src/features/agents/components/matrix/GhostedCellRenderer.tsx -- FOUND
- [x] src/features/agents/components/matrix/__tests__/GhostedCellRenderer.test.tsx -- FOUND
- [x] src/features/agents/components/matrix/__tests__/completenessRing.test.ts -- FOUND
- [x] src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx -- FOUND
- [x] Commit ababa7c -- FOUND
- [x] Commit 0628522 -- FOUND
- [x] Commit 7a6e3a4 -- FOUND

---
*Phase: 02-unified-matrix-build-surface*
*Completed: 2026-03-14*
