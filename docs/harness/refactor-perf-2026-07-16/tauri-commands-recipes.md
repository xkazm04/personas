# tauri:commands/recipes — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 1 high / 1 medium / 2 low)
> Context group: Backend Data & Commands | Files read: 9 | Missing: 0

## 1. Over-escaped braces in the versioning prompt render invalid guidance to the LLM
- **Severity**: High
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/commands/recipes/recipe_versioning.rs:57-64
- **Scenario**: Every `start_recipe_versioning` run builds this prompt via `format!`. Inside a `format!` string, `{{` renders `{`, so the fenced JSON example written as `{{{{ ... }}}}` renders as `{{ ... }}` (doubled braces, invalid JSON) and the placeholder hint `{{{{{{{{variable}}}}}}}}` renders as `{{{{variable}}}}` instead of the intended `{{variable}}`.
- **Root cause**: The block was escaped twice — compare `recipe_generation.rs:50-60`, which uses half the brace count and renders correctly (`{` for the JSON object, `{{variable}}` for the placeholder hint). The versioning copy doubled every brace again.
- **Impact**: The model receives a malformed JSON example and a wrong placeholder convention; it may emit `{{{{variable}}}}` templates that `render_template` (which only matches `{{key}}`) will never substitute, silently producing broken recipe versions. At best it wastes model attention reconciling the contradiction.
- **Fix sketch**: Halve every brace run in the fenced block of `build_recipe_versioning_prompt` so it matches `build_recipe_generation_prompt` exactly: `{{{{` → `{{`, `}}}}` → `}}`, `{{{{{{{{variable}}}}}}}}` → `{{{{variable}}}}`. Add a unit test asserting the rendered prompt contains the literal strings `{{variable}}` and a `{`-opened JSON example (generation has no such test either — cover both).

## 2. Triplicated start/cancel command scaffolding in crud.rs
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/recipes/crud.rs:194-508
- **Scenario**: `start_recipe_execution` / `start_recipe_generation` / `start_recipe_versioning` are the same ~45-line block (build cli_args, uuid, `try_begin` guard with near-identical error text, optional `set_target`, `spawn_ai_artifact_task` with an `ArtifactSpend` differing only in `trigger_kind`), and the three `cancel_*` commands are the same ~25-line block (take_id, log, emit `*_STATUS` with a cancelled payload) differing only in domain string, event name, and id-field key.
- **Root cause**: Each new AI-artifact domain was added by copy-paste rather than extracting the domain-parameterized core once the second copy appeared.
- **Impact**: ~140 duplicated lines; any fix to the claim/cancel protocol (e.g. the 2026-06-07 double-click race fix, which had to be applied three times by comment evidence) must be re-applied per copy, and a missed copy silently diverges. The `id_field` already lives in `AiArtifactMessages`, yet each cancel handler hardcodes its own key (`execution_id`/`generation_id`/`versioning_id`) — one drift away from a frontend that stops matching cancel events.
- **Fix sketch**: Extract `fn start_recipe_ai_task(state, app, domain, target: Option<String>, prompt, messages, extractor, trigger_kind) -> Result<Value>` and `fn cancel_recipe_ai_task(state, app, domain, status_event, id_field) -> Result<Value>`, driving the emitted id key from `messages.id_field`. The three public `#[tauri::command]` wrappers shrink to prompt construction plus one call each.

## 3. execute_recipe and start_recipe_execution duplicate the validate+render prologue
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/recipes/crud.rs:173-181, 201-209
- **Scenario**: Both commands run the identical four-step prologue — `get_by_id`, `validate_required_inputs_present`, `render_template` — including the same two multi-line comments, character for character.
- **Root cause**: The dry-run (`execute_recipe`) and live (`start_recipe_execution`) paths were written independently instead of sharing a `load_and_render(recipe_id, input_data) -> Result<(RecipeDefinition, String)>` helper.
- **Impact**: Bounded (two copies), but this is the exact seam where the template-contract tests at the bottom of the file pin behavior — a future fix applied to one path and not the other splits the dry-run preview from what actually executes.
- **Fix sketch**: Add a private `fn render_recipe_prompt(db, recipe_id, input_data) -> Result<(RecipeDefinition, String), AppError>` that does fetch + validate + render, and call it from both commands. The duplicated comment block then lives in one place.

## 4. Per-use-case queries in the derivation loop (N+1) plus a redundant re-serialization
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/recipes/recipe_derivation.rs:189-234
- **Scenario**: `derive_recipes_from_template_inner` issues one `find_by_source` SELECT per use case inside the loop, plus one INSERT/UPDATE each; and in the `Some(prev)` branch it calls `synthesize_prompt_template(uc)` a second time (line 234) even though the identical value was already computed into `synthesized_prompt` at line 186 and is otherwise unused on that path.
- **Root cause**: The loop was written per-UC for clarity; the pre-computed prompt variable was simply not reused when the compare branch was added.
- **Impact**: Bounded — this is a cold migration/derivation path and templates carry tens of UCs, so it's SELECT-count waste, not user-visible latency. The double serialization is pure redundant work on every re-derive of an existing recipe.
- **Fix sketch**: Fetch all derived recipes once via the existing `recipe_repo::list_by_source_template(&state.db, template_id)` and build a `HashMap<source_use_case_id, RecipeDefinition>` before the loop, replacing the per-UC `find_by_source`. In the `Some(prev)` branch, reuse `synthesized_prompt` instead of calling `synthesize_prompt_template(uc)` again. Optionally wrap the loop's writes in a single transaction for atomicity of a re-derive.
