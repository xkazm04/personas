# templates/generated [1/5] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 4 medium / 1 low)
> Context group: Templates & Recipes | Files read: 34 | Missing: 0

## 1. Duplicated and already-drifted trigger-type alias maps
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/templates/sub_generated/adoption/chronology/useUseCaseChronology.ts:101
- **Scenario**: A template ships a trigger typed `watcher`, `web_hook`, or `focus`. The adoption seed path (ChronologyAdoptionView.tsx:57 `TRIGGER_TYPE_ALIASES` + `normalizeTriggerType`) normalizes it correctly, but the chronology view's private copy of the same map (useUseCaseChronology.ts:101) is missing the `web_hook`, `watcher`/`fs_watcher`/`watch`, and `focus`/`window_focus` entries, so the chronology rows render the raw un-normalized type while the seeded persona gets the canonical one.
- **Root cause**: The alias map + `normalizeTriggerType` were copy-pasted into two files instead of extracted; one copy was later extended (adoption) and the other wasn't (chronology) — the classic duplication-drift failure already happened.
- **Impact**: Inconsistent trigger labels between the adoption matrix and the chronology/detail surfaces for the affected alias families; every future alias addition must be made twice or the surfaces diverge further.
- **Fix sketch**: Extract `TRIGGER_TYPE_ALIASES` + `normalizeTriggerType` into a shared module (e.g. `shared/triggerAliases.ts` next to `vaultAdoptionMatcher.ts`), take the union of both maps as the canonical set, and import it from both ChronologyAdoptionView.tsx and useUseCaseChronology.ts. Two-file change, no behavior change beyond fixing the drift.

## 2. Dead legacy callbacks kept alive with a `void (...)` expression hack
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/sub_generated/adoption/ChronologyAdoptionView.tsx:1543
- **Scenario**: `handleApplyEdits` (line 1408) and `handleDiscardEdits` (line 1421) — ~35 lines including a refine-prompt builder and a full re-seed-from-template path — are defined but never invoked by any surface. The JSX renders `{void (handleApplyEdits || handleDiscardEdits)}` purely to suppress the unused-variable lint, with a comment admitting no surface invokes them since the PersonaMatrix variant was retired.
- **Root cause**: The original PersonaMatrix edit surface was replaced by PersonaLayoutBuild, but its callbacks were kept "live for build flow" via a lint-defeating void expression instead of being deleted.
- **Impact**: ~35 lines of unreachable logic (including a `lifecycle.handleRefine` call path and `extractDimensionData` re-seed) that readers must reason about, plus a lint suppression pattern that hides genuinely dead code from tooling. `handleDiscardEdits` also silently pins `triggerSelections.perUseCase` into a dep list, widening the memo graph for nothing.
- **Fix sketch**: Delete both callbacks and the `{void (...)}` line. If matrix-cell editing is genuinely planned to return, the logic lives in git history; alternatively move it to a documented follow-up note. Verify nothing else references them (they are component-local, so the check is confined to this file).

## 3. Gallery eagerly full-parses every template's design_result JSON just to detect drafts
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: eager-parse
- **File**: src/features/templates/sub_generated/gallery/cards/useGalleryActions.ts:57
- **Scenario**: The `draftIds` memo calls `getCachedDesignResult(item)` for every loaded review on every `allItems` change. Each call JSON-parses the full `design_result` blob (structured prompts, flows, connectors — often tens of KB per template). With 100+ templates loaded via the infinite list, first render of the gallery parses all of them up front, defeating the deliberate lazy design elsewhere (ComfortableRow.tsx:73 only parses when a row is expanded, and `getCachedLightFields` exists precisely to avoid full parses on the list path).
- **Root cause**: The dev-only `_draft` marker lives inside the full design_result, so draft detection reaches for the heavy parser instead of a light field.
- **Impact**: Main-thread jank proportional to catalog size on gallery mount and on each fetched page (parse cost is paid once per item thanks to the cache, but all at once and for rows the user may never expand).
- **Fix sketch**: Expose the `_draft` flag through `getCachedLightFields` (a cheap regex/`includes('"_draft":true')` probe or a dedicated light parse of the first level), or persist a `is_draft` column on the review row so no JSON parse is needed. Keep `getCachedDesignResult` for expanded rows only.

## 4. Arch-category heuristics re-derived per item on every gallery recompute
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: repeated-computation
- **File**: src/features/templates/sub_generated/gallery/cards/useGalleryActions.ts:127
- **Scenario**: `displayItems` calls `deriveArchCategories(connectors)` inside its filter for every item whenever the component filter, coverage filter, or readiness inputs change, and `availableComponents` (line 84) does the same walk again over all items. For connectors missing from `connector-categories.json`, `inferCategory` (architecturalCategories.ts:109) runs ~25 sequential `includes` checks and fires a dev `console.warn` — repeated on every recompute, so one unmapped connector spams the console dozens of times per filter click.
- **Root cause**: Category derivation is stateless per review but is not cached per item; two independent memos redo it, and the unmapped-connector warning has no once-per-name guard.
- **Impact**: O(items × connectors × 25 substring checks) on each filter/sort interaction in a 100+ template gallery — bounded but pure waste on a hot interaction path, plus dev-console noise that buries real warnings.
- **Fix sketch**: Build one `Map<reviewId, Set<categoryKey>>` in a single memo keyed on `allItems` and consume it from both `availableComponents` and `displayItems`. Guard the `console.warn` in `inferCategory` with a module-level `Set` of already-reported names.

## 5. SelectPills/QuestionCard re-exported through a three-hop back-compat chain
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/templates/sub_generated/adoption/QuestionnaireFormGrid.tsx:22
- **Scenario**: `SelectPills`/`PillOption` are defined in SelectPills.tsx, re-exported by QuestionnaireFormGridParts.tsx:26 ("so importers that imported from this file still resolve"), and re-exported again by QuestionnaireFormGrid.tsx:23-25 alongside `QuestionCard` and the category config. A reader chasing an import can hop through three files before reaching the definition.
- **Root cause**: Two successive extractions (Parts split, then SelectPills split) each left a compatibility re-export instead of updating call sites.
- **Impact**: Pure navigation/maintenance friction and a wider public surface than needed; no runtime cost. Risk of new code importing from the wrong hop and cementing the chain.
- **Fix sketch**: Grep for imports of `SelectPills`, `PillOption`, and `QuestionCard` from QuestionnaireFormGrid/QuestionnaireFormGridParts, point them at the defining modules (SelectPills.tsx, QuestionnaireFormGridParts.tsx), then drop the re-export lines. Cross-context callers outside this directory need the same one-line import fix — verify with a repo-wide grep before deleting.
