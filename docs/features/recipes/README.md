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

## Capability catalog — adopt and remove (2026-07)

The catalog surface (Templates → Recipes tab, `sub_recipes/`) adopts a recipe
onto the selected persona by substituting bindings into the recipe template
and appending a `DesignUseCase` into `design_context.useCases[]` with
provenance (`source_recipe_id`, `source_recipe_version`, `adopted_at`). Since
2026-07-06 the path is **idempotent** (the dedupe check runs inside the queued
design_context mutator, so double-clicks and stale UI can't duplicate) and
**symmetric**: adopted recipes show a Remove CTA (confirmation dialog) that
detaches every use case carrying that `source_recipe_id`. The Foundry
(`docs/features/personas/README.md`) attaches the same catalog recipes at
creation time via `recipe_ref`s instead.

**Dead code, deliberately unwired:** `commands/recipes/recipe_adoption.rs`
(`adopt_recipe_for_persona` / `unadopt_recipe_from_persona`),
`recipe_eligibility.rs` (tool-hint scoring) and the `PersonaRecipeLink` table
are a fully-built parallel adoption pipeline with **zero frontend callers**.
The shipped spine is the design_context path above; the frontend
connector-based eligibility (`sub_recipes/eligibility.ts`) is the one in use.
Do not half-wire the Rust pipeline — either converge onto it wholesale
(future work) or leave it be.

**Catalog audit (2026-07-06):** an 11-agent audit + adversarial verification
of all 299 seeded recipes concluded that apparent near-duplicates are NOT
mergeable — recipes remain template-bound (hardcoded event-listener names,
vendor-specific tool guidance, connector sets tied to the source template).
True dedup requires recipe parameterization (the designed-but-unused bindings
system) first. See `docs/architecture/recipe-catalog-audit-2026-07.md`.

## Recipe parameterization — input_schema → live persona params (2026-07)

Recipes declare tunable knobs per capability via each use-case's `input_schema`
(264/299 seeded recipes carry one). Until 2026-07 these were **inert**: the
placeholders that consume them lived only in `sample_input`, which the promote
projection drops — so an adopted recipe's declared parameters reached nothing at
runtime. **Now they are bridged into the working persona-level parameter
mechanism** (the same one templates use for `{{param.KEY}}`), so they take effect
and stay editable without a rebuild.

On promote (build-session → persona), `engine/recipe_parameters.rs`:

1. **Derives** `persona.parameters` from each capability's `input_schema`
   (`number→Number`, `boolean→Boolean`, `enum/select→Select`,
   `text/textarea/string→String`; `source_definition`/`connector_ref`/
   `list[string]` are skipped in v1). Field default → the param's default+value;
   null and multi-select values are coerced so `{{param}}` never renders `null`.
2. **Merges** them **under** any template-authored `suggested_parameters` /
   `adoption_questions` of the same key (template wins; across recipes, first
   wins). Keys are flat `<field>` — a key shared by two capabilities is one
   shared knob.
3. **Injects** a synthesized `## Capability Parameters` block (grouped by
   capability, `- <label>: {{param.<key>}}`) into
   `structured_prompt.instructions`, which the runtime resolver
   (`engine/prompt/variables.rs::replace_variables`) already substitutes every
   execution. So the model sees each capability's configured knobs, and editing a
   value via the persona parameters editor (`update_persona_parameters`) changes
   behavior with no rebuild.

The promote projection also now **keeps** `capability_summary` + `tool_hints`
(previously dropped), restoring the curated one-liner the Active Capabilities
renderer prefers.

**Known gaps (documented, not silently skipped):** the catalog quick-adopt path
(`sub_recipes/libs/useAdoption.ts`) is lossy by design — thin use-case, no
promote, no `persona.parameters` write — so parameterization only applies to the
promote/Foundry path today. `instant_adopt` (Dev-Clone) does not yet inject the
section. Params remain prompt-level directives (LLM-adherence, not code-gated),
consistent with every persona-level param. Design notes in
`docs/architecture/recipe-parameterization-roadmap.md`.

## Relationship to templates and personas

Templates create personas; recipes are reusable operational workflows. A persona can be linked to multiple recipes, and use cases can be promoted into recipes when a repeated workflow emerges from a design/use-case flow. **Promotion is reachable from the UI** (UAT F-CLIENT-OPERATOR-VIEW): the capability detail view (`UseCaseDetailExpanded`, in the persona Use Cases tab) has a **"Save as recipe"** action that calls `promote_use_case_to_recipe` (no credential baked in — the adopter resolves credentials), closing the build-once → reusable-recipe loop. Previously the command existed but had no caller, so a built capability couldn't be turned into a shareable recipe without rebuilding from scratch.
