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
- **Coverage filter — All / Ready / Partial / Drafts** (`gallery/search/filters/FilterChips.tsx`
  + `gallery/cards/useGalleryActions.ts`): Ready = 100% connector readiness, Partial = some.
  **Drafts** isolates unpublished (`is_published: false`) templates and is **dev-build-only**:
  the catalog skips drafts in production (`templateCatalog.ts` — `import.meta.env.DEV` gate), so
  they never leak into All/Ready/Partial, trending, or home; in dev they seed with a `_draft`
  marker on `design_result` and the Drafts chip appears (auto-hidden in prod since there are 0
  drafts). To move a template to Drafts, set `"is_published": false` and rerun
  `node scripts/generate-template-checksums.mjs` (drafts are still checksummed for dev integrity).
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
- **Table** (`RecipesTableResults.tsx`): sortable columns — name (search matches
  highlighted), category badge (translated label), required-connector icon strip
  (up to 3 + overflow), version, eligibility. Row click opens detail; hover reveals
  Adopt. Eligibility is a per-persona verdict: before a persona is selected the
  column shows a neutral dash (no LOCKED stamping, no row dimming). Rows the
  selected persona already adopted carry a green **Adopted** chip, driven by
  `DesignUseCase.source_recipe_id` — stamped at adoption time by `useAdoption`
  and persisted on both the TS and Rust shapes.
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

### Per-capability model tiering

Each recipe's serialized use-case carries a `model_override` (+ optional `model_rationale`)
that right-sizes the Claude model **per capability** by *cognitive complexity* — not by how
many tools it calls:

- `"haiku"` — mechanical / low-judgment work (triage into fixed buckets, field extraction,
  templated digests, rule-based routing).
- `null` — the default tier (**Sonnet**); the majority of capabilities. `null` means "use the
  persona's model", which is Sonnet by default, so it tracks any persona-level change.
- `"opus"` — high-judgment / high-stakes work where output quality dominates (competitive
  research synthesis, code review/refactor, legal/financial/compliance judgments, deep
  multi-source analysis).

Safety rule baked into the catalog: a capability with `review_policy.mode == "always"`
(consequential output) is never `haiku`.

Propagation: the tier rides the recipe's `prompt_template` → `hydrate_recipe_refs` →
`map_template_use_case_to_design_use_case` (template adopt) **and** the Glyph
build→promote path → `persona.design_context.useCases[].model_override`. At run time the
runner reads it and seeds the primary model before the failover chain
(`engine/runner/mod.rs`, "per-UC model override"); the value is passed verbatim to the CLI's
`--model` (bare aliases `haiku`/`opus` are resolved by the Claude CLI). `null` tiers leave
`--model` unset → persona default.

Existing installs: the boot seeder (`engine/recipe_seed.rs`) field-merges the bundle's
`model_override`/`model_rationale` into already-seeded **builtin** rows (`refresh_model_tier`),
so a later retiering reaches existing DBs without clobbering other `prompt_template` edits.
Fresh installs get it via the normal create path. To re-tier the catalog, edit
`_recipe_seeds.json` in place (the underscore prefix excludes it from checksums) — do **not**
regenerate.

### Ambient connector pre-ranking (build-from-scratch)

When the build-from-scratch flow asks *"which connector should this capability
use?"* (`scope: connector_category`), the picker is **pre-ranked from ambient
desktop signals** (Ambient Context Fusion, Case 1). If you're building a persona
while `github.com` is the focused tab — or `*.docx` files just landed in a
watched folder — the matching credential floats to the top of
`VaultConnectorPicker` with a "Suggested" badge. The clarifying question still
fires; you confirm.

Pipeline: `build_session/runner.rs` computes `ambient_connectors` once per
session via `AmbientContextFusion::connector_evidence(&registry_keywords)`
(`engine/ambient_context.rs`), passes it through
`gates::synthesize_gate_question` as a `suggested` array on the connector
question; the `Question`/`ClarifyingQuestionV3` events
(`db/models/build_session.rs`) carry it to the frontend. Persona-agnostic,
desktop-only, skipped in one-shot builds, and gated behind the ambient master
switch. It surfaces **only matched connector keywords** — never raw window
titles, paths, or clipboard text — so no ambient content leaks into the build
UI. See [`../../concepts/ambient-context-fusion.md`](../../concepts/ambient-context-fusion.md).

### Generated-persona error handling (honest-failure)

The build prompt's Rule 7 (`build_session/session_prompt.rs`) bakes a mandatory
error-handling contract into every generated persona's `system_prompt`: on a
missing/expired credential, an unreachable service, or an auth error the agent
must **stop and report the blocker** (emit `manual_review`, set
`outcome_assessment.business_outcome = "precondition_failed"` / `"no_input_available"`)
and must **never fabricate "realistic sample data"** to finish the run. The sole
carve-out is a persona explicitly built as a demo, whose output must be labeled
`SAMPLE`. This replaced an earlier clause that *mandated* fabricating sample data
on failure (UAT L1 F-FABRICATION-CLAUSE). A runtime `DATA_HONESTY_INVARIANT`
(`engine/prompt/templates.rs`, pushed for both execution disciplines) restates
the rule above the persona prompt so personas built before the fix are honest at
runtime too, and requires inline source citations for reported figures.

### Build grounding — optional reference context

The build session can ingest **first-class reference context** beyond the intent
string (UAT P7 — F-BUILD-NO-CONTEXT). `build_session_prompt`
(`build_session/session_prompt.rs`) takes an optional `context` that, when
present, is injected after the intent as a delimited **"USER-PROVIDED REFERENCE
CONTEXT"** block — framed as reference material, *not* instructions (a
prompt-injection guard so a pasted email can't hijack the build), and truncated
to 8k chars. The persona grounds its voice, facts, and assumptions in it instead
of inventing them from one sentence. `None`/blank reproduces the prior prompt
byte-for-byte. It is threaded through `start_session` and all build entry points
(the UI `start_build_session` command, the headless command, and the
test-automation + management-api HTTP build endpoints); the companion one-shot
path passes `None` for now. On the UI, an optional collapsed **"Add reference
context"** field (`BuildContextField`, in the matrix build entry) collects a
writing sample / role / brand guide pre-launch. The context is **transient** —
used to build the prompt, not persisted on the build session row.

### Synthesized teams wire handoff

`synthesize_team_from_templates` (`commands/design/team_synthesis.rs`) now calls
`engine::team_handoff::wire_team_handoff` after creating member connections —
mirroring the preset-adoption path — so a synthesized team actually hands work
between members instead of silently stalling after the entry member (UAT L1
F-TEAM-HANDOFF-SYNTH).

L2 verification then exposed a deeper, pre-existing bug: the synthesis prompt
told the LLM (and the examples showed) free-text roles like
"coordinator"/"executor", but `persona_team_members.role` has a
`CHECK(role IN ('orchestrator','worker','reviewer','router'))` — so the **first**
`add_member` failed the constraint and aborted the whole synthesis, leaving
orphaned personas + an empty team (no members/connections/handoff). Fixed two
ways: the synthesis prompt now requests only the four valid role tokens, and
`normalize_team_role` clamps any LLM deviation to the enum before insert. Live
L2 then confirmed a real synth produces members + connections and
`wire_team_handoff` fires (chain + event_listener triggers on the members).

That same incident showed synth is **non-transactional** — the persona/team/
member/connection/trigger writes each take their own pooled connection, so a
failure partway used to leave orphaned personas + an empty team. Synth now runs
the create steps inside a closure and, on any error, **compensates** by deleting
every entity it had already persisted (`created_personas` + `created_team`; FK
cascades reclaim members/connections/triggers). True single-transaction
atomicity would require threading one connection through every repo call — the
compensating rollback gives the same "all-or-nothing" guarantee without that
cross-cutting refactor.

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
