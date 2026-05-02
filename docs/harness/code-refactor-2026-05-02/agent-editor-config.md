# Code Refactor Scan — Agent Editor & Configuration

> Scanned: 2026-05-02 | Findings: 8 | Files reviewed: ~45

## Summary

The editor shell (`sub_editor`) is in good shape — clean separation between `EditorDocument` (dirty/save/undo store), per-tab `useTabSection` orchestrator, and `useEditorSave` (typed key-group dirty detection with exhaustiveness checks). The dominant problems all sit in **`sub_model_config/`**, which holds two parallel, drifting implementations of the entire model A/B compare surface: a `components/compare/` tree (exported, in use) and a flat root-level tree (newer, dead, but shipping in the bundle). Three of the five duplicated files have diverged with new safety logic only in the dead copy. Secondary themes: a thin re-export shim for `OllamaCloudPresets`, scattered hardcoded timeout literals that bypass the `MIN/MAX_PERSONA_TIMEOUT_MS` constants, and structural inconsistencies in `sub_design/` (helpers split between root and `libs/`). The scope description references `sub_prompt`, `TwinBindingCard`, and `src/api/agents` / `src/stores/slices/agents` — `sub_prompt` and `TwinBindingCard` exist only in worktrees, and the API/store layers were lightly reviewed and proved healthy (typed discriminated-union ops, sequence-numbered fetches, derived `selectedPersona`).

## 1. Five-file dead duplication of the model A/B compare module

- **Severity**: high
- **Category**: dead-code
- **File**: src/features/agents/sub_model_config/{ModelABCompare.tsx, ComparisonResults.tsx, CompareMetricCards.tsx, CompareOutputPreviews.tsx, compareModels.ts}
- **Scenario**: The root of `sub_model_config/` contains a complete, self-referential parallel copy of the compare feature: `ModelABCompare.tsx` (244 lines), `ComparisonResults.tsx` (171 lines, contains `ModelDropdown`), `CompareMetricCards.tsx`, `CompareOutputPreviews.tsx`, `compareModels.ts`. None are exported from `sub_model_config/index.ts` (which exports the canonical `components/compare/ModelABCompare` instead) and none are imported by any file outside this dead island — they only import from each other. Project-wide grep for `from '*/sub_model_config/ModelABCompare'`, `from '*/ComparisonResults'`, `from '*/compareModels'`, etc. returns zero hits except the internal cross-references.
- **Root cause**: A "move-into-subfolder" refactor split files into `components/compare/` + `libs/compareHelpers.ts` and updated the index, but the original root-level files were never deleted. The dead copies kept being modified afterwards — see finding #2.
- **Impact**: ~600 lines of unreferenced code shipping in tree-shaking analysis (Vite tree-shakes them, but every `git grep ModelABCompare` returns two definitions, every IDE "Go to symbol" picks the wrong one, every search-and-replace risks editing the wrong file). Future readers will reasonably assume both are live and try to keep them in sync, which is exactly how finding #2 happened.
- **Fix sketch**:
  - Delete all 5 root-level files
  - Verify `index.ts` still exports the same surface
  - Run `npm run build` and full `tsc --noEmit` to confirm no hidden import path

## 2. Dead `ModelABCompare.tsx` is the SAFER version — exported copy is the older/inferior one

- **Severity**: high
- **Category**: duplication
- **File**: src/features/agents/sub_model_config/ModelABCompare.tsx (dead) vs src/features/agents/sub_model_config/components/compare/ModelABCompare.tsx (live)
- **Scenario**: The two `ModelABCompare` files have meaningfully diverged. The dead root copy added three improvements that never made it into the live copy:
  1. Persona-switch reset effect (lines 86-96) that cancels in-flight runs and clears `lastResults`/`expanded` when the user navigates to a different persona — the comment explicitly calls out the bug it fixes ("could leak sensitive prompts across workspaces"). The live copy has no such effect.
  2. `aggregateResultsDetailed` + `missingModels` warning UI (lines 104-112, 179-186) that distinguishes "no run started" from "model produced no results" so dispatch failures surface as a red warning instead of a blank panel.
  3. `capturePersonaToken`-based persona-staleness guard in `handleStart` (lines 57, 64) instead of an inline `useAgentStore.getState()` re-read.
- **Root cause**: After the refactor that should have deleted the root copy (see finding #1), someone improved the dead copy thinking it was the canonical one. The live `components/compare/ModelABCompare.tsx` still does `setLoading` without setting `lastResults(null)` on cancel and has no persona-switch cleanup.
- **Impact**: Real cross-persona prompt/result leak in the live UI. The fix already exists in the codebase but is dead code. This is a high-severity correctness issue masquerading as a refactor finding.
- **Fix sketch**:
  - Port the persona-switch reset effect, `aggregateResultsDetailed`, missing-model warning, and `capturePersonaToken` usage from the dead copy into `components/compare/ModelABCompare.tsx`
  - Move `aggregateResultsDetailed` + `AggregateResult` type from the dead `compareModels.ts` into `libs/compareHelpers.ts`
  - Then delete the dead files per finding #1

## 3. `OllamaCloudPresets.ts` is a thin re-export shim that 5+ files still import directly

- **Severity**: medium
- **Category**: structure
- **File**: src/features/agents/sub_model_config/OllamaCloudPresets.ts (10 lines, only re-exports)
- **Scenario**: The root file is a 10-line re-export of `./libs/OllamaCloudPresets`. Six callsites still import from the root path — `sub_editor/libs/PersonaDraft.ts`, `sub_editor/libs/useEditorSave.ts`, `sub_use_cases/libs/useCaseDetailHelpers.ts`, `sub_use_cases/components/detail/UseCaseModelOverride.tsx`, `sub_use_cases/components/core/DefaultModelSection.tsx`, `lib/models/modelCatalog.ts`, `features/shared/components/editors/draft-editor/DraftSettingsTab.tsx`. Internal files (`OllamaApiKeyField`, `ModelSelector`) use the libs/ path. So there are two import conventions for the same symbols.
- **Root cause**: Same refactor as findings #1-2: file moved to `libs/`, shim left at root for backward compat, callers were never migrated.
- **Impact**: Two import paths for the same symbols means future refactors must update both, and IDE "find references" misses half the consumers. Low correctness risk, real maintenance friction.
- **Fix sketch**:
  - `sed`-replace `'@/features/agents/sub_model_config/OllamaCloudPresets'` → `'@/features/agents/sub_model_config/libs/OllamaCloudPresets'` across the 6 callsites
  - Or: re-export from `index.ts` only and have everyone go through that
  - Delete the root shim file

## 4. `MIN/MAX_PERSONA_TIMEOUT_MS` constants exist but `PersonaSettingsTab` hardcodes 10/1800

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/agents/sub_settings/components/PersonaSettingsTab.tsx:155-158, src/features/agents/sub_editor/libs/PersonaDraft.ts:14-16
- **Scenario**: `PersonaDraft.ts` exports `DEFAULT_PERSONA_TIMEOUT_MS = 180_000`, `MIN_PERSONA_TIMEOUT_MS = 10_000`, `MAX_PERSONA_TIMEOUT_MS = 1_800_000`. `MIN_*` and `MAX_*` are never imported anywhere — they are dead exports. Meanwhile `PersonaSettingsTab.tsx` hardcodes `Math.min(Math.max(safe, 10), 1800)` (seconds), `min={10}`, `max={1800}` and the FieldHint range `"10--1800 seconds"` for the timeout input. The `FieldHint` text claims "engine hard ceiling is 1800 seconds (30 min)" — that 30-min figure is exactly what `MAX_PERSONA_TIMEOUT_MS` encodes.
- **Root cause**: The constants were extracted (with helpful comments about the 1M-ms bug) but the consumer was never migrated.
- **Impact**: If the engine ceiling changes, the constants update but the input still clamps to 1800. The hint text and the clamp logic could drift independently. Low immediate risk, real lurking inconsistency.
- **Fix sketch**:
  - Import `MIN_PERSONA_TIMEOUT_MS`, `MAX_PERSONA_TIMEOUT_MS` in `PersonaSettingsTab.tsx`
  - Replace the hardcoded `10`, `1800` literals (clamp + `min`/`max` props) with `MIN_PERSONA_TIMEOUT_MS / 1000` and `MAX_PERSONA_TIMEOUT_MS / 1000`
  - Build the FieldHint range string from the constants

## 5. `EditorBody` redirect-on-tab effect has redundant matrix branch

- **Severity**: low
- **Category**: cleanup
- **File**: src/features/agents/sub_editor/components/EditorBody.tsx:102-110
- **Scenario**: Two adjacent `if` statements in the same `useEffect`:
  ```tsx
  if (isStarter && (editorTab === 'activity' || editorTab === 'matrix' || editorTab === 'lab')) {
    setEditorTab('use-cases');
  }
  if (editorTab === 'matrix') {
    setEditorTab('use-cases');
  }
  ```
  The second branch handles the legacy persisted `'matrix'` value (the matrix tab was removed). For starter users this branch is redundant — the first branch already redirected. For non-starter users with a persisted `matrix`, only the second branch fires.
- **Root cause**: When `'matrix'` was removed from `tabDefs` the second branch was added as a one-shot migration, but the first branch's `'matrix'` literal was never cleaned out.
- **Impact**: Minor reader confusion — the first branch suggests `'matrix'` is a starter-restricted tab when it's actually a removed tab. Both effects are idempotent, so no functional bug.
- **Fix sketch**:
  - Drop `'matrix'` from the first `if` clause
  - Add a comment to the second `if` indicating it's a one-shot migration that can be removed once persisted state churns

## 6. `EditorBody` save-error banner duplicates `BannerPrimitive` shape inline

- **Severity**: low
- **Category**: duplication
- **File**: src/features/agents/sub_editor/components/EditorBody.tsx:158-180
- **Scenario**: `EditorBanners.tsx` already has a `BannerPrimitive` with `colorScheme: 'red'` and `actions` slots. `EditorBody` then renders two near-identical inline banners (the failed-tabs retry banner and the saveError banner) using the same `mx-6 my-2 rounded-modal px-3 py-2 ... bg-red-500/10 border border-red-500/20` Tailwind classes — bypassing `BannerPrimitive` for no apparent reason.
- **Root cause**: `BannerPrimitive` was added later; the inline banners predate it and weren't migrated.
- **Impact**: Style drift risk (any future restyling of the banner system has to remember to update these two inline copies), ~20 lines of redundant JSX in the orchestrator file.
- **Fix sketch**:
  - Add a `SaveErrorBanner` and/or `FailedTabsBanner` to `EditorBanners.tsx` that wrap `BannerPrimitive`
  - Replace the inline JSX in `EditorBody` with the new components
  - Lets the `RefreshCw` icon and retry button live with the other banner primitives

## 7. `sub_design/` helpers split between root and `libs/` inconsistently

- **Severity**: low
- **Category**: structure
- **File**: src/features/agents/sub_design/DesignTabHelpers.ts vs src/features/agents/sub_design/libs/designStateHelpers.ts
- **Scenario**: `sub_design/` has both `DesignTabHelpers.ts` (root) and `libs/designStateHelpers.ts`. They cooperate — `designStateHelpers.ts` imports `allIndices` and `buildChangeSummary` from `../DesignTabHelpers`. Other sub_* modules in `agents/` consistently put helpers under `libs/` (compare with `sub_editor/libs/`, `sub_model_config/libs/`, `sub_settings/index.ts`). `DesignQuestionPanel`, `IntentResultExtras`, `PhaseIndicator` also sit at the root rather than under `components/`.
- **Root cause**: Organic growth — files were added at the root, then `libs/` and `components/` and `phases/` and `wizard/` subfolders were introduced for newer additions, but the root-level stragglers were never moved.
- **Impact**: Inconsistent file location makes it harder to predict where a given module lives. No correctness impact.
- **Fix sketch**:
  - Move `DesignTabHelpers.ts` → `libs/designTabHelpers.ts` (lowercase to match siblings)
  - Move `DesignQuestionPanel.tsx`, `IntentResultExtras.tsx`, `PhaseIndicator.tsx` → `components/`
  - Update imports (mostly intra-folder, low blast radius)

## 8. `EditorBody` named export is unused outside the module

- **Severity**: low
- **Category**: dead-code
- **File**: src/features/agents/sub_editor/index.ts:3
- **Scenario**: `sub_editor/index.ts` re-exports both `PersonaEditor` (default) and `EditorBody` (named). Project-wide grep for `EditorBody` shows it's only imported by its sibling `PersonaEditor.tsx` and referenced in store comments — no external consumer uses the named export.
- **Root cause**: Likely auto-added during a refactor that split `PersonaEditor` into a wrapper and a body. The body export is unnecessary.
- **Impact**: Minor — exposes an internal implementation detail as part of the package public surface. Encourages outside callers to bypass the `EditorDirtyProvider` wrapper.
- **Fix sketch**:
  - Drop the `EditorBody` re-export from `sub_editor/index.ts`
  - Keep the file's local `export function EditorBody(...)` — `PersonaEditor.tsx` still uses it via relative import

> Total: 8 findings (2 high, 3 medium, 3 low)
