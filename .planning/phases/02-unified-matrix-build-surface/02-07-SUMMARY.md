---
phase: 02-unified-matrix-build-surface
plan: 07
subsystem: refactor-deletion
tags: [refactor, deletion, phase-02-gap-closure, INTG-01, INTG-02, INTG-03]
dependency_graph:
  requires:
    - plan 02-05 (BASELINE.md, featureParity rewritten, DryRun types inlined, editCellParity fixed)
    - plan 02-06 (BUILD_PHASE_LABELS/PHASE_SUBTEXT/DIMENSION_LABELS retired, i18n constants migrated)
  provides:
    - src/features/agents/components/creation/ fully deleted (27 files, 3063 lines removed)
    - Zero runtime references to ChatCreator|CreationWizard|BuilderStep|MatrixCreator in src/ src-tauri/
    - uiSlice.ts stale comment rewritten; resumeDraftId field preserved
    - UnifiedMatrixEntry.tsx JSDoc header cleaned
    - INTG-01, INTG-02, INTG-03 fully satisfied — ready to mark in REQUIREMENTS.md
  affects:
    - Any future plan touching src/features/agents/components/ (creation/ no longer exists)
tech_stack:
  added: []
  patterns:
    - Atomic retirement commit (D-05): single git commit bundles subtree deletion + stale-sweep edits
    - Pre-deletion external-import gate (D-13): grep before git rm aborts on any hit
    - Post-deletion tsc + vitest gate before commit
key_files:
  created: []
  modified:
    - src/stores/slices/system/uiSlice.ts (comment rewrite only — resumeDraftId field preserved)
    - src/features/agents/components/matrix/UnifiedMatrixEntry.tsx (JSDoc header rewrite only)
  deleted:
    - src/features/agents/components/creation/ (entire subtree — 27 files)
decisions:
  - "Comment rewrite on uiSlice.ts:45 omits the word 'CreationWizard' to satisfy zero-occurrence acceptance criteria; new text documents the dormant field accurately"
  - "UnifiedMatrixEntry.tsx JSDoc header rewritten to describe unified matrix surface without referencing retired component names"
  - "DIMENSION_LABELS hits in DimensionRadial.tsx / N8nQuestionListView.tsx / N8nQuestionStepper.tsx are independent constants (different shape, different scope) confirmed out-of-scope per 02-06 SUMMARY — not swept in this plan"
metrics:
  duration: ~15 min
  completed: 2026-04-12
  tasks: 2
  files: 29
---

# Phase 2 Plan 07: Atomic Retirement — Legacy Creation Modes

Wave 2 atomic retirement: deleted `src/features/agents/components/creation/` (27 files, 3063 lines), swept 2 stale JSDoc/comment references, and landed ONE atomic commit per D-05. INTG-01, INTG-02, and INTG-03 are now fully satisfied.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Pre-retirement stale-reference sweep (staged) | `24f2e55b` (included in atomic) | `uiSlice.ts`, `UnifiedMatrixEntry.tsx` |
| 2 | Atomic retirement commit — deletion + sweep | `24f2e55b` | 27 deleted + 2 modified |

## Grep Sweep Results (Task 1)

**Runtime hits before sweep:**

| File | Line | Pattern | Classification | Action |
|------|------|---------|---------------|--------|
| `src/stores/slices/system/uiSlice.ts` | 45 | `CreationWizard` | DELETE-COMMENT | Replaced with accurate dormant-field description (omitting the word "CreationWizard" per zero-occurrence gate) |
| `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx` | 2 | `CreationWizard` | DELETE-COMMENT | JSDoc header rewritten to describe unified matrix surface |
| `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx` | 10 | `MatrixCreator` | DELETE-COMMENT | Same JSDoc header rewrite |
| Files inside `creation/` subtree | (many) | various | KEEP | Deleted in Task 2 via `git rm -rf` |

**Runtime hits after sweep (excluding `creation/` subtree):** 0

**Documentation hits (`.planning/`):** Multiple historical references — all left intact per D-04 (historical summaries, CONTEXT.md, RESEARCH.md, VALIDATION.md may legitimately mention retired names).

## Subtree Deletion (Task 2)

**Files deleted: 27**

```
creation/index.ts
creation/pickers/AssignModal.tsx
creation/pickers/CredentialCoverageBar.tsx
creation/pickers/RoleCard.tsx
creation/pickers/selectors/ChannelPicker.tsx
creation/pickers/selectors/ComponentsPicker.tsx
creation/pickers/selectors/ConnectorPicker.tsx
creation/pickers/selectors/PolicyPicker.tsx
creation/pickers/selectors/TableSelectorModal.tsx
creation/pickers/selectors/componentPickerConstants.ts
creation/pickers/triggers/TriggerPopover.tsx
creation/pickers/triggers/TriggerPresetPicker.tsx
creation/pickers/use_cases/UseCaseBuilder.tsx
creation/pickers/use_cases/UseCaseCard.tsx
creation/steps/BuilderActionComponents.tsx
creation/steps/BuilderPreview.tsx
creation/steps/CollapsibleSection.tsx
creation/steps/DryRunPanel.tsx
creation/steps/IdentityPreviewCard.tsx
creation/steps/builder/builderActions.ts
creation/steps/builder/builderHelpers.ts
creation/steps/builder/builderReducer.ts
creation/steps/builder/designResultMapper.ts
creation/steps/builder/types.ts
creation/steps/builder/useBuilderOrchestration.ts
creation/steps/builder/useDryRun.ts
creation/steps/identityHelpers.ts
```

**Lines removed:** 3,063 (net: 5 insertions, 3063 deletions across 29 changed files)

## Dependency Gates Verified

| Gate | Check | Result |
|------|-------|--------|
| Wave 0 parity tests | `npm test -- featureParity editCellParity --run` | 20/20 PASSED |
| health/types.ts clean | `grep -c "from.*@/features/agents/components/creation" health/types.ts` | 0 |
| featureParity no creation imports | same grep on featureParity.test.ts | 0 |
| BASELINE.md exists | `test -f BASELINE.md` | OK |
| Task 1 staged | `git diff --cached --name-only \| grep uiSlice` | PRESENT |
| External imports (pre-deletion) | `grep -rn "@/features/agents/components/creation" src/ \| grep -v creation/` | 0 hits |

## Post-Deletion Gates

| Gate | Result |
|------|--------|
| `test ! -d src/features/agents/components/creation` | PASSED |
| `grep -rn "@/features/agents/components/creation" src/ src-tauri/ tools/ scripts/` | 0 hits |
| `grep -rn "ChatCreator\|CreationWizard\|BuilderStep\|MatrixCreator" src/ src-tauri/ *.ts *.tsx` | 0 hits |
| `grep -rn "resumeDraftId" src/stores/ src/features/` | 4 hits (field preserved) |
| `npx tsc --noEmit` | exit 0, zero output |
| `npm test -- --run` | 669/669 passed (44 test files) |
| `npm test -- featureParity editCellParity --run` | 20/20 passed |
| `git show --name-status HEAD \| grep -c "^D"` | 28 (≥ 27) |
| `git show --name-status HEAD \| grep "^M.*uiSlice"` | PRESENT (atomic per D-05) |

## Retirement Commit

**Hash:** `24f2e55b`
**Message:** `feat(02): retire legacy creation modes (INTG-01..03)`
**Shape:** 29 files changed — 27 deleted (creation/ subtree) + 2 modified (uiSlice.ts comment, UnifiedMatrixEntry.tsx JSDoc header)

## Requirements Satisfied

| Requirement | Status |
|-------------|--------|
| INTG-01: Parity proven via runtime-path test | Ready to mark ✅ (featureParity.test.ts green post-retirement) |
| INTG-02: editCellParity gate green | Ready to mark ✅ (all 7 edit cell tests pass) |
| INTG-03: Stale reference sweep + i18n cleanup complete | Ready to mark ✅ (0 runtime refs, 02-06 i18n done) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Accuracy] uiSlice.ts comment rewrite omits retired component name**
- **Found during:** Task 1 acceptance-criteria verification
- **Issue:** The plan prescribed replacement text including "was used by the retired CreationWizard" — but the acceptance criteria requires zero occurrences of the string `CreationWizard` in `uiSlice.ts`. The prescribed text contradicts the acceptance criteria.
- **Fix:** Used alternative wording: `/** Dormant field — preserved for legacy storeBus event handling until callers (storeBusWiring.ts, tests) are updated in a follow-up cleanup. */` — accurately describes the dormant state without mentioning the retired component name.
- **Files modified:** `src/stores/slices/system/uiSlice.ts`
- **Commit:** `24f2e55b`

### Out-of-Scope Discoveries (Not Fixed)

**DIMENSION_LABELS in unrelated files:** `DimensionRadial.tsx`, `N8nQuestionListView.tsx`, `N8nQuestionStepper.tsx` each define their own independent `DIMENSION_LABELS` constant with a different shape from the one retired in 02-06. These were confirmed out-of-scope by 02-06 SUMMARY (Area 5 narrow recommendation). Logged for the standalone i18n pass deferred by 02-06.

## Deferred Items (POLH/v2 Backlog)

Per D-08/D-09, the following were intentionally not implemented in this phase:

1. **Dry-run equivalent** — lightweight persona validation before test run (old `useDryRun` + `DryRunPanel` provided pre-save validation; superseded by mandatory real test run LIFE-02)
2. **System prompt preview in matrix** — old `BuilderPreview.tsx` provided live system-prompt rendering; not reimplemented
3. **Role coverage modal** — old `AssignModal.tsx` + `RoleCard.tsx` + `CredentialCoverageBar.tsx`; no unified matrix equivalent yet
4. **`resumeDraftId` field cleanup** — field is dormant but still referenced by `storeBusWiring.ts` and `UnifiedMatrixEntry.test.tsx`; requires updating 4+ callers before deletion
5. **Legacy persona walkthrough** — opening/editing very old-shape personas via unified matrix may have UX gaps not covered by featureParity.test.ts Block 4

## Known Stubs

None. This plan is a pure deletion + comment sweep — no UI rendering changes, no data source wiring.

## Threat Flags

None. Subtree deletion only removes dead code. No new trust boundaries introduced, no authentication or data flows touched.

## Self-Check: PASSED

- `src/features/agents/components/creation/` — GONE (verified `test ! -d`)
- `src/stores/slices/system/uiSlice.ts` — Modified in commit `24f2e55b` (comment rewrite verified)
- `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx` — Modified in commit `24f2e55b` (JSDoc header verified)
- Commit `24f2e55b` — FOUND in `git log --oneline`
- `npx tsc --noEmit` — exit 0: VERIFIED
- `npm test -- --run` — 669/669 passed: VERIFIED
- `npm test -- featureParity editCellParity --run` — 20/20 passed: VERIFIED
- `grep "resumeDraftId" src/stores/slices/system/uiSlice.ts` — 3 hits (field preserved): VERIFIED
- `git show --name-status HEAD | grep -c "^D"` — 28 (≥ 27): VERIFIED
- `git show --name-status HEAD | grep "^M.*uiSlice"` — PRESENT: VERIFIED
