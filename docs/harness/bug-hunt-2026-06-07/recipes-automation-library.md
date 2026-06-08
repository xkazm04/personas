# Bug Hunter — recipes-automation-library
> Total: 6
> Critical: 1 · High: 2 · Medium: 3 · Low: 0

## 1. Recipe history is split across two `useRecipeTestRunner` instances — runs never appear in the History tab or badge
- **Severity**: High
- **Category**: state-corruption
- **File**: `src/features/recipes/sub_playground/components/RecipePlaygroundModal.tsx:32`
- **Scenario**: Open any recipe playground, go to the Test Runner tab, run the recipe one or more times, then click the History tab. The History tab is permanently empty and the tab-bar count badge stays at 0, even though runs succeeded and produced rendered prompts + LLM output.
- **Root cause**: `RecipePlaygroundModal` calls `const testRunner = useRecipeTestRunner(currentRecipe)` (line 32) purely to feed the tab-bar badge (`testRunner.history.length`, line 76) and the History tab (`history={testRunner.history}`, line 102). But the *actual runs* happen inside `RecipeTestRunnerTab`, which calls its OWN second instance of `useRecipeTestRunner(recipe)` (`src/features/recipes/sub_playground/tabs/RecipeTestRunnerTab.tsx:24-27`). `useRecipeTestRunner` keeps `history` in component-local `useState` (`src/features/recipes/sub_playground/libs/useRecipeTestRunner.ts:11`), so the two hook instances have completely independent state. The modal's instance is never told to `execute`, so its `history` is always `[]`. The design assumption — "calling the same hook twice shares state" — is false; React hooks create per-call-site state.
- **Impact**: UX degradation / silent feature loss. The entire History tab and its run counter are dead; the user's run history (capped at 20 entries) is invisible. A core advertised playground feature silently does nothing.
- **Fix sketch**: Make `useRecipeTestRunner` single-source-of-truth: instantiate it once in `RecipePlaygroundModal` and pass `execute`, `running`, `result`, etc. down to `RecipeTestRunnerTab` as props (drop the tab's own call). Alternatively lift history into a small context/store keyed by recipe id. Structurally, never call a stateful hook at two call sites and expect shared state.

## 2. TOCTOU race in `start_recipe_execution` / `start_recipe_versioning` spawns duplicate CLI tasks and silently discards a result
- **Severity**: Critical
- **Category**: race-condition
- **File**: `src-tauri/src/commands/recipes/crud.rs:213` (also `:294`, `:431`)
- **Scenario**: Double-click "Run" (or two windows / a debounced typeahead that fires twice within a few ms). Two `start_recipe_execution` async commands interleave. Both execute `if registry.get_id("recipe_execution").is_some() { return Err }` and both observe `None` *before* either reaches `registry.set_id(...)`. Both pass the guard, both `spawn_ai_artifact_task`, and the second `set_id` overwrites the first task's id in the registry.
- **Root cause**: The "already in progress" guard is a non-atomic check-then-set across an `.await` boundary on a shared `ActiveProcessRegistry`. The registry already exposes the correct atomic primitive — `begin_run` (`src-tauri/src/lib.rs:149`) — built specifically to "prevent the race where a completed-but-not-yet-checked run sees its registry ID overwritten by a newer run and silently discards a valid result." These handlers don't use it; they use the racy `get_id` + `set_id` pair. When task #1 finishes, `run_ai_artifact_task` computes `is_cancelled = registry.get_id(&domain) != Some(task_id)` (`src-tauri/src/commands/credentials/ai_artifact_flow.rs:255`); because #2 overwrote the id, #1 is misclassified as cancelled and returns early at line 273, throwing away a completed (and billed) LLM result with no status event.
- **Impact**: Data/work loss + wasted spend: two real Claude CLI processes launch concurrently, one result is silently dropped, and the UI may hang on the lost run until the 5-minute timeout. On the versioning path the discarded run can be the one the user is waiting on.
- **Fix sketch**: Replace the `get_id`/`set_id` pair with a single atomic claim: have `begin_run` (or a new `try_begin` returning `Err` if a run is live) perform the in-progress check and id install under one mutex acquisition, and only spawn the task if the claim succeeded. That makes concurrent starts impossible to both win regardless of `.await` interleaving.

## 3. `delete_recipe` in-flight guard is racy and unenforced under the SQLite delete transaction
- **Severity**: High
- **Category**: race-condition
- **File**: `src-tauri/src/commands/recipes/crud.rs:125`
- **Scenario**: A recipe versioning/execution task is mid-flight for recipe R. In a second window the user deletes R. `delete_recipe` checks `active_target("recipe_execution"/"recipe_versioning") == Some(R)` and, if the running task happens to have already cleared its id (it completed microseconds earlier) or hasn't yet set its target, the guard passes and the row + its `recipe_versions` are deleted. The still-running task (or the user's pending Accept) then writes against a now-deleted `recipe_id`.
- **Root cause**: The guard is a point-in-time read of registry state with no lock held across the subsequent `repo::delete`, and the registry target lifecycle is not synchronized with the DB write. The `accept_version`/`revert_to_version` transactions (`src-tauri/src/db/repos/resources/recipes.rs:475`, `:566`) take `BEGIN IMMEDIATE` and serialize *version-number allocation*, but `delete` uses a plain `unchecked_transaction` (`:215`) and there is no FK/row-level coordination preventing a delete from racing an in-flight accept. After delete, an in-flight `accept_version` will `INSERT` orphan `recipe_versions` rows (no FK enforcement shown) or update zero recipe rows and return `NotFound` after already inserting version rows — leaving orphaned version history.
- **Impact**: Silent data corruption: orphaned `recipe_versions` rows pointing at a deleted recipe, or a half-applied accept. The user-facing "Cancel it first" protection is bypassable by timing.
- **Fix sketch**: Do the conflict check and the delete inside one `BEGIN IMMEDIATE` transaction that also re-asserts no active run for the id at commit time, OR enforce `recipe_versions.recipe_id`/`persona_recipe_links.recipe_id` as `FOREIGN KEY ... ON DELETE CASCADE` with `PRAGMA foreign_keys=ON` so a delete and a concurrent insert serialize at the DB level and orphans become impossible. Make the registry target check advisory only; the DB must be the source of truth.

## 4. Recipe-versioning/execution status events are not correlated by run id — cross-recipe draft contamination
- **Severity**: Medium
- **Category**: race-condition
- **File**: `src/hooks/design/core/useTauriStream.ts:111`
- **Scenario**: Two `RecipeVersionsTab` instances are alive for different recipes (e.g. a playground modal left mounted while another opens, or a remount during generation). Both subscribe to the global `RECIPE_VERSIONING_STATUS` event. A single completion emitted by the backend is delivered to *both* listeners; each accepts it as its own result and renders recipe A's generated draft inside recipe B's tab. Clicking Accept then writes A's prompt template onto B.
- **Root cause**: The backend status payload carries a discriminator (`versioning_id` / `execution_id`, set in `crud.rs:452`/`:234` and echoed by `ai_artifact_flow.rs:107-114`), but the frontend status handler only guards with a per-instance `generationRef` counter (`useTauriStream.ts:112`) and never compares the payload's id against the id this instance started. The design assumes one listener per domain app-wide; nothing enforces that, and Tauri events are broadcast to every listener.
- **Impact**: Silent data corruption of the wrong recipe (Accept applies the other recipe's draft) when more than one versioning/execution surface is mounted. Also affects `useRecipeExecution`.
- **Fix sketch**: Have `start()` capture the run id returned by `startFn` (e.g. `{ versioning_id }`) and have `resolveStatus`/the status listener ignore any payload whose id field doesn't match the captured run id. Correlate by id, not just by a local generation counter.

## 5. `RecipeTestRunnerTab` blocks LLM execution on JSON-decoded input that the backend rejects, and free-input fallback can silently mis-shape data
- **Severity**: Medium
- **Category**: edge-case
- **File**: `src/features/recipes/sub_playground/tabs/RecipeTestRunnerTab.tsx:38`
- **Scenario**: A recipe has no `input_schema` (free-input mode). The user pastes a JSON value that is valid JSON but not an object — e.g. `"hello"`, `42`, or `[1,2]`. `JSON.parse(freeInput)` succeeds and `inputData` becomes a string/number/array, which is then sent to `executeRecipe` as `input_data`. The backend signature is `HashMap<String, serde_json::Value>` (`src-tauri/src/db/models/recipe.rs:147`), so deserialization fails for a non-object and the whole run errors out with an opaque IPC deserialize message; the intended `{ input: freeInput }` fallback (line 42) is never reached because parse didn't throw.
- **Root cause**: The fallback logic assumes `JSON.parse` throwing is the only failure mode, but a successful parse of a non-object is equally invalid for the `HashMap` contract. The catch only covers syntax errors, not shape mismatches.
- **Impact**: UX degradation: a class of pasted inputs (JSON scalars/arrays) produce a confusing low-level error instead of being treated as the literal `{ input: ... }` payload. Recoverable but surprising.
- **Fix sketch**: After `JSON.parse`, check `typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)`; if false, fall back to `{ input: freeInput }`. Make the object-shape invariant explicit at the boundary rather than inferring it from a thrown error.

## 6. Recipe versioning derivation parses `truncate` on byte length but the truncation helper indexes by chars — mismatch on multibyte UC descriptions
- **Severity**: Medium
- **Category**: edge-case
- **File**: `src-tauri/src/commands/recipes/recipe_derivation.rs:78`
- **Scenario**: A template use case has a `description` whose UTF-8 byte length exceeds 500 but whose *character* count is well under 500 (e.g. emoji-heavy or CJK text where each char is 3–4 bytes). `extract_uc_description` tests `if s.len() > 500` (byte length) and then calls `truncate_on_char_boundary(&s, 499)`. The truncation target (499) is applied to a string the gate selected by *bytes*, so a 200-character / 600-byte description gets truncated even though it's short, and the resulting "fit" is inconsistent with the documented "500 chars" intent (the test at line 359 only exercises ASCII).
- **Root cause**: Mixed units — the length guard uses `str::len()` (bytes) while the contract and the truncation helper reason in characters. The assumption "len() ≈ char count" holds only for ASCII; UC descriptions are free-form, possibly non-ASCII.
- **Impact**: Silent over-truncation / inconsistent recipe descriptions for non-ASCII templates derived via `derive_recipes_from_template`. Data is lossy but not corrupt; affects display only. (Note: `truncate_on_char_boundary` prevents a panic, so this is degraded output, not a crash.)
- **Fix sketch**: Gate on `s.chars().count() > 500` to match the helper's char-based truncation and the documented contract, and add a non-ASCII test case alongside `extract_uc_description_truncates`. Keep one consistent unit (characters) end-to-end.
