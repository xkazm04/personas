---
phase: 02-unified-matrix-build-surface
verified: 2026-04-12T02:15:00Z
status: human_needed
score: 13/13 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open a pre-unified-matrix persona (created before 2026-03-14), click a resolved cell, edit it, save, and confirm the persona reloads correctly"
    expected: "No errors thrown; persona opens in unified matrix; cell edit persists on next open. Legacy persona shape is accepted at runtime."
    why_human: "Automated featureParity.test.ts Block 4 uses store-level seeding (useAgentStore.setState), which does not exercise real SQLite-stored legacy personas from prior app versions. Runtime SQLite deserialization of old-shape rows can only be verified with an actual prior-version persona record in the user's local DB."
  - test: "Walk the feature inventory from 02-RESEARCH.md §'Feature Inventory from Retired Modes' and confirm each retired-mode capability has a unified-matrix equivalent"
    expected: "Every user-facing flow (persona creation, connector/trigger/credential attach, inline cell edit, role assignment, refine, test, approve, reject, reopen-existing-persona) is reachable through the unified matrix surface."
    why_human: "The parity test is mechanical (component-render and store-shape assertions). It cannot catch UX-level gaps where a flow exists in code but is unreachable or confusing to a real user. VALIDATION.md §'Manual-Only Verifications' explicitly requires this walkthrough before phase close."
---

# Phase 2: Unified Matrix Build Surface — Verification Report

**Phase Goal:** Users build AI agents through a single interactive matrix where cells animate to life as the CLI resolves persona dimensions, questions appear spatially on relevant cells, and all capabilities from the retired Chat/Build/Matrix modes are preserved.

**Verified:** 2026-04-12T02:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `src/features/agents/components/creation/` directory does not exist (D-01) | VERIFIED | `test ! -d` exits 0; git shows 28 deletions in commit `24f2e55b` |
| 2 | Zero files import from `@/features/agents/components/creation` (D-13) | VERIFIED | `grep -rn "@/features/agents/components/creation" src/ tools/ scripts/` returns 0 |
| 3 | Zero runtime references to `ChatCreator\|CreationWizard\|BuilderStep\|MatrixCreator` in `.ts`/`.tsx`/`.rs` (D-04) | VERIFIED | Grep of `src/` and `src-tauri/` returns 0 hits |
| 4 | `resumeDraftId` field preserved in `uiSlice.ts` with stale CreationWizard comment removed (Risk 3) | VERIFIED | `grep resumeDraftId` returns 3 hits (interface, initial state, action body); `grep CreationWizard uiSlice.ts` returns 0 |
| 5 | `export interface DryRunResult\|DryRunIssue\|DryRunProposal` exist in `health/types.ts` (Risk 1 mitigation) | VERIFIED | All 3 interfaces found at lines 26, 34, 39 |
| 6 | `BUILD_PHASE_LABELS` and `PHASE_SUBTEXT` fully deleted — zero repo-wide references (INTG-03) | VERIFIED | `grep -rn "BUILD_PHASE_LABELS\|PHASE_SUBTEXT" src/` returns 0; matrixBuildConstants.ts count returns 0 |
| 7 | 4 new `phase_subtext_*` keys exist under `t.templates.matrix.*` in `en.ts` (INTG-03) | VERIFIED | All 4 keys found at lines 5946–5951 of `src/i18n/en.ts` |
| 8 | `MatrixCommandCenterParts.tsx` resolves phase labels via `useTranslation()` + `t.templates.matrix.*` (INTG-03) | VERIFIED | `grep t.templates.matrix MatrixCommandCenterParts.tsx` returns matches at lines 130–135+ |
| 9 | `SpatialQuestionPopover.tsx` resolves dimension labels via `t.templates.matrix.dim_*` — `DIMENSION_LABELS` deleted (INTG-03) | VERIFIED | `grep DIMENSION_LABELS SpatialQuestionPopover.tsx` returns 0; `t.templates.matrix.dim_tasks` confirmed present |
| 10 | `UnifiedMatrixEntry.tsx` error-banner dismiss uses `t.errors.dismiss_error` (plan 02-06 auto-fixed key path; plan stated `t.common.dismiss_error`, actual key is `t.errors.dismiss_error`) | VERIFIED | Line 383 of `UnifiedMatrixEntry.tsx` confirmed |
| 11 | `npx tsc --noEmit` exits 0 (D-11) | VERIFIED | Exit 0, zero output |
| 12 | `npm test --run` all 669/669 tests pass, 44/44 test files pass (D-10) | VERIFIED | 44 passed, 669 passed, 0 failed |
| 13 | `featureParity.test.ts` and `editCellParity.test.tsx` both green (20/20) with zero creation/ imports in featureParity | VERIFIED | `npm test -- featureParity editCellParity --run` → 2 files passed, 20 tests passed; grep returns 0 |

**Score:** 13/13 truths verified

---

### Deferred Items

None. All gap-closure items landed before this verification run.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/features/agents/components/creation` | Non-existence (D-01) | VERIFIED — DELETED | 28 files removed in commit `24f2e55b` |
| `.planning/phases/02-unified-matrix-build-surface/BASELINE.md` | Exists (D-12) | VERIFIED | Committed via `git add -f` in commit `978d9b30` |
| `src/features/agents/components/matrix/__tests__/featureParity.test.ts` | Rewritten with zero creation/ imports (D-02) | VERIFIED | Present; `grep "from.*@/features/agents/components/creation"` returns 0 |
| `src/features/agents/components/matrix/__tests__/editCellParity.test.tsx` | Green with lucide mock fix (INTG-02) | VERIFIED | 7/7 tests pass post-fix commit `c85e2ae8` |
| `src/features/agents/health/types.ts` | Self-contained DryRun types (Risk 1) | VERIFIED | 3 interfaces at lines 26, 34, 39; zero creation/ imports |
| `src/i18n/en.ts` | 4 new `phase_subtext_*` keys under `t.templates.matrix.*` | VERIFIED | Lines 5946–5951 confirmed |
| `src/features/templates/sub_generated/gallery/matrix/matrixBuildConstants.ts` | `BUILD_PHASE_LABELS` and `PHASE_SUBTEXT` deleted | VERIFIED | Grep returns 0 |
| `src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenterParts.tsx` | Uses `useTranslation()` + `t.templates.matrix.*` | VERIFIED | Present |
| `src/features/agents/components/matrix/SpatialQuestionPopover.tsx` | `DIMENSION_LABELS` deleted; `t.templates.matrix.dim_*` used | VERIFIED | Present |
| `src/stores/slices/system/uiSlice.ts` | Stale CreationWizard comment removed; `resumeDraftId` preserved | VERIFIED | 0 CreationWizard occurrences; 3 resumeDraftId occurrences |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `MatrixCommandCenterParts.tsx` | `en.ts` `t.templates.matrix.*` | `useTranslation()` hook inside `ActiveBuildProgress` | WIRED | `t.templates.matrix.preparing`, `.analyzing`, `.building`, etc. in inline `PHASE_TO_I18N` map |
| `SpatialQuestionPopover.tsx` | `en.ts` `t.templates.matrix.dim_*` | `useTranslation()` hook (already imported) | WIRED | `DIM_I18N_MAP` inside `QuestionModal` function body maps cell keys to 8 `dim_*` keys |
| `UnifiedMatrixEntry.tsx` | `en.ts` `t.errors.dismiss_error` | `useTranslation()` hook | WIRED | Line 383 confirmed |
| `featureParity.test.ts` | Runtime paths (`useAgentStore`, `computeCredentialCoverage` from `src/lib/validation/`) | Direct imports (no creation/ path) | WIRED | Zero creation/ imports; uses `useAgentStore.setState()` for Block 4 store seeding |
| Retirement commit `24f2e55b` | Plans 02-05 + 02-06 prerequisites | Dependency gates in plan 02-07 Task 2 sub-step 2.1 | WIRED | All 6 gate checks passed before deletion; atomic commit includes both deletion and uiSlice.ts sweep |

---

### Data-Flow Trace (Level 4)

Not applicable for this phase. Plans 02-05, 02-06, 02-07 are pure infrastructure work — type migration, i18n string-source refactor, and subtree deletion. No new data rendering surfaces were introduced. The unified matrix components (UnifiedMatrixEntry, SpatialQuestionPopover, MatrixCommandCenterParts) were wired in plans 02-02 through 02-04 and are not modified for data flow in this gap-closure run.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript clean after retirement | `npx tsc --noEmit` | Exit 0, zero output | PASS |
| All 669 tests pass | `npm test -- --run` | 44 files passed, 669 tests passed | PASS |
| featureParity + editCellParity green | `npm test -- featureParity editCellParity --run` | 2 files, 20 tests passed | PASS |
| Locale parity script completes | `node scripts/check-locale-parity.mjs` | Exit 0, only missing-key reports (expected) | PASS |
| creation/ directory gone | `test ! -d src/features/agents/components/creation` | Exit 0 | PASS |
| Zero dangling imports | `grep -rn "@/features/agents/components/creation" src/ tools/ scripts/` | 0 lines | PASS |
| Zero retired mode name refs | `grep -rn "ChatCreator\|CreationWizard\|BuilderStep\|MatrixCreator" src/ src-tauri/ *.ts *.tsx *.rs` | 0 lines | PASS |
| resumeDraftId preserved | `grep resumeDraftId uiSlice.ts` | 3 hits | PASS |
| Atomic retirement commit | `git log --oneline` | `24f2e55b feat(02): retire legacy creation modes (INTG-01..03)` — 28 deletions + 2 modifications | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MTRX-01 | 02-02 | Single unified matrix-first entry point replaces Chat, Build, Matrix modes | SATISFIED | `UnifiedMatrixEntry.tsx` created in commit `b0fb09a`; creation/ subtree deleted |
| MTRX-02 | 02-02 | Guided start experience with progressive cell reveal | SATISFIED | `useMatrixBuild` hook (commit `1fa5558`) + `GhostedCellRenderer` (plan 02-03) |
| MTRX-03 | 02-02/02-03 | Cell state machine: hidden → revealed → pending → filling → resolved → highlighted | SATISFIED | `cellStateClasses.ts` data contract from plan 02-01; `PersonaMatrix` progression in plan 02-03 |
| MTRX-04 | 02-03 | Cell-by-cell live construction animation | SATISFIED | AnimatePresence-wrapped transitions in plan 02-03 |
| MTRX-05 | 02-04 | Click-to-answer spatial Q&A | SATISFIED | `SpatialQuestionPopover.tsx` created in plan 02-04 |
| MTRX-06 | 02-04 | CLI questions mapped to specific cell keys | SATISFIED | `question.cellKey` → cell anchor in SpatialQuestionPopover |
| MTRX-07 | 02-02 | Natural language intent input via command center | SATISFIED | `UnifiedMatrixEntry` command center textarea |
| MTRX-08 | 02-04 | Inline cell editing of generated configuration | SATISFIED | `editCellParity.test.tsx` green (7/7 edit cell components render) |
| MTRX-09 | 02-04 | Cancel/abort generation at any point | SATISFIED | `cancelBuild.test.ts` created in plan 02-04 |
| MTRX-10 | 02-02 | Completeness scoring with live ring | SATISFIED | `completenessRing.test.ts` in plan 02-03; `useMatrixBuild` completeness derivation |
| VISL-05 | 02-03 | Non-technical cell vocabulary ("Apps & Services", "When it runs") | SATISFIED | `CELL_LABELS` from plan 02-01; `t.templates.matrix.dim_*` i18n keys now the live source |
| INTG-01 | 02-05/02-07 | Existing personas remain fully functional (store-level parity) | SATISFIED (automated); manual boost pending | `featureParity.test.ts` Block 4 uses `initEditStateFromDraft` store seeding; SQLite walkthrough is manual-only |
| INTG-02 | 02-05 | All edit cell capabilities preserved | SATISFIED | `editCellParity.test.tsx` 7/7 tests green post lucide mock fix |
| INTG-03 | 02-05/02-06/02-07 | Parity audit complete, no capabilities lost, stale refs removed | SATISFIED | Zero creation/ imports in featureParity; i18n migration complete; BUILD_PHASE_LABELS/PHASE_SUBTEXT/DIMENSION_LABELS all retired |

**Note on REQUIREMENTS.md traceability table:** INTG-01, INTG-02, INTG-03 are still listed as "Pending" in `.planning/REQUIREMENTS.md` (lines 123–125). The code meets all criteria, but the traceability table was not updated as part of plan 02-07. This table needs to be updated to "Complete" — it is a documentation artifact, not a code gate.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenterParts.tsx` | (multiple) | ~12 pre-existing hardcoded English strings in `CELL_FRIENDLY_NAMES` and `TestReportModal.tsx` | Info | Deferred per Area 5 narrow recommendation in 02-RESEARCH.md; logged for standalone i18n pass. Does not block phase goal. |
| `src/features/agents/components/matrix/SpatialQuestionPopover.tsx`<br>`DimensionRadial.tsx`<br>`N8nQuestionListView.tsx`<br>`N8nQuestionStepper.tsx` | (various) | Independent `DIMENSION_LABELS` constants (different shape from retired one) still present in 3 unrelated files | Info | Out of scope per Area 5. These are separate constants, not the one retired by plan 02-06. |

No blocker or warning anti-patterns found in the newly shipped code (plans 02-05, 02-06, 02-07).

---

### Human Verification Required

Two items require manual verification before the phase can be marked fully complete. Both are from VALIDATION.md §"Manual-Only Verifications" and are not automatable.

#### 1. Legacy Persona SQLite Walkthrough (INTG-01 confidence boost)

**Test:** Launch `npm run tauri dev`. Open an existing persona that was created before 2026-03-14 (i.e., created via the old Chat/Build/Matrix mode, stored with the old schema shape in SQLite). Click a resolved cell in the unified matrix to edit it. Save. Quit and relaunch. Open the same persona again.

**Expected:** No errors thrown during open, edit, or save. Persona loads successfully on the second open. Legacy persona shape is transparently accepted by `initEditStateFromDraft` at runtime.

**Why human:** `featureParity.test.ts` Block 4 seeds the Zustand store directly via `useAgentStore.setState()` with a typed fixture object. This never touches SQLite deserialization — it bypasses the actual IPC path (`invoke("get_agent")` → Rust `from_row` → TypeScript deserialization). A legacy persona stored in the user's actual database on disk may have fields in unexpected order, missing optional fields, or use enum values that changed between versions. Only a real app launch can exercise that path.

#### 2. Retired-Mode Feature Inventory Walkthrough (INTG-03 human sanity check)

**Test:** Open `.planning/phases/02-unified-matrix-build-surface/02-RESEARCH.md` §"Feature Inventory from Retired Modes". For each listed capability, confirm it is reachable and functional in the current unified matrix surface.

**Expected:** All user-facing flows from the old Chat/Build/Matrix modes — persona creation, connector/trigger/credential attachment via edit cells, inline cell editing, role assignment, refine, test, approve, reject, reopen-existing-persona, legacy-format open — are reachable through the unified matrix without a degraded UX.

**Why human:** The parity test asserts that code paths exist and components render without errors. It cannot verify that the navigation path to reach a capability is discoverable, or that the UX matches user expectations from the retired modes. VALIDATION.md §"Manual-Only Verifications" explicitly requires this walkthrough before phase close.

---

### Pre-Shipped Requirements (MTRX-01..10, VISL-05) Coverage Check

Per the phase scope, MTRX-01..10 and VISL-05 were shipped in plans 02-01 through 02-04. Evidence check:

- **02-02-SUMMARY.md** present: covers MTRX-01, MTRX-07, MTRX-09, MTRX-10 (`useMatrixBuild` + `UnifiedMatrixEntry`)
- **02-03-SUMMARY.md** present: covers MTRX-02, MTRX-03, MTRX-04, VISL-05 (GhostedCellRenderer, state machine, AnimatePresence, CELL_LABELS)
- **02-04-SUMMARY.md** present: covers MTRX-05, MTRX-06, MTRX-08, MTRX-09 (SpatialQuestionPopover, cancelBuild, editCellParity)
- REQUIREMENTS.md traceability shows all MTRX-01..10 and VISL-05 marked "Complete"

The live artifacts for all pre-shipped work exist (featureParity.test.ts and editCellParity.test.tsx are both green, validating that the matrix surface and edit cells continue to function post-retirement).

---

### Gaps Summary

No automated-gate gaps. All 13 must-haves pass.

One documentation artifact requires updating: `REQUIREMENTS.md` traceability table must mark INTG-01, INTG-02, INTG-03 as "Complete" (currently "Pending" at lines 123–125). This is a documentation update, not a code fix — the code meets all criteria. This is a minor gap in the documentation artifact, not a blocker for goal achievement.

Two items require human verification before the phase can be fully closed:

1. Legacy persona SQLite walkthrough (INTG-01 confidence boost) — cannot be automated.
2. Retired-mode feature inventory walkthrough (INTG-03 human sanity check) — cannot be automated.

---

*Verified: 2026-04-12T02:15:00Z*
*Verifier: Claude (gsd-verifier)*
