# Code Refactor Scan — Agent Lab & Matrix Builder

> Scanned: 2026-05-02 | Findings: 9 | Files reviewed: ~35

## Summary

The matrix-build core (`useBuildSession`, `matrixBuildSlice`, `useMatrixBuild`/`useMatrixLifecycle`, `UnifiedMatrixEntry`) is in good shape — extensive comments, clean session-scoping, real care around HMR/race conditions. The lab side is more uneven: aggregation logic was unified into `labAggregation.ts` but a parallel copy of the same accumulator pattern still lives in `evalAggregation.ts`. The biggest debt is **orphan code that survived a layout-direction change** — entire components like `BuildReviewPanel`, the v3 `SharedResourcesPanel` consumer surface, several v3 scalar mirrors in the store, and the standalone `extractBuildHints`/`buildSessionEnricher.ts` are wired up but no longer reachable from any layout. The `src/features/composition/` module is fully dead. Three patterns dominate: (1) "v3 capability framework" partially shipped — types & store are in, UI consumers were superseded by Glyph Full but the dead surfaces remain; (2) duplicate aggregation/diff code that drifted instead of consolidating; (3) the `useAgentStore` mirror layer (`scalarsFromSession`) maintains projections nothing reads.

## 1. `BuildReviewPanel` is dead — only self-references

- **Severity**: high
- **Category**: dead-code
- **File**: src/features/agents/components/matrix/BuildReviewPanel.tsx:1-148
- **Scenario**: A 148-line review-panel component (with two private `CountBadge` / `DimensionChip` helpers, an i18n-bound checklist, full readiness logic) is exported from this file and imported by absolutely no one. Project-wide `BuildReviewPanel` matches return only the file's own `export function`/`interface`.
- **Root cause**: The pre-Glyph build flow had a "review before promote" panel; Glyph Full and PersonaMatrix both ship their own review surfaces (`GlyphTestCompleteCore`, `MatrixCommandCenterParts`) and the legacy entry point was deleted, but the panel itself was never removed.
- **Impact**: Future readers exploring the matrix flow find this file via grep on "promote", "test_passed", or "readiness checklist" and waste time tracing imports that never converge. Bundle is unaffected (tree-shaken), but the file translates 4+ keys (`agents.build_review.*`) keeping translation strings alive in 14 locales.
- **Fix sketch**:
  - Delete `src/features/agents/components/matrix/BuildReviewPanel.tsx`.
  - Remove the corresponding `agents.build_review.*` keys from `src/i18n/locales/*.json` once delete is verified.

## 2. `extractBuildHints` / `buildSessionEnricher.ts` is unreachable

- **Severity**: high
- **Category**: dead-code
- **File**: src/features/agents/sub_lab/libs/buildSessionEnricher.ts:1-40
- **Scenario**: This module exports `BuildHints` and `extractBuildHints(testMetadata)` but the only project-wide reference is the file itself. `buildTestMetadataForDesignContext` (its upstream feeder in `labFeedbackLoop.ts`) IS called from `ImprovePromptButton.tsx`, but the enricher pipeline that was supposed to feed those hints into the build flow was never wired.
- **Root cause**: Half-shipped feature: lab → design-context feedback loop. The lab side computes `LabTestMetadata` (used by ImprovePromptButton), but the build-side consumer that would have read `BuildHints` and seeded `design_context` was deferred and the code shim was left in place.
- **Impact**: Misleading — the file's docstring claims the data flows into PersonaMatrix, but no caller exists. Anyone debugging "why isn't my lab feedback influencing builds?" will find this file and assume it's wired.
- **Fix sketch**:
  - Either delete `buildSessionEnricher.ts` outright, or
  - If feedback-loop-into-build is still on the roadmap, file an issue and add a `// TODO(feedback-loop): not yet wired — see issue #...` comment so the orphan state is explicit.

## 3. `src/features/composition/` is a fully dead module

- **Severity**: high
- **Category**: dead-code
- **File**: src/features/composition/index.ts:1, src/features/composition/libs/dagUtils.ts:1-133
- **Scenario**: The composition feature exports `topologicalSort`, `validateWorkflow`, `getUpstream`, `getDownstream`. No file imports from `@/features/composition` anywhere. The harness has its own private `topologicalSort` in `src/lib/harness/plan-builder.ts` (line 97). The pipeline canvas defines its own `getUpstreamOutputs` callback. `WorkflowNode`/`WorkflowEdge` types in `compositionTypes` are referenced only by `dagUtils.ts` itself and a tangential `credentialGraph.ts` (which uses `Workflow`, not the DAG utils).
- **Root cause**: A "Persona Composition Engine" was scaffolded but the consumer feature (multi-persona DAG editor) was never shipped. The utilities have full test-quality logic (Kahn's algorithm, cycle detection, validation errors) gathering dust.
- **Impact**: Implies a feature that doesn't exist; readers exploring "how do persona DAGs work?" land here and follow false leads. ~150 LOC + types module.
- **Fix sketch**:
  - Delete `src/features/composition/` entirely.
  - Audit `src/lib/types/compositionTypes.ts` — if `WorkflowNode`/`WorkflowEdge` are unused after removal, delete those too (keep `Workflow` if still referenced by `credentialGraph.ts`).

## 4. Duplicate accumulator pattern in `evalAggregation.ts` vs `labAggregation.ts`

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/agents/sub_lab/libs/evalAggregation.ts:27-102, src/features/agents/sub_lab/libs/labAggregation.ts:14-60
- **Scenario**: `labAggregation.ts` has a clean `Accum` / `newAccum` / `addToAccum` / `finalizeAccum` quartet that `aggregateArenaResults`, `aggregateAbResults`, `aggregateMatrixResults` all share. `evalAggregation.ts` defines the exact same shape inline as `VersionAccum` and `CellAccum` and re-implements the loop bodies (lines 65-101, 106-122, 127-145) instead of importing the helpers next door.
- **Root cause**: Eval was built first, then arena/ab/matrix consolidated into the helper file; eval was never back-ported. The drift is already showing — `labAggregation.finalizeAccum` returns `Math.round(avgTA)` for individual averages but eval's per-cell finalizer rounds *only* when count > 0 (line 131). Behaviourally close but not identical.
- **Impact**: Future bug fixes to scoring (e.g., handling all-null metrics, weighting changes) must be applied twice and risk diverging. ~80 LOC duplicate.
- **Fix sketch**:
  - Export `Accum`/`newAccum`/`addToAccum`/`finalizeAccum` from `labAggregation.ts`.
  - In `evalAggregation.ts`, replace `VersionAccum`/`CellAccum` with `Accum & { versionNumber: number }` and `Accum`, then call `addToAccum(va, ...)` / `finalizeAccum(va)` with the same pattern as `aggregateAbResults`.
  - Verify the `Math.round` placement matches across both files post-merge.

## 5. v3 scalar mirrors `buildClarifyingQuestionV3` and `setSavedBuildSnapshot` are write-only

- **Severity**: medium
- **Category**: dead-code
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:151-157, 162, 391, 502
- **Scenario**: `buildClarifyingQuestionV3` is declared on the slice, projected from `s.clarifyingQuestionV3` in `scalarsFromSession`, and defaulted in three places — but no consumer reads `buildClarifyingQuestionV3` anywhere. Same for the action `setSavedBuildSnapshot`: it's declared and implemented (line 502) but never called. `savedBuildSnapshot` itself IS read (PersonaMatrix:192) — the setter just has no caller.
- **Root cause**: The "v3 capability framework" scalar mirrors were added speculatively to match the pattern of every other slice field, but the v3 clarifying-question consumer landed inside the per-session shape (`s.clarifyingQuestionV3` in `GlyphRefineComposer`), bypassing the mirror. `setSavedBuildSnapshot` was meant for a "view promoted agent" transition that ended up being implemented differently in `UnifiedMatrixEntry.handleViewPromotedAgent`.
- **Impact**: The slice is already 1300+ lines; every dead mirror lengthens the projection function and the empty-state defaults, making the actually-meaningful state harder to scan.
- **Fix sketch**:
  - Drop `buildClarifyingQuestionV3` from the interface (line 151), `scalarsFromSession` (line 322, 356, 391), and initial state (line 496). Read `clarifyingQuestionV3` directly via `s.buildSessions[s.activeBuildSessionId]` if a future consumer needs it, or expose a cleaner selector.
  - Drop `setSavedBuildSnapshot` since `savedBuildSnapshot` is never set anywhere — this means PersonaMatrix's `s.savedBuildSnapshot` is always `null`, which itself is a separate concern worth investigating (the "saved variant" code path in PersonaMatrix may also be dead).

## 6. Two parallel diff viewers reading the same `diffStrings` engine

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/agents/sub_lab/shared/DiffViewer.tsx:1-59, src/features/agents/sub_lab/components/shared/DraftDiffViewer.tsx:1-81
- **Scenario**: `DiffViewer` (shared/) and `DraftDiffViewer` (components/shared/) render essentially the same UI: section-keyed cards with token-level adds/removes colored emerald/red, and an "no diff" empty state. They differ in input shape (`PersonaPromptVersion` vs raw JSON strings) and one supports a `changeSummary` banner, but the rendering logic — the inner `<span>` mapping with the same className triplet — is duplicated verbatim (DiffViewer:35-47, DraftDiffViewer:60-72). `InlineDiffPreview.tsx` is a third sibling that aggregates into per-section word counts but reuses the same primitives.
- **Root cause**: `DraftDiffViewer` was added later for the matrix's draft-vs-current preview and built by copying `DiffViewer`'s render block instead of factoring out a `<DiffSegments diff={...}>` primitive.
- **Impact**: Style changes to diff coloring (e.g., contrast tweaks, accessibility audit) must touch all three. The current emerald-300/red-300 palette is already pinned in three independent literals.
- **Fix sketch**:
  - Extract a `<DiffSegments diff={DiffEntry[]} />` (or `renderDiffSegments(diff)`) primitive into `labPrimitives.ts` next to `diffStrings`.
  - Have all three callers consume it; this also collapses the "section iterates → diffStrings → render" boilerplate so each viewer focuses on its parsing differences.

## 7. `labPrimitives.ts` has an import statement after exports — file structure smell

- **Severity**: low
- **Category**: structure
- **File**: src/features/agents/sub_lab/shared/labPrimitives.ts:1-18
- **Scenario**: Lines 1-2 import lucide icons + `getSectionSummary`. Then line 6-10 declare `TAG_STYLES`. Then line 14 has `import { formatRelativeTime } from '@/lib/utils/formatters'` — an import declaration in the middle of the file body — followed immediately by `export const formatRelative = ...`. ESM allows hoisting so it works, but linters/code-fold tools and humans expect imports at the top.
- **Root cause**: Probably a quick "drop a re-export here" patch where the author colocated the import next to the consumer. Easy to fix.
- **Impact**: Confuses anyone scanning the import block to understand a file's dependencies. Trivial.
- **Fix sketch**:
  - Move `import { formatRelativeTime } from '@/lib/utils/formatters';` to line 3.
  - Same applies to `labUtils.ts` which is itself just a thin re-export shim and may itself be deletable (see finding 8).

## 8. `labUtils.ts` re-export shim is unused

- **Severity**: low
- **Category**: dead-code
- **File**: src/features/agents/sub_lab/shared/labUtils.ts:1-19
- **Scenario**: This file re-exports `TAG_STYLES`, `formatRelative`, `getSectionSummary`, `diffStrings` from `labPrimitives` and four scoring symbols from `@/lib/eval/evalFramework`. Project-wide grep for `from.*labUtils` matches only `evalFramework.ts`'s historical comment ("logic that was spread across testUtils.ts, labUtils.ts, and test_runner.rs") — no actual import of the shim exists.
- **Root cause**: The file used to be the canonical aggregator before the unification into `labPrimitives` + `evalFramework`. Consumers were migrated to those direct paths and the shim was forgotten.
- **Impact**: Another orphan in the same folder as the larger sub_lab/shared barrel; encourages the wrong import path for future contributors.
- **Fix sketch**:
  - Delete `src/features/agents/sub_lab/shared/labUtils.ts`. Verify no test fixtures or string-keyed lookups reference it (grep already shows zero).

## 9. `UnifiedMatrixEntry` mixes module-level localStorage I/O with React state

- **Severity**: low
- **Category**: structure
- **File**: src/features/agents/components/matrix/UnifiedMatrixEntry.tsx:30-46, 430-434
- **Scenario**: `readLayoutPreference()` / `writeLayoutPreference()` are file-scope helpers that touch `localStorage` and embed migration logic for retired values ("v3-capabilities" → "glyph-full"). They're only consumed by this one component (`useState<BuildLayout>(readLayoutPreference)` and `handleLayoutChange`). The migration logic (lines 39-40) silently rewrites values from older versions on read, but the write path on `setLayout` doesn't normalize, so a typo elsewhere could persist a non-canonical value.
- **Root cause**: Persisting a preference inside a component grew from a one-off feature; nothing wrong with the implementation but it's the kind of helper that gravitates toward `@/lib/preferences` or a typed `useLocalStoragePref` hook over time.
- **Impact**: Low — works correctly today. But if more parts of the build flow gain layout/persistence preferences (likely, given the Glyph/legacy split is one of several), inlining them per-component will scatter the migration story.
- **Fix sketch**:
  - Either factor into a small `useLocalStoragePref<T>(key, schema, default)` hook that owns parse/migrate/write, or
  - Leave as-is but add a unit test asserting the migration map covers all retired values (currently "v3-capabilities", "glyph"). Easy regression target.

> Total: 9 findings (3 high, 4 medium, 2 low)

## Notes on scope

Three files listed in the assignment do not exist in the project:
- `src/features/agents/sub_activity/MatrixTab.tsx` — no MatrixTab in sub_activity (only ActivityTab/Header/List/Filters/Modals).
- `src/features/agents/components/matrix/CapabilityAddModal.tsx` — not present.
- `src/features/agents/components/matrix/CapabilityRowEditor.tsx` — not present (the closest analog `CapabilityRow.tsx` lives under `components/newPersona/capabilityView/`).

These appear to be either renamed/relocated or never landed; flagging in case the orchestrator wants to update its scope manifest. None of the existing files in scope reference them, so no broken imports result.
