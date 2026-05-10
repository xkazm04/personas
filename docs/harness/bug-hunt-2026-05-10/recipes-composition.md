# Bug Hunt — Recipes & Composition

> Group: Pipelines, Recipes & Execution
> Files scanned: 12
> Total: 2C / 6H / 4M / 1L = 13 findings

---

## 1. Concurrent edits silently overwrite each other (last-write-wins)

- **Severity**: high
- **Category**: versioning-conflict
- **File**: `src-tauri/src/commands/recipes/crud.rs:91`
- **Scenario**: User A opens a recipe in `RecipeEditor`. User B (or the derive-from-template flow, or a Glyph composer round) updates the same recipe in DB. User A clicks Save. The `update_recipe` SQL is a blind `UPDATE ... WHERE id = ?` — there is no `updated_at` / row-version guard, no ETag check on the frontend (`RecipeEditor.tsx:103` passes only `recipe.id`). User B's edits vanish without warning.
- **Root cause**: `repo::update` (`recipes.rs:104`) accepts any `UpdateRecipeInput` that hits the `id`. Frontend has no awareness of a stale `updated_at`. Combined with the explicit "rescue 5 minutes of edits" comment at `RecipeEditor.tsx:114-120`, the design assumes single-writer but does not enforce it.
- **Impact**: Authors lose work, especially when `derive_recipes_from_template` (`recipe_derivation.rs:233-263`) runs in the background while a user is editing a derived recipe — the derive flow blindly overwrites manual edits to `prompt_template`, `description`, `category`, and bumps `source_version`.
- **Fix sketch**: Add `WHERE id = ? AND updated_at = ?` optimistic-lock; return `Conflict` AppError when 0 rows affected; surface a "this recipe was updated elsewhere — view diff / overwrite / discard" dialog instead of silently winning.

## 2. `delete_recipe` only blocks the active recipe's tasks via a global lock keyed on domain — different recipes leak

- **Severity**: high
- **Category**: race-condition
- **File**: `src-tauri/src/commands/recipes/crud.rs:107-114`
- **Scenario**: User starts `start_recipe_execution` for recipe A. While A's CLI is running, user opens recipe B in the playground (a different recipe) and clicks Delete in the list. Delete is rejected with "Cannot delete recipe while a recipe execution task is in progress" — even though no task references recipe B. Conversely, the guard does NOT verify the running task is for the recipe being deleted, so it cannot protect against the real failure mode either: deleting the recipe whose CLI task is still streaming output back through `recipe-execution-status` events.
- **Root cause**: `process_registry.get_id("recipe_execution")` only stores `task_id`, never the recipe id. The check is a coarse "is anything running" gate, not an actual referential-integrity guard.
- **Impact**: (a) UX papercut — users cannot delete unrelated recipes during a long versioning task. (b) The intended protection fails — if you delete the recipe whose execution is in flight, the running task continues and emits `completed` against an id whose row is now gone, the `accept_recipe_version` later FK-fails, and `persona_recipe_links` rows survive deletion of the recipe itself only because of the explicit cascade in `repo::delete`.
- **Fix sketch**: Track `(domain, recipe_id, task_id)` in the registry; only block deletion when `recipe_id == id`. Optionally cancel the in-flight task and emit `cancelled` instead of refusing.

## 3. Cancellation race emits `cancelled` even when task already wrote `completed`

- **Severity**: high
- **Category**: race-condition
- **File**: `src-tauri/src/commands/recipes/crud.rs:217-230`
- **Scenario**: Claude CLI finishes and the spawn task is about to call `registry.get_id("recipe_execution")`. User clicks Cancel; `cancel_recipe_execution` calls `take_id` (returns `Some(id)`), unconditionally emits `status="cancelled"` and returns. The spawn task then races: per the module doc at `mod.rs:78-86`, it checks the registry and bails silently — but the `completed` event may have already been emitted from `spawn_ai_artifact_task` BEFORE the registry check (depends on `spawn_ai_artifact_task`'s ordering: it likely emits status THEN clears registry). Frontend now sees `completed` → `cancelled` for the same `execution_id`.
- **Root cause**: `cancel_recipe_execution` emits `cancelled` based solely on `take_id` returning `Some`, without verifying the task has not already entered its terminal-status emit path. The doc claims "exactly one terminal event" but this only holds if the spawn task always checks-then-emits, and the cancel handler doesn't pre-empt a not-yet-emitted check.
- **Impact**: Frontend `useRecipeTestRunner` (line 27-37) merges `execution.output` whenever phase==`done`, but if the listener gets `completed` first then `cancelled`, the result is added to history and then UI flips to "Cancelled" while the history entry still shows the LLM output — confusing state.
- **Fix sketch**: Introduce a per-domain `AtomicBool` "terminal_emitted" flag set by whichever side wins; second emitter no-ops. Or have cancel set a "cancel_requested" flag and let the spawn task observe it before emitting any terminal status.

## 4. `useRecipeTestRunner` re-renders inject new `execute` closure → stale-closure bug in re-render mid-flight

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/recipes/sub_playground/libs/useRecipeTestRunner.ts:39-66`
- **Scenario**: `execute` is `useCallback` with deps `[recipe.id, execution]`. The `execution` object from `useRecipeExecution()` is a fresh object on every render (likely — typical pattern). Every time `execution.phase` changes, `execute` re-creates. If `RecipeTestRunnerTab.handleExecute` (line 33) is called rapid-fire while `execution.phase` is mid-transition, two different `runId`s can both think they're the latest because `runCountRef` increments are not atomic with the `execution.reset()` / `await api.executeRecipe(...)` window.
- **Root cause**: The run-id correlation ref pattern is correct for the late-arriving effect, but `execution.reset()` then `api.executeRecipe()` then `execution.start()` is three awaits during which a second `execute()` call can interleave its `++runCountRef.current` and clobber the first run's `resultRunIdRef = runId` (line 54) right before the first run reads it.
- **Impact**: Run #2's `resultRunIdRef = 2` is set; run #1's `setHistory((prev) => [res, ...prev])` then prepends run #1's preliminary entry on top of run #2's preliminary entry, so the merge effect at line 27 picks up the wrong slot when removing `[, ...rest]`.
- **Fix sketch**: Disable the Run button while `running` (already done), AND guard `execute` with `if (running) return` at the top, AND set `resultRunIdRef` before any await.

## 5. Quick-test stomps on user input — sample_inputs not validated against schema

- **Severity**: medium
- **Category**: validation-gap
- **File**: `src/features/recipes/sub_list/components/RecipeList.tsx:35`
- **Scenario**: A recipe author saves `sample_inputs` as `'{"foo":"bar"}'` but later changes the input_schema to require `{user_query, target_url}`. Quick test runs from the card → JSON.parse succeeds → `executeRecipe` is invoked with `{foo:"bar"}` → backend `render_template` leaves `{{user_query}}` and `{{target_url}}` un-substituted → `validate_no_unreplaced_placeholders` returns the placeholder error — but the toast says "Quick test failed" (line 39), discarding the actual error message.
- **Root cause**: `catch {}` (line 38) swallows the error entirely. There is no schema-vs-sample drift check on save.
- **Impact**: User cannot diagnose why quick-test fails repeatedly. They retry, paste in different inputs, never realize the stored `sample_inputs` is stale.
- **Fix sketch**: Capture error message in catch and put it in the toast. Add a save-time validator in `RecipeEditor` that checks every `sample_inputs` key matches an `input_schema` key.

## 6. `parseMockValues` accepts arrays as objects — type confusion downstream

- **Severity**: medium
- **Category**: validation-gap
- **File**: `src/features/recipes/sub_playground/tabs/recipeTestHelpers.ts:27`
- **Scenario**: A recipe stores `sample_inputs = "[1,2,3]"`. `parseMockValues` returns the array (because `typeof [] === 'object' && [] !== null`). Downstream code uses it as `Record<string, unknown>` and tries to spread it / look up keys, producing nonsense object `{0:1, 1:2, 2:3}` when passed to `render_template`. The Rust HashMap deserializer rejects it, but only with a generic Tauri invoke error.
- **Root cause**: Missing `Array.isArray(parsed)` guard.
- **Impact**: Cryptic "invalid args" failures from the playground when sample_inputs was authored as JSON array.
- **Fix sketch**: `return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;`

## 7. `consumePendingPlayground` racy with `loading` gate — handoff lost if recipes load slowly

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/recipes/sub_manager/components/RecipeManager.tsx:44-51`
- **Scenario**: Glyph composer sets `pendingPlaygroundRecipeId` and routes to RecipeManager. RecipeManager mounts → first `useEffect` fires `fetchRecipes`. Second effect runs immediately with `loading=true` → returns. `fetchRecipes` resolves → `loading=false` → second effect re-runs, calls `consumePendingPlayground()`, finds `exists=false` because Zustand state for `recipes` is the closure value at this render — but if a subsequent setState in `fetchRecipes` hasn't yet flushed (Zustand updates synchronously, but React subscribed via `usePipelineStore((s) => s.recipes)` may need a re-render), `recipes` may still be `[]` even though `loading` is now false.
- **Root cause**: `loading` flips from a useState inside the effect; `recipes` flips from a Zustand subscription. Both updates do not arrive in a guaranteed order. The "consume" is destructive — once `consumePendingPlayground` clears the slot, a missed `exists` check abandons the recipe id forever (line 49 returns silently without re-arming).
- **Impact**: User clicks "Run now" in Glyph composer → lands on Recipes page → playground does NOT auto-open. Bug is intermittent, slow networks make it more likely.
- **Fix sketch**: Don't consume until `exists` is true. Move guard: `if (!recipes.some((r) => r.id === pendingId)) return;` BEFORE `consumePendingPlayground()`.

## 8. `useEffect` for versioning reset uses `recipe.id` dep but fires on unmount of every recipe.id change — race with active versioning

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/recipes/sub_playground/tabs/RecipeVersionsTab.tsx:48-50`
- **Scenario**: User starts a versioning task on recipe A. Mid-stream, the parent `RecipePlaygroundModal` swaps `currentRecipe` (e.g. accept-version mutated it on line 73 and the parent state.recipe id is unchanged but `prompt_template` changed). Cleanup function captures `versioning` from a stale render and calls `versioning.reset()` — but `versioning` here is from the deps array set when `recipe.id` changed. Since `recipe.id` did NOT change but `recipe.prompt_template` did, the cleanup may NOT fire. A pending versioning task is left running with no UI binding.
- **Root cause**: The dep array is `[recipe.id]` (line 50) but the cleanup uses `versioning` captured from an older render. ESLint exhaustive-deps would warn.
- **Impact**: Orphaned in-flight versioning task; cancel button no longer wired to anything; user sees "create new version" UI while a previous task still streams events into `useRecipeVersioning`.
- **Fix sketch**: Use `[recipe.id, versioning]` deps OR move the reset into a layout effect keyed on a stable identity.

## 9. `derive_recipes_from_template` cascades stale `prompt_template` over user edits without confirmation

- **Severity**: critical
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/recipes/recipe_derivation.rs:215-263`
- **Scenario**: User adopts a template-derived recipe, then customizes `prompt_template` via `RecipeEditor`. Later, `derive_recipes_from_template` is re-run (e.g. template payload updated). Comparison at line 220 detects "drift" because `prev.prompt_template` (user-edited) != `synthesize_prompt_template(uc)`. Code path takes the Updated branch: blindly overwrites the user's edits, bumps `source_version`, no audit trail in `recipe_versions` table.
- **Root cause**: The "Updated" branch (line 233) treats user customization as drift. There is no `is_user_modified` flag or `last_user_edit_at` comparison.
- **Impact**: Silent loss of every customization a user made to derived recipes whenever the template payload is re-imported. Combined with finding #1, no version history exists either, so recovery is impossible.
- **Fix sketch**: Snapshot to `recipe_versions` before overwriting; OR detect divergence (compare `updated_at` to `created_at`) and skip auto-update for user-modified rows; OR require an `auto_apply: bool` flag the same way recipe_adoption requires `auto_setup`.

## 10. Description truncation slices on byte offset → multi-byte UTF-8 panic

- **Severity**: high
- **Category**: edge-case
- **File**: `src-tauri/src/commands/recipes/recipe_derivation.rs:81`
- **Scenario**: A use case description ends in a multi-byte char at byte 499 (e.g. an emoji or Cyrillic at the boundary). `&s[..499]` slices on a non-char-boundary → Rust panics with `byte index 499 is not a char boundary`. Function uses `s.len() > 500` (byte length) and `&s[..499]` (byte slice).
- **Root cause**: Mixing UTF-8 byte length with str slicing without `floor_char_boundary`. The companion test at line 359-363 only uses ASCII.
- **Impact**: `derive_recipes_from_template` panics, takes down the Tauri command. Whole template import aborts; partial state in DB if previous use cases already wrote.
- **Fix sketch**: Use `s.chars().take(499).collect::<String>()` or `s.floor_char_boundary(499)` (nightly) or simple loop to find char boundary ≤ 499.

## 11. `bump_version` only bumps last segment — semver minor/major impossible; no rollover protection

- **Severity**: low
- **Category**: edge-case
- **File**: `src-tauri/src/commands/recipes/recipe_derivation.rs:56-63`
- **Scenario**: Repeated derivation runs eventually produce `1.0.4294967295` (u32::MAX) → `parse::<u32>` fails on next bump → falls back to `1.0.0`. Recipe `source_version` history goes nonlinear; if any code relies on lexicographic comparison of versions for "is newer?" decisions, it breaks.
- **Root cause**: u32 patch counter with overflow-fallback to "1.0.0" rather than rolling minor up.
- **Impact**: Astronomically unlikely in practice but a real correctness bug; debugging would be hellish if it ever occurs.
- **Fix sketch**: Use `u64` or check for `u32::MAX` and bump minor instead.

## 12. `link_to_persona` returns the EXISTING row on `INSERT OR IGNORE` but the returned `link.id` is from the existing row — frontend may double-record

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src-tauri/src/db/repos/resources/recipes.rs:298-326`
- **Scenario**: Frontend calls `linkRecipeToPersona({persona_id: P, recipe_id: R})` twice (e.g. user double-clicks "Adopt"). First call inserts `id=L1`, returns `{id:L1, ...}`. Second call's `INSERT OR IGNORE` is a no-op, then `SELECT WHERE persona_id AND recipe_id` returns row with `id=L1`. Frontend's optimistic store may have already added a placeholder with a different temporary id, leading to UI duplicates. Also, `sort_order` and `config` from the second call are silently discarded — caller has no signal that they were ignored.
- **Root cause**: No `RETURNING` clause + INSERT OR IGNORE collapse hides whether the insert happened.
- **Impact**: Adoption UX shows "linked twice" briefly, or worse — `auto_setup`-wired tools get re-wired but the link config silently does not update.
- **Fix sketch**: Detect 0 rows changed → return existing row with an explicit `was_existing: true` field; OR use `INSERT ... ON CONFLICT DO UPDATE` so config/sort_order updates are explicit.

## 13. Composition workflow `nodes_json`/`edges_json` are blob TEXT — no cycle/orphan validation on save

- **Severity**: critical
- **Category**: cycle
- **File**: `src-tauri/src/commands/core/composition_workflows.rs:36-52`
- **Scenario**: Frontend posts a workflow whose `edges_json` describes a cycle (node A → B → A) or references a node id absent from `nodes_json`. `create_composition_workflow` blindly persists the strings. When the executor walks edges, infinite recursion → stack overflow OR null dereference on missing node lookup.
- **Root cause**: The Tauri command is a "thin wrapper" (per the doc at line 3) — but the repo (`composition_workflows.rs:54`) also performs zero validation. There is no shared validator at either layer. `bulk_import` likewise accepts arbitrary blobs.
- **Impact**: A malicious or buggy frontend creates a workflow that crashes the executor on every run; user sees "engine restarted unexpectedly" loops with no clear cause. Migration from localStorage (`bulk_import`) is especially risky since the data was authored without backend validation.
- **Fix sketch**: Add a `validate_workflow(nodes, edges)` step in repo `create`/`update` that (a) parses both as JSON, (b) verifies every edge endpoint references a node id present in `nodes_json`, (c) runs a DFS cycle check, (d) caps node count. Return `Validation` AppError on any violation. Apply same check inside `bulk_import` per-row, accumulating the count of dropped rows.
