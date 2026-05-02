# Code Refactor Scan — Persona Templates Catalog

> Scanned: 2026-05-02 | Findings: 9 | Files reviewed: ~32

## Summary

The template loader/catalog itself (`src/lib/personas/templates/templateCatalog.ts` + overlays + checksums) is in solid shape — well-documented, defensive, and the JSON catalog under `scripts/templates/` is fully accounted for (110 canonical files, 110 checksums, no orphans). The pain is concentrated elsewhere: `src/api/templates/` is a mis-named bucket containing recipe/skill/design/discovery API clients that have nothing to do with templates; `src/features/templates/sub_generated/` has a half-dozen barrel `index.ts` files that nobody imports from (consumers go direct to the relative path); and a `TRIGGER_ICONS` constant has been independently re-defined four times across the codebase. There's also a parallel mini-i18n system at `features/templates/i18n/` for 8 strings, half of which are dead keys. Three dominant patterns: (1) abandoned barrel exports masking the real import shape, (2) unrelated API clients clustered under `api/templates/` for path-convenience, (3) duplicated constant tables (TRIGGER_ICONS, animation presets) born of cross-feature reuse without a shared home.

## 1. `api/templates/` is a misnamed bucket — half its files are not about templates

- **Severity**: medium
- **Category**: structure
- **File**: src/api/templates/recipes.ts, design.ts, skills.ts, platformDefinitions.ts, discovery.ts
- **Scenario**: `src/api/templates/` contains 8 modules. Three are templates-related (`templateAdopt.ts`, `templateFeedback.ts`, `n8nTransform.ts`). The other five are API clients for unrelated domains: `recipes.ts` (recipe CRUD), `skills.ts` (skill CRUD), `design.ts` (design analysis / conversations), `platformDefinitions.ts` (platform-definition catalog), `discovery.ts` (connector resource discovery for adoption questionnaires).
- **Root cause**: `api/templates/` likely started as the home for the template-adoption flow, then accumulated whatever the adoption hook touched. Recipes, skills, and design are top-level features (`features/recipes/`, `features/agents/sub_design/`) that should each have their own `api/<domain>/` namespace, not nest under templates.
- **Impact**: New devs grep `api/recipes` and find nothing; consumers across `features/recipes/`, `features/agents/`, `hooks/design/`, and `stores/slices/pipeline/` all import from `@/api/templates/recipes` or `@/api/templates/design` — actively misleading paths that hide the actual domain layout.
- **Fix sketch**:
  - Move `recipes.ts` → `src/api/recipes/recipes.ts`
  - Move `skills.ts` → `src/api/skills/skills.ts`
  - Move `design.ts` → `src/api/design/design.ts`
  - Move `platformDefinitions.ts` → `src/api/platforms/platformDefinitions.ts`
  - Move `discovery.ts` → `src/api/connectors/discovery.ts` (it's connector discovery, not template discovery)
  - Update the ~30 import sites — mostly mechanical search/replace.

## 2. `TRIGGER_ICONS` defined independently four times

- **Severity**: medium
- **Category**: duplication
- **File**: 
  - src/features/shared/glyph/triggers.ts:6
  - src/features/templates/sub_generated/gallery/cards/renderers/templateCardTypes.ts:8
  - src/features/templates/sub_generated/gallery/matrix/matrixEditTypes.ts:83
  - src/features/agents/components/matrix/DimensionEditPanel.tsx:362
- **Scenario**: The same `Record<string, lucide-icon>` mapping for trigger types appears four times. The mappings have already drifted: `triggers.ts` maps `schedule → Calendar` and `polling → Clock`, while `templateCardTypes.ts` and `matrixEditTypes.ts` map `schedule → Clock` and `polling → Radio`. The `matrixEditTypes` and `DimensionEditPanel` versions add `event → Activity` while the others omit it.
- **Root cause**: Each new feature that needed a trigger icon copy-pasted the previous version and tweaked it locally rather than promote a shared mapping. `features/shared/glyph/triggers.ts` already exists and is named correctly to be the canonical home but isn't being reached for.
- **Impact**: The same template can show different icons depending on which view renders it (gallery card vs. matrix vs. dimension panel) — a real visual inconsistency, not just code smell. Adding a new trigger type means hunting four files.
- **Fix sketch**:
  - Promote `features/shared/glyph/triggers.ts` to be the only source of truth; export both the icon map and the `triggerIcon(type)` accessor.
  - Replace the three copies with `import { triggerIcon } from '@/features/shared/glyph/triggers'`.
  - Reconcile the divergence: pick `Calendar` vs `Clock` for `schedule` once and apply everywhere.

## 3. Six barrel `index.ts` files are dead — consumers all use direct relative paths

- **Severity**: medium
- **Category**: dead-code
- **File**:
  - src/features/templates/sub_generated/adoption/index.ts
  - src/features/templates/sub_generated/design-preview/index.ts
  - src/features/templates/sub_generated/generation/index.ts
  - src/features/templates/sub_generated/shared/index.ts
  - src/features/templates/sub_generated/gallery/search/filters/index.ts
  - src/features/templates/sub_generated/gallery/search/suggestions/index.ts
  - src/features/templates/sub_n8n/reducers/index.ts
- **Scenario**: Each of these files re-exports a handful of symbols, but project-wide grep finds zero imports of the form `from '.../adoption'`, `from '.../design-preview'`, etc. The actual consumers — `OnboardingOverlay`, `DesignPhasePreview`, `useN8nImportReducer`, `CustomSourceView`, etc. — all use direct paths like `from '../adoption/AdoptionWizardModal'` or `from '../runner/designRunnerConstants'`.
- **Root cause**: Barrel files were added speculatively for "clean public API" but downstream code never adopted them, possibly because `sub_generated/index.ts` (which IS used) only re-exports three things and consumers learned that direct imports are the convention.
- **Impact**: 30+ lines of `export { … } from './…'` that bundlers must resolve, false signal that there's a public API contract here, and easy to add a "public" symbol that nobody actually imports. `generation/index.ts` re-exports `parseListMdFormat`, `PREDEFINED_TEST_CASES`, `CATEGORY_COLORS`, `CATEGORY_OPTIONS`, `TRIGGER_OPTIONS`, `MIN_INSTRUCTION_LENGTH`, `useCreateTemplateReducer`, `CREATE_TEMPLATE_*` — every one of those consumers imports from the source file directly.
- **Fix sketch**:
  - Delete the six dead barrels.
  - Keep `sub_generated/index.ts` (the one real public API surface — 3 items, all consumed externally).
  - If a public-API contract IS desired, make consumers actually import from the barrels (one direction or the other; pick one).

## 4. Parallel mini-i18n system at `features/templates/i18n/` for 8 strings, 3 of which are dead

- **Severity**: medium
- **Category**: dead-code / duplication
- **File**: src/features/templates/i18n/{en,zh,ar,…}.ts (14 locale files), useTemplatesTranslation.ts
- **Scenario**: A separate i18n system lives at `features/templates/i18n/` with 14 locale files (en, zh, ar, hi, ru, id, es, fr, bn, ja, vi, de, ko, cs) and its own `useTemplatesTranslation()` hook. The full content is 8 strings under `templates.complexity` (3 difficulty labels, 3 setup labels, 2 minute formatters). Project-wide grep shows the consumers (`TemplateDetailModal`, `TemplateCardHeader`) only ever use `complexity[difficulty]` (beginner/intermediate/advanced), `complexity.minuteShort`, and `complexity.minuteSetup` — i.e. **5 of the 8 keys**. The three setup labels (`quickSetup`, `moderateSetup`, `involvedSetup`) are translated across all 14 locales but never read. Meanwhile `templateComplexity.ts:34-37` and `:163-165` hardcode "Quick Setup" / "Moderate Setup" / "Involved Setup" in English, never reaching for the i18n strings — a parallel, non-translated path.
- **Root cause**: The setup-level i18n keys were added speculatively when SETUP_META was first written; the actual rendering kept using the hardcoded English `label` field on the meta object and the i18n keys were forgotten. Two separate i18n systems (this one + the global `i18n/generated/types.ts`) exist for what's effectively a single feature's translations.
- **Impact**: 42 untranslated strings (3 keys × 14 locales) ship in the bundle for nothing; new translators waste effort on `quickSetup`. Setup labels currently render "Quick Setup" in every language because the i18n keys are never read. This is also confusing — the global `i18n/generated/types.ts:5446` already has a `templates: { … }` namespace, so why two systems?
- **Fix sketch**:
  - Either: drop the local i18n folder entirely and move `complexity.*` keys into the global `i18n/generated/templates` namespace.
  - Or: actually USE `quickSetup/moderateSetup/involvedSetup` in `SETUP_META.label` (refactor it to be a function that takes `t`).
  - At minimum, delete the three dead keys from all 14 locale files.

## 5. `animationPresets.ts` lives in `features/templates/` but is consumed by 4 other features

- **Severity**: medium
- **Category**: structure
- **File**: src/features/templates/animationPresets.ts
- **Scenario**: This file exports `staggerContainer`, `staggerItem`, `dashboardItem`, `MOTION`, `MOTION_TIMING`, `TRANSITION_*`, `useTemplateMotion`, etc. Its consumers are `features/vault/sub_credentials/`, `features/vault/sub_catalog/components/autoCred/`, `features/vault/sub_catalog/components/negotiator/`, `features/overview/sub_manual-review/`, plus templates itself. The file's name (`useTemplateMotion`) and folder location both lie about scope — this is a shared animation library, not a templates-specific preset.
- **Root cause**: Started as templates-only, became the de-facto shared motion module without ever being relocated.
- **Impact**: Importing motion presets now requires reaching across the dependency graph into a sibling feature. Cross-feature coupling that's invisible until you grep. Also makes `features/templates/` look bigger than it is.
- **Fix sketch**:
  - Move to `src/features/shared/motion/animationPresets.ts` (or `src/lib/motion/`).
  - Rename `useTemplateMotion` → `useMotionPresets` to reflect its real audience.
  - Update the ~5 import sites.

## 6. Dead exports inside `animationPresets.ts`

- **Severity**: low
- **Category**: dead-code
- **File**: src/features/templates/animationPresets.ts:11-13, 27, 47-51, 84-89
- **Scenario**: Several exports in this file are never imported anywhere:
  - `CSS_DURATION_CLASS.SNAP / FLOW / EASE` (the upper-case aliases — only `snappy/smooth/gentle` are read)
  - `MOTION_TIMING.SNAP` and `MOTION_TIMING.EASE` (only `MOTION_TIMING.FLOW` is read by negotiator components)
  - `TRANSITION_INSTANT`, `TRANSITION_FAST` (only `TRANSITION_NORMAL` and `TRANSITION_SLOW` are imported externally)
  - `dashboardContainer` (exported, never imported — `dashboardItem` is used; the container is not)
- **Root cause**: Speculative API surface ("we'll need 4 transition speeds, let me export all of them"), then only two were ever used in practice.
- **Impact**: ~25 lines of dead exports inside a file that already overlaps with `useMotion()` from `hooks/utility/interaction/useMotion`. Misleads readers about which presets are canonical.
- **Fix sketch**:
  - Delete `CSS_DURATION_CLASS.SNAP/FLOW/EASE` (keep the lowercase versions).
  - Delete `MOTION_TIMING.SNAP` and `MOTION_TIMING.EASE`.
  - Delete `TRANSITION_INSTANT`, `TRANSITION_FAST`.
  - Delete `dashboardContainer`.

## 7. `recipes.ts` has duplicated section comment header

- **Severity**: low
- **Category**: cleanup
- **File**: src/api/templates/recipes.ts:75-77 and 110-112
- **Scenario**: The comment block `// Use Case <-> Recipe Connection` appears twice in the same file with different content underneath each one (line 79: `getUseCaseRecipes`; line 114: `promoteUseCaseToRecipe`). The second occurrence drifted in during a later commit.
- **Root cause**: Copy-paste of the section divider when adding `promoteUseCaseToRecipe` later.
- **Impact**: Low — but cosmetically confusing; reader sees two identically-titled sections and assumes one is a leftover.
- **Fix sketch**:
  - Rename one of the headers (e.g. line 110 → `// Use Case Promotion`).
  - Or merge: move `promoteUseCaseToRecipe` up next to the other use-case helper and keep one section.

## 8. `MatrixCommandCenterParts.tsx` re-exports symbols it just imported

- **Severity**: low
- **Category**: cleanup
- **File**: src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenterParts.tsx:22-23
- **Scenario**: The file does `import { CELL_FRIENDLY_NAMES, ORB_GLOW_CLASSES, type BuildPhase } from './matrixBuildConstants'` and immediately on the next line `export { CELL_FRIENDLY_NAMES, ORB_GLOW_CLASSES } from './matrixBuildConstants'`. The re-export creates an alternate import path. Project-wide grep shows nobody imports these constants from `MatrixCommandCenterParts` — the only consumers go straight to `matrixBuildConstants`.
- **Root cause**: Possibly an artifact of refactoring constants out of `MatrixCommandCenterParts` while keeping a back-compat re-export that nobody needed.
- **Impact**: Low — but creates a phantom public API on the component file. Adds visual noise.
- **Fix sketch**:
  - Delete line 23 (the `export { … } from './matrixBuildConstants'` line). Keep only the import.

## 9. `CELL_FRIENDLY_NAMES` hardcodes English while neighbors use i18n

- **Severity**: low
- **Category**: naming / cleanup
- **File**: src/features/templates/sub_generated/gallery/matrix/matrixBuildConstants.ts:4-13
- **Scenario**: `CELL_FRIENDLY_NAMES` is a `Record<string, string>` mapping cell keys (`'use-cases'`, `'connectors'`, …) to hardcoded English labels (`'Tasks'`, `'Apps & Services'`, …). It's consumed by `MatrixCommandCenterParts.tsx` at line 152, 156, 330 — line 330 is right next to `tx(t.templates.matrix.editing_cell, …)` which IS a translated string. So the matrix labels half-translate: dynamic context strings are i18n'd, the cell name slotted into them is not.
- **Root cause**: Constants file added before the i18n contract was applied to the matrix view.
- **Impact**: In non-English locales, the matrix shows mixed-language strings like `"Editing: Tasks"` (English noun in a translated frame). Users on Bengali / Japanese / Czech see this.
- **Fix sketch**:
  - Move the labels into the global i18n templates namespace (`templates.matrix.cell_names.use_cases`, etc.) — there's already a `templates.matrix` block.
  - Replace `CELL_FRIENDLY_NAMES[key]` with `t.templates.matrix.cell_names[key]`.

> Total: 9 findings (0 high, 5 medium, 4 low)
