# Code-refactor scan — Recipes (Use-Case Blueprints)

> Total: 8 findings (1 high, 4 medium, 3 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: the agent brief listed `src/features/recipes/blueprints`, `src/api/recipes/blueprints.ts`, `src/api/recipes/usecase.ts`, `src/lib/blueprints`, `src/stores/slices/blueprintSlice.ts`, `src-tauri/src/commands/recipes/blueprints.rs`, `src-tauri/src/commands/recipes/usecase.rs`, `src-tauri/src/db/models/blueprint.rs`, `src-tauri/src/db/models/usecase.rs`, `src-tauri/src/db/repos/recipes/blueprints`, `src-tauri/src/db/repos/recipes/usecase`. **None of these paths exist.** The "use-case blueprint" feature in this codebase is implemented as recipes-derived-from-templates (Stage B Phase 1b) at `src-tauri/src/commands/recipes/recipe_derivation.rs` + `src-tauri/src/commands/recipes/recipe_adoption.rs` + the recipes playground/manager surfaces under `src/features/recipes`. Wave 1's recipes scan (`connector-catalog-mcp-gateways-recipes.md`) covered cancel-handler duplication (#1), accept_version/revert_to_version SQL duplication (#2), prompt-builder duplication (#3), the `promoteUseCaseToRecipe`/`getUseCaseRecipes` dead exports (#10), and the `delete_recipe` inline domain list (#11). This scan deliberately avoids those, focusing instead on derivation, eligibility/adoption, the playground UI, and shared parsing utilities.

## 1. RecipePlaygroundModal instantiates a second `useRecipeTestRunner` whose state is orphaned

- **Severity**: high
- **Category**: structure (and latent bug)
- **File**: `src/features/recipes/sub_playground/components/RecipePlaygroundModal.tsx:32` and `src/features/recipes/sub_playground/tabs/RecipeTestRunnerTab.tsx:27`
- **Scenario**: The modal calls `const testRunner = useRecipeTestRunner(currentRecipe);` to read `testRunner.history` for the tab-badge count (line 76, 78) and to pass `history` + `clearHistory` to `RecipeHistoryTab` (line 102-104). But `RecipeTestRunnerTab` *also* invokes `useRecipeTestRunner(recipe)` independently, and that's the instance that actually drives executions. Each call constructs its own `useState`/`useRef` cells (`useRecipeTestRunner.ts:8-19`), so the modal-level history stays at `[]` forever; the History tab is permanently empty and the badge never appears even after successful runs.
- **Root cause**: The hook owns module-local state (no Zustand/Context) but is consumed in two places that expect to share the same `history` array. The originally-intended single-source design was lost when history wiring was hoisted to the modal.
- **Impact**: User-visible regression on the History tab — the empty-state "Run a recipe to see history" persists indefinitely after runs. Also ~85 LOC of state machinery in `useRecipeTestRunner` is effectively duplicated per render: two run-id refs, two histories, two `useEffect` mergers fighting over the same `execution.phase` events.
- **Fix sketch**: Pick one ownership level. Easiest: hoist `useRecipeTestRunner(currentRecipe)` to the modal, drop the call inside `RecipeTestRunnerTab`, and pass the runner as a prop. Alternatively, move history into a Zustand slice (or `pipelineStore`) keyed by recipe id so any consumer sees the same array. Either approach also fixes the duplicated `useRecipeExecution` subscription that fires twice per status event.

## 2. `parseInputSchema` / `parseSchemaFields` / `parseTags` duplicated across 3 sites

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/recipes/shared/recipeParseUtils.ts:12-53` (canonical), `src/features/recipes/sub_playground/tabs/recipeTestHelpers.ts:14-22` (duplicate `parseInputSchema`), `src/features/recipes/sub_editor/components/RecipeEditor.tsx:20-44` (duplicate `parseTagsString` + `parseSchemaString`)
- **Scenario**: `parseInputSchema(schema: string | null)` exists twice with byte-identical bodies — same `JSON.parse`/`isArray`/error-stringify shape — only the result-interface name differs (`InputSchemaResult` vs `InputFieldResult`). `parseSchemaFields` (`recipeParseUtils.ts:29-43`) and `parseSchemaString` (`RecipeEditor.tsx:30-44`) are also literal copies — same `parsed.map(...)` shape extracting `key/type/label/default`. `parseTags` (`recipeParseUtils.ts:12-20`) and `parseTagsString` (`RecipeEditor.tsx:20-28`) are likewise identical. The shared module clearly already exists; the editor and test-helpers reinvented it.
- **Root cause**: The shared `recipeParseUtils.ts` landed mid-refactor; new code (editor, test runner) was authored against ad-hoc local copies.
- **Impact**: ~60 LOC of duplication across 3 files; future schema-format changes (e.g. new field types, stricter validation) require 3 edits. The mismatched result-type names (`InputSchemaResult` vs `InputFieldResult`) also cost readers cognitive overhead deciding which to import.
- **Fix sketch**: Delete `recipeTestHelpers.ts:14-22` (`parseInputSchema`) and re-export the shared version. Delete `RecipeEditor.tsx:20-44` (`parseTagsString`, `parseSchemaString`) and use `parseTags`/`parseSchemaFields` from `recipeParseUtils.ts`. Unify the two `InputField*` interfaces into one canonical shape that includes `default?: string` + optional `options?: string[]`.

## 3. `formatOutputForMarkdown` inlined verbatim in RecipeHistoryTab

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/recipes/sub_playground/tabs/RecipeHistoryTab.tsx:76-82` vs `src/features/recipes/sub_playground/tabs/recipeTestHelpers.ts:34-45`
- **Scenario**: The history tab renders LLM output through a hand-rolled IIFE that detects JSON-shaped output and wraps it in a fenced code block — exactly what `formatOutputForMarkdown` does. The IIFE even keeps the same `intentional: non-critical -- JSON parse fallback` comment fragment, betraying the copy origin. The sibling `RecipeOutputSection.tsx:8,127` imports and uses the shared helper correctly.
- **Root cause**: Copy-paste during initial history-tab implementation; the helper existed but wasn't reused.
- **Impact**: Two divergent JSON-detection paths. Any future tweak (e.g. handle code-fence-wrapped JSON, YAML detection) needs two edits. The inlined version also nests a 7-line ternary inside a JSX `content={...}` prop, which is materially harder to scan than `formatOutputForMarkdown(run.llm_output!)`.
- **Fix sketch**: Replace lines 76-82 with `<MarkdownRenderer content={formatOutputForMarkdown(run.llm_output!)} />` and add the import.

## 4. `useRecipeGenerator` reports `recipe_execution` as its trace operation

- **Severity**: medium
- **Category**: cruft (latent telemetry bug)
- **File**: `src/hooks/design/template/useRecipeGenerator.ts:22`
- **Scenario**: The hook passes `traceOperation: 'recipe_execution'` to `useAiArtifactTask`, but this hook drives recipe *generation* (Claude CLI builds a recipe from a description). The companion `useRecipeExecution.ts:25` also uses `'recipe_execution'` (correct), and `useRecipeVersioning.ts:22` uses `'recipe_versioning'` (correct). Generation telemetry is therefore being attributed to executions — a copy-paste error one row off.
- **Root cause**: `useRecipeGenerator.ts` was created by copying `useRecipeExecution.ts` and the trace string was missed during the rename pass.
- **Impact**: Telemetry/x-ray traces conflate two distinct operations: every recipe-generation run shows up as a recipe-execution in dashboards. Anyone debugging an "execution stalls" alert may stare at generation traces and not realize it.
- **Fix sketch**: Change line 22 to `traceOperation: 'recipe_generation'`. Optionally add a unit test that asserts each hook's `traceOperation` matches its file basename, blocking similar copy-paste regressions.

## 5. `RecipeEditor.parseSchemaString` plus a parallel `SchemaField` type fork the schema shape

- **Severity**: medium
- **Category**: structure
- **File**: `src/features/recipes/sub_editor/components/RecipeEditor.tsx:8` (imports `SchemaField` from `./SchemaFieldBuilder`), `:30-44` (`parseSchemaString`), `src/features/recipes/shared/recipeParseUtils.ts:22-27` (`SchemaFieldParsed`)
- **Scenario**: `SchemaField` (defined in `SchemaFieldBuilder.tsx`, re-exported via `import { ..., type SchemaField }`) and `SchemaFieldParsed` (in shared utils) describe the same `{key, type, label, default?}` row but live in separate modules with subtly different field optionality. `parseSchemaString` in the editor returns `SchemaField[]`; `parseSchemaFields` in shared returns `SchemaFieldParsed[]`. Both parse the identical JSON shape produced by the same Rust `input_schema` field.
- **Root cause**: Two teams (or two refactor passes) modeled the same wire shape twice and the second never reconciled.
- **Impact**: Editing a recipe and viewing it in the playground go through *different* TypeScript types for the same JSON. Adding a new column (e.g. `placeholder`, `required`) requires updating both. The `default` field is `string` in one, `string | undefined` in the other — a third caller using the wrong import could silently lose default values.
- **Fix sketch**: Promote one shape (recommend `SchemaFieldParsed` since it lives in `shared/`), have `SchemaFieldBuilder` consume it via `import type { SchemaFieldParsed as SchemaField } from '../../shared/recipeParseUtils'` (or rename). Delete the editor's duplicate parser and reuse `parseSchemaFields`.

## 6. Duplicated section banner in recipe API surface

- **Severity**: low
- **Category**: cruft
- **File**: `src/api/recipes/recipes.ts:76-78` and `:110-112`
- **Scenario**: The same `// =========\n// Use Case <-> Recipe Connection\n// =========` banner comment appears twice in the file — once before `getUseCaseRecipes` (line 79) and again before `promoteUseCaseToRecipe` (line 114). The second appearance is misleading because the section between them is `Recipe Versioning` (lines 86-108). Wave 1's finding #10 already pegs both wrapped commands as dead, but the banner cruft survives independently — anyone tidying just one half of the section will still leave a duplicate header.
- **Root cause**: Versioning commands were inserted between two pieces of the use-case section, and instead of merging the two halves the author copied the section header.
- **Impact**: 3 LOC of misleading section structure. Newcomers reading the file see two "Use Case" sections separated by something else and reasonably assume they relate to different concerns.
- **Fix sketch**: When applying Wave 1's #10 (deleting `promoteUseCaseToRecipe` + `getUseCaseRecipes`), remove both banners too. If either function is kept, collapse them into a single section block.

## 7. `synthesize_prompt_template` documents a known misuse it cannot fix

- **Severity**: low
- **Category**: cruft
- **File**: `src-tauri/src/commands/recipes/recipe_derivation.rs:111-125`
- **Scenario**: The 15-line function is a one-liner (`serde_json::to_string(uc).unwrap_or_else(...)`) wrapped in 12 lines of doc comment explaining that this is *deliberately the wrong thing* — the entire UC JSON is being shoved into the `prompt_template` column until "Phase 2 ships". Until then, every comparison in `derive_recipes_from_template_inner` (`:218-220`) and every storage write of `prompt_template` carries this caveat. The TODO has been in place since Stage B Phase 1b shipped; Phase 2 is still unscheduled in the comment.
- **Root cause**: A migration-shaped workaround turned semi-permanent. The semantic violation propagates to every derived recipe row in the DB plus every consumer reading `prompt_template`.
- **Impact**: Conceptual debt. Any new caller of `RecipeDefinition.prompt_template` for derived recipes gets the serialized UC JSON instead of a prompt. The shape mismatch is invisible until a UI tries to render it as an LLM prompt.
- **Fix sketch**: Either (a) ship the real prompt synthesis: parse the UC's `operating_instructions` / `capability_summary` into a Markdown prompt template — this matches what `recipe_generation.rs` builds for user-authored recipes. Or (b) add a `derived_payload_json` column to `recipe_definitions` for the raw UC, leaving `prompt_template` empty for derived recipes until Phase 2's true prompt synthesizer lands. Either resolves the documented sin; the current state is the worst of both worlds.

## 8. `recipe_match.rs` and `recipe_eligibility.rs::get_recipe_catalog_for_persona` each re-fetch the full recipe table

- **Severity**: low
- **Category**: structure
- **File**: `src-tauri/src/commands/recipes/recipe_match.rs:50` (`recipe_repo::get_all`), `src-tauri/src/commands/recipes/recipe_eligibility.rs:65` (`recipe_repo::get_all`)
- **Scenario**: Both commands read the entire `recipe_definitions` table on every call. `match_recipes_to_intent` runs on every debounced keystroke from the Glyph composer (~300ms cadence per the docs); `get_recipe_catalog_for_persona` runs every time the catalog sidebar opens. Each call rehydrates all ~500 recipes from SQLite, allocates the full `Vec<RecipeDefinition>`, then runs O(N) scoring. The match path's own doc comment acknowledges this trade-off ("If the catalog grows >5K recipes, add an inverted index"); eligibility has no such acknowledgment.
- **Root cause**: Phase 1b ceiling justified the simple full-scan, but no caching layer was added even though both call sites would benefit identically.
- **Impact**: At today's ~500-recipe scale this is small (<10 ms per call). At 5K it would be ~100 ms x every keystroke — perceptible debounce extension. The duplicated full-fetch also makes both commands harder to optimize independently.
- **Fix sketch**: Add a thin `recipe_catalog_cache` (e.g. `Arc<RwLock<Option<CachedCatalog>>>` on `AppState` with a generation counter bumped by `create/update/delete/accept_version/revert_to_version`). Both `match_intent_to_recipes` and `get_recipe_catalog_for_persona` consume the cached slice. As a bonus, the cache invalidation tracks recipe-write events in one place rather than letting future read paths each invent their own.
