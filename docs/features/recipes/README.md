# Recipes

A recipe is a reusable, parameterized capability definition. The shipping
product uses recipes for exactly one thing: **a browsable catalog you adopt
onto a persona**, which appends a capability to that persona's
`design_context.useCases[]` and bridges the recipe's declared knobs into the
persona's live `{{param.*}}` parameters.

> **Doc contract:** every claim below is grep-confirmable against `src/` and
> `src-tauri/` as of 2026-08-09. A large amount of recipe code exists that is
> *not* reachable from any UI — it is inventoried in
> [Dead code](#dead-code--reachable-from-no-ui) rather than described as if it
> ran. An earlier revision of this file documented that dead path as the main
> surface; if you are looking for `RecipeManager`, start there.

## The pipeline that actually ships

```
scripts/templates/_recipe_seeds.json     (299 recipes, compiled in)
  └─ include_str! ─► src-tauri/src/engine/recipe_seed.rs   (boot, idempotent)
       └─ INSERT INTO recipe_definitions                   (key: source_template_id + source_use_case_id)
            └─ list_recipes ─► usePipelineStore().recipes
                 └─ recipeDefinitionsToRecipes()           (sub_recipes/libs/recipeAdapter.ts)
                      └─ RecipesPage catalog ─► RecipeAdoptionModal ─► useAdoption.adopt()
                           ├─ mutateUseCases(): append DesignUseCase { source_recipe_id }
                           └─ sync_capability_parameters ─► persona.parameters + injected
                                                            "## Capability Parameters" section
                                └─ per run: engine/prompt/variables.rs::replace_variables
                                            resolves {{param.<key>}}
```

Nothing between the catalog and execution goes through a "recipe execution"
code path. An adopted recipe becomes an ordinary persona capability; the
persona runner is what executes it.

### Seeding

`src-tauri/src/engine/recipe_seed.rs` embeds `scripts/templates/_recipe_seeds.json`
via `include_str!` and inserts missing rows into `recipe_definitions` on app
startup. Idempotency is keyed on the partial-unique
`(source_template_id, source_use_case_id)` index — existing rows are skipped,
with two deliberate exceptions the module documents in its header (display-name
/ category repair, and `model_override` + `model_rationale` refresh for builtin
rows). Fresh installs therefore always have the full catalog without running
the dev-time Python migration script.

## User surface — the catalog

`DesignReviewsPage.tsx` mounts `RecipesPage` (`src/features/templates/sub_recipes/`)
when the templates second-level sidebar's `recipes` entry is active. That is
the **only** recipe UI a user can reach.

| Surface | Behavior | Implementation |
| --- | --- | --- |
| Browse | Searchable/filterable catalog table, tag chips | `components/RecipesBrowseList.tsx`, `RecipesTableResults.tsx` |
| Detail | Header, needs, guardrails, how-it-runs breakdown | `components/RecipeDetailPanel.tsx`, `components/detail/*` |
| Adopt | Binding form → writes the capability onto a persona | `components/RecipeAdoptionModal.tsx`, `libs/useAdoption.ts` |
| Eligibility | Connector-based "can this persona run it" chip | `eligibility.ts`, `useEligibility.ts`, `components/EligibilityChip.tsx` |
| Adapter | `RecipeDefinition` row → rich frontend `Recipe` | `libs/recipeAdapter.ts` |
| Staleness | Flags an adopted capability whose source recipe moved on | `libs/recipeStaleness.ts` |

`RecipesPage` owns two pieces of view state (`selectedRecipeId`,
`adoptingRecipeId`) plus a lifted `search` so detail-view tag clicks can jump
back into a filtered browse. It refreshes via `usePipelineStore().fetchRecipes()`
on mount; the boot seed means that is normally a one-shot read.

`recipeDefinitionsToRecipes` is memoised — the catalog is ~299 entries and the
adapter parses each `prompt_template` once per call.

## Adoption — catalog into `design_context`

`libs/useAdoption.ts` owns both sides:

- **`adopt`** — `recipeToUseCase` substitutes the filled bindings into the
  recipe template (title, description, capability summary, notification channel
  types, suggested trigger with a cron-binding override), producing a
  `DesignUseCase` stamped with `source_recipe_id`. That use case is appended
  through `mutateUseCases`, then `sync_capability_parameters` reconciles the
  persona's parameters, then `fetchDetail` refreshes the persona.
- **`remove`** — drops every use case whose `source_recipe_id` matches, then
  re-syncs so the detached capability's parameter lines leave the injected
  prompt section.

Both are **idempotent**: the dedupe check runs *inside* the queued design_context
mutator, against the freshest use-case list, so a double-click or a stale UI
cannot append the same recipe twice. Re-adopting surfaces an "already adopted"
warning toast instead.

The Foundry (`docs/features/personas/README.md`) attaches the same catalog
recipes at creation time via `recipe_ref`s instead of going through this hook.

**Catalog audit (2026-07-06):** an 11-agent audit + adversarial verification of
all 299 seeded recipes concluded that apparent near-duplicates are NOT
mergeable — recipes remain template-bound (hardcoded event-listener names,
vendor-specific tool guidance, connector sets tied to the source template).
True dedup requires recipe parameterization first. See
`docs/architecture/recipe-catalog-audit-2026-07.md`.

For template authoring conventions, see [recipe-templates.md](recipe-templates.md).

## Recipe parameterization — `input_schema` → live persona params

Recipes declare tunable knobs per capability via each use case's `input_schema`
(264/299 seeded recipes carry one). Until 2026-07 these were **inert**: the
placeholders that consume them lived only in `sample_input`, which the promote
projection drops. They are now bridged into the persona-level parameter
mechanism (the same one templates use for `{{param.KEY}}`), so they take effect
and stay editable without a rebuild.

`src-tauri/engine/src/recipe_parameters.rs`:

1. **Derives** params from each capability's `input_schema`
   (`number→number`, `boolean→boolean`, `enum`/`select`→`select`,
   `multi_select`→`string` (comma-joined), `text`/`textarea`/`string`→`string`).
   Field default → the param's `default_value` + `value`; null and multi-select
   values are coerced so `{{param}}` never renders `null`.
2. **Merges** them **under** any existing persona parameters — template-authored
   `suggested_parameters` / `adoption_questions` or user-tuned values of the same
   key win. Across recipes, first wins. Keys are flat `<field>`, so a key shared
   by two capabilities is one shared knob.
3. **Injects** a synthesized `## Capability Parameters` block (grouped by
   capability, `- <label>: {{param.<key>}}`) into `structured_prompt.instructions`.
   Injection strips any prior copy first, so it is idempotent and re-adoption
   cannot stack duplicate blocks.
4. At run time `engine/prompt/variables.rs::replace_variables` substitutes
   `{{param.<key>}}` from `persona.parameters` on every execution — so editing a
   value in the persona parameters editor (`update_persona_parameters`) changes
   behavior with no rebuild.

### Unsupported field types are dropped

`map_param_type` returns `None` for `source_definition`, `connector_ref` and
`list[string]`. Those fields are **skipped** rather than mis-typed — a recipe
declaring one gets no editable knob for it. Across the seeded catalog that is
22 of 594 declared fields (5 `source_definition`, 16 `connector_ref`, 1
`list[string]`). Implementing the three types is separate, backlogged work.

The **gap is reported, not swallowed**. `params_from_schema` returns the
skipped fields alongside the derived params (`CapabilityParams.skipped`), and
`get_recipe_parameter_coverage` (`commands/recipes/recipe_parameter_coverage.rs`)
reports `{ declared, derived, skipped[] }` for a recipe. The catalog adoption
flow calls it right after a successful adopt and, when `skipped` is non-empty,
shows a warning toast naming how many settings could not be created and which
declared types caused it. A clean adopt still shows the plain success toast —
the warning is scoped to a genuine gap.

The supported-type list lives only in Rust, so the frontend cannot drift from
what actually runs.

A field whose `name` is missing **or blank** is ignored entirely: it would mint
a `{{param.}}` placeholder and a keyless parameters-editor row, and there is no
key to report it under. No seeded recipe has one.

A `syncCapabilityParameters` failure during adopt no longer passes silently
either — adoption still succeeds (the capability is already written), but the
toast says so instead of claiming a clean result.

### The three parameterizing paths

- **Promote / Foundry** (`build_sessions.rs`) — derives inline from the IR's
  `use_cases` before persist. Also keeps `input_schema` in
  `design_context.useCases` so a later catalog sync stays consistent.
- **`instant_adopt`** (Dev-Clone / completion-notifier) — derives from the
  hydrated `design["use_cases"]`, injects the section, and seeds params inline,
  mirroring promote.
- **Catalog quick-adopt** (`libs/useAdoption.ts`) — after appending the
  `DesignUseCase`, calls `sync_capability_parameters`, which resolves each use
  case's **authoritative** `input_schema` from the recipe row (via
  `source_recipe_id`, falling back to inline), merges under the persona's
  existing set, and idempotently re-injects the section.

The promote projection also **keeps** `capability_summary` + `tool_hints`
(previously dropped), restoring the curated one-liner the Active Capabilities
renderer prefers.

**Contract:** params remain prompt-level directives (LLM-adherence, not
code-gated), consistent with every persona-level param. Removing a capability
does **not** garbage-collect its `persona.parameters` entries — they go inert
(no section references them) and are user-removable via the parameters editor.
Design notes in `docs/architecture/recipe-parameterization-roadmap.md`.

## Glyph composer — recipe suggestion chip

`match_recipes_to_intent` powers the Glyph composer's suggestion chip
(`sub_glyph/commandPanel/composer/ComposerRecipeSuggestion.tsx`). The frontend
debounces the typed task by 300ms and queries with `top_k = 1`. The chip shows
only when the top match's `above_threshold` is `true` — i.e. the score clears
`engine::recipe_matcher::SUGGESTION_THRESHOLD` (0.90, conservative).
Below-threshold and zero-overlap matches are dropped silently, so the
suggestion never gets in the way during normal authoring. The same command also
backs `sub_glyph/useRecipeStarters.ts` and `RecipeAlternativeModal.tsx`.

**Mode 1 (pre-fill) — live.** Clicking "Use this recipe" fetches the full recipe
via `get_recipe` and pre-fills the in-flight draft. Policy lives in
`mergeRecipeIntoDraft` (`commandPanelHelpers.ts`): replace `draft.task` with the
recipe's description (or name if missing); pre-fill `draft.tools` from
`tool_requirements` only when the user hasn't typed any; leave
`when`/`output`/`review` untouched. A success toast names the applied recipe.

**Telemetry — live.** Every visible chip logs one `impression` (deduped per
`recipe_id` per mount); "Use this recipe" logs an `accept`; the dismiss X logs a
`dismiss`. Events land in `recipe_suggestion_events` and roll up via
`get_recipe_suggestion_stats` into
`RecipeSuggestionStats { impressions, accepts, dismisses, accept_rate, decisive_count, sample_size, mode_2_eligible }`.
The `mode_2_eligible` gate (`accept_rate ≥ 0.5` and `decisive_count ≥ 20` over
the last 50 events) lives as constants in
`db::repos::resources::recipe_suggestions`. Note this measures **chip
impressions and clicks — not recipe outcomes.**

**Mode 2 ("Run now") — BROKEN.** `useRecipeSuggestionEligibility` gates the
button on `mode_2_eligible`, and `CommandPanelComposer.tsx:113`'s
`handleRunDirect` stashes the recipe id in
`pipelineStore.pendingPlaygroundRecipeId`, switches the sidebar to
`design-reviews`, and toasts. **Nothing consumes that value.** The only reader of
`consumePendingPlayground` is `src/features/recipes/sub_manager/components/RecipeManager.tsx`,
which is never mounted (see below). The user is dropped on the catalog with no
playground and a toast that claims otherwise. The button is dormant on fresh
installs until ~20 decisive events cross the gate, which is why this has gone
unnoticed. Fixing or removing the handoff is backlogged.

## Backend command surface

Registered Tauri commands, annotated by whether any live UI can reach them.
"Dead" here means the only caller sits in a tree with no mounted consumer.

| Family | Commands | Reachable from UI? |
| --- | --- | --- |
| Read | `list_recipes`, `get_recipe` | **Yes** — catalog, composer chip, `CompositionXray`, `useHydratedDesignResult` |
| Suggestions | `match_recipes_to_intent` | **Yes** — composer chip, starters, alternative modal |
| Suggestion telemetry | `log_recipe_suggestion_event`, `get_recipe_suggestion_stats` | **Yes** — composer chip |
| Promotion | `promote_use_case_to_recipe` | **Yes** — `UseCaseDetailExpanded` "Save as recipe" |
| Parameter sync | `sync_capability_parameters` (persona params family) | **Yes** — `useAdoption` adopt + remove |
| Parameter coverage | `get_recipe_parameter_coverage` | **Yes** — `useAdoption` adopt (post-adopt gap notice) |
| CRUD (write) | `create_recipe`, `update_recipe`, `delete_recipe` | **No** — only `features/recipes/sub_editor`, `sub_manager` |
| Persona links | `link_recipe_to_persona`, `unlink_recipe_from_persona`, `get_persona_recipes` | **No** — only `features/recipes/sub_list/LinkedRecipesSection` |
| Execution | `execute_recipe`, `start_recipe_execution`, `cancel_recipe_execution` | **No** — only `features/recipes/sub_playground` |
| Versioning | `get_recipe_versions`, `start_recipe_versioning`, `cancel_recipe_versioning`, `accept_recipe_version`, `revert_recipe_version` | **No** — only `features/recipes/sub_playground/tabs/RecipeVersionsTab` |
| Generation | `get_credential_recipes`, `start_recipe_generation`, `cancel_recipe_generation` | **No** — `RecipeCreateFlow.tsx` has zero consumers |
| Use-case generation | `get_use_case_recipes` | **No** — zero references in `src/` |
| Derivation | `derive_recipes_from_template`, `list_recipes_by_template` | **No** — dev/migration-time only, zero `src/` callers |
| Adoption (parallel) | `adopt_recipe_for_persona`, `unadopt_recipe_from_persona` | **No** — see dead trio below |
| Eligibility (parallel) | recipe eligibility scoring | **No** — see dead trio below |

The execution state machine, cancellation race, and terminal-event guarantees
for `start_recipe_execution` are documented in the module header of
`src-tauri/src/commands/recipes/mod.rs`. That contract is accurate for the Rust
side — it simply has no live caller today.

## Dead code — reachable from no UI

Named explicitly so the next reader does not mistake volume for aliveness. **A
deletion direction is backlogged; do not delete piecemeal.**

### 1. `src/features/recipes/**` — the superseded recipe manager

28 files, ~2,629 LOC, **zero JSX consumers outside its own subtree** and **zero
`data-testid` anywhere in it**. `RecipeManager` is exported from
`sub_manager/index.ts` and imported by nothing. The tree contains the recipe
list, editor (`SchemaFieldBuilder`, `TagChipInput`), playground modal with its
tabs, the `useRecipeViewFSM` state machine, and `LinkedRecipesSection`. It was
superseded by `src/features/templates/sub_recipes/` (the catalog above).

Consequences: every write-side, execution, versioning and linking command is
unreachable, and the mode-2 "Run now" handoff has no landing site.

`src/features/vault/shared/playground/tabs/RecipeCreateFlow.tsx` is separately
orphaned (zero consumers), which is what strands the generation commands.

### 2. The parallel Rust adoption pipeline

`commands/recipes/recipe_adoption.rs` (`adopt_recipe_for_persona` /
`unadopt_recipe_from_persona`), `commands/recipes/recipe_eligibility.rs`
(tool-hint scoring) and the `persona_recipe_links` table
(`db/src/migrations/schema.rs:1033`, repo methods in
`db/src/repos/resources/recipes.rs`) form a fully-built adoption pipeline with
**zero frontend callers**. The shipped spine is the `design_context` path above;
the frontend connector-based eligibility (`sub_recipes/eligibility.ts`) is the
one in use. Do not half-wire the Rust pipeline — either converge onto it
wholesale or leave it be.

### 3. The mode-2 "Run now" handoff

`pipelineStore.pendingPlaygroundRecipeId` / `setPendingPlayground` /
`consumePendingPlayground` (`stores/slices/pipeline/recipeSlice.ts`) — written
by `CommandPanelComposer.tsx:113`, read only by the orphaned `RecipeManager`.
See the composer section above.

## Recipe outcome attribution — not yet wired

Adopted capabilities carry `source_recipe_id` provenance in
`design_context.useCases[]`, but that provenance is never joined to a run.
Nothing on the execution path records which recipe produced an output;
`dev_llm_spend` has only a coarse `source: "recipe"` tag written by the dead
playground path; and `recipe_suggestion_events` measures composer chip
impressions, not outcomes. So with 299 seeded recipes the product cannot answer
"which of these do people actually run, and do they succeed?" Backlogged.

## Relationship to templates and personas

Templates create personas; recipes are reusable capability definitions adopted
onto them. **Promotion closes the loop the other way** (UAT
F-CLIENT-OPERATOR-VIEW): the capability detail view (`UseCaseDetailExpanded`, in
the persona Use Cases tab) has a **"Save as recipe"** action calling
`promote_use_case_to_recipe` — no credential baked in, the adopter resolves
credentials. Previously the command existed but had no caller, so a built
capability could not be turned into a shareable recipe without rebuilding from
scratch.
