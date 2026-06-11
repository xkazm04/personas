//! Stage B Phase 2.4 — recipe seed bootstrap.
//!
//! Embeds `scripts/templates/_recipe_seeds.json` (298 recipes derived from
//! the pre-Phase-2.2 inline-UC catalog at commit 34f483f1f^, plus 9
//! SDLC-template recipes appended after that ref) into the binary via
//! `include_str!`, and idempotently inserts any missing rows into
//! `recipe_definitions` on app startup.
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
//!   "version": 1,
//!   "ref": "34f483f1f^",
//!   "recipe_count": 291,
//!   "recipes": [ { "id": "<uuid>", "source_template_id": ..., ... }, ... ]
//! }
//! ```
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
//! no longer a pure function of the script's default ref (9 recipes were
//! appended from templates converted later; a blind re-run drops them).
//! Read the CAUTION block in that script's docstring first.

use serde::Deserialize;

use crate::db::models::{CreateRecipeInput, UpdateRecipeInput};
use crate::db::repos::resources::recipes as recipe_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// JSON seeds bundle. Compile-time embedded; ~1.3 MB.
const SEEDS_JSON: &str =
    include_str!("../../../scripts/templates/_recipe_seeds.json");

/// Minimum schema version this code understands. Rev when a breaking
/// change to the seed shape lands so `seed_recipes` fails fast instead
/// of silently mis-mapping fields.
const EXPECTED_SEED_VERSION: i64 = 1;

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

    if bundle.version != EXPECTED_SEED_VERSION {
        return Err(AppError::Internal(format!(
            "recipe seed bundle version mismatch: got {}, expected {EXPECTED_SEED_VERSION}",
            bundle.version
        )));
    }

    let mut report = SeedReport {
        total: bundle.recipes.len() as i64,
        ..Default::default()
    };

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
    if let Some(existing) = recipe_repo::find_by_source(
        pool,
        &seed.source_template_id,
        &seed.source_use_case_id,
    )? {
        // One-time upgrade repair: bundles before 2026-06 seeded the
        // technical `uc_*` id as the display name, a NULL category, and
        // never set is_builtin (CreateRecipeInput has no such field).
        // The signature `name == source_use_case_id` identifies exactly
        // the stale-name rows (a user rename breaks the equality, so
        // renamed rows are never touched); NULL-category rows get the
        // seed's category; un-flagged rows get is_builtin = 1 — this row
        // IS in the shipped bundle, that's how we found it.
        let stale_name = existing.name == seed.source_use_case_id
            && seed.name != seed.source_use_case_id;
        let missing_category = existing.category.is_none() && seed.category.is_some();
        let missing_builtin = !existing.is_builtin;
        if stale_name || missing_category {
            let update = UpdateRecipeInput {
                name: stale_name.then(|| seed.name.clone()),
                source_use_case_name: stale_name
                    .then(|| seed.source_use_case_name.clone())
                    .flatten(),
                category: if missing_category { seed.category.clone() } else { None },
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
    let null = serde_json::Value::Null;
    let seed_override = seed_inner.get("model_override").unwrap_or(&null);
    let seed_rationale = seed_inner.get("model_rationale").unwrap_or(&null);
    let cur_override = cur.get("model_override").unwrap_or(&null);
    let cur_rationale = cur.get("model_rationale").unwrap_or(&null);

    if seed_override == cur_override && seed_rationale == cur_rationale {
        return Ok(false);
    }

    let obj = match cur.as_object_mut() {
        Some(o) => o,
        None => return Ok(false),
    };
    // model_override: always present in the seed shape (null = persona
    // default / sonnet). Mirror the seed exactly.
    obj.insert("model_override".to_string(), seed_override.clone());
    // model_rationale: present only for non-default tiers; drop it when the
    // seed clears it so the row doesn't keep a stale rationale.
    if seed_rationale.is_null() {
        obj.remove("model_rationale");
    } else {
        obj.insert("model_rationale".to_string(), seed_rationale.clone());
    }

    let merged = serde_json::to_string(&cur)
        .map_err(|e| AppError::Internal(format!("recipe model-tier merge serialize failed: {e}")))?;
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let bundle: SeedBundle = serde_json::from_str(SEEDS_JSON)
            .expect("embedded seed bundle must parse");
        assert_eq!(bundle.version, EXPECTED_SEED_VERSION);
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

    #[test]
    fn seed_into_empty_db_creates_all_rows() {
        let pool = test_pool();
        let report = seed_recipes_from_bundle(&pool).expect("seed ok");
        assert!(report.total > 0);
        assert_eq!(report.created, report.total, "fresh DB → all created");
        assert_eq!(report.skipped_existing, 0);
        assert_eq!(report.failed, 0);
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
        assert!(fresh.is_builtin, "seeded rows are flagged builtin on create");

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
        assert_eq!(healed.category, target.category, "category healed from seed");
        assert!(healed.is_builtin, "builtin flag healed alongside name/category");

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
        let first = bundle.recipes.first().expect("bundle has at least one recipe");
        let row = recipe_repo::get_by_id(&pool, &first.id)
            .expect("seeded recipe must be queryable by id");
        assert_eq!(row.source_template_id.as_deref(), Some(first.source_template_id.as_str()));
        assert_eq!(row.source_use_case_id.as_deref(), Some(first.source_use_case_id.as_str()));
        let _: serde_json::Value = serde_json::from_str(&row.prompt_template)
            .expect("prompt_template must round-trip as JSON");
    }

    #[test]
    fn builtin_model_tier_is_refreshed_on_existing_rows() {
        let pool = test_pool();
        seed_recipes_from_bundle(&pool).expect("seed ok");
        let bundle: SeedBundle = serde_json::from_str(SEEDS_JSON).unwrap();

        // Find a shipped recipe carrying a concrete (non-null) model tier.
        let (target, want_tier) = bundle
            .recipes
            .iter()
            .find_map(|r| {
                let inner: serde_json::Value = serde_json::from_str(&r.prompt_template).ok()?;
                let mo = inner.get("model_override")?.as_str()?.to_string();
                Some((r, mo))
            })
            .expect("bundle must contain at least one tiered recipe");

        // Regress the seeded row to the pre-tiering shape (null override, no
        // rationale) — simulating an install seeded before tiers shipped.
        {
            let row = recipe_repo::get_by_id(&pool, &target.id).unwrap();
            let mut inner: serde_json::Value =
                serde_json::from_str(&row.prompt_template).unwrap();
            let obj = inner.as_object_mut().unwrap();
            obj.insert("model_override".into(), serde_json::Value::Null);
            obj.remove("model_rationale");
            let regressed = serde_json::to_string(&inner).unwrap();
            recipe_repo::update(
                &pool,
                &target.id,
                UpdateRecipeInput {
                    prompt_template: Some(regressed),
                    ..Default::default()
                },
            )
            .unwrap();
        }

        // Re-seed: exactly the regressed row's tier should heal.
        let pass = seed_recipes_from_bundle(&pool).expect("refresh pass ok");
        assert_eq!(pass.created, 0, "no new rows on a populated DB");
        assert_eq!(pass.repaired, 1, "exactly the regressed tier is refreshed");

        let healed = recipe_repo::get_by_id(&pool, &target.id).unwrap();
        let inner: serde_json::Value = serde_json::from_str(&healed.prompt_template).unwrap();
        assert_eq!(
            inner.get("model_override").and_then(|v| v.as_str()),
            Some(want_tier.as_str()),
            "model_override refreshed from the bundle tier",
        );
        assert!(
            inner.get("model_rationale").map(|v| v.is_string()).unwrap_or(false),
            "rationale restored alongside the tier",
        );
        // Non-tier content survives the field-merge.
        let orig: serde_json::Value = serde_json::from_str(&target.prompt_template).unwrap();
        assert_eq!(
            inner.get("title"),
            orig.get("title"),
            "untouched fields are preserved through the merge",
        );

        // Idempotent: once in sync, nothing further is repaired.
        let again = seed_recipes_from_bundle(&pool).expect("second refresh pass ok");
        assert_eq!(again.repaired, 0, "no row needs refreshing once in sync");
    }
}
