---
phase: 02-unified-matrix-build-surface
plan: 06
subsystem: i18n
tags: [i18n, phase-02-gap-closure, INTG-03]
dependency_graph:
  requires:
    - plan 02-05 (BASELINE.md, clean tsc, featureParity + editCellParity green)
  provides:
    - 4 new phase_subtext_* keys under t.templates.matrix.* in en.ts
    - BUILD_PHASE_LABELS retired (0 source references)
    - PHASE_SUBTEXT retired (0 source references)
    - DIMENSION_LABELS retired from SpatialQuestionPopover.tsx
    - MatrixCommandCenterParts.tsx resolves phase labels via useTranslation()
    - SpatialQuestionPopover.tsx resolves dimension labels via t.templates.matrix.dim_*
    - UnifiedMatrixEntry.tsx error-banner dismiss uses t.errors.dismiss_error
  affects:
    - plan 02-07 (retirement commit — i18n cleanup complete, no conflicting constants)
tech_stack:
  added: []
  patterns:
    - Inline i18n map inside function body (PHASE_TO_I18N, DIM_I18N_MAP) — map references t, so must live inside hook scope
    - useTranslation() added to ActiveBuildProgress component in MatrixCommandCenterParts.tsx
key_files:
  created: []
  modified:
    - src/i18n/en.ts
    - src/features/templates/sub_generated/gallery/matrix/matrixBuildConstants.ts
    - src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenterParts.tsx
    - src/features/agents/components/matrix/SpatialQuestionPopover.tsx
    - src/features/agents/components/matrix/UnifiedMatrixEntry.tsx
decisions:
  - "Deleted BUILD_PHASE_LABELS and PHASE_SUBTEXT outright (Area 3 narrow recommendation — 1 and 0 call sites respectively)"
  - "DIMENSION_LABELS deleted from SpatialQuestionPopover.tsx only; other files (DimensionRadial.tsx, N8nQuestionListView.tsx, N8nQuestionStepper.tsx) define their own independent constants with the same name — out of scope per Area 5"
  - "dismiss_error key lives at t.errors.dismiss_error (not t.common.dismiss_error as plan stated) — fixed automatically (Rule 1)"
metrics:
  duration: ~10 min
  completed: 2026-04-12
  tasks: 2
  files: 5
---

# Phase 2 Plan 06: i18n Cleanup — Wave 1

Wave 1 i18n cleanup: 4 new `phase_subtext_*` keys added, `BUILD_PHASE_LABELS` and `PHASE_SUBTEXT` constants deleted, `MatrixCommandCenterParts.tsx` migrated to `useTranslation()`, `DIMENSION_LABELS` deleted from `SpatialQuestionPopover.tsx`, and error-banner dismiss updated to `t.errors.dismiss_error`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add phase_subtext_* keys + migrate MatrixCommandCenterParts + delete constants | `a143aa21` | `en.ts`, `matrixBuildConstants.ts`, `MatrixCommandCenterParts.tsx` |
| 2 | Migrate DIMENSION_LABELS + dismiss_error to i18n | `45353a7e` | `SpatialQuestionPopover.tsx`, `UnifiedMatrixEntry.tsx` |

## Exact Lines Added to `src/i18n/en.ts`

Inserted after `build_failed: "Build failed",` at line 5942, before `// Cell dimension labels`:

```typescript
      // Phase subtext hints — longer descriptions shown under the build phase label.
      // Used by BuildStatusIndicator.hint prop in the command center.
      // Keep concise (under 8 words) and end with an ellipsis or period.
      phase_subtext_analyzing: "Understanding your intent...",
      phase_subtext_resolving: "Building agent configuration...",
      // Sub-text displayed when the build is paused waiting for user dimension answers.
      phase_subtext_awaiting_input: "Your input is needed — click a highlighted dimension",
      // Sub-text displayed when all dimensions are resolved and ready for test.
      phase_subtext_draft_ready: "All dimensions resolved — ready for testing",
```

## Per-File Diffs Summary

### `matrixBuildConstants.ts`
- Deleted `BUILD_PHASE_LABELS` constant (lines 3–14, 9-entry object with hardcoded English phase labels)
- Deleted `PHASE_SUBTEXT` constant (lines 28–34, 4-entry object with hardcoded English phase subtext)
- Retained: `CELL_FRIENDLY_NAMES`, `ORB_GLOW_CLASSES`, `export type { BuildPhase }`

### `MatrixCommandCenterParts.tsx`
- Added `import { useTranslation } from '@/i18n/useTranslation'`
- Removed `BUILD_PHASE_LABELS` from local import of `matrixBuildConstants`
- Removed backward-compat re-exports of `BUILD_PHASE_LABELS` and `PHASE_SUBTEXT`
- Added `const { t } = useTranslation()` inside `ActiveBuildProgress` function body
- Replaced `BUILD_PHASE_LABELS[buildPhase ?? 'analyzing'] ?? 'Building...'` with inline `PHASE_TO_I18N` map resolving via `t.templates.matrix.*`

### `SpatialQuestionPopover.tsx`
- Deleted `DIMENSION_LABELS` constant (lines 16–25, 8-entry object duplicating `t.templates.matrix.dim_*`)
- Added inline `DIM_I18N_MAP` inside `QuestionModal` function body (after `const { t, tx } = useTranslation()`)
- `dimensionLabel` now resolves via `DIM_I18N_MAP[question.cellKey] ?? question.cellKey`

### `UnifiedMatrixEntry.tsx`
- Changed error-banner dismiss button from `{t.common.dismiss}` to `{t.errors.dismiss_error}`

## Grep Counts Before/After

| Constant | Before | After (source files only) |
|----------|--------|--------------------------|
| `BUILD_PHASE_LABELS` | 2 (definition + 1 call site in MatrixCommandCenterParts.tsx) | 0 |
| `PHASE_SUBTEXT` | 1 (definition only — 0 call sites) | 0 |
| `DIMENSION_LABELS` in `SpatialQuestionPopover.tsx` | 1 (definition + 1 call site, same file) | 0 |

Note: `DIMENSION_LABELS` appears in 3 other unrelated files (`DimensionRadial.tsx`, `N8nQuestionListView.tsx`, `N8nQuestionStepper.tsx`) as independent constants with the same name. These are out of scope per Area 5 narrow recommendation and were not touched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect i18n key path for dismiss_error**
- **Found during:** Task 2 validation (`npx tsc --noEmit` returned error TS2339)
- **Issue:** The plan specified `t.common.dismiss_error` but `dismiss_error` lives under `t.errors.dismiss_error` (en.ts line 7970, inside the `errors:` section). `t.common` has `dismiss` but not `dismiss_error`.
- **Fix:** Changed `{t.common.dismiss_error}` to `{t.errors.dismiss_error}` in `UnifiedMatrixEntry.tsx`
- **Files modified:** `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx`
- **Commit:** `45353a7e` (same task commit)

## Final Verification

All plan gate checks passed:

```
# 1. New keys exist
grep -q "phase_subtext_analyzing" src/i18n/en.ts && echo "OK"   # OK: 4 new keys present

# 2. Retired constants gone (source files)
grep -rn "BUILD_PHASE_LABELS|PHASE_SUBTEXT" src/ --include="*.ts" --include="*.tsx"
  (no output — 0 source matches)

grep -c "DIMENSION_LABELS" src/features/agents/components/matrix/SpatialQuestionPopover.tsx
  0

# 3. Call sites use i18n
grep -q "t\.templates\.matrix" MatrixCommandCenterParts.tsx          # present
grep -q "t\.templates\.matrix\.dim_tasks" SpatialQuestionPopover.tsx # present
grep -c "t\.errors\.dismiss_error" UnifiedMatrixEntry.tsx            # 1

# 4. Typecheck + tests green
npx tsc --noEmit    → exit 0 (no errors)
npm test -- --run   → 44 test files passed, 669 tests passed

# 5. Locale parity
node scripts/check-locale-parity.mjs  → completes without structural errors
                                        (missing keys in non-English locales are expected)
```

## Known Stubs

None. This plan is a pure i18n string-source migration — no UI rendering changes, no data source changes.

## Threat Flags

None. Pure UI string resolution refactor with no new trust boundaries.

## Follow-up Note

~12 additional hardcoded strings exist in matrix dirs (`MatrixCommandCenter.tsx`, `TestReportModal.tsx`, and others) — deferred per Area 5 narrow recommendation. Tracked for a standalone i18n pass. The `DIMENSION_LABELS` constant in `DimensionRadial.tsx`, `N8nQuestionListView.tsx`, and `N8nQuestionStepper.tsx` are independent constants (different shape, different scope) — also deferred to that same i18n pass.

## Self-Check: PASSED

- `src/i18n/en.ts` — phase_subtext_* keys present: VERIFIED
- `src/features/templates/sub_generated/gallery/matrix/matrixBuildConstants.ts` — BUILD_PHASE_LABELS and PHASE_SUBTEXT absent: VERIFIED
- `src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenterParts.tsx` — useTranslation + t.templates.matrix.*: VERIFIED
- `src/features/agents/components/matrix/SpatialQuestionPopover.tsx` — DIMENSION_LABELS absent, DIM_I18N_MAP with t.templates.matrix.dim_*: VERIFIED
- `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx` — t.errors.dismiss_error: VERIFIED
- Commit `a143aa21` — FOUND in git log
- Commit `45353a7e` — FOUND in git log
- `npx tsc --noEmit` — exit 0: VERIFIED
- `npm test -- --run` — 669/669 passed: VERIFIED
