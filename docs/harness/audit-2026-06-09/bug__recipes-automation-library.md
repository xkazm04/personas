# Bug Hunter — recipes-automation-library
> Total: 6
> Severity: 1 critical, 3 high, 2 medium

## 1. Versioning "Accept" silently clobbers concurrent edits — no compare-and-swap against the live recipe
- **Severity**: critical
- **Category**: state-corruption / silent-failure (lost update)
- **File**: src/features/recipes/sub_playground/tabs/RecipeVersionsTab.tsx:60-83 ; src-tauri/src/db/repos/resources/recipes.rs:474-564 ; src-tauri/src/commands/recipes/crud.rs:412-455
- **Scenario**: User opens a recipe's Versions tab and clicks "Generate new version". `start_recipe_versioning` reads the recipe's current `prompt_template`/`input_schema` (crud.rs:420-427) and the LLM spends ~30-300s producing a diff *against that snapshot*. Meanwhile the same recipe is edited elsewhere — via the RecipeEditor (`updateRecipe`), via "Save mock" in `RecipeInputSection.handleSaveMockValues` (RecipeInputSection.tsx:52), or via a second Accept/Revert. The user then clicks "Accept & apply". `handleAccept` posts `versioning.draft` straight into `accept_version`, whose step 4 `UPDATE recipe_definitions SET prompt_template=?, input_schema=?, sample_inputs=?, description=? WHERE id=?` (recipes.rs:541-544) overwrites the row unconditionally.
- **Root cause**: The accept path has no optimistic-concurrency token (no `updated_at`/version check in the WHERE clause). The `BEGIN IMMEDIATE` + UNIQUE(recipe_id,version_number) machinery only protects the *version-number counter*; it does nothing to detect that the recipe body changed since the draft was generated. The draft is computed against a stale base and applied as an unconditional last-writer-wins write.
- **Impact**: data loss — every edit made to the recipe during the (long) generation window is silently destroyed, with no error and no entry in version history attributing the loss.
- **Fix sketch**: Capture the recipe's `updated_at` (or a content hash) at generation start, thread it through `acceptRecipeVersion`, and make step 4 `... WHERE id=?N AND updated_at=?expected`; if `rows == 0`, abort with a "recipe changed under you — regenerate" error instead of overwriting. This makes lost-update structurally impossible regardless of which mutation path raced.

## 2. Recipe edits via the editor/mock-save are never versioned, so the first "v1 snapshot" misrepresents history
- **Severity**: high
- **Category**: state-corruption / silent-failure
- **File**: src-tauri/src/db/repos/resources/recipes.rs:104-210 (update) ; recipes.rs:502-525 (accept_version v1 snapshot) ; src/features/recipes/sub_playground/tabs/RecipeInputSection.tsx:52-63
- **Scenario**: A recipe is created, then edited several times through `RecipeEditor` (`update_recipe`) and through "Save mock" (`updateRecipe` with `sample_inputs`). None of these create a `recipe_versions` row. Later the user runs the versioning flow once. `accept_version` sees `latest == 0`, so it snapshots the *current* recipe as version 1 with the label "Initial version (snapshot before first edit)" (recipes.rs:521).
- **Root cause**: Versioning is bolted onto only one of several mutation paths. `update` (the editor path) and the mock-save path write `recipe_definitions` directly and never call `create_version`. The "snapshot before first edit" invariant the code claims is false: by the time the first Accept runs, the row may already reflect many editor edits, so v1 captures a mutated state and all prior states are unrecoverable.
- **Impact**: corruption of the audit/version trail — version history is not a faithful log; users who rely on "revert" to recover an earlier editor edit cannot, because that state was never snapshotted. Misleading provenance.
- **Fix sketch**: Either route all recipe-body mutations through a single `mutate_and_version` repo function that snapshots-then-updates inside one transaction, or stop labelling the first snapshot as "before first edit" and instead snapshot on every `update` that changes a versioned field.

## 3. Free-input JSON that parses to a non-object is sent verbatim and triggers an opaque deserialization failure
- **Severity**: high
- **Category**: edge-case / silent-failure
- **File**: src/features/recipes/sub_playground/tabs/RecipeTestRunnerTab.tsx:36-50 ; src-tauri/src/db/models/recipe.rs:145-148 ; src-tauri/src/commands/recipes/crud.rs:166-189
- **Scenario**: A recipe has no input schema, so the test runner shows the free-text box. The user types valid JSON that is *not* an object — e.g. `42`, `"hello"`, `true`, or `[1,2,3]`. `JSON.parse(freeInput)` succeeds (RecipeTestRunnerTab.tsx:42), so the `catch`-fallback `{ input: freeInput }` is skipped and `inputData` becomes a number/string/array. That value is passed as `Record<string,unknown>` to `executeRecipe`, then deserialized into `RecipeExecutionInput.input_data: HashMap<String, Value>` on the Rust side.
- **Root cause**: The fallback only fires on a parse *exception*, not on a successful-parse-of-wrong-shape. The contract "input_data is an object" is assumed but never enforced at the boundary. Serde rejects a non-object as a map, so the user gets a raw `invalid type: integer, expected a map`-style IPC error instead of the intended graceful `{ input: ... }` wrapping.
- **Impact**: UX degradation — confusing, leaky error for a perfectly reasonable input; the "type free text, we'll wrap it" affordance silently breaks for any scalar/array JSON.
- **Fix sketch**: After `JSON.parse`, check `typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)`; otherwise fall back to `{ input: freeInput }`. Make the wrong-shape case take the same path as the parse-failure case.

## 4. `handleSaveMockValues` has no error handling and no in-flight guard — unhandled rejection + false "Saved"
- **Severity**: medium
- **Category**: silent-failure / recovery-gap
- **File**: src/features/recipes/sub_playground/tabs/RecipeInputSection.tsx:52-63
- **Scenario**: User clicks "Save mock". If the recipe was deleted underneath them, or the backend update fails, `await updateRecipe(...)` rejects. There is no try/catch, so the promise rejects unhandled; `setMockSaved(true)` never runs and the user sees no toast, no error, nothing — the click appears to do nothing. Conversely there is no `disabled`/in-flight guard, so rapid double-clicks fire two concurrent `update_recipe` calls.
- **Root cause**: Unlike the sibling `RecipeEditor.handleSave` (which wraps `updateRecipe` in try/catch + toast + clipboard rescue), this lighter "save mock" path was written as fire-and-forget with an optimistic `setMockSaved(true)` that is never reconciled against actual success/failure.
- **Impact**: UX degradation / silent failure — user believes mock values were persisted when they may not have been; possible duplicate writes.
- **Fix sketch**: Wrap in try/catch, gate the button with a `saving` flag, set `mockSaved` only after the await resolves, and surface a toast on rejection (mirror `RecipeEditor.handleSave`).

## 5. Playground `currentRecipe` goes stale after mock-save; "Saved Mock Values" panel shows pre-save data
- **Severity**: medium
- **Category**: stale-data / state-corruption
- **File**: src/features/recipes/sub_playground/components/RecipePlaygroundModal.tsx:31-32,95-106 ; src/features/recipes/sub_playground/tabs/RecipeInputSection.tsx:52-63 ; src/features/recipes/sub_playground/tabs/RecipeTestRunnerTab.tsx:17
- **Scenario**: The modal seeds `currentRecipe` from the prop and only ever advances it through `onRecipeUpdated` (wired solely to the Versions tab, RecipePlaygroundModal.tsx:98). When the user saves mock values, `RecipeInputSection` calls `updateRecipe` directly and never notifies the modal. `mockValues` is `useMemo`'d on `recipe.sample_inputs` (RecipeTestRunnerTab.tsx:17), so the "Saved Mock Values" panel and the "Load mock" button keep showing the *old* `sample_inputs` for the rest of the session. The store's `recipes` array is also not refreshed (the call bypasses the `recipeSlice` actions), so closing/reopening from the list still shows stale data until a full `fetchRecipes`.
- **Root cause**: Two parallel write paths to the recipe (the versioning path that calls `onRecipeUpdated`, and the mock-save path that doesn't) with no single source of truth; the local `currentRecipe` copy diverges from the DB.
- **Impact**: UX degradation — users save mocks then see their old values reflected back, leading them to re-save or believe the feature is broken.
- **Fix sketch**: Have `handleSaveMockValues` return/propagate the updated recipe and call an `onRecipeUpdated`-style callback (or route through the `recipeSlice` so the store + modal both refresh), so the single `currentRecipe` always reflects the last write.

## 6. Two-step `try_begin` + `set_target` lets the delete-guard miss a just-started run (TOCTOU window)
- **Severity**: medium
- **Category**: race-condition
- **File**: src-tauri/src/commands/recipes/crud.rs:216-222 (execution), 434-440 (versioning) ; src-tauri/src/lib.rs:176-213
- **Scenario**: `start_recipe_execution` first calls `registry.try_begin("recipe_execution", id)` (which sets `id` and resets `target_ref = None`, lib.rs:183), then in a *separate* lock acquisition calls `registry.set_target("recipe_execution", Some(recipe_id))` (crud.rs:222). Between those two locked sections, a concurrent `delete_recipe` for that same recipe can run: it calls `active_target("recipe_execution")` (crud.rs:126), which sees `id = Some(..)` but `target_ref` still `None`, so it reports no conflict and proceeds to delete the recipe — even though a run against it has already been claimed and is about to spawn.
- **Root cause**: The "claim the domain" and "record which recipe it targets" operations are not atomic. `try_begin` deliberately clears `target_ref`, opening a window where the run is live but untargeted, defeating the scoped-conflict guard the target mechanism exists to provide.
- **Impact**: orphaned background CLI process running against a now-deleted recipe; the delete proceeds when it should have been rejected with "cancel the in-flight task first". Low probability but a real correctness hole in the delete-safety invariant.
- **Fix sketch**: Extend `try_begin` to accept an optional target and install `id` + `target_ref` under the single lock (e.g. `try_begin_with_target(domain, id, target)`), so a run is never observable as claimed-but-untargeted.
