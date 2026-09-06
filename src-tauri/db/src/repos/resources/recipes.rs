use rusqlite::params;

use crate::models::{
    CreatePersonaRecipeLinkInput, CreateRecipeInput, PersonaRecipeLink, RecipeDefinition,
    RecipeVersion, UpdateRecipeInput,
};
use crate::DbPool;
use personas_core::error::AppError;

// ============================================================================
// Row Mappers
// ============================================================================

row_mapper!(row_to_recipe -> RecipeDefinition {
    id, project_id, credential_id, use_case_id, name, description,
    category, prompt_template, input_schema, output_contract,
    tool_requirements, credential_requirements, model_preference,
    sample_inputs, tags, icon, color,
    is_builtin [bool],
    created_at, updated_at,
    source_template_id, source_use_case_id, source_use_case_name, source_version,
});

row_mapper!(row_to_link -> PersonaRecipeLink {
    id, persona_id, recipe_id, sort_order, config, created_at,
});

/// The columns `row_to_recipe` reads, in one place beside the mapper.
///
/// `SELECT *` fixes the result shape to `CREATE TABLE` order, and this table
/// has picked up four columns by `ALTER TABLE` already — so a named projection
/// is what keeps a future additive migration from rewriting a query nobody
/// edited. New reads here should use it; the older `SELECT *` sites in this
/// file are carried in the census baseline and are a separate change.
const RECIPE_COLUMNS: &str = "id, project_id, credential_id, use_case_id, name, description,      category, prompt_template, input_schema, output_contract, tool_requirements,      credential_requirements, model_preference, sample_inputs, tags, icon, color, is_builtin,      created_at, updated_at, source_template_id, source_use_case_id, source_use_case_name,      source_version";

// ============================================================================
// Recipe CRUD
// ============================================================================

crud_get_by_id!(
    RecipeDefinition,
    "recipe_definitions",
    "Recipe",
    row_to_recipe
);
crud_get_all!(
    RecipeDefinition,
    "recipe_definitions",
    row_to_recipe,
    "created_at DESC"
);

pub fn create(pool: &DbPool, input: CreateRecipeInput) -> Result<RecipeDefinition, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    create_with_id(pool, &id, input)
}

/// Same as `create`, but uses a caller-provided id instead of generating
/// a fresh v4 UUID. Used by Stage B Phase 1b's `derive_recipes_from_template`
/// flow, which derives a deterministic v5 UUID from
/// `(source_template_id, source_use_case_id)` so the conversion script in
/// Phase 2.2 can pre-compute recipe IDs without DB access.
pub fn create_with_id(
    pool: &DbPool,
    id: &str,
    input: CreateRecipeInput,
) -> Result<RecipeDefinition, AppError> {
    timed_query!("recipes", "recipes::create_with_id", {
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.query_row(
            "INSERT INTO recipe_definitions
             (id, project_id, credential_id, use_case_id, name, description, category, prompt_template,
              input_schema, output_contract, tool_requirements, credential_requirements,
              model_preference, sample_inputs, tags, icon, color, created_at, updated_at,
              source_template_id, source_use_case_id, source_use_case_name, source_version)
             VALUES (?1, 'default', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17,
                     ?18, ?19, ?20, ?21)
             RETURNING *",
            params![
                id,
                input.credential_id,
                input.use_case_id,
                input.name,
                input.description,
                input.category,
                input.prompt_template,
                input.input_schema,
                input.output_contract,
                input.tool_requirements,
                input.credential_requirements,
                input.model_preference,
                input.sample_inputs,
                input.tags,
                input.icon,
                input.color,
                now,
                input.source_template_id,
                input.source_use_case_id,
                input.source_use_case_name,
                input.source_version,
            ],
            row_to_recipe,
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::Internal("Failed to create recipe".into()),
            other => AppError::Database(other),
        })
    })
}

/// Flag a recipe as builtin (team-curated, shipped with the app). Only the
/// boot-time seeder calls this — `CreateRecipeInput` deliberately has no
/// `is_builtin` so user-facing create paths can't mint builtin rows.
pub fn set_builtin(pool: &DbPool, id: &str, value: bool) -> Result<(), AppError> {
    timed_query!("recipes", "recipes::set_builtin", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE recipe_definitions SET is_builtin = ?1 WHERE id = ?2",
            params![value, id],
        )?;
        Ok(())
    })
}

pub fn update(
    pool: &DbPool,
    id: &str,
    input: UpdateRecipeInput,
) -> Result<RecipeDefinition, AppError> {
    timed_query!("recipes", "recipes::update", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;

        push_field!(input.name, "name", sets, param_idx);
        push_field!(input.description, "description", sets, param_idx);
        push_field!(input.category, "category", sets, param_idx);
        push_field!(input.prompt_template, "prompt_template", sets, param_idx);
        push_field!(input.input_schema, "input_schema", sets, param_idx);
        push_field!(input.output_contract, "output_contract", sets, param_idx);
        push_field!(
            input.tool_requirements,
            "tool_requirements",
            sets,
            param_idx
        );
        push_field!(
            input.credential_requirements,
            "credential_requirements",
            sets,
            param_idx
        );
        push_field!(input.model_preference, "model_preference", sets, param_idx);
        push_field!(input.sample_inputs, "sample_inputs", sets, param_idx);
        push_field!(input.tags, "tags", sets, param_idx);
        push_field!(input.icon, "icon", sets, param_idx);
        push_field!(input.color, "color", sets, param_idx);
        push_field!(
            input.source_use_case_name,
            "source_use_case_name",
            sets,
            param_idx
        );
        push_field!(input.source_version, "source_version", sets, param_idx);

        let sql = format!(
            "UPDATE recipe_definitions SET {} WHERE id = ?{} RETURNING *",
            sets.join(", "),
            param_idx
        );

        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        if let Some(ref v) = input.name {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.description {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.category {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.prompt_template {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.input_schema {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.output_contract {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.tool_requirements {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.credential_requirements {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.model_preference {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.sample_inputs {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.tags {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.icon {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.color {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.source_use_case_name {
            param_values.push(Box::new(v.clone()));
        }
        if let Some(ref v) = input.source_version {
            param_values.push(Box::new(v.clone()));
        }
        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.query_row(&sql, params_ref.as_slice(), row_to_recipe)
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Recipe {id}")),
                other => AppError::Database(other),
            })
    })
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("recipes", "recipes::delete", {
        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM persona_recipe_links WHERE recipe_id = ?1",
            params![id],
        )?;
        tx.execute(
            "DELETE FROM recipe_versions WHERE recipe_id = ?1",
            params![id],
        )?;
        let rows = tx.execute("DELETE FROM recipe_definitions WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(rows > 0)
    })
}

/// Retire the builtin recipe rows the shipped bundle no longer carries.
///
/// **Why this exists.** The boot seeder only ever INSERTS. A row seeded by an
/// older bundle stays forever, so a live DB drifts above the bundle by every
/// recipe any past release ever shipped — measured 2026-09-06: 316 rows
/// against a 109-row bundle, i.e. 190 ghosts plus 18 `derived` rows whose
/// template was deleted months ago. Ghost recipes are not inert: they are
/// offered in the catalog and adopted.
///
/// **"Retire" means DELETE.** `recipe_definitions` has no status or archived
/// column, so there is no softer state to move a row into. What makes that
/// safe is the guard set, not the verb — a row is removed only when all of
/// these hold:
///
/// * `is_builtin = 1`. A user-authored recipe is NEVER touched, whatever the
///   bundle says. This is the single most important line in the function.
/// * no `persona_recipe_links` row references it;
/// * no charter references it at `spec.sourceRecipeId`;
/// * AND either it is absent from `keep_ids` (the bundle's own id set), or it
///   is tagged `derived` and its `source_template_id` is not in
///   `shipped_template_ids` (a row derived from a template that no longer
///   ships).
///
/// One IMMEDIATE transaction: the reads decide the writes, and a deferred
/// transaction fails `SQLITE_BUSY_SNAPSHOT` in 0 ms while ignoring
/// `busy_timeout`.
///
/// Returns the ids actually removed, so the caller can log them. Never errors
/// on "nothing to do".
///
/// **Index note (measured 2026-09-06).** The charter guard is
/// `json_extract(spec, '$.sourceRecipeId')` over `persona_responsibilities`,
/// which has no index and cannot use one without an expression index. It is
/// read ONCE per boot into a set (not once per candidate row), over a table
/// that holds tens of rows on a real install and 82 in the largest corpus
/// seen — a full scan of that is microseconds. An expression index would cost
/// a migration and write amplification on every charter update to save
/// nothing measurable, so it is deliberately not added. Revisit if
/// `persona_responsibilities` ever reaches thousands of rows.
pub fn retire_stale(
    pool: &DbPool,
    keep_ids: &std::collections::HashSet<String>,
    shipped_template_ids: &std::collections::HashSet<String>,
) -> Result<Vec<String>, AppError> {
    timed_query!("recipes", "recipes::retire_stale", {
        let mut conn = pool.get()?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::Database)?;

        // Columns BY NAME. `recipe_definitions` is read with `SELECT *` at six
        // sites in this file already; a seventh would make the next
        // mid-table `ALTER TABLE ADD COLUMN` shift one more set of indices.
        let mut stmt =
            tx.prepare("SELECT id, is_builtin, source_template_id, tags FROM recipe_definitions")?;
        let rows: Vec<(String, bool, Option<String>, Option<String>)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>("id")?,
                    row.get::<_, i64>("is_builtin")? != 0,
                    row.get::<_, Option<String>>("source_template_id")?,
                    row.get::<_, Option<String>>("tags")?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);

        // Both reference sets, read once rather than once per candidate.
        let mut linked = std::collections::HashSet::new();
        {
            let mut stmt = tx.prepare("SELECT DISTINCT recipe_id FROM persona_recipe_links")?;
            for id in stmt.query_map([], |row| row.get::<_, String>("recipe_id"))? {
                linked.insert(id?);
            }
        }
        let mut charter_referenced = std::collections::HashSet::new();
        {
            let mut stmt = tx.prepare(
                "SELECT DISTINCT json_extract(spec, '$.sourceRecipeId') AS source_recipe_id
                 FROM persona_responsibilities
                 WHERE json_extract(spec, '$.sourceRecipeId') IS NOT NULL",
            )?;
            for id in stmt.query_map([], |row| row.get::<_, Option<String>>("source_recipe_id"))? {
                if let Some(id) = id? {
                    charter_referenced.insert(id);
                }
            }
        }

        let mut retired: Vec<String> = Vec::new();
        for (id, is_builtin, source_template_id, tags) in rows {
            if !is_builtin {
                continue;
            }
            if linked.contains(&id) || charter_referenced.contains(&id) {
                continue;
            }
            let absent_from_bundle = !keep_ids.contains(&id);
            // `tags` is a JSON array string; a substring probe is enough for a
            // one-word marker and avoids parsing 300 blobs at boot.
            // `is_none_or` is deliberately spelled out: it stabilized in
            // 1.82 and this workspace declares MSRV 1.80, so clippy's
            // `incompatible_msrv` rejects it.
            let template_still_ships = source_template_id
                .as_deref()
                .map(|t| shipped_template_ids.contains(t))
                .unwrap_or(false);
            let derived_orphan =
                tags.as_deref().is_some_and(|t| t.contains("derived")) && !template_still_ships;
            if !absent_from_bundle && !derived_orphan {
                continue;
            }
            tx.execute(
                "DELETE FROM persona_recipe_links WHERE recipe_id = ?1",
                params![id],
            )?;
            tx.execute(
                "DELETE FROM recipe_versions WHERE recipe_id = ?1",
                params![id],
            )?;
            tx.execute("DELETE FROM recipe_definitions WHERE id = ?1", params![id])?;
            retired.push(id);
        }

        tx.commit()?;
        retired.sort();
        Ok(retired)
    })
}

/// Stage B Phase 1b — find a derived recipe by its (template_id, use_case_id)
/// stable key. Returns None if no recipe has been derived for this pair yet.
/// The (source_template_id, source_use_case_id) pair has a partial unique
/// index, so at most one row matches.
pub fn find_by_source(
    pool: &DbPool,
    template_id: &str,
    use_case_id: &str,
) -> Result<Option<RecipeDefinition>, AppError> {
    timed_query!("recipes", "recipes::find_by_source", {
        let conn = pool.get()?;
        let result = conn.query_row(
            "SELECT * FROM recipe_definitions
             WHERE source_template_id = ?1 AND source_use_case_id = ?2
             LIMIT 1",
            params![template_id, use_case_id],
            row_to_recipe,
        );
        match result {
            Ok(recipe) => Ok(Some(recipe)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    })
}

/// The recipe whose v3 payload declares `slug`, or `None`.
///
/// A v3 recipe's slug lives INSIDE `prompt_template` (the `RecipeSpec` JSON
/// blob), not in a column of its own, so this reads it with `json_extract`
/// rather than inventing a denormalised column the seeders would have to keep
/// in step. `prompt_template` also holds v1/v2 payloads and free prose;
/// `json_extract` yields NULL for both, so they simply never match.
///
/// Newest-first, `LIMIT 1`: the corpus is seeded with one row per slug, and if
/// a re-seed ever left two the fresher one is the one a caller means.
pub fn get_by_slug(pool: &DbPool, slug: &str) -> Result<Option<RecipeDefinition>, AppError> {
    timed_query!("recipes", "recipes::get_by_slug", {
        let conn = pool.get()?;
        let result = conn.query_row(
            &format!(
                "SELECT {RECIPE_COLUMNS} FROM recipe_definitions
                 WHERE json_valid(prompt_template)
                   AND json_extract(prompt_template, '$.slug') = ?1
                 ORDER BY updated_at DESC, id DESC
                 LIMIT 1"
            ),
            params![slug],
            row_to_recipe,
        );
        match result {
            Ok(recipe) => Ok(Some(recipe)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    })
}

/// Stage B Phase 1b — list every recipe derived from the given template.
/// Returns rows ordered by `source_use_case_id` (stable, alphanumeric)
/// for deterministic output. Useful for:
///   - Verifying a Phase 1b migration ran successfully (count + spot-check ids).
///   - Debugging Phase 2.2 conversion output before / after `--apply`.
///   - Future template-editor UI that wants to show "this template
///     contributes N recipes to the catalog".
///
/// Returns an empty Vec when no recipes have been derived for `template_id`
/// yet (caller distinguishes "migration not run" vs "template has no UCs").
pub fn list_by_source_template(
    pool: &DbPool,
    template_id: &str,
) -> Result<Vec<RecipeDefinition>, AppError> {
    timed_query!("recipes", "recipes::list_by_source_template", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM recipe_definitions
             WHERE source_template_id = ?1
             ORDER BY source_use_case_id ASC",
        )?;
        let rows = stmt
            .query_map(params![template_id], row_to_recipe)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

// ============================================================================
// Persona <-> Recipe Link Operations
// ============================================================================

pub fn link_to_persona(
    pool: &DbPool,
    input: CreatePersonaRecipeLinkInput,
) -> Result<PersonaRecipeLink, AppError> {
    timed_query!("recipes", "recipes::link_to_persona", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let sort_order = input.sort_order.unwrap_or(0);

        let conn = pool.get()?;
        conn.execute(
            "INSERT OR IGNORE INTO persona_recipe_links
             (id, persona_id, recipe_id, sort_order, config, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                input.persona_id,
                input.recipe_id,
                sort_order,
                input.config,
                now
            ],
        )?;

        // Return the link (may already exist due to IGNORE)
        let link = conn
            .query_row(
                "SELECT * FROM persona_recipe_links WHERE persona_id = ?1 AND recipe_id = ?2",
                params![input.persona_id, input.recipe_id],
                row_to_link,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::Internal("Failed to create recipe link".into())
                }
                other => AppError::Database(other),
            })?;
        Ok(link)
    })
}

pub fn unlink_from_persona(
    pool: &DbPool,
    persona_id: &str,
    recipe_id: &str,
) -> Result<bool, AppError> {
    timed_query!("recipes", "recipes::unlink_from_persona", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM persona_recipe_links WHERE persona_id = ?1 AND recipe_id = ?2",
            params![persona_id, recipe_id],
        )?;
        Ok(rows > 0)
    })
}

pub fn get_for_persona(pool: &DbPool, persona_id: &str) -> Result<Vec<RecipeDefinition>, AppError> {
    timed_query!("recipes", "recipes::get_for_persona", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT r.* FROM recipe_definitions r
             INNER JOIN persona_recipe_links l ON l.recipe_id = r.id
             WHERE l.persona_id = ?1
             ORDER BY l.sort_order, r.name",
        )?;
        let rows = stmt.query_map(params![persona_id], row_to_recipe)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_for_credential(
    pool: &DbPool,
    credential_id: &str,
) -> Result<Vec<RecipeDefinition>, AppError> {
    timed_query!("recipes", "recipes::get_for_credential", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM recipe_definitions WHERE credential_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![credential_id], row_to_recipe)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_for_use_case(
    pool: &DbPool,
    use_case_id: &str,
) -> Result<Vec<RecipeDefinition>, AppError> {
    timed_query!("recipes", "recipes::get_for_use_case", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM recipe_definitions WHERE use_case_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![use_case_id], row_to_recipe)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

// ============================================================================
// Recipe Versions
// ============================================================================

row_mapper!(row_to_version -> RecipeVersion {
    id, recipe_id, version_number, prompt_template,
    input_schema, sample_inputs, description,
    changes_summary, created_at,
});

pub fn get_versions(pool: &DbPool, recipe_id: &str) -> Result<Vec<RecipeVersion>, AppError> {
    timed_query!("recipes", "recipes::get_versions", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM recipe_versions WHERE recipe_id = ?1 ORDER BY version_number DESC",
        )?;
        let rows = stmt.query_map([recipe_id], row_to_version)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn get_latest_version_number(pool: &DbPool, recipe_id: &str) -> Result<i32, AppError> {
    timed_query!("recipes", "recipes::get_latest_version_number", {
        let conn = pool.get()?;
        let n: i64 = conn.query_row(
            "SELECT COALESCE(MAX(version_number), 0) FROM recipe_versions WHERE recipe_id = ?1",
            [recipe_id],
            |row| row.get(0),
        )?;
        Ok(n as i32)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create_version(
    pool: &DbPool,
    recipe_id: &str,
    version_number: i32,
    prompt_template: &str,
    input_schema: Option<&str>,
    sample_inputs: Option<&str>,
    description: Option<&str>,
    changes_summary: Option<&str>,
) -> Result<RecipeVersion, AppError> {
    timed_query!("recipes", "recipes::create_version", {
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO recipe_versions (id, recipe_id, version_number, prompt_template, input_schema, sample_inputs, description, changes_summary, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![id, recipe_id, version_number, prompt_template, input_schema, sample_inputs, description, changes_summary, now],
        )?;
        conn.query_row(
            "SELECT * FROM recipe_versions WHERE id = ?1",
            [&id],
            row_to_version,
        )
        .map_err(AppError::Database)
    })
}

/// Map a UNIQUE-constraint violation on `recipe_versions(recipe_id,
/// version_number)` to a friendly, retryable message instead of leaking the raw
/// SQLite error to the user.
///
/// The version-mutating ops below run inside BEGIN IMMEDIATE transactions, which
/// serialize version-number allocation at the SQLite level (the second writer
/// blocks on the write lock, then reads the post-commit MAX). This mapping is
/// defense-in-depth for any residual race — e.g. a double-clicked Accept, or an
/// Accept landing while a Revert is mid-flight — so the loser sees a clear
/// "try again" message rather than `UNIQUE constraint failed: ...`.
fn map_version_conflict(err: rusqlite::Error) -> AppError {
    let msg = err.to_string();
    if msg.contains("UNIQUE") && msg.contains("version_number") {
        AppError::Validation(
            "Another version change is already in progress for this recipe. Please try again."
                .into(),
        )
    } else {
        AppError::Database(err)
    }
}

#[allow(clippy::too_many_arguments)]
pub fn accept_version(
    pool: &DbPool,
    recipe_id: &str,
    prompt_template: &str,
    input_schema: Option<&str>,
    sample_inputs: Option<&str>,
    description: Option<&str>,
    changes_summary: Option<&str>,
    expected_updated_at: Option<&str>,
) -> Result<RecipeDefinition, AppError> {
    timed_query!("recipes", "recipes::accept_version", {
        // BEGIN IMMEDIATE: take the write lock up front so two concurrent
        // accept/revert calls serialize instead of both reading the same stale
        // MAX(version_number) snapshot and colliding on UNIQUE(recipe_id,
        // version_number). busy_timeout (5s) makes the loser wait for the winner
        // to commit, then it reads the updated max.
        let mut conn = pool.get()?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::Database)?;

        // 1. Get latest version number
        let latest: i64 = tx.query_row(
            "SELECT COALESCE(MAX(version_number), 0) FROM recipe_versions WHERE recipe_id = ?1",
            [recipe_id],
            |row| row.get(0),
        )?;

        // 2. If no versions exist yet, snapshot the current recipe as v1
        if latest == 0 {
            let current = tx
                .query_row(
                    "SELECT * FROM recipe_definitions WHERE id = ?1",
                    params![recipe_id],
                    row_to_recipe,
                )
                .map_err(|_| AppError::NotFound(format!("Recipe {recipe_id} not found")))?;

            let snapshot_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO recipe_versions (id, recipe_id, version_number, prompt_template, input_schema, sample_inputs, description, changes_summary, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    snapshot_id, recipe_id, 1,
                    current.prompt_template, current.input_schema,
                    current.sample_inputs, current.description,
                    "Initial version (snapshot before first edit)", now,
                ],
            )
            .map_err(map_version_conflict)?;
        }

        let new_version_number = if latest == 0 { 2 } else { latest + 1 };

        // 3. Create the new version record
        let version_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO recipe_versions (id, recipe_id, version_number, prompt_template, input_schema, sample_inputs, description, changes_summary, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![version_id, recipe_id, new_version_number, prompt_template, input_schema, sample_inputs, description, changes_summary, now],
        )
        .map_err(map_version_conflict)?;

        // 4. Update the recipe definition with the new data. When the caller
        //    supplies expected_updated_at (the recipe's updated_at captured when
        //    generation started), guard the write with a compare-and-swap: if the
        //    recipe changed under us during the long LLM generation window, the
        //    UPDATE matches 0 rows and we abort — rolling back the version rows
        //    inserted above — instead of silently clobbering the concurrent edit.
        let now = chrono::Utc::now().to_rfc3339();
        let updated_rows = match expected_updated_at {
            Some(expected) => tx.execute(
                "UPDATE recipe_definitions SET prompt_template = ?1, input_schema = ?2, sample_inputs = ?3, description = ?4, updated_at = ?5 WHERE id = ?6 AND updated_at = ?7",
                rusqlite::params![prompt_template, input_schema, sample_inputs, description, now, recipe_id, expected],
            )?,
            None => tx.execute(
                "UPDATE recipe_definitions SET prompt_template = ?1, input_schema = ?2, sample_inputs = ?3, description = ?4, updated_at = ?5 WHERE id = ?6",
                rusqlite::params![prompt_template, input_schema, sample_inputs, description, now, recipe_id],
            )?,
        };
        if updated_rows == 0 {
            // Dropping tx without commit rolls back the snapshot/version inserts.
            return Err(AppError::Validation(
                "Recipe changed since this version was generated — discard and regenerate so the newer edit isn't overwritten.".into(),
            ));
        }

        // 5. Read the updated recipe within the transaction
        let recipe = tx
            .query_row(
                "SELECT * FROM recipe_definitions WHERE id = ?1",
                params![recipe_id],
                row_to_recipe,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Recipe {recipe_id}"))
                }
                other => AppError::Database(other),
            })?;

        tx.commit()?;

        Ok(recipe)
    })
}

pub fn revert_to_version(
    pool: &DbPool,
    recipe_id: &str,
    version_id: &str,
) -> Result<RecipeDefinition, AppError> {
    timed_query!("recipes", "recipes::revert_to_version", {
        // BEGIN IMMEDIATE for the same reason as accept_version: serialize the
        // MAX(version_number)+1 allocation so a revert racing an accept (or
        // another revert) can't compute a duplicate version number.
        let mut conn = pool.get()?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(AppError::Database)?;

        // 1. Read the target version
        let version = tx
            .query_row(
                "SELECT * FROM recipe_versions WHERE id = ?1 AND recipe_id = ?2",
                rusqlite::params![version_id, recipe_id],
                row_to_version,
            )
            .map_err(|_| AppError::NotFound(format!("Version {version_id} not found")))?;

        // 2. Read the current recipe state
        let current = tx
            .query_row(
                "SELECT * FROM recipe_definitions WHERE id = ?1",
                params![recipe_id],
                row_to_recipe,
            )
            .map_err(|_| AppError::NotFound(format!("Recipe {recipe_id} not found")))?;

        // 3. Get latest version number
        let latest: i64 = tx.query_row(
            "SELECT COALESCE(MAX(version_number), 0) FROM recipe_versions WHERE recipe_id = ?1",
            [recipe_id],
            |row| row.get(0),
        )?;
        let snapshot_version = if latest == 0 { 1 } else { latest + 1 };

        // 4. Snapshot the current recipe state before overwriting so the user can recover it
        let snapshot_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "INSERT INTO recipe_versions (id, recipe_id, version_number, prompt_template, input_schema, sample_inputs, description, changes_summary, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                snapshot_id,
                recipe_id,
                snapshot_version,
                current.prompt_template,
                current.input_schema,
                current.sample_inputs,
                current.description,
                format!("Snapshot before revert to v{}", version.version_number),
                now,
            ],
        )
        .map_err(map_version_conflict)?;

        // 5. Update the recipe definition to the target version
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE recipe_definitions SET prompt_template = ?1, input_schema = ?2, sample_inputs = ?3, description = ?4, updated_at = ?5 WHERE id = ?6",
            rusqlite::params![version.prompt_template, version.input_schema, version.sample_inputs, version.description, now, recipe_id],
        )?;

        // 6. Read the updated recipe within the transaction
        let recipe = tx
            .query_row(
                "SELECT * FROM recipe_definitions WHERE id = ?1",
                params![recipe_id],
                row_to_recipe,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Recipe {recipe_id}"))
                }
                other => AppError::Database(other),
            })?;

        tx.commit()?;

        Ok(recipe)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_version_conflict_translates_unique_violation() {
        // The raw SQLite UNIQUE error must become a friendly, retryable message
        // rather than leaking to the user.
        let err = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
            Some(
                "UNIQUE constraint failed: recipe_versions.recipe_id, recipe_versions.version_number"
                    .to_string(),
            ),
        );
        match map_version_conflict(err) {
            AppError::Validation(msg) => {
                assert!(msg.contains("in progress"), "unexpected message: {msg}");
            }
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn map_version_conflict_passes_through_unrelated_errors() {
        // A non-UNIQUE failure stays a Database error — we only special-case the
        // version-number collision.
        let err = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            Some("database is locked".to_string()),
        );
        match map_version_conflict(err) {
            AppError::Database(_) => {}
            other => panic!("expected Database, got {other:?}"),
        }
    }
}
