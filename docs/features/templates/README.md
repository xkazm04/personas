# Templates — Technical Documentation

> How the template catalog, adoption flow, questionnaire, and dynamic
> discovery engine fit together. Start here when touching anything in
> `src/features/templates/`, `scripts/templates/`, or
> `src-tauri/src/commands/design/template_adopt.rs`.

Templates are the "starter kits" a user picks from the gallery to create
an AI persona without writing one from scratch. Each template is a JSON
file on disk (`scripts/templates/<category>/<slug>.json`) that declares
the agent's prompts, connectors, triggers, and an adoption questionnaire
the user fills in to customize it. Adopting a template seeds a
`persona_design_reviews` row and walks the user through the Matrix
Adoption flow, ending in a tested + promoted persona.

The system has five layers worth documenting separately:

| Doc | Scope | Read when… |
|---|---|---|
| [01-template-format.md](01-template-format.md) | JSON shape, `payload.*` sections, adoption questions | Adding or editing a template |
| [02-catalog-loading.md](02-catalog-loading.md) | Vite glob, checksums, verification, seeding | Debugging "my template change didn't show up" |
| [03-adoption-flow.md](03-adoption-flow.md) | Gallery click → review → questionnaire → matrix → promote | Touching the adoption journey or build session |
| [04-adoption-questionnaire.md](04-adoption-questionnaire.md) | Question types, vault matching, blocking, Focus variant UI | Adding question types or changing the questionnaire UX |
| [05-dynamic-discovery.md](05-dynamic-discovery.md) | Rust registry, auth strategies, per-connector ops | Adding a new connector op or debugging 401s during adoption |
| [06-integrity-and-security.md](06-integrity-and-security.md) | Two-layer checksum verification, trust model | Touching template loading or checksum generation |
| [07-adoption-answer-pipeline.md](07-adoption-answer-pipeline.md) | How questionnaire answers reach the persona's prompt at runtime | Debugging "my adoption answers aren't being used" or adding `{{param}}` support to a template |
| [08-team-presets.md](08-team-presets.md) | Multi-template "preset team" bundles: manifest schema, adoption engine, library UI, Playwright E2E | Adding a new preset to ship or debugging the bulk-adoption flow |

## TL;DR architecture

```
scripts/templates/**/*.json          (source of truth on disk)
        │
        ▼ Vite glob (build-time static)
src/lib/personas/templates/
  templateCatalog.ts        ── loadAndVerify() → _cached VerifiedEntry[]
  templateChecksums.ts      ── client-side integrity manifest (generated)
  seedTemplates.ts          ── catalog → SeedReviewInput[]
        │
        ▼ batchImportDesignReviews() (Tauri IPC, ON CONFLICT upsert)
SQLite persona_design_reviews
        │
        ▼ fetched by useDesignReviews + rendered in gallery
GeneratedReviewsTab → user clicks "Adopt"
        │
        ▼ AdoptionWizardModal (BaseModal portal)
MatrixAdoptionView
  ├── extractDimensionData(designResult)        (seeds 8 matrix cells)
  ├── QuestionnaireFormFocus                    (renders adoption_questions)
  │     ├── useDynamicQuestionOptions            (Sentry/Notion/Linear/...)
  │     ├── matchVaultToQuestions                (auto-detect + block)
  │     └── QuestionCard ── SelectPills / DynamicSelectBody / ...
  ├── save_adoption_answers (Tauri IPC)         (persists answers to SQLite)
  └── useMatrixBuild + useMatrixLifecycle       (test → promote)
        │
        ▼ create_adoption_session (Tauri command)
build_sessions row + cells + adoption_answers hydrated
        │
        ▼ test_build_draft
substitute_variables() + inject_configuration_section() → run_tool_tests()
        │
        ▼ promote_build_draft
substitute_variables() + inject_configuration_section() → persona with real config
```

Rust surface:

```
src-tauri/src/commands/design/build_sessions.rs   (test, promote, save_adoption_answers)
src-tauri/src/commands/design/template_adopt.rs   (adoption commands)
src-tauri/src/commands/credentials/discovery.rs   (discover_connector_resources)
src-tauri/src/engine/adoption_answers.rs          (variable substitution + config injection)
src-tauri/src/engine/discovery.rs                 (discovery registry + ops)
src-tauri/src/engine/connector_strategy.rs        (auth strategies per connector)
src-tauri/src/engine/api_proxy.rs                 (HTTP proxy w/ auth + SSRF + rate limit)
src-tauri/src/engine/template_checksums.rs        (compiled-in checksum manifest)
src-tauri/src/db/repos/communication/reviews.rs   (persona_design_reviews DAO)
```

### Gallery & preview UI surfaces

- **Template comparison** (`gallery/cards/useTemplateCompare.ts`, `CompareTray.tsx`,
  `gallery/modals/CompareModal.tsx`, `gallery/cards/buildComparison.ts`): in comfortable
  density a per-row hover/selected checkbox adds up to 3 templates to a floating tray;
  **Compare** opens a side-by-side modal contrasting category, goal, connectors (with
  readiness), triggers, use-cases, complexity, setup time, and adoptions. Rows where the
  templates disagree get an amber diff accent, and each column carries Adopt / Try-it
  actions so the decision can be acted on in place. `buildComparison`
  reuses the same cached-parse / complexity / connector-readiness helpers the cards use, so
  the compare view never disagrees with what a card shows for the same template.
- **Use-cases tab** (`gallery/modals/UseCasesTab.tsx`): fourth detail-modal tab rendering
  each use-case flow as a linear digest (typed node chips walked along the flow's edges),
  readable without leaving the modal; hidden for templates without flows.
- **Trending quick-adopt** (`gallery/explore/TrendingCarousel.tsx`): trending cards carry a
  hover-revealed adopt action that opens the adoption flow directly from the shelf.
- **Design summary bar** (`design-preview/DesignSummaryBar.tsx`): `DesignResultPreview`
  leads with count pills (connectors / tools / events / channels) plus the feasibility
  verdict, so a reviewer grasps a generated design's shape before scrolling its full section
  list. Self-hides when there is nothing to summarise.

### Recipes catalog (`sub_recipes/`)

Browse/adopt surface for the 298 seeded recipe definitions (derived use cases packaged as
`recipe_definitions` rows). `RecipesPage` pulls rows from `usePipelineStore`, adapts each
`RecipeDefinition` through `libs/recipeAdapter.ts`, and routes browse → detail → adoption.

- **Adapter is the display contract** (`libs/recipeAdapter.ts`): the row's `prompt_template`
  holds the full serialized use-case JSON; the adapter extracts the human `title` (the row
  `name` was historically the technical `uc_*` id), the UC-level `category` (row-level is
  NULL for most seeds), `capability_summary` (browse tagline), and the review/memory/error
  policies. Categories funnel through a 42-alias map (`CATEGORY_ALIASES`) into the 9-bucket
  `RecipeCategory` taxonomy (monitoring / reporting / automation / communication / data-sync /
  analysis / development / content / productivity); labels resolve via `libs/categoryLabels.ts`.
- **Table** (`RecipesTableResults.tsx`): sortable columns — name, category badge
  (translated label), required-connector icon strip (up to 3 + overflow), version,
  eligibility. Row click opens detail; hover reveals Adopt.
- **Detail** (`RecipeDetailPanel.tsx` + `components/detail/*`): connector-tinted hero header
  (eligibility chip, category/version badges, author; publish time hidden for builtins),
  About + tags, "What it does" (trigger/cron, branded channel chips, tool hints), "What it
  needs" (connectors, bindings), and "Guardrails & memory" — the UC's review-policy,
  memory-policy and failure-handling prose with honest mode badges (no badge when the
  policy field is absent).
- **Source-side derivation** (`src-tauri/src/commands/recipes/recipe_derivation.rs`):
  `extract_uc_name` falls back name → title → id and derivation prefers the UC-level
  category. The boot seeder (`engine/recipe_seed.rs`) additionally heals pre-2026-06 rows
  still carrying the technical name signature (`name == source_use_case_id`) or a NULL
  category — user renames are never overwritten. **Never blindly regenerate
  `scripts/templates/_recipe_seeds.json`**: see the CAUTION in
  `scripts/generate-recipe-seeds.py` (a re-run from the pinned ref drops the 9 SDLC recipes
  appended after it).

## Common operations

### Add a new template

1. Create `scripts/templates/<category>/<slug>.json` — see
   [01-template-format.md](01-template-format.md) for the full schema.
2. Run `node scripts/generate-template-checksums.mjs` to update both
   the frontend and backend checksum manifests.
3. Restart `npm run tauri dev` so the Rust binary picks up the new
   `template_checksums.rs` constants at compile time.
4. Template appears in the Generated tab on next app launch (seeded
   via `useDesignReviews` + `batchImportDesignReviews`).

### Edit an existing template

1. Edit the JSON file.
2. `node scripts/generate-template-checksums.mjs`.
3. Restart `npm run tauri dev`. In dev mode the frontend invalidates
   `templateCatalog._cached` on every mount, so only the Rust binary
   needs a rebuild.
4. Seed upsert fires on next adoption hook mount — `ON CONFLICT DO
   UPDATE` writes the new `design_result` into the existing DB row.

### Audit the catalog

```bash
node scripts/audit-adoption-questions.cjs
```

Classifies every adoption question into five buckets (dynamic /
vault-aware / text / static-select / boolean) and flags cloud alias
mismatches. This is the authoritative catalog health check.

### Add a new discovery op for an existing connector

1. Add an entry to the `REGISTRY` in
   `src-tauri/src/engine/discovery.rs` keyed by
   `(service_type, operation)`.
2. Verify the connector's credential field names match what
   `connector_strategy::find_auth_token()` looks for, or add a custom
   strategy if Basic Auth / OAuth / query-string auth is needed.
3. Upgrade the template's question to include `dynamic_source`.
4. `cargo check --features desktop` + `npx tsc --noEmit`.

See [05-dynamic-discovery.md](05-dynamic-discovery.md) for the full
mechanics including body + headers support (Notion, GraphQL, etc.).

## Gotchas that burn time

1. **Running `tauri dev` caches `template_checksums.rs` at compile time.**
   Edits to template JSON files need a dev-server restart before the
   Rust-side `check_template_integrity` accepts the new content.
   Frontend-only changes hot-reload fine.
2. **The backend adoption path reads `design_result` from the DB**, not
   from the JSON file directly. If the DB row is stale (e.g. pre-edit
   seed), the user sees old content. `batchImportDesignReviews` uses
   `ON CONFLICT DO UPDATE` so subsequent seed runs fix this, but the
   `seedDoneRef` gate in `useDesignReviews` means seeding only fires
   once per component mount.
3. **Two BaseModal exports exist** — `@/lib/ui/BaseModal` and
   `sub_generated/shared/BaseModal`. The latter re-exports the former.
   Always pass `portal={true}` when rendering inside an
   `overflow-hidden` container.
4. **Two modal portals at the same DOM level don't auto-stack by
   recency.** `AdoptionWizardModal`'s BaseModal uses `z-[10000]`;
   anything nested inside needs higher z-index if it portals to body
   (see `TestReportModal` at `z-[10001]`).
5. **Cloud credentials have two service_type spellings.** CLI probes
   emit `aws`, `google_cloud`, `azure` while the catalog writes
   `aws_cloud`, `gcp_cloud`, `azure_cloud`. `vaultAdoptionMatcher` has
   a `SERVICE_TYPE_ALIASES` map to normalize — extend it when adding
   new CLI probes.
6. **The LLM adoption path is usually bypassed.** `template_adopt.rs`
   has `run_unified_adopt_turn1` that sends seed questions through an
   LLM, but templates with pre-curated `payload.adoption_questions`
   skip the LLM entirely — `seedTemplates.ts` writes the raw payload
   into `design_result` and `MatrixAdoptionView` reads it verbatim.
   This is why `dynamic_source` / `vault_category` / `allow_custom`
   survive unchanged.

## Related pillars

The three pillars of the persona platform:

```
1. Templates (this pillar)  →  2. Persona  →  3. Execution
```

- [../personas/README.md](../personas/README.md) — What a persona is
  once adopted: data model, capabilities (tools, triggers, events,
  memory, notifications), trust and governance.
- [../execution/README.md](../execution/README.md) — How a persona
  runs: entry points (manual, schedule, webhook, …), lifecycle
  (validate → spawn → stream → finalize), chaining + human approval,
  observability.

## Historical handoffs

- `docs/HANDOFF-templates-adoption.md` — multi-session handoff for the
  April 12–13 UX overhaul (close button, blocking callout, adoption
  resume, runtime project probe)
- `docs/HANDOFF-dynamic-discovery.md` — April 13–14 handoff covering
  the dynamic discovery engine rollout, alias map, Focus variant, and
  the Wave 3–6 uncommitted changes
- `docs/architecture/persona-matrix-build.md` — separate docs on the build
  session / matrix state machine that adoption eventually feeds into
