# Code-refactor scan — Connector Catalog, MCP Gateways & Recipes

> Total: 11 findings (2 high, 5 medium, 4 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12

## 1. Three near-identical cancel handlers in recipe crud.rs

- **Severity**: high
- **Category**: duplication
- **File**: `src-tauri/src/commands/recipes/crud.rs:212-236` (`cancel_recipe_execution`), `:291-315` (`cancel_recipe_generation`), `:428-452` (`cancel_recipe_versioning`)
- **Scenario**: All three commands implement the exact same pattern: `require_auth().await` → `state.process_registry.take_id(<domain>)` → emit a `<domain>-status` event with `{status: "cancelled", id, result: null, error: null}` → return `{was_running, cancelled_id}` JSON. Only the domain string and event-name constant differ.
- **Root cause**: Copy/paste growth as the AI-artifact task pattern was repeated for each long-running operation. The `crud.rs` API even declares the `CancelResult` TS interface (frontend `src/api/recipes/recipes.ts:12-15`) but every Rust handler returns an untyped `serde_json::Value` instead of using a strongly-typed struct.
- **Impact**: ~75 lines of duplicated boilerplate that drifts independently per task type. Future fixes (e.g. tracing key changes, new event fields) must be applied in three places — easy to miss one.
- **Fix sketch**: Extract `pub async fn cancel_ai_artifact_task(state, app, domain: &str, event: &'static str, id_field: &'static str)` returning a typed `CancelResult` struct. Each public command becomes a 3-line wrapper. The `RECIPE_*_MESSAGES` constants already pair `status_event` with `id_field` — reuse them so the cancel handler is data-driven, eliminating the parallel constants.

## 2. accept_version and revert_to_version repeat the same version-write-snapshot dance

- **Severity**: high
- **Category**: duplication
- **File**: `src-tauri/src/db/repos/resources/recipes.rs:452-533` (`accept_version`) and `:535-614` (`revert_to_version`)
- **Scenario**: Both functions execute the identical 4-step transaction shape: (1) read current `recipe_definitions` row, (2) `INSERT INTO recipe_versions (id, recipe_id, version_number, prompt_template, input_schema, sample_inputs, description, changes_summary, created_at) VALUES (?1..?9)` snapshot, (3) `UPDATE recipe_definitions SET prompt_template = ?1, input_schema = ?2, sample_inputs = ?3, description = ?4, updated_at = ?5 WHERE id = ?6`, (4) read back the updated row with the same `map_err(|e| match e { QueryReturnedNoRows => NotFound(...), other => Database(other) })` block. The 9-column `INSERT INTO recipe_versions` literal appears **three times** in this file (lines 439, 486, 503, 574) and the recipe-definitions UPDATE+read-back appears twice (511-527, 592-608).
- **Root cause**: No helper for "snapshot then mutate" exists; each call site hand-rolls its own SQL.
- **Impact**: ~160 LOC of repetition. The column list in `recipe_versions` must stay synchronized across 4 hard-coded VALUES tuples — a single forgotten column on add silently breaks one snapshot path.
- **Fix sketch**: Add private helpers `insert_version_row(tx, recipe_id, version_number, fields, changes_summary)` and `update_recipe_fields_and_read(tx, recipe_id, fields)` that take a `RecipeMutableFields` struct (4 strings) and centralize the SQL. `accept_version` and `revert_to_version` then become 20-line orchestrators that differ only in input source (params vs. resolved historical version).

## 3. Two prompt builders in recipe_generation.rs and recipe_versioning.rs share 80% of the same shape

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/commands/recipes/recipe_generation.rs:28-68` and `src-tauri/src/commands/recipes/recipe_versioning.rs:27-73`
- **Scenario**: Both `build_recipe_generation_prompt` and `build_recipe_versioning_prompt` emit the same Markdown JSON-schema instruction with overlapping fields (`prompt_template`, `input_schema`, `sample_inputs`, `description`), the same fenced-code-block wrapper, the same closing "Important:" list. The only real difference is the lead-in narrative (designing vs. modifying) and a couple of extra fields.
- **Root cause**: The two paths were authored sequentially; the prompt was duplicated for fast iteration with no consolidation pass.
- **Impact**: ~100 lines of structural repetition. Each fix to the JSON schema contract (e.g. when `output_contract` shipped) must be made twice. The escaping is also inconsistent — `recipe_generation` uses `{{` to literally produce `{` while `recipe_versioning` uses `{{{{` to do the same job, an artifact of the second copy being made through different format-string layers.
- **Fix sketch**: Extract a `recipe_prompt_skeleton(lead_in: &str, extra_fields: &[(&str, &str)], rules: &[&str]) -> String` builder that owns the JSON-schema block and the "Important:" closing list. Both call sites become 10-line wrappers that pass their lead-in and `(recipe_name, change_requirements)` context.

## 4. Three dead exports in connectorRoles.ts

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/lib/credentials/connectorRoles.ts:256` (`getPurposeGroupForConnector`), `:275` (`hasAlternatives`), `:291` (`getArchitectureComponent`)
- **Scenario**: All three exported functions have zero callers in `src/`. `hasAlternatives` is a 3-line wrapper around `getAlternatives` that nobody invokes; `getPurposeGroupForConnector` and `getArchitectureComponent` build composite shapes that aren't consumed anywhere. The `ArchitectureComponent` type they reference is also dead.
- **Root cause**: Forward-looking exports added during the role/purpose refactor that the UI never picked up. The retired `ROLE_PRESETS` API was replaced (see `connectorAudiences.ts`) but these companion helpers were not pruned.
- **Impact**: ~50 LOC of dead public surface plus an exported `ArchitectureComponent` interface that misleads new readers into thinking the wizard consumes this shape.
- **Fix sketch**: Delete `getPurposeGroupForConnector`, `hasAlternatives`, `getArchitectureComponent`, and the `ArchitectureComponent` interface. Keep `getRoleForConnector`, `getAlternatives`, `getPurposeForConnector`, `resolveRoleLabel`, `resolvePurposeLabel` — those have live callers.

## 5. `recipeToConnectorContext` helper is dead code

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/lib/credentials/credentialRecipeRegistry.ts:144-159`
- **Scenario**: Exported `recipeToConnectorContext(recipe)` returns a flattened shape but no consumer imports it. The companion `recipeToDesignResult` (line 112) IS used (by `lookupRecipeAsDesignResult` and elsewhere). The comment says "Convert a recipe to the connector context shape used by AutoCred" but AutoCred currently consumes `recipeToDesignResult` via `lookupRecipeAsDesignResult`.
- **Root cause**: Helper kept after a refactor that consolidated AutoCred onto the `CredentialDesignResult` shape.
- **Impact**: 16 dead LOC that re-implements partial recipe parsing and confuses readers about which shape AutoCred wants.
- **Fix sketch**: Delete the function. If a future caller needs a flatter shape, they can derive it from `recipeToDesignResult` output.

## 6. `delete_by_connector` in credential_recipes repo is unused

- **Severity**: medium
- **Category**: dead-code
- **File**: `src-tauri/src/db/repos/resources/credential_recipes.rs:111-124`
- **Scenario**: The 14-line `delete_by_connector` function has no Tauri command wrapping it (`commands/credentials/credential_recipes.rs` only exposes get/list/upsert/use) and no engine caller. Recipe cleanup happens elsewhere (the table has its own lifecycle through `upsert`).
- **Root cause**: Symmetry afterthought — added "in case it's needed" but the UI never grew a per-connector recipe delete path.
- **Impact**: ~15 LOC dead. Worse, it appears in IDE auto-complete which can mislead someone implementing a real deletion path into thinking it's already wired.
- **Fix sketch**: Delete `delete_by_connector`. If recipe deletion ever lands, the implementation should be a deliberate command with auth + telemetry, not a silent helper.

## 7. `ALL_AUDIENCES` constant is exported but never imported

- **Severity**: low
- **Category**: dead-code
- **File**: `src/lib/credentials/connectorAudiences.ts:20-24`
- **Scenario**: The frozen `ALL_AUDIENCES: readonly Audience[]` array has zero consumers — Grep across `src/` returns only the definition line. Filter UI iterates a hard-coded subset and pickers read the `Audience` union directly.
- **Root cause**: Speculative export when defining the audience tagging surface.
- **Impact**: 4 LOC and a small mental tax: readers wonder why a constant exists with no users.
- **Fix sketch**: Delete the export. If a future iteration needs the runtime list, derive it via a `const audiences = ['developer','support','manager'] as const satisfies readonly Audience[]` at the call site.

## 8. `RolePreset` type duplicates `Audience` and ships a deprecation-only file

- **Severity**: low
- **Category**: cruft
- **File**: `src/features/vault/sub_catalog/components/picker/catalogRolePresets.ts:13`
- **Scenario**: This entire 13-line file exists solely to re-export `type RolePreset = 'developer' | 'support' | 'manager'` (the same union as `Audience` in `connectorAudiences.ts:18`) and host a deprecation banner. Two callers (`usePickerFilters.ts:6`, `CredentialPickerFilters.tsx:5`) still import `RolePreset`.
- **Root cause**: Mid-migration: the new `Audience` exists, the old name was kept for compat, but the file was never collapsed into the new module.
- **Impact**: Two parallel type identities for the same union. New code is told to "prefer Audience" in the deprecation banner — most authors will pick whichever they see first.
- **Fix sketch**: Update the two callers to import `Audience` and delete the file. Single source of truth in `connectorAudiences.ts`.

## 9. `list_gateways_containing` is dead per its own `#[allow(dead_code)]`

- **Severity**: low
- **Category**: dead-code
- **File**: `src-tauri/src/db/repos/resources/mcp_gateways.rs:122-137`
- **Scenario**: The `#[allow(dead_code)]` on `list_gateways_containing` is honest — the function is genuinely unused (verified by grep). Its doc comment says it would warn the user "before unlinking a credential that belongs to one or more gateways" but no caller invokes it; the ON DELETE CASCADE handles the actual cleanup unceremoniously.
- **Root cause**: Planned UX surface ("informational confirmation") that never shipped.
- **Impact**: 16 LOC and a misleading doc comment that implies the warning exists.
- **Fix sketch**: Either wire it up to a Tauri command + UI confirmation dialog (do the work the docstring promises), or delete the function. Pick one.

## 10. `promoteUseCaseToRecipe` + `getUseCaseRecipes` frontend wrappers have no UI callers

- **Severity**: low
- **Category**: dead-code
- **File**: `src/api/recipes/recipes.ts:79-80` (`getUseCaseRecipes`) and `:114-127` (`promoteUseCaseToRecipe`)
- **Scenario**: Both exports are referenced only by their own definitions; no React component or hook imports them. The Rust commands they wrap (`get_use_case_recipes`, `promote_use_case_to_recipe`) are still registered, but the frontend has lost its consumer.
- **Root cause**: Frontend wrappers added preemptively for a use-case → recipe promotion UX that didn't ship, or that ships now through a different code path.
- **Impact**: ~18 LOC of dead surface plus the implication that the Tauri commands are reachable from the UI when they're orphaned.
- **Fix sketch**: Verify the use-case → recipe path lives elsewhere (e.g. via `linkRecipeToPersona` plus inline recipe creation), then delete these two exports. If the Rust command is also orphaned, deregister it from `lib.rs:1718` and `commandNames.generated.ts`.

## 11. `delete_recipe` in-flight check repeats domain list inline

- **Severity**: low
- **Category**: duplication
- **File**: `src-tauri/src/commands/recipes/crud.rs:106-114`
- **Scenario**: `delete_recipe` hard-codes `&["recipe_execution", "recipe_generation", "recipe_versioning"]` as the list of process-registry domains that must be quiescent before deletion. The same three strings appear as keys passed to `registry.set_id`/`take_id`/`get_id` in this same file's three start/cancel handler pairs. Adding a fourth long-running recipe operation (e.g. a `recipe_optimization`) means remembering to extend two separate places.
- **Root cause**: No central enumeration of "domains that block recipe delete"; the check was inlined ad hoc.
- **Impact**: Minor — only 3 entries today — but the parallel literal couples otherwise independent code paths.
- **Fix sketch**: Declare `const RECIPE_TASK_DOMAINS: &[&str] = &["recipe_execution", "recipe_generation", "recipe_versioning"]` at module scope (or pair it with the `RECIPE_*_MESSAGES` consts) and reference it from both the cancel-handler refactor (finding #1) and this guard.
