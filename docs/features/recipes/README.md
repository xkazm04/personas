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

Async generation/execution/versioning commands use active-process registration and can be cancelled. Synchronous `execute_recipe` is for direct test-style execution; `start_recipe_execution` returns an execution id for longer runs.

`match_recipes_to_intent` powers the Glyph composer's recipe-suggestion chip (`ComposerRecipeSuggestion`). The frontend debounces the user's typed task by 300ms and queries this command with `top_k = 1`. The chip is shown only when the top match's `above_threshold` is `true` — i.e. the score clears `engine::recipe_matcher::SUGGESTION_THRESHOLD` (0.90, conservative). Below-threshold matches and zero-overlap recipes are silently dropped, so the suggestion never gets in the user's way during normal authoring.

## Relationship to templates and personas

Templates create personas; recipes are reusable operational workflows. A persona can be linked to multiple recipes, and use cases can be promoted into recipes when a repeated workflow emerges from a design/use-case flow.
