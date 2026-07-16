# templates/recipes — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Templates & Recipes | Files read: 19 | Missing: 0

## 1. `mockRecipes.ts` is dead seed data still shipped through the barrel
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/sub_recipes/mockRecipes.ts:18
- **Scenario**: `MOCK_RECIPES` (497 lines of hand-authored catalog data) has zero importers anywhere in `src/` or `src-tauri/` — its only reference is the re-export in `sub_recipes/index.ts:16`. `RecipesPage` has been "wired to live recipes" (Stage E.3) via `usePipelineStore` + `recipeDefinitionsToRecipes` since the store migration.
- **Root cause**: The Stage E.3 switch from the prototype's hand-authored array to the DB-backed catalog left the seed file and its barrel export behind. Doc comments still point at it (`types.ts:16` "Storage in the prototype: a hand-authored array in mockRecipes.ts", `useEligibility.ts:62` "passing a stable `MOCK_RECIPES` array").
- **Impact**: ~500 lines of dead data that must be kept type-correct on every `Recipe` shape change, and — because `DesignReviewsPage` imports `RecipesPage` from the barrel — the whole array is pulled into the app bundle (~10 KB of strings) despite never rendering. The stale comments actively mislead readers about where catalog data comes from. `useNoPersonaSelected` (useEligibility.ts:43) is likewise defined + barrel-exported with no callers.
- **Fix sketch**: Delete `mockRecipes.ts` and its barrel export; drop `useNoPersonaSelected` (or keep only if a cross-context caller shows up — a repo-wide grep found none, but re-verify before deleting the hook). Update the two stale doc comments in `types.ts` and `useEligibility.ts` to reference the pipeline-store catalog. Verify with `tsc` + the existing `recipeAdapter`/`recipeStaleness` tests.

## 2. `BindingInput` repeats the same single/multi text-input block five times
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/templates/sub_recipes/components/RecipeAdoptionModal.tsx:288
- **Scenario**: Any change to how connector-name inputs behave (trim rules, validation, styling, the comma-split for multi values) must be applied in five places; the `slack-channel`, `github-repo`, and `email-address` branches are byte-for-byte identical except for placeholder text, and `google-drive-folder` / `google-calendar` are the same single-input shape again.
- **Root cause**: Each `BindingKind` case was written out longhand while the pickers were stubbed as plain text inputs ("DEFERRED: live picker" in every branch), so the interim text-input pattern got copy-pasted per kind (~120 of the switch's ~235 lines).
- **Impact**: Real drift hazard on code that will definitely be touched again — the comments promise live pickers per kind, and until then every tweak to the comma-split multi logic risks being applied to 2 of 3 twins. Also inflates a 526-line component file.
- **Fix sketch**: Extract two small helpers inside the file: `SingleTextBinding({ placeholder, type = 'text', value, onChange })` and `MultiTextBinding({ placeholder, value, onChange })` (owning the `split(',').map(trim).filter(Boolean)` logic once). Collapse the five connector-kind cases to one-liners that pick the placeholder. The switch then keeps only the genuinely distinct kinds (text/number/cron/enum).

## 3. Adopted/Update badge chip duplicated between table row and detail header
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/templates/sub_recipes/components/RecipesTableResults.tsx:262
- **Scenario**: The "Update" (ArrowUpCircle, warning tone) and "Adopted" (Check, success tone) chips are rendered with near-identical markup twice: RecipesTableResults.tsx:262-276 and RecipeDetailHeader.tsx:80-93. A tone/copy change in one spot silently diverges from the other (they already differ slightly: `px-1` vs `px-1.5`, tooltip presence).
- **Root cause**: The staleness feature added the chip to the browse row and the detail header separately instead of extracting a shared `AdoptionBadge`.
- **Impact**: Bounded visual-drift risk across the two surfaces that must present the same adoption state. Related micro-cleanup in the same file: `toggleSort` (RecipesTableResults.tsx:87-91) has a dead ternary — `key === 'eligibility' ? 'asc' : 'asc'` — both branches are `'asc'`.
- **Fix sketch**: Add `AdoptionBadge({ stale, adoptedVersion?, currentVersion? })` next to `EligibilityChip` (which already models this shared-chip pattern) and use it in both call sites. While there, simplify `toggleSort`'s new-key branch to `{ key, dir: 'asc' }`.

## 4. Search filter rebuilds and lowercases every recipe's haystack on each keystroke
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/templates/sub_recipes/components/RecipesBrowseList.tsx:86
- **Scenario**: Typing in the catalog search re-runs the `filtered` memo per keystroke; for each of the ~291 recipes it allocates `[name, summary, description, ...tags].join(' ').toLowerCase()` — descriptions are multi-sentence, so this is roughly 200-300 KB of string churn per keypress — and the new `filtered` array identity then forces `RecipesTableResults` to re-sort and re-render all visible rows.
- **Root cause**: The searchable haystack is derived inside the filter predicate instead of being precomputed once per catalog load; search is also uncontrolled by any debounce, so the full pipeline runs at typing speed.
- **Impact**: Bounded today (~291 recipes, likely ~1 ms/keystroke) but it is the hottest interaction on the page and scales linearly with catalog size and description length; the comment in `RecipesBrowseList` explicitly anticipates the catalog growing.
- **Fix sketch**: Precompute `haystack` once per recipe in a `useMemo(() => new Map(recipes.map(r => [r.id, [...].join(' ').toLowerCase()])), [recipes])` (or attach it during `recipeDefinitionsToRecipes`, which already does a single adapter pass). The per-keystroke filter then reduces to a `Map.get(...).includes(q)`.

## 5. `categoryLabel` rebuilds the 9-entry label record for every table row render
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/templates/sub_recipes/libs/categoryLabels.ts:21
- **Scenario**: `RecipeRow` (RecipesTableResults.tsx:283) calls `categoryLabel(t, recipe.category)`, which invokes `getCategoryLabels(t)` — constructing a fresh 9-key object with 9 i18n property reads — once per row, per render. With ~291 rows re-rendering on every search keystroke / sort toggle, that is ~2,600 throwaway object allocations per interaction.
- **Root cause**: `categoryLabel` was written as a convenience wrapper that rebuilds the full record to look up one key, and it sits inside a render loop.
- **Impact**: Micro in absolute terms but pure waste on the page's hot render path, and it compounds with finding 4's per-keystroke full-table re-render. `RecipesBrowseList` already computes the same record via `getCategoryLabels(t)` in a memo (line 62), showing the intended pattern.
- **Fix sketch**: Memoize the record once — either `const labels = useMemo(() => getCategoryLabels(t), [t])` in `RecipesTableResults` passed down (or looked up directly in `RecipeRow` via a tiny `useCategoryLabels()` hook), or make `getCategoryLabels` cache per `t` reference with a module-level `WeakMap<Translations, Record<...>>`. Then `categoryLabel` becomes a plain map lookup.
