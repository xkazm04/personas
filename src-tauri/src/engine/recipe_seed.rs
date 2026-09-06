//! Stage B Phase 2.4 — recipe seed bootstrap.
//!
//! Embeds `scripts/templates/_recipe_seeds.json` (recipes derived from the
//! pre-Phase-2.2 inline-UC catalog at commit 34f483f1f^, plus the
//! SDLC-template recipes appended after that ref) into the binary via
//! `include_str!`, and idempotently inserts any missing rows into
//! `recipe_definitions` on app startup.
//!
//! Bundle size, re-measured from the committed file 2026-09-06: **109
//! recipes across 43 templates**. It held 299, then 213 after the 2026-09
//! template retirement, then 109 after the recipe consolidation. This line
//! claimed 213 until the count was re-derived rather than remembered.
//!
//! Why this exists: Phase 2.2 collapsed every template's inline use_cases
//! into recipe_ref pointers, so on a fresh install the recipe table is
//! empty until something derives the rows. The dev-time path was the
//! Python migration script (`migrate-template-usecases-to-recipes.py`),
//! but that requires the test-automation HTTP bridge running. For
//! end-user installs we instead seed the recipes directly from a
//! compiled-in JSON bundle.
//!
//! Seed file format (top-level wrapper, then a `recipes[]` array):
//! ```json
//! {
//!   "version": 3,
//!   "ref": "34f483f1f^",
//!   "recipe_count": 109,
//!   "recipes": [ { "id": "<uuid>", "source_template_id": ..., ... }, ... ]
//! }
//! ```
//! Since version 3 (Recipe v3, 2026-09-06) each `prompt_template` holds a
//! serialized `RecipeSpec` (craft knowledge: connector TYPES, a recommended
//! trigger, activities), not a charter and not a use case — see
//! `EXPECTED_SEED_VERSION`.
//!
//! Idempotency contract: each entry's `(source_template_id,
//! source_use_case_id)` is the partial-unique-index key. We look up via
//! `recipe_repo::find_by_source` first; existing rows are skipped (we
//! intentionally do not bump version or rewrite content here — a content
//! drift between the seed bundle and an existing row signals either a
//! template rev-up or a hand-edit in the dev DB, and either way is
//! something the existing `derive_recipes_from_template` flow handles
//! more carefully than this boot-time seeder should). Two targeted
//! exceptions live in `insert_one`:
//!   1. Metadata repair — rows still carrying the pre-2026-06 technical
//!      name (`name == source_use_case_id`) or a NULL category get those
//!      two display fields healed from the seed.
//!   2. Model-tier refresh — for builtin rows only, the per-capability
//!      `model_override` + `model_rationale` are field-merged from the
//!      seed into the stored `prompt_template`. These two keys encode a
//!      system-owned decision (which Claude model right-sizes a
//!      capability), so a later bundle's retiering must reach existing
//!      installs; every other `prompt_template` field (incl. user edits)
//!      is preserved untouched. Aside from those two keys, content is
//!      never rewritten.
//!
//! Seed regeneration: do NOT blindly re-run
//! `python scripts/generate-recipe-seeds.py` — the checked-in bundle is
//! no longer a pure function of the script's default ref (recipes were
//! appended from templates converted later, and the 2026-09 retirement
//! pruned 86 rows out; a blind re-run undoes both).
//! Read the CAUTION block in that script's docstring first.

use serde::Deserialize;

use crate::db::models::{CreateRecipeInput, UpdateRecipeInput};
use crate::db::repos::resources::recipes as recipe_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// JSON seeds bundle. Compile-time embedded; ~1.3 MB.
const SEEDS_JSON: &str = include_str!("../../../scripts/templates/_recipe_seeds.json");

/// The seed shape this code is written against. Rev when a breaking change
/// to the payload shape lands.
///
/// v2 (Stage B WP4, agent-manifest rebase): every `prompt_template` payload
/// is a serialized responsibility charter (camelCase `{id, title, domain,
/// outcomes, procedure, connectors, cadence, approvalGates, spec}` — see
/// `scripts/templates/transform-recipes-to-responsibilities.mjs`), no longer
/// a serialized use case.
///
/// v3 (Recipe v3): every payload is a serialized [`RecipeSpec`] — craftsman
/// knowledge with connector TYPES and a RECOMMENDED trigger, bound to an
/// installation only at adoption. See `scripts/templates/_RECIPE_V3_SPEC.md`
/// and `scripts/templates/transform-recipes-v2-to-v3.mjs`.
const EXPECTED_SEED_VERSION: i64 = 3;

/// The oldest bundle version this reader still accepts.
///
/// Narrowed to 3 on 2026-09-06, in the same commit that landed the
/// transformed v3 corpus (it was briefly 2 while the v3 backend preceded the
/// reviewed bundle, so the app would not refuse to seed in between). The
/// range still exists rather than a single pin so that a future v4 can stage
/// the same way. Note this pins the BUNDLE, not the rows: every consumer of
/// `prompt_template` tells the shapes apart STRUCTURALLY (v3 has an
/// `activities` array and an object `description`; v2 has a `procedure`
/// string; v1 has neither), and rows seeded by an older install are never
/// rewritten, so a live DB holds a mix of all three forever regardless of
/// what the bundle says.
const MIN_SUPPORTED_SEED_VERSION: i64 = 3;

#[derive(Debug, Deserialize)]
struct SeedBundle {
    version: i64,
    #[serde(default)]
    recipe_count: i64,
    recipes: Vec<SeedRecipe>,
}

#[derive(Debug, Deserialize)]
struct SeedRecipe {
    id: String,
    source_template_id: String,
    source_use_case_id: String,
    source_use_case_name: Option<String>,
    source_version: Option<String>,
    name: String,
    description: Option<String>,
    category: Option<String>,
    prompt_template: String,
    tool_requirements: Option<String>,
    tags: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct SeedReport {
    pub total: i64,
    pub created: i64,
    pub skipped_existing: i64,
    pub repaired: i64,
    pub failed: i64,
    /// Builtin rows the shipped bundle no longer carries, removed by
    /// `recipe_repo::retire_stale`. Before this existed the seeder only ever
    /// inserted, so a live DB kept every recipe any past release had shipped.
    pub retired: i64,
}

/// Walk the embedded recipe seed bundle and insert any rows that aren't
/// already in the DB. Safe to call repeatedly — re-runs are no-ops once
/// every seed row is present.
///
/// Failure mode: this function returns an error only if the bundle JSON
/// itself is malformed or the version is wrong. Per-row insert failures
/// are accumulated into `SeedReport.failed` and logged, but do NOT abort
/// the whole seed pass — one bad recipe shouldn't block 290 good ones
/// from landing.
pub fn seed_recipes_from_bundle(pool: &DbPool) -> Result<SeedReport, AppError> {
    let bundle: SeedBundle = serde_json::from_str(SEEDS_JSON).map_err(|e| {
        AppError::Internal(format!(
            "recipe seed bundle parse failed (rebuild via `python scripts/generate-recipe-seeds.py`): {e}"
        ))
    })?;

    if !(MIN_SUPPORTED_SEED_VERSION..=EXPECTED_SEED_VERSION).contains(&bundle.version) {
        return Err(AppError::Internal(format!(
            "recipe seed bundle version mismatch: got {}, expected {MIN_SUPPORTED_SEED_VERSION}..={EXPECTED_SEED_VERSION}",
            bundle.version
        )));
    }

    let mut report = SeedReport {
        total: bundle.recipes.len() as i64,
        ..Default::default()
    };

    // The bundle IS the shipped set — captured before the loop consumes it.
    let keep_ids: std::collections::HashSet<String> =
        bundle.recipes.iter().map(|r| r.id.clone()).collect();
    let shipped_template_ids: std::collections::HashSet<String> = bundle
        .recipes
        .iter()
        .map(|r| r.source_template_id.clone())
        .collect();

    for seed in bundle.recipes.into_iter() {
        match insert_one(pool, seed) {
            Ok(InsertOutcome::Created) => report.created += 1,
            Ok(InsertOutcome::Existing) => report.skipped_existing += 1,
            Ok(InsertOutcome::Repaired) => report.repaired += 1,
            Err(e) => {
                report.failed += 1;
                tracing::warn!(error = %e, "recipe seed insert failed; continuing");
            }
        }
    }

    // Sweep the ghosts the insert-only seeder has been accumulating since the
    // first release. Best-effort by the same logic as a per-row insert
    // failure: a sweep that cannot run must not stop the app from booting with
    // a correctly seeded catalog.
    match recipe_repo::retire_stale(pool, &keep_ids, &shipped_template_ids) {
        Ok(retired) => {
            report.retired = retired.len() as i64;
            if !retired.is_empty() {
                // The ids, not just the count: a retirement is a deletion and
                // the operator must be able to see exactly which rows went.
                tracing::info!(
                    count = retired.len(),
                    ids = %retired.join(", "),
                    "Retired builtin recipes the shipped bundle no longer carries"
                );
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, "recipe retirement sweep failed; continuing");
        }
    }

    if report.recipe_count_signal_mismatch(bundle.recipe_count) {
        // Soft warning, not an error — bundles in flight may have stale
        // top-level counts that don't quite match the array length.
        tracing::warn!(
            stated = bundle.recipe_count,
            actual = report.total,
            "recipe seed bundle recipe_count diverges from recipes[] length"
        );
    }

    tracing::info!(
        total = report.total,
        created = report.created,
        skipped_existing = report.skipped_existing,
        repaired = report.repaired,
        retired = report.retired,
        failed = report.failed,
        "Recipe seed bundle applied"
    );
    Ok(report)
}

impl SeedReport {
    fn recipe_count_signal_mismatch(&self, stated: i64) -> bool {
        stated != 0 && stated != self.total
    }
}

enum InsertOutcome {
    Created,
    Existing,
    Repaired,
}

fn insert_one(pool: &DbPool, seed: SeedRecipe) -> Result<InsertOutcome, AppError> {
    if let Some(existing) =
        recipe_repo::find_by_source(pool, &seed.source_template_id, &seed.source_use_case_id)?
    {
        // One-time upgrade repair: bundles before 2026-06 seeded the
        // technical `uc_*` id as the display name, a NULL category, and
        // never set is_builtin (CreateRecipeInput has no such field).
        // The signature `name == source_use_case_id` identifies exactly
        // the stale-name rows (a user rename breaks the equality, so
        // renamed rows are never touched); NULL-category rows get the
        // seed's category; un-flagged rows get is_builtin = 1 — this row
        // IS in the shipped bundle, that's how we found it.
        let stale_name =
            existing.name == seed.source_use_case_id && seed.name != seed.source_use_case_id;
        let missing_category = existing.category.is_none() && seed.category.is_some();
        let missing_builtin = !existing.is_builtin;
        if stale_name || missing_category {
            let update = UpdateRecipeInput {
                name: stale_name.then(|| seed.name.clone()),
                source_use_case_name: stale_name
                    .then(|| seed.source_use_case_name.clone())
                    .flatten(),
                category: if missing_category {
                    seed.category.clone()
                } else {
                    None
                },
                ..Default::default()
            };
            recipe_repo::update(pool, &existing.id, update)?;
        }
        if missing_builtin {
            recipe_repo::set_builtin(pool, &existing.id, true)?;
        }
        // Model-tier refresh (builtin rows only): bring the per-capability
        // model_override/model_rationale up to the bundle's current tiering,
        // field-merged so any other prompt_template edits survive.
        let tier_refreshed = refresh_model_tier(pool, &existing, &seed)?;

        if stale_name || missing_category || missing_builtin || tier_refreshed {
            return Ok(InsertOutcome::Repaired);
        }
        return Ok(InsertOutcome::Existing);
    }

    let input = CreateRecipeInput {
        credential_id: None,
        use_case_id: None,
        name: seed.name,
        description: seed.description,
        category: seed.category,
        prompt_template: seed.prompt_template,
        input_schema: None,
        output_contract: None,
        tool_requirements: seed.tool_requirements,
        credential_requirements: None,
        model_preference: None,
        sample_inputs: None,
        tags: seed.tags,
        icon: None,
        color: None,
        source_template_id: Some(seed.source_template_id),
        source_use_case_id: Some(seed.source_use_case_id),
        source_use_case_name: seed.source_use_case_name,
        source_version: seed.source_version.or_else(|| Some("1.0.0".to_string())),
    };

    let created = recipe_repo::create_with_id(pool, &seed.id, input)?;
    // `CreateRecipeInput` has no is_builtin (user create paths must not mint
    // builtin rows) — flag the freshly seeded row explicitly.
    recipe_repo::set_builtin(pool, &created.id, true)?;
    Ok(InsertOutcome::Created)
}

/// Field-merge the bundle's per-capability model tier (`model_override` +
/// `model_rationale`) into an already-seeded **builtin** recipe's stored
/// `prompt_template`, preserving every other field the row carries
/// (including dev/user edits). Returns `true` iff the row was updated.
///
/// Rationale: `insert_one` deliberately never rewrites an existing row's
/// content, so model tiers shipped in a later bundle would otherwise only
/// reach fresh installs (the Created path). The model tier is a system-owned
/// decision, not user content, so for builtin rows we surgically merge just
/// those two keys. Non-builtin (user-authored) recipes are left untouched.
fn refresh_model_tier(
    pool: &DbPool,
    existing: &crate::db::models::RecipeDefinition,
    seed: &SeedRecipe,
) -> Result<bool, AppError> {
    if !existing.is_builtin {
        return Ok(false);
    }
    // Both sides must be parseable JSON objects; a malformed row is left
    // alone (the metadata-repair path and adoption already tolerate this).
    let seed_inner: serde_json::Value = match serde_json::from_str(&seed.prompt_template) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };
    let mut cur: serde_json::Value = match serde_json::from_str(&existing.prompt_template) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };
    // A v3 recipe payload carries no model tier at all: which model
    // right-sizes the work is an ADOPTION decision that lands on the charter's
    // `spec.modelOverride`, not a property of the craft knowledge. Writing the
    // v1 top-level keys onto one (which is what the v2/v1 fork below would do,
    // since a v3 payload has no `procedure`) would invent a field the shape
    // does not have.
    if crate::db::models::RecipeSpec::looks_like_v3(&seed_inner)
        || crate::db::models::RecipeSpec::looks_like_v3(&cur)
    {
        return Ok(false);
    }

    let (seed_override, seed_rationale) = model_tier_of(&seed_inner);
    let (cur_override, cur_rationale) = model_tier_of(&cur);

    if seed_override == cur_override && seed_rationale == cur_rationale {
        return Ok(false);
    }

    // Write at the STORED row's own shape: a v1 row (seeded before the v2
    // bundle; never rewritten by the idempotency contract) keeps its
    // top-level snake_case keys, a v2 row keeps `spec.*` — mixing the two
    // shapes in one payload is exactly the corruption the version pin above
    // exists to prevent.
    if !write_model_tier(&mut cur, &seed_override, &seed_rationale) {
        return Ok(false);
    }

    let merged = serde_json::to_string(&cur).map_err(|e| {
        AppError::Internal(format!("recipe model-tier merge serialize failed: {e}"))
    })?;
    recipe_repo::update(
        pool,
        &existing.id,
        UpdateRecipeInput {
            prompt_template: Some(merged),
            ..Default::default()
        },
    )?;
    Ok(true)
}

/// Structural shape probe for a `prompt_template` payload: a v2 charter
/// payload carries a `procedure` string, which no v1 use case ever did.
fn is_v2_payload(v: &serde_json::Value) -> bool {
    v.get("procedure").map(|p| p.is_string()).unwrap_or(false)
}

/// Read a payload's model tier from wherever ITS shape keeps it —
/// `spec.modelOverride` / `spec.modelRationale` for v2 charter payloads,
/// top-level `model_override` / `model_rationale` for v1 use-case payloads.
/// Absent and JSON-null are equivalent (both mean "persona default tier").
fn model_tier_of(v: &serde_json::Value) -> (serde_json::Value, serde_json::Value) {
    if is_v2_payload(v) {
        (
            v.pointer("/spec/modelOverride")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
            v.pointer("/spec/modelRationale")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        )
    } else {
        (
            v.get("model_override")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
            v.get("model_rationale")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        )
    }
}

/// Mirror the seed's tier into `cur` at `cur`'s own shape. A null override /
/// rationale removes the key (a stale rationale must not outlive its tier).
/// Returns false when `cur` is not a writable object.
fn write_model_tier(
    cur: &mut serde_json::Value,
    seed_override: &serde_json::Value,
    seed_rationale: &serde_json::Value,
) -> bool {
    let v2 = is_v2_payload(cur);
    let Some(root) = cur.as_object_mut() else {
        return false;
    };
    let (target, override_key, rationale_key) = if v2 {
        let spec = root
            .entry("spec".to_string())
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
        let Some(spec_obj) = spec.as_object_mut() else {
            return false;
        };
        (spec_obj, "modelOverride", "modelRationale")
    } else {
        (root, "model_override", "model_rationale")
    };
    if seed_override.is_null() {
        // v2 spec keys omit-on-null (the transform never writes explicit
        // nulls); v1 payloads historically carried an explicit
        // `model_override: null` for the default tier — preserve each style.
        if v2 {
            target.remove(override_key);
        } else {
            target.insert(override_key.to_string(), serde_json::Value::Null);
        }
    } else {
        target.insert(override_key.to_string(), seed_override.clone());
    }
    if seed_rationale.is_null() {
        target.remove(rationale_key);
    } else {
        target.insert(rationale_key.to_string(), seed_rationale.clone());
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::PoolExt;

    /// Mirrors `recipe_suggestions::test_pool` — initial migrations + the
    /// incremental ones that add the source_* columns. Independent across
    /// concurrent tests via a unique URI per call.
    fn test_pool() -> DbPool {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:testdb_recipe_seed_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder().max_size(4).build(manager).unwrap();
        {
            let conn = pool.get().unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).unwrap();
            crate::db::migrations::run_incremental(&conn).unwrap();
        }
        pool
    }

    #[test]
    fn embedded_bundle_parses_and_has_expected_shape() {
        let bundle: SeedBundle =
            serde_json::from_str(SEEDS_JSON).expect("embedded seed bundle must parse");
        assert!(
            (MIN_SUPPORTED_SEED_VERSION..=EXPECTED_SEED_VERSION).contains(&bundle.version),
            "bundle version {} is outside the supported range",
            bundle.version
        );
        assert!(
            !bundle.recipes.is_empty(),
            "bundle should not be empty after Phase 2.4 generation"
        );
        // Every entry must have the load-bearing fields populated.
        for r in bundle.recipes.iter().take(10) {
            assert!(!r.id.is_empty(), "recipe id must not be empty");
            assert!(!r.source_template_id.is_empty());
            assert!(!r.source_use_case_id.is_empty());
            assert!(
                !r.prompt_template.is_empty(),
                "prompt_template stores the serialized UC; must be non-empty"
            );
            // prompt_template must round-trip as JSON (hydrate_recipe_refs
            // relies on this; a malformed entry would break adoption).
            let _: serde_json::Value = serde_json::from_str(&r.prompt_template)
                .expect("each prompt_template must parse as JSON");
        }
    }

    /// Recipe ids that predate the UUIDv5 derivation convention — the
    /// hand-minted SDLC rows appended after ref `34f483f1f^` (see the
    /// module-header warning about blind regeneration). Frozen: new refs
    /// must use `derive_recipe_id`; this list must only ever shrink.
    /// It shrank from 9 to 7 when the `code-reviewer` and `docs-steward`
    /// templates were retired and their rows left the bundle with them.
    const HAND_MINTED_RECIPE_IDS: &[&str] = &[
        "5dc1a001-a5c0-4a01-9e01-5dc1a0010001", // solution-architect:uc_architecture_review
        "5dc1a002-a5c0-4a02-9e02-5dc1a0020002", // solution-architect:uc_idea_architecture_analysis
        "5dc1a004-a5c0-4a04-9e04-5dc1a0040004", // release-manager:uc_release_automation
        "5dc1a005-a5c0-4a05-9e05-5dc1a0050005", // security-sentinel:uc_security_scan
        "c0a5e100-4b1d-4c0a-9e10-71a5c0a5e100", // qa-guardian:uc_coverage_scan
        "b0a5e200-4b1d-4b09-9e20-72a5b0a5e200", // qa-guardian:uc_bug_hunt
        "c0a5e300-4b1d-4c0a-9e30-73a5c0a5e300", // qa-guardian:uc_pr_review
    ];

    const LOCALE_SUFFIXES: &[&str] = &[
        "ar", "bn", "cs", "de", "es", "fr", "hi", "id", "ja", "ko", "ru", "vi", "zh",
    ];

    /// Canary (2026-07-06): every template's `recipe_ref` graph must stay
    /// coherent with the seed bundle. Guards the bug class found during the
    /// Foundry research — the 2026 email/sales consolidation re-pointed 3
    /// templates at rows derived from DELETED templates, which left
    /// `email-support-operator` hydrating two UCs with the same embedded id
    /// (`uc_email_triage`) and an adoption question bound to an id
    /// (`uc_email_triage_assistant`) that existed nowhere — silently
    /// orphaning the questionnaire. Asserts, corpus-wide:
    ///   1. every `recipe_ref.id` resolves to a bundle row
    ///   2. that row's provenance names THIS template (re-derivable)
    ///   3. `source_use_case_id` == the id embedded in `prompt_template`
    ///   4. embedded ids are unique within a template (hydration identity)
    ///   5. every adoption question's use-case binding hits an embedded id
    ///   6. ref ids follow `derive_recipe_id` (or are on the frozen
    ///      hand-minted allowlist)
    /// Dev-checkout test: walks `scripts/templates/` relative to the
    /// manifest dir (same pattern as `companion::dev_mode` context tests).
    #[test]
    fn template_recipe_refs_are_coherent_corpus_wide() {
        use crate::commands::recipes::recipe_derivation::derive_recipe_id;
        use std::collections::{HashMap, HashSet};

        let bundle: SeedBundle = serde_json::from_str(SEEDS_JSON).unwrap();
        let by_id: HashMap<&str, &SeedRecipe> =
            bundle.recipes.iter().map(|r| (r.id.as_str(), r)).collect();
        let hand_minted: HashSet<&str> = HAND_MINTED_RECIPE_IDS.iter().copied().collect();

        let root =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/templates");
        let mut checked_templates = 0usize;
        let mut checked_refs = 0usize;

        let category_dirs = std::fs::read_dir(&root).expect("scripts/templates readable");
        for dir in category_dirs.flatten() {
            let dir_path = dir.path();
            let dir_name = dir.file_name().to_string_lossy().to_string();
            if !dir_path.is_dir() || dir_name.starts_with('_') {
                continue;
            }
            for file in std::fs::read_dir(&dir_path)
                .expect("category dir readable")
                .flatten()
            {
                let name = file.file_name().to_string_lossy().to_string();
                if !name.ends_with(".json") {
                    continue;
                }
                // Skip per-locale siblings (name.<locale>.json).
                let parts: Vec<&str> = name.split('.').collect();
                if parts.len() == 3 && LOCALE_SUFFIXES.contains(&parts[1]) {
                    continue;
                }
                let raw = std::fs::read_to_string(file.path()).expect("template readable");
                let doc: serde_json::Value = serde_json::from_str(&raw)
                    .unwrap_or_else(|e| panic!("template {name} must parse as JSON: {e}"));
                let template_id = doc["id"].as_str().unwrap_or_default().to_string();
                assert!(!template_id.is_empty(), "{name}: template id missing");
                checked_templates += 1;

                let use_cases = doc
                    .pointer("/payload/use_cases")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let mut embedded_ids: Vec<String> = Vec::new();
                for uc in &use_cases {
                    let Some(ref_id) = uc.pointer("/recipe_ref/id").and_then(|v| v.as_str()) else {
                        continue; // inline UC (pre-v3) — out of scope here
                    };
                    checked_refs += 1;
                    let row = by_id.get(ref_id).unwrap_or_else(|| {
                        panic!("{template_id}: recipe_ref {ref_id} has no seed row (adoption would fail-closed)")
                    });
                    assert_eq!(
                        row.source_template_id, template_id,
                        "{template_id}: ref {ref_id} provenance names a different template ({}) — not re-derivable",
                        row.source_template_id
                    );
                    let embedded: serde_json::Value = serde_json::from_str(&row.prompt_template)
                        .unwrap_or_else(|e| {
                            panic!("{template_id}: ref {ref_id} prompt_template unparseable: {e}")
                        });
                    let emb_id = embedded["id"].as_str().unwrap_or_default().to_string();
                    assert_eq!(
                        row.source_use_case_id, emb_id,
                        "{template_id}: ref {ref_id} source_use_case_id drifts from embedded UC id"
                    );
                    if !hand_minted.contains(ref_id) {
                        assert_eq!(
                            ref_id,
                            derive_recipe_id(&template_id, &emb_id),
                            "{template_id}: ref {ref_id} is neither derive_recipe_id({template_id}, {emb_id}) nor hand-minted"
                        );
                    }
                    embedded_ids.push(emb_id);
                }

                // 4. hydration identity: no two UCs may share an embedded id.
                let unique: HashSet<&String> = embedded_ids.iter().collect();
                assert_eq!(
                    unique.len(),
                    embedded_ids.len(),
                    "{template_id}: duplicate embedded UC ids after hydration: {embedded_ids:?}"
                );

                // 5. adoption questions bind to real (embedded) UC ids.
                if let Some(questions) = doc
                    .pointer("/payload/adoption_questions")
                    .and_then(|v| v.as_array())
                {
                    for q in questions {
                        let mut bound: Vec<String> = Vec::new();
                        if let Some(s) = q["use_case_id"].as_str() {
                            bound.push(s.to_string());
                        }
                        if let Some(arr) = q["use_case_ids"].as_array() {
                            bound.extend(arr.iter().filter_map(|v| v.as_str().map(String::from)));
                        }
                        for b in bound.into_iter().filter(|b| !b.is_empty()) {
                            // Only enforce when the template composes via
                            // recipe_refs (inline templates keep their own ids).
                            if !embedded_ids.is_empty() {
                                assert!(
                                    embedded_ids.contains(&b),
                                    "{template_id}: adoption question binds use case `{b}` which no hydrated UC carries (question would be silently orphaned)"
                                );
                            }
                        }
                    }
                }
            }
        }

        // Floors re-derived from the shipped corpus 2026-09-06: **43
        // templates, 100 recipe_refs** (the consolidation took the corpus from
        // 111 templates / ~300 refs down to this). They stood at 100/250 —
        // numbers from the pre-consolidation corpus that this walk could no
        // longer reach, so the canary could not pass however healthy the
        // corpus was. The floors exist to catch a walk that visits NOTHING
        // (the fail-loud contract), so they sit just under the measured
        // counts; re-derive them, never lower them to fit a failure.
        assert!(
            checked_templates >= 40,
            "expected the full corpus (43 templates at 2026-09-06), saw {checked_templates}"
        );
        assert!(
            checked_refs >= 90,
            "expected recipe_ref coverage (100 refs at 2026-09-06), saw {checked_refs}"
        );
    }

    #[test]
    fn model_tier_merge_writes_at_the_stored_rows_own_shape() {
        // v1 stored row (top-level snake_case) + v2 seed tier -> healed at
        // the v1 location; the row must NOT grow a v2 `spec` envelope.
        let mut v1_row = serde_json::json!({
            "id": "uc_x", "title": "X", "model_override": null
        });
        assert!(write_model_tier(
            &mut v1_row,
            &serde_json::json!("haiku"),
            &serde_json::json!("mechanical"),
        ));
        assert_eq!(
            v1_row.get("model_override").and_then(|v| v.as_str()),
            Some("haiku")
        );
        assert_eq!(
            v1_row.get("model_rationale").and_then(|v| v.as_str()),
            Some("mechanical")
        );
        assert!(
            v1_row.get("spec").is_none(),
            "a v1 row must not grow a v2 spec envelope"
        );

        // v2 stored row -> healed under spec; a null seed tier removes the
        // keys, and the row must not grow v1 top-level keys.
        let mut v2_row = serde_json::json!({
            "id": "uc_x", "title": "X", "procedure": "Do the thing.",
            "spec": { "modelOverride": "opus", "modelRationale": "stale" }
        });
        assert!(write_model_tier(
            &mut v2_row,
            &serde_json::Value::Null,
            &serde_json::Value::Null,
        ));
        assert!(v2_row.pointer("/spec/modelOverride").is_none());
        assert!(v2_row.pointer("/spec/modelRationale").is_none());
        assert!(
            v2_row.get("model_override").is_none(),
            "a v2 row must not grow v1 keys"
        );
        // And both directions read back through the same accessor.
        assert_eq!(
            model_tier_of(&v1_row).0,
            serde_json::json!("haiku"),
            "v1 read follows the v1 location"
        );
        assert!(
            model_tier_of(&v2_row).0.is_null(),
            "v2 read follows the spec location"
        );
    }

    /// A v3 recipe payload has no model tier to refresh. The probe must catch
    /// that BEFORE the v2/v1 fork, which would otherwise take the v1 branch
    /// (no `procedure` key) and write `model_override` onto a shape that has
    /// no such field.
    #[test]
    fn a_v3_payload_is_told_apart_from_a_v1_payload_by_the_tier_probe() {
        let v3 = serde_json::json!({
            "id": "uc_x", "title": "X",
            "description": { "need": "n", "coreAction": "c" },
            "activities": [{ "id": "collect", "label": "Collect", "kind": "observe" }]
        });
        assert!(crate::db::models::RecipeSpec::looks_like_v3(&v3));
        // The v1/v2 probe genuinely cannot see it — which is exactly why
        // `refresh_model_tier` checks the v3 shape first.
        assert!(!is_v2_payload(&v3));
    }

    #[test]
    fn seed_into_empty_db_creates_all_rows() {
        let pool = test_pool();
        let report = seed_recipes_from_bundle(&pool).expect("seed ok");
        assert!(report.total > 0);
        assert_eq!(report.created, report.total, "fresh DB → all created");
        assert_eq!(report.skipped_existing, 0);
        assert_eq!(report.failed, 0);
    }

    /// The retirement sweep: exactly the unreferenced BUILTIN row the bundle
    /// no longer carries goes. A referenced one stays (a persona is using it)
    /// and a user-authored one stays whatever the bundle says.
    #[test]
    fn retirement_removes_only_the_unreferenced_builtin_ghost() {
        use std::collections::HashSet;

        let pool = test_pool();
        let now = chrono::Utc::now().to_rfc3339();
        let mk = |id: &str, builtin: bool| {
            // `PoolExt::conn` rather than `pool.get()`: the labelled checkout is
            // the sanctioned door (census `pool-get-unwrapped`), and a fixture
            // that panics on acquire hides the same saturation the product would.
            let conn = pool.conn("recipe_seed_test::mk").unwrap();
            conn.execute(
                "INSERT INTO recipe_definitions (id, project_id, name, prompt_template, is_builtin, created_at, updated_at)
                 VALUES (?1, 'default', ?1, '{}', ?2, ?3, ?3)",
                rusqlite::params![id, builtin as i64, now],
            )
            .unwrap();
        };
        mk("ghost", true); // builtin, unreferenced, not in the bundle
        mk("in_use", true); // builtin, referenced by a charter
        mk("mine", false); // user-authored

        // A charter pointing at `in_use` through the same field the guard
        // reads (`spec.sourceRecipeId`).
        {
            let conn = pool.conn("recipe_seed_test::charter").unwrap();
            conn.execute(
                "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
                 VALUES ('p1', 'P', '', ?1, ?1)",
                rusqlite::params![now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO persona_responsibilities
                   (id, persona_id, title, domain, outcomes, objectives, scope_rung,
                    refusal_classes, approval_gates, owner, cadence, tenure, status,
                    source, connectors, procedure, spec, created_at, updated_at)
                 VALUES ('r1','p1','T','general','[]','[]',0,'[]','[]','', '{}', '{}',
                         'active','operator','[]','', ?1, ?2, ?2)",
                rusqlite::params![r#"{"sourceRecipeId":"in_use"}"#, now],
            )
            .unwrap();
        }

        let keep: HashSet<String> = ["in_use".to_string()].into_iter().collect();
        let templates: HashSet<String> = HashSet::new();
        let retired = recipe_repo::retire_stale(&pool, &keep, &templates).expect("sweep ok");

        assert_eq!(retired, vec!["ghost".to_string()], "exactly the ghost goes");
        assert!(
            recipe_repo::get_by_id(&pool, "in_use").is_ok(),
            "a referenced recipe stays"
        );
        assert!(
            recipe_repo::get_by_id(&pool, "mine").is_ok(),
            "a user-authored recipe is never retired, whatever the bundle says"
        );
        assert!(recipe_repo::get_by_id(&pool, "ghost").is_err());

        // Idempotent: a second sweep finds nothing left to do.
        let again = recipe_repo::retire_stale(&pool, &keep, &templates).expect("second sweep ok");
        assert!(again.is_empty());
    }

    /// A `derived` row whose template no longer ships is retired even though
    /// its id IS in the bundle's keep set — the second half of the rule.
    #[test]
    fn a_derived_row_from_a_deleted_template_is_retired() {
        use std::collections::HashSet;

        let pool = test_pool();
        let now = chrono::Utc::now().to_rfc3339();
        {
            let conn = pool.conn("recipe_seed_test::derived").unwrap();
            conn.execute(
                "INSERT INTO recipe_definitions
                   (id, project_id, name, prompt_template, tags, source_template_id,
                    is_builtin, created_at, updated_at)
                 VALUES ('orphan','default','Orphan','{}','[\"derived\"]','gone-template',1,?1,?1)",
                rusqlite::params![now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO recipe_definitions
                   (id, project_id, name, prompt_template, tags, source_template_id,
                    is_builtin, created_at, updated_at)
                 VALUES ('kept','default','Kept','{}','[\"derived\"]','live-template',1,?1,?1)",
                rusqlite::params![now],
            )
            .unwrap();
        }

        let keep: HashSet<String> = ["orphan".to_string(), "kept".to_string()]
            .into_iter()
            .collect();
        let templates: HashSet<String> = ["live-template".to_string()].into_iter().collect();
        let retired = recipe_repo::retire_stale(&pool, &keep, &templates).expect("sweep ok");
        assert_eq!(retired, vec!["orphan".to_string()]);
        assert!(recipe_repo::get_by_id(&pool, "kept").is_ok());
    }

    #[test]
    fn second_seed_pass_is_idempotent() {
        let pool = test_pool();
        let first = seed_recipes_from_bundle(&pool).expect("first seed ok");
        let second = seed_recipes_from_bundle(&pool).expect("second seed ok");
        assert_eq!(first.total, second.total);
        // Second pass: zero new rows, every seed already present.
        assert_eq!(second.created, 0, "re-seed must not duplicate rows");
        assert_eq!(second.skipped_existing, second.total);
        assert_eq!(second.repaired, 0, "fresh rows must not trigger repair");
        assert_eq!(second.failed, 0);
    }

    #[test]
    fn stale_technical_name_rows_are_repaired_once() {
        // Simulate a pre-2026-06 install: seed everything, then regress one
        // row to the old shape (name = technical uc id, category = NULL).
        let pool = test_pool();
        seed_recipes_from_bundle(&pool).expect("seed ok");
        let bundle: SeedBundle = serde_json::from_str(SEEDS_JSON).unwrap();
        let target = bundle.recipes.first().expect("bundle non-empty");

        // Fresh seeding must flag rows builtin.
        let fresh = recipe_repo::get_by_id(&pool, &target.id).expect("row exists");
        assert!(
            fresh.is_builtin,
            "seeded rows are flagged builtin on create"
        );

        {
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE recipe_definitions
                 SET name = source_use_case_id, source_use_case_name = source_use_case_id,
                     category = NULL, is_builtin = 0
                 WHERE id = ?1",
                [&target.id],
            )
            .unwrap();
        }

        let repair_pass = seed_recipes_from_bundle(&pool).expect("repair pass ok");
        assert_eq!(repair_pass.repaired, 1, "exactly the regressed row heals");
        assert_eq!(repair_pass.created, 0);

        let healed = recipe_repo::get_by_id(&pool, &target.id).expect("row exists");
        assert_eq!(healed.name, target.name, "display name healed from seed");
        assert_eq!(
            healed.category, target.category,
            "category healed from seed"
        );
        assert!(
            healed.is_builtin,
            "builtin flag healed alongside name/category"
        );

        // A user rename must never be overwritten by the repair.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "UPDATE recipe_definitions SET name = 'My Custom Name' WHERE id = ?1",
                [&target.id],
            )
            .unwrap();
        }
        let after_rename = seed_recipes_from_bundle(&pool).expect("third pass ok");
        assert_eq!(after_rename.repaired, 0, "renamed rows are left alone");
        let kept = recipe_repo::get_by_id(&pool, &target.id).unwrap();
        assert_eq!(kept.name, "My Custom Name");
    }

    #[test]
    fn seeded_recipe_round_trips_prompt_template() {
        // Pick the first bundle entry and confirm that after seeding, the
        // row's prompt_template still parses as JSON. Adoption (via
        // hydrate_recipe_refs) depends on this — a corrupted entry would
        // surface as a validation error mid-adoption.
        let pool = test_pool();
        seed_recipes_from_bundle(&pool).expect("seed ok");
        let bundle: SeedBundle = serde_json::from_str(SEEDS_JSON).unwrap();
        let first = bundle
            .recipes
            .first()
            .expect("bundle has at least one recipe");
        let row = recipe_repo::get_by_id(&pool, &first.id)
            .expect("seeded recipe must be queryable by id");
        assert_eq!(
            row.source_template_id.as_deref(),
            Some(first.source_template_id.as_str())
        );
        assert_eq!(
            row.source_use_case_id.as_deref(),
            Some(first.source_use_case_id.as_str())
        );
        let _: serde_json::Value = serde_json::from_str(&row.prompt_template)
            .expect("prompt_template must round-trip as JSON");
    }

    /// A v3 recipe carries NO model tier: which model right-sizes the work is
    /// an adoption decision that lands on the charter, not a property of the
    /// craft knowledge. So the tier refresh that healed v2 rows must be a
    /// strict no-op over the shipped bundle: a reseed of a populated install
    /// repairs nothing tier-wise and leaves every payload byte-identical.
    /// (The v2 field-merge itself stays covered by
    /// `model_tier_merge_writes_at_the_stored_rows_own_shape`, which uses
    /// inline fixtures rather than the shipped corpus.)
    #[test]
    fn v3_bundle_carries_no_model_tier_and_reseed_repairs_nothing() {
        let pool = test_pool();
        seed_recipes_from_bundle(&pool).expect("seed ok");
        let bundle: SeedBundle = serde_json::from_str(SEEDS_JSON).unwrap();
        assert_eq!(
            bundle.version, EXPECTED_SEED_VERSION,
            "shipped bundle is v3"
        );

        let tiered = bundle
            .recipes
            .iter()
            .filter(|r| {
                serde_json::from_str::<serde_json::Value>(&r.prompt_template)
                    .ok()
                    .and_then(|v| v.pointer("/spec/modelOverride").map(|m| !m.is_null()))
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(tiered, 0, "a v3 bundle ships no recipe-level model tier");

        let before: Vec<(String, String)> = bundle
            .recipes
            .iter()
            .map(|r| {
                let row = recipe_repo::get_by_id(&pool, &r.id).unwrap();
                (r.id.clone(), row.prompt_template)
            })
            .collect();

        let pass = seed_recipes_from_bundle(&pool).expect("reseed ok");
        assert_eq!(pass.created, 0, "no new rows on a populated DB");
        assert_eq!(pass.repaired, 0, "nothing to refresh on a v3 bundle");

        for (id, payload) in before {
            let after = recipe_repo::get_by_id(&pool, &id).unwrap();
            assert_eq!(
                after.prompt_template, payload,
                "payload {id} untouched by the reseed"
            );
        }

        // Idempotent: once in sync, nothing further is repaired.
        let again = seed_recipes_from_bundle(&pool).expect("second refresh pass ok");
        assert_eq!(again.repaired, 0, "no row needs refreshing once in sync");
    }
}
