# Stage B — Recipe migration: from inline-template-UCs to recipe references

**Status:** Design — ready for Phase 1a implementation. Phase 1b (migration script) and Phase 2 (template payload schema) gated on Phase 1a landing first.

**Date:** 2026-05-09

**Owner:** Whoever picks up the next session after Stage A4.

**Why this exists:** the Recipe redesign agreed 2026-05-02 (`project_recipe_redesign` memory) defined Recipe as the canonical *shareable* unit, but templates today bake their use cases inline as full capability definitions in `payload.use_cases[]`. Stage B closes that gap by making templates *reference* recipes by ID. This unblocks Stage D (Glyph recipe injection) and the persona-hub signing work in `unclear-wins/idea-728d3714` (which is explicitly waiting on this).

**Note on backward compatibility:** the app is pre-live, so we are NOT keeping inline-UC support after migration. The user's stated direction (2026-05-09) is "we don't need to keep legacy templates always alive ... though we will need proper live tests." Phase 1a's schema is forward-only; the one-time migration converts all 125 existing templates and the inline-UC parsing path is retired in Phase 2.

---

## Audit findings (current state)

### Templates

- **125 JSON files** across 14 category directories (`scripts/templates/{content,development,devops,email,finance,hr,legal,marketing,productivity,project-management,research,sales,security,support}/`)
- Schema version 3 (`schema_version: 3` in each file)
- Use cases live at `payload.use_cases[]` — each UC is a full capability definition with `id`, `name`, plus nested `suggested_trigger`, `event_subscriptions`, `tools`, `memory_policy`, `review_policy`, etc.
- Adoption questions live at `payload.adoption_questions[]` (per-UC binding via `use_case_id` field)
- Templates are loaded into the gallery via `templateCatalog.ts` (Vite glob import); the JSON files are the source of truth

### Recipes

- Schema lives in `src-tauri/src/db/models/recipe.rs:10` as `RecipeDefinition`
- Existing fields: `id`, `project_id`, `credential_id`, `use_case_id`, `name`, `description`, `category`, `prompt_template`, `input_schema`, `output_contract`, `tool_requirements`, `credential_requirements`, `model_preference`, `sample_inputs`, `tags`, `icon`, `color`, `is_builtin`, `created_at`, `updated_at`
- `PersonaRecipeLink` junction table connects personas → recipes (`persona_id`, `recipe_id`, `sort_order`, `config`)
- `RecipeVersion` table tracks per-recipe versions but **not provenance / parent-hash chains**
- **No `source_template_id` or `source_use_case_name` field** — Phase 1a adds these
- Existing recipe command groups: `crud.rs`, `recipe_execution.rs`, `recipe_generation.rs`, `recipe_versioning.rs`

### Migration system

- SQLite migrations live at `src-tauri/src/db/migrations/`
- Module layout (per the doc comment in `mod.rs`):
  - `schema.rs` — `SCHEMA` const, 1,517 LOC of `CREATE TABLE` / `CREATE INDEX` SQL (idempotent, used by `initial::run`)
  - `initial.rs` — `run()`: pre-schema ALTERs, then `SCHEMA`, then post-schema tables
  - `incremental.rs` — `run_incremental()`: column / index / table additions made after initial schema; **this is where Phase 1a's schema additions go**
  - `helpers.rs` — credential blob → fields helpers
  - `fk_hygiene.rs` — FK normalization helpers
- 11 historical Vibeman migrations (090–112) were consolidated into the single idempotent schema — there's no per-version migration directory; everything is `run()` (initial) + `run_incremental()` (additions).

---

## Concept refinement: what's the stable key?

**The hardest design call.** Use cases inside templates have `id` fields (e.g. `uc_detect_and_distribute`, `uc_performance_review`). Treating UC `id` as the stable key would cause every template re-author session that renames a UC to orphan recipes. UC `name` is more stable in practice but also editable.

**Decision: composite stable key = `(source_template_id, source_use_case_id)`** — using UC `id` not `name`, with explicit handling for renames.

Rationale:
- UC `id` is meant to be a stable internal identifier (e.g. `uc_detect_and_distribute`) — template authors generally don't rename them
- UC `name` is human-readable and frequently edited for UX polish
- Keying on `id` means renaming the human-facing name doesn't break recipes
- For the rare case of UC `id` rename: explicit handling (see "Re-import behavior" below)

**Recipe row identity for derived recipes:**
```
recipe.id           = uuid::v4()                             // permanent recipe ID, never changes
recipe.source_template_id   = "<template_id>"                // e.g. "analytics-content-distribution-use-case"
recipe.source_use_case_id   = "<uc_id>"                      // e.g. "uc_detect_and_distribute"
recipe.source_use_case_name = "<uc_name_at_import_time>"     // for human reference, not load-bearing
```

The lookup index for "does a recipe already exist for this (template, uc)?" uses `(source_template_id, source_use_case_id)` — a unique composite index.

---

## Phase 1a — Schema additions (mechanical, this Stage B turn or next)

### 1a.1 Add columns to `recipe_definitions` table

The codebase uses an `IncrementalMigration` struct in `src-tauri/src/db/migrations/incremental.rs` with idempotency via `has_column` / `has_table` helpers (defined in the same file at `incremental.rs:26` and `:35`). Pattern:

```rust
run_step(
    conn,
    IncrementalMigration {
        id: "recipe_definitions_provenance_v1",
        description: "Add provenance columns to recipe_definitions for template-derived recipes",
        already_applied: |conn| has_column(conn, "recipe_definitions", "source_template_id"),
        apply: |conn| {
            conn.execute_batch(
                "ALTER TABLE recipe_definitions ADD COLUMN source_template_id TEXT;
                 ALTER TABLE recipe_definitions ADD COLUMN source_use_case_id TEXT;
                 ALTER TABLE recipe_definitions ADD COLUMN source_use_case_name TEXT;
                 ALTER TABLE recipe_definitions ADD COLUMN source_version TEXT;
                 CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_definitions_source
                   ON recipe_definitions(source_template_id, source_use_case_id)
                   WHERE source_template_id IS NOT NULL;",
            )?;
            Ok(())
        },
    },
)?;
```

Notes:
- The migration's `already_applied` checks for the first column only — if all four are added in the same `apply` block, this is sufficient (they always land together).
- The unique index is **partial** (`WHERE source_template_id IS NOT NULL`) so existing non-template recipes can have NULL provenance without colliding.
- `id` is human-readable + unique; this is the registry's idempotency key.

Append this block to the end of `run_incremental` in `incremental.rs` (after the existing migrations), preserving migration order.

### 1a.2 Update `RecipeDefinition` struct in `src-tauri/src/db/models/recipe.rs`

```rust
pub struct RecipeDefinition {
    pub id: String,
    pub project_id: String,
    pub credential_id: Option<String>,
    pub use_case_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub prompt_template: String,
    pub input_schema: Option<String>,
    pub output_contract: Option<String>,
    pub tool_requirements: Option<String>,
    pub credential_requirements: Option<String>,
    pub model_preference: Option<String>,
    pub sample_inputs: Option<String>,
    pub tags: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
    // 2026-05-09 — provenance for template-derived recipes (Stage B Phase 1a)
    pub source_template_id: Option<String>,
    pub source_use_case_id: Option<String>,
    pub source_use_case_name: Option<String>,
    pub source_version: Option<String>,
}
```

`CreateRecipeInput` and `UpdateRecipeInput` get the same four optional fields.

### 1a.3 Regenerate ts-rs bindings

```
cargo test --manifest-path src-tauri/Cargo.toml export_bindings
```

Verify `src/lib/bindings/RecipeDefinition.ts` etc. include the new fields, then commit.

### 1a.4 Update repository layer

In whatever file holds the `recipe_definitions` repo (likely `src-tauri/src/db/repos/recipes.rs` or similar — verify):
- `INSERT` includes the new columns
- `SELECT` returns them
- Add `find_by_source(template_id, use_case_id)` lookup function for the migration script + future re-import

### 1a.5 Verification

- `cargo check --manifest-path src-tauri/Cargo.toml` clean
- `npx tsc --noEmit` clean
- App boots without error (incremental migrations are idempotent — re-running is fine)
- New columns visible via SQLite browser or test query

**Phase 1a is shippable on its own** — it adds nullable columns and an index. Existing recipes (none of which are template-derived today) get NULL provenance fields, no behavior change.

---

## Phase 1b — Migration script (one-time + idempotent re-import)

### 1b.1 New Rust command: `derive_recipes_from_template`

Add to `src-tauri/src/commands/recipes/`:

```rust
#[tauri::command]
pub async fn derive_recipes_from_template(
    state: State<'_, Arc<AppState>>,
    template_id: String,
    template_payload_json: String,
) -> Result<Vec<DeriveResult>, AppError> {
    require_auth(&state).await?;
    derive_recipes_from_template_inner(&state, &template_id, &template_payload_json).await
}

pub struct DeriveResult {
    pub use_case_id: String,
    pub recipe_id: String,
    pub action: DeriveAction,    // Created | Updated | Unchanged
}

pub enum DeriveAction { Created, Updated, Unchanged }
```

Logic:
1. Parse `template_payload_json` → extract `payload.use_cases[]`
2. For each UC:
   - Compute lookup key `(template_id, uc.id)`
   - Query `recipe_definitions` where `source_template_id = ? AND source_use_case_id = ?`
   - If found: compare current UC vs stored recipe. If different → bump `source_version`, update fields, return `Updated`. If same → return `Unchanged`.
   - If not found: create new recipe with provenance fields populated, `source_version = "1.0.0"`, return `Created`.
3. Return `Vec<DeriveResult>` so the caller can log what changed.

### 1b.2 Bulk migration script

`scripts/migrate-template-usecases-to-recipes.mjs`:

```javascript
// One-time + re-runnable script that walks scripts/templates/<category>/*.json
// and calls derive_recipes_from_template via the Tauri IPC bridge for each.
// Idempotent — re-running is safe (existing recipes match their source row).
//
// Usage:
//   uvx --with httpx python scripts/migrate-template-usecases-to-recipes.py
//   (or via the test-automation HTTP server on :17320)
//
// What it does:
//   1. Walk scripts/templates/<category>/*.json
//   2. For each template, POST to /derive-recipes-from-template
//   3. Aggregate per-template counts (Created / Updated / Unchanged)
//   4. Write a JSON report to docs/tests/results/recipe-migration-{run_id}.json
```

(Implement in Python for parity with the existing `tools/test-mcp/*.py` harnesses, or Node — pick whichever matches team conventions. Python is closer to existing test infra.)

### 1b.3 Verification

- Run on a clean dev DB: every template's UCs become recipes. Count: 125 templates × ~3 UCs avg = ~375 recipes.
- Re-run on the same DB: every result `Unchanged`. Idempotency proved.
- Modify one template's UC `id` (rename `uc_x` → `uc_y`):
  - Re-run: old `uc_x` recipe is orphaned (still exists, unreferenced); new `uc_y` recipe is created.
  - This is the **rename case** mentioned in the stable-key discussion. Mitigation: add an audit log + a manual cleanup pass. For Stage B, accept the orphan; flag for future versioning UX work.
- Modify a UC's name (not id): re-run produces `Updated` for that recipe (new `source_use_case_name` recorded, `source_version` bumped). Persistent — verify next run shows `Unchanged`.

### 1b.4 Decision gate before running on a populated DB

Don't run on any user data without:
- Phase 1a in production for ≥ 1 release (column adds verified)
- Round-trip test: derive recipes → adopt template → verify resulting persona is identical to pre-migration adoption (compare `persona_use_cases` rows)

---

## Phase 2 — Template payload schema gains `recipe_ref` shape

### 2.1 Schema addition

`payload.use_cases[]` items can be one of two shapes:

**Inline (current, retired in this phase):**
```json
{
  "id": "uc_detect_and_distribute",
  "name": "Detect and distribute",
  "suggested_trigger": { ... },
  "event_subscriptions": [ ... ],
  "tools": [ ... ],
  "memory_policy": "...",
  "review_policy": "...",
  ...
}
```

**Recipe ref (target, after migration):**
```json
{
  "recipe_ref": {
    "id": "<recipe_uuid>",
    "version": "1.0.0",
    "bindings": {
      "platform_choice": "{{aq_platforms}}",
      "review_mode": "{{aq_review_mode}}"
    }
  }
}
```

`bindings` carries the placeholder substitutions — same `{{...}}` grammar already documented in `docs/features/recipes/recipe-templates.md`.

### 2.2 Parser update — `template_v3.rs`

The `is_v3_shape` and `normalize_v3_to_flat` functions in `src-tauri/src/engine/template_v3.rs` need to:
- Recognize `recipe_ref` shape vs inline shape per UC
- For `recipe_ref` shape: look up the recipe by ID, hydrate the inline UC shape from recipe definition + apply `bindings`, then proceed with existing flatten logic
- Treat hydration failure (recipe not found, version mismatch) as a hard error — surface to user with clear "this template depends on recipe X which isn't installed" message

### 2.3 Inline-UC parsing path retirement

After Phase 1b runs and all 125 templates have been migrated to `recipe_ref` shape:
- Walk the JSON files programmatically: replace each UC's inline definition with the `recipe_ref` shape (script outputs new JSON files alongside originals; user reviews diff and commits)
- Once all template files are updated, remove the inline-UC parsing branch from `template_v3.rs`
- Add a hard error: "template uses inline UC shape — please re-author against recipe_ref"

This is the "no backward compat" stance the user authorized. Users running an older app version against a newer template DB would see a hard error, but that's acceptable for pre-live state.

---

## Phase 3 — Authoring UX (deferred, Stage B+)

Out of scope for the initial Stage B turn(s):
- Template editor surface to "use existing recipe" picker (today's templates are JSON files, no editor UI)
- Recipe detail view back-pointer ("used by templates: X, Y, Z")
- Recipe authoring flow (today's recipes are also data-only or generated)

These ship in a later stage when there's editor work happening anyway.

---

## Risks and mitigations

1. **Stable-key wrong choice.** If `source_use_case_id` turns out to be edited frequently, recipes will orphan on every re-import. Mitigation: scan all 125 templates' UC ids first; verify they look stable (snake_case, descriptive). If a template author commonly renames ids, fall back to a hash of `(template_id, uc.name + sorted_capability_signature)`. Add a UC-id stability test: re-run derive after random UC renames in test fixtures, count orphans.
2. **Migration produces 375 recipes overnight.** Recipes table currently sparse (likely <100 rows). Going to 500+ may surface query plan issues. Mitigation: the index added in Phase 1a is a unique composite — keeps lookups O(log n). Audit recipe list queries in `crud.rs` for unindexed scans.
3. **Round-trip parity.** A recipe-derived template adoption MUST produce the same persona as the inline-UC adoption did. Mitigation: capture a `persona_ir` snapshot from a pre-migration adoption, then post-migration re-adopt the same template, diff the two `agent_ir` rows. Any divergence is a Phase 2 parser bug.
4. **Recipe-version drift across template re-imports.** If a template author edits a UC, the recipe gets `Updated` and bumped to `1.0.1`. Existing personas adopted from that template still pin to `1.0.0`. The new "newer version available" UX doesn't exist yet (Phase 3). Mitigation: ship Phase 1a + 1b with version pinning in `adoption_metadata` (per the existing `useAdoption.ts:30` TODO); ship the UX in a follow-up.
5. **Test fixtures.** The 5-tier 30-template scenarios in `docs/tests/template-adoption-scenarios.md` rely on the inline-UC shape. Mitigation: those fixtures auto-update during the migration (template JSON files are the same fixtures the test scripts read). Re-run the e2e suite after Phase 2 to confirm parity.

---

## Concrete next steps

**This Stage B turn or next:** Phase 1a (schema additions, struct + ts-rs regen + repo updates + verification). Self-contained, mechanical, ~1–2 hours of careful work.

**Next session:** Phase 1b (`derive_recipes_from_template` Rust command + migration script). Run on dev DB, verify idempotency, write the round-trip parity test from risk #3.

**Session after that:** Phase 2 (template_v3 parser update + retire inline path + walk JSON files to convert all 125 templates). This is the load-bearing change that's hardest to revert.

**Don't start Phase 3 until users start requesting it** — authoring UX without authoring volume is empty calories.

---

## Cross-references

- Memory: `project_recipe_redesign` — concept agreement (2026-05-02), defines Recipe / Use Case / Template split
- `unclear-wins/idea-728d3714-persona-hub-a-signed-template` — signing infrastructure, explicitly waiting on this Stage B work; the `source_template_id` field added in Phase 1a is the same field the signing layer would key against
- `docs/concepts/persona-hub-marketplace.md` — public marketplace shelved, decision gate references "Recipe redesign settles"
- `docs/tests/template-adoption-scenarios.md` §6.4–6.5 — Stage B test scenarios (recipe-as-use-case adoption, version drift detection)
- `src-tauri/src/db/models/recipe.rs` — existing recipe schema
- `src-tauri/src/db/migrations/{incremental,helpers}.rs` — where Phase 1a SQL goes
- `src-tauri/src/engine/template_v3.rs` — Phase 2 parser updates
