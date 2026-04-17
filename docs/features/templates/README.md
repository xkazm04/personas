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

## Related docs

- `docs/HANDOFF-templates-adoption.md` — multi-session handoff for the
  April 12–13 UX overhaul (close button, blocking callout, adoption
  resume, runtime project probe)
- `docs/HANDOFF-dynamic-discovery.md` — April 13–14 handoff covering
  the dynamic discovery engine rollout, alias map, Focus variant, and
  the Wave 3–6 uncommitted changes
- `docs/arch-persona-matrix-build.md` — separate docs on the build
  session / matrix state machine that adoption eventually feeds into
