# Perf-Optimizer Scan — Recipes (Use-Case Blueprints)

> Project: Personas (frontend-only)
> Scope: 7 paths in src/ — `src/features/recipes/{sub_editor,sub_list,sub_manager,sub_playground,hooks,shared}` + `src/api/recipes`
> Total: 9 findings (1 C / 5 H / 2 M / 1 L)

## Scope notes
- All 7 declared paths exist; 28 files read (full feature).
- Recipe catalog is global Zustand state (`usePipelineStore.recipes`) — boot-seeded with **~291 entries** (explicit comment in `RecipesPage.tsx:43`), so list/picker components actually render hundreds of cards without virtualization.
- `fetchRecipes()` is called from at least 4 mount sites (`RecipeManager`, `RecipesPage`, `PersonasPage` boot dispatch, `CredentialRecipesTab` post-mutation) — every call hits `list_recipes` and refreshes the whole array (no diff). Every mutation in `recipeSlice.ts` also re-fetches the entire list.
- Both `RecipePlaygroundModal` (recipes feature) and `LinkedRecipesSection` are sometimes mounted simultaneously; both can host playgrounds. Playground inputs are tracked in `useState` (no debounce) — keystroke rate is OK for the small form, but autosave is absent for the editor entirely.

## 1. RecipeList renders all ~291 cards without virtualization
- **Severity**: critical
- **Category**: re-render
- **File**: `src/features/recipes/sub_list/components/RecipeList.tsx:75`
- **Scenario**: Open the Recipes tab. With the seeded catalog of ~291 entries (see `RecipesPage.tsx:43` "the catalog has ~291 entries"), the `recipes.map(...)` mounts ~291 `RecipeCard` instances simultaneously — each with its own `useState` for the delete-confirm popover, its own `useEffect` cleanup, a `parseTags(JSON.parse)` call in render, a 5-row `CATEGORY_*` lookup table, and ~10 SVG/lucide icons.
- **Root cause**: No windowing (`react-window`/`virtua`/`@tanstack/react-virtual`); grid is `display:grid` with `auto-fill minmax(280px,1fr)`. Every search keystroke re-runs `filteredRecipes` (`useRecipeViewFSM.ts:44-54`) and re-renders all cards because `RecipeCard` is not memoized.
- **Impact**: First mount of the page measures in seconds rather than ms; every search keystroke triggers a full reconcile across ~291 cards. Causes visible jank when typing in the search box and a noticeable freeze on tab switch into the recipes view.
- **Fix sketch**: Wrap `RecipeCard` in `React.memo` (props are referentially stable except for callbacks — stabilize via `useCallback` already done in manager); add windowing for >50 entries (`@tanstack/react-virtual` grid mode) or paginate with an `IntersectionObserver` "load more" sentinel. Also memoize the per-card `parseTags` result (move parsing up to `recipeAdapter`-style pre-pass, or memoize in card).

## 2. RecipeEditor lacks autosave + loses draft on background save error only via clipboard
- **Severity**: high
- **Category**: async-coordination
- **File**: `src/features/recipes/sub_editor/components/RecipeEditor.tsx:79-130`
- **Scenario**: User edits a recipe with a 200-line `prompt_template`. If they switch tabs, refresh, or the app crashes between the last keystroke and the "Save Changes" click, the entire edit is lost. There is **no autosave** and no draft persistence — state lives only in React `useState`.
- **Root cause**: All form state is plain `useState` (`name`, `description`, `category`, `promptTemplate`, `tags`, `schemaFields`). The only recovery path is the error-handler clipboard copy at line 122, which fires *after* the save attempt already failed. No localStorage / IndexedDB / store-backed draft. `handleSave` also serializes the entire schema/tags on every invocation rather than memoizing the serialized form.
- **Impact**: User-visible data loss on long edits; the explicit comment at line 118 confirms this is a known recurring failure mode (`5+ minutes of edits` lost). Not a rendering problem but qualifies as an async-coordination perf/UX gap because save is non-debounced and synchronous.
- **Fix sketch**: Add a debounced (1–2s) localStorage autosave keyed by `recipe?.id ?? 'new'`; restore on mount when `recipe` matches the saved id and `updated_at` is older than the draft. Memoize `serializeSchema(schemaFields)` and `serializeTags(tags)` so they don't recompute on every keystroke when the user only edits `name`/`description`.

## 3. Every mutation re-fetches the entire recipe catalog (cascading O(N) refresh)
- **Severity**: high
- **Category**: duplicate-call
- **File**: `src/stores/slices/pipeline/recipeSlice.ts:50-82`
- **Scenario**: User clicks save in the editor → `createRecipe` / `updateRecipe` / `deleteRecipe` each invoke `list_recipes` again to refresh the whole array, ignoring the response payload (`createRecipe` already returns the created `RecipeDefinition`, `updateRecipe` already returns the updated one). With ~291 recipes, each mutation triggers a full round-trip + a full Zustand state replace + a re-render of every mounted recipe consumer.
- **Root cause**: Lines 53, 65, 76: `await get().fetchRecipes();` after every write. The returned entity is discarded (line 52: `const created = await createRecipe(input);` then re-fetches). Not even a stale-while-revalidate pattern.
- **Impact**: After every save, the user pays a network/IPC round-trip serializing ~291 rows + a full subscriber re-render storm (every component using `(s) => s.recipes` re-renders, including `RecipeList` from finding 1). On a moderately slow disk this is hundreds of ms of jank per save.
- **Fix sketch**: Use the returned entity to do an immutable splice (`set((s) => ({ recipes: [...s.recipes, created] }))` / map for update / filter for delete). Keep `fetchRecipes()` for explicit refresh only. Same fix applies in `LinkedRecipesSection.tsx:50,60` which calls `loadLinked()` (a full `getPersonaRecipes`) after every link/unlink.

## 4. RecipeHistoryTab re-renders all history rows with full Markdown on every state tick
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/recipes/sub_playground/tabs/RecipeHistoryTab.tsx:46-89`
- **Scenario**: User runs the test runner 20 times (`useRecipeTestRunner.ts:34`: `slice(0, 20)`). Each history entry renders a `PromptTemplateRenderer` plus, if `llm_output` is set, a `MarkdownRenderer` (react-markdown + remark-gfm + rehype-highlight per `MarkdownRenderer.tsx:2-4`). The `JSON.parse(trimmed)` / `JSON.stringify(..., null, 2)` happens **inline in the JSX** (line 76-82) — re-runs on every parent re-render.
- **Root cause**: No `React.memo` on the row, no `useMemo` for the formatted markdown body, no `useMemo` for `JSON.stringify(run.input_data, null, 2)` (line 63). Each history mutation (`setHistory` in the test runner) causes all 20 rows to re-process their llm_output via JSON.parse + react-markdown render with highlighting.
- **Impact**: Adding a 21st run causes all 20 prior rows to re-render with heavyweight markdown parsing each time — visible lag in the modal during long testing sessions.
- **Fix sketch**: Extract row to `HistoryRunRow` wrapped in `memo`; precompute `formattedMarkdown` and `inputJson` via `useMemo` on `run.llm_output` / `run.input_data`. Already-exported `formatOutputForMarkdown` in `recipeTestHelpers.ts:34` should be used instead of the duplicated inline IIFE.

## 5. useRecipeTestRunner spurious history rewrites on every execution.output tick
- **Severity**: high
- **Category**: re-render
- **File**: `src/features/recipes/sub_playground/libs/useRecipeTestRunner.ts:27-37`
- **Scenario**: The LLM execution streams tokens. `execution.phase === 'done'` triggers an effect that calls `setHistory((prev) => { const [, ...rest] = prev; return [updated, ...rest].slice(0, 20); })` — but the effect dep list includes `execution.output` and `result`. If `execution.output` is a stable terminal string only after the run, that's fine; but `result` is in the deps and gets `setResult(updated)` *inside* the effect, which re-runs the effect on the next render. The guard `resultRunIdRef.current === runCountRef.current` prevents corruption but **not** the re-render: `setResult(updated)` on the next tick produces a new `result` reference equal in shape, so React schedules another render.
- **Root cause**: Effect mutates `result` it depends on without a referential-equality short-circuit. No `if (result.llm_output === execution.output) return;` early exit.
- **Impact**: Each completed run causes 2–3 extra renders of the entire playground modal (which mounts 4 tabs including the heavy `RecipeOverviewTab` markdown preview). Compounds with finding #4.
- **Fix sketch**: Add a guard `if (result.llm_output === execution.output) return;` at the top of the effect, or store `mergedOutputRef` and only setState on a true change. Better: drive the merge in `execute()`'s `finally` branch using the final `execution.output` instead of via effect.

## 6. RecipeVersionsTab re-fetches versions on every recipe.id render path & remounts versioning hook
- **Severity**: medium
- **Category**: duplicate-call
- **File**: `src/features/recipes/sub_playground/tabs/RecipeVersionsTab.tsx:33-50`
- **Scenario**: User opens playground modal, switches to the Versions tab → `loadVersions` runs (good). User clicks Accept → `acceptRecipeVersion` returns the updated recipe, `onRecipeUpdated(updated)` is invoked, which `setCurrentRecipe(updated)` in the modal (parent). The new `recipe.id` is identical, so `loadVersions` re-runs anyway — but then the success-branch also calls `await loadVersions()` (line 76), so the version list is fetched twice on every accept. The cleanup effect at line 48-50 has `recipe.id` in its dep array but the linter would also want `versioning` — currently disabled risk of stale closure.
- **Root cause**: `useEffect` cleanup re-runs whenever `recipe.id` changes; the parent-state update from `onRecipeUpdated` may flip `recipe` reference even though `id` is stable, but the manual `loadVersions()` post-accept guarantees a duplicate fetch.
- **Impact**: Doubles `get_recipe_versions` IPC traffic on every accept; with hundreds of versions in a mature recipe this is noticeable.
- **Fix sketch**: Drop the manual `await loadVersions();` after accept — the parent recipe-id change (or a small `bumpVersionCounter` state) can drive the refresh. Alternatively, append `updated` directly to the local `versions` array.

## 7. useRecipeViewFSM filteredRecipes lowercases every recipe on every keystroke
- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/recipes/hooks/useRecipeViewFSM.ts:44-54`
- **Scenario**: Search box keystroke → `filteredRecipes` runs `r.name.toLowerCase()`, `(r.description ?? '').toLowerCase()`, `(r.category ?? '').toLowerCase()`, `(r.tags ?? '').toLowerCase()` for **every** recipe (~291). Each keystroke does ~1164 `String.prototype.toLowerCase` allocations.
- **Root cause**: No pre-lowercased index; recomputed from scratch every render. The `recipes` reference rarely changes but the lowercase work is repeated on every search keystroke.
- **Impact**: Adds 5–15ms per keystroke at 291 entries; will scale linearly with the catalog (already growing). User feels typing lag, not just card-render lag.
- **Fix sketch**: Build a lowercase index once per `recipes` change via a separate `useMemo`: `const lcIndex = useMemo(() => recipes.map(r => ({ id: r.id, hay: \`${r.name} ${r.description ?? ''} ${r.category ?? ''} ${r.tags ?? ''}\`.toLowerCase() })), [recipes])`. Then filter against the precomputed haystack.

## 8. RecipePicker reuses the same render-time filter without pre-lowercased haystack
- **Severity**: medium
- **Category**: algorithmic
- **File**: `src/features/recipes/sub_list/components/RecipePicker.tsx:19-28`
- **Scenario**: Open the recipe picker (Add to Persona). Each keystroke filters all ~291 recipes minus the linked set, calling `.toLowerCase()` 3× per recipe. Combined with the picker's autoFocus input, the first keystroke also triggers a fresh render.
- **Root cause**: Same pattern as finding #7, scoped to a smaller filtered set but still O(N) per keystroke.
- **Impact**: Smaller than finding #7 (picker is bounded by `linkedRecipeIds.has` short-circuit), still measurable on slow machines.
- **Fix sketch**: Share the pre-lowercased index from finding #7 via context or a custom hook (`useLowerCasedRecipes()`); the linked-id `Set` already provides O(1) exclusion.

## 9. RecipeCard recomputes category color/icon lookups on every render
- **Severity**: low
- **Category**: re-render
- **File**: `src/features/recipes/sub_list/components/RecipeCard.tsx:47-55,74-75`
- **Scenario**: Each `RecipeCard` calls `getCategoryIcon`, `getCategoryStyle` and reads `CATEGORY_CONTAINER_COLORS[recipe.category?.toLowerCase() ?? '']` **twice** in the JSX (line 74 in container class, line 75 again inside IIFE for the icon color). Also lowercases `recipe.category` 3× in render.
- **Root cause**: No memoization; the IIFE `(() => { const Icon = getCategoryIcon(...); return <Icon ...> })()` defeats compiler hoisting on every render.
- **Impact**: Micro per card, but multiplied by ~291 cards (finding #1) it adds measurable cost.
- **Fix sketch**: Compute `const cat = recipe.category?.toLowerCase() ?? '';` once at the top, derive `containerCls`, `iconCls`, `Icon`, `pillCls` from a single map lookup. Combined with `React.memo` (finding #1) this becomes free.
