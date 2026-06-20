# Recipes

Recipes are reusable workflow definitions that can be created manually, generated from credentials/use cases, linked to personas, tested in a playground, versioned, and executed.

## User surface

Recipes are surfaced from the Templates area through the Recipes tab. `RecipeManager` is the main page host.

| Surface | Behavior | Implementation |
| --- | --- | --- |
| List | Searchable recipe cards, edit/delete/playground actions | `sub_list/components/RecipeList.tsx`, `RecipeCard.tsx` |
| Editor | Create/edit recipe metadata, schema fields, tags | `sub_editor/components/RecipeEditor.tsx`, `SchemaFieldBuilder.tsx`, `TagChipInput.tsx` |
| Playground | Test input, output, execution history, versions | `sub_playground/components/RecipePlaygroundModal.tsx`, `tabs/*` |
| View FSM | Keeps list/create/edit/playground states explicit | `hooks/useRecipeViewFSM.ts` |

The manager fetches recipes from `usePipelineStore().fetchRecipes()`, supports `Ctrl/Cmd+K` search focus, and routes editing/playground through `useRecipeViewFSM`.

## Definition and schema

A recipe is a structured definition with metadata, tags, input schema, and execution behavior. The editor builds schema fields visually and the playground uses the schema to render test inputs. Parse errors are surfaced by `SchemaParseErrorBanner`.

For template authoring conventions, see [recipe-templates.md](recipe-templates.md).

## Backend command surface

| Family | Commands |
| --- | --- |
| CRUD | `list_recipes`, `get_recipe`, `create_recipe`, `update_recipe`, `delete_recipe` |
| Persona links | `link_recipe_to_persona`, `unlink_recipe_from_persona`, `get_persona_recipes` |
| Execution | `execute_recipe`, `start_recipe_execution`, `cancel_recipe_execution` |
| Credential/use-case generation | `get_credential_recipes`, `start_recipe_generation`, `cancel_recipe_generation`, `get_use_case_recipes`, `promote_use_case_to_recipe` |
| Versioning | `get_recipe_versions`, `start_recipe_versioning`, `cancel_recipe_versioning`, `accept_recipe_version`, `revert_recipe_version` |
| Derivation | `derive_recipes_from_template`, `list_recipes_by_template` |
| Suggestions | `match_recipes_to_intent` |
| Suggestion telemetry | `log_recipe_suggestion_event`, `get_recipe_suggestion_stats`, `list_recipe_suggestion_events` |

Async generation/execution/versioning commands use active-process registration and can be cancelled. Synchronous `execute_recipe` is for direct test-style execution; `start_recipe_execution` returns an execution id for longer runs.

`match_recipes_to_intent` powers the Glyph composer's recipe-suggestion chip (`ComposerRecipeSuggestion`). The frontend debounces the user's typed task by 300ms and queries this command with `top_k = 1`. The chip is shown only when the top match's `above_threshold` is `true` — i.e. the score clears `engine::recipe_matcher::SUGGESTION_THRESHOLD` (0.90, conservative). Below-threshold matches and zero-overlap recipes are silently dropped, so the suggestion never gets in the user's way during normal authoring.

When the user clicks the chip's "Use this recipe" button, the composer fetches the full recipe via `get_recipe` and pre-fills the in-flight draft (Stage D Phase 3, mode 1 acceptance). Pre-fill policy lives in `mergeRecipeIntoDraft` (`commandPanelHelpers.ts`): replace `draft.task` with the recipe's description (or name if missing); pre-fill `draft.tools` from `tool_requirements` only when the user hasn't typed any; leave `when`/`output`/`review` untouched. Acceptance is intentionally opt-in — the chip is hidden by default until the matcher's score crosses threshold, and the apply action shows a success toast naming the applied recipe.

Stage D Phase 4 instruments the chip with append-only telemetry. Every visible chip logs one `impression` event (deduped per `recipe_id` per mount); clicking "Use this recipe" logs an `accept`; clicking the dismiss X logs a `dismiss`. Events live in `recipe_suggestion_events` and roll up via `get_recipe_suggestion_stats` into a `RecipeSuggestionStats { impressions, accepts, dismisses, accept_rate, decisive_count, sample_size, mode_2_eligible }`. The `mode_2_eligible` gate (`accept_rate ≥ 0.5` and `decisive_count ≥ 20` over the last 50 events) is what Phase 5 reads to decide whether to enable the "skip build" shortcut. Thresholds live as constants in `db::repos::resources::recipe_suggestions` so they can be tuned without touching the type binding.

Stage D Phase 5 adds the mode-2 affordance. When the chip first surfaces, the composer fetches stats once via `useRecipeSuggestionEligibility` and only renders the "Run now" button if `mode_2_eligible` is true. The handler stashes the recipe id in `pipelineStore.pendingPlaygroundRecipeId`, switches the sidebar to `design-reviews`, and shows a toast. The recipes panel's `RecipeManager` reads `consumePendingPlayground` on mount and dispatches `GO_PLAYGROUND` for that id, jumping the user straight into the recipe's playground modal — bypassing the entire Glyph build flow. The button stays dormant on fresh installs until ~20 decisive events have crossed the gate, so first-time users see only the conservative mode-1 chip.

## Relationship to templates and personas

Templates create personas; recipes are reusable operational workflows. A persona can be linked to multiple recipes, and use cases can be promoted into recipes when a repeated workflow emerges from a design/use-case flow. **Promotion is reachable from the UI** (UAT F-CLIENT-OPERATOR-VIEW): the capability detail view (`UseCaseDetailExpanded`, in the persona Use Cases tab) has a **"Save as recipe"** action that calls `promote_use_case_to_recipe` (no credential baked in — the adopter resolves credentials), closing the build-once → reusable-recipe loop. Previously the command existed but had no caller, so a built capability couldn't be turned into a shareable recipe without rebuilding from scratch.
