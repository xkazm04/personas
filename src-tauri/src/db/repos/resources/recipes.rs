use rusqlite::params;

use crate::db::models::{
    CreatePersonaRecipeLinkInput, CreateRecipeInput, PersonaRecipeLink, RecipeDefinition,
    RecipeVersion, UpdateRecipeInput,
};
use crate::db::DbPool;
use crate::error::AppError;

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
});

row_mapper!(row_to_link -> PersonaRecipeLink {
    id, persona_id, recipe_id, sort_order, config, created_at,
});

// ============================================================================
// Recipe CRUD
// ============================================================================

crud_get_by_id!(RecipeDefinition, "recipe_definitions", "Recipe", row_to_recipe);
crud_get_all!(RecipeDefinition, "recipe_definitions", row_to_recipe, "created_at DESC");

pub fn create(pool: &DbPool, input: CreateRecipeInput) -> Result<RecipeDefinition, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO recipe_definitions
         (id, project_id, credential_id, use_case_id, name, description, category, prompt_template,
          input_schema, output_contract, tool_requirements, credential_requirements,
          model_preference, sample_inputs, tags, icon, color, created_at, updated_at)
         VALUES (?1, 'default', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)",
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
        ],
    )?;

    get_by_id(pool, &id)
}

pub fn update(
    pool: &DbPool,
    id: &str,
    input: UpdateRecipeInput,
) -> Result<RecipeDefinition, AppError> {
    get_by_id(pool, id)?;

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
    push_field!(input.tool_requirements, "tool_requirements", sets, param_idx);
    push_field!(input.credential_requirements, "credential_requirements", sets, param_idx);
    push_field!(input.model_preference, "model_preference", sets, param_idx);
    push_field!(input.sample_inputs, "sample_inputs", sets, param_idx);
    push_field!(input.tags, "tags", sets, param_idx);
    push_field!(input.icon, "icon", sets, param_idx);
    push_field!(input.color, "color", sets, param_idx);

    let sql = format!(
        "UPDATE recipe_definitions SET {} WHERE id = ?{}",
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
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_by_id(pool, id)
}

pub fn delete(pool: &DbPool, id: &str) -> Result<bool, AppError> {
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
}

// ============================================================================
// Persona <-> Recipe Link Operations
// ============================================================================

pub fn link_to_persona(
    pool: &DbPool,
    input: CreatePersonaRecipeLinkInput,
) -> Result<PersonaRecipeLink, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let sort_order = input.sort_order.unwrap_or(0);

    let conn = pool.get()?;
    conn.execute(
        "INSERT OR IGNORE INTO persona_recipe_links
         (id, persona_id, recipe_id, sort_order, config, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, input.persona_id, input.recipe_id, sort_order, input.config, now],
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
}

pub fn unlink_from_persona(
    pool: &DbPool,
    persona_id: &str,
    recipe_id: &str,
) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM persona_recipe_links WHERE persona_id = ?1 AND recipe_id = ?2",
        params![persona_id, recipe_id],
    )?;
    Ok(rows > 0)
}

pub fn get_for_persona(pool: &DbPool, persona_id: &str) -> Result<Vec<RecipeDefinition>, AppError> {
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
}

pub fn get_for_credential(pool: &DbPool, credential_id: &str) -> Result<Vec<RecipeDefinition>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM recipe_definitions WHERE credential_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![credential_id], row_to_recipe)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn get_for_use_case(pool: &DbPool, use_case_id: &str) -> Result<Vec<RecipeDefinition>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM recipe_definitions WHERE use_case_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![use_case_id], row_to_recipe)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
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
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM recipe_versions WHERE recipe_id = ?1 ORDER BY version_number DESC"
    )?;
    let rows = stmt.query_map([recipe_id], row_to_version)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn get_latest_version_number(pool: &DbPool, recipe_id: &str) -> Result<i32, AppError> {
    let conn = pool.get()?;
    let n: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version_number), 0) FROM recipe_versions WHERE recipe_id = ?1",
        [recipe_id],
        |row| row.get(0),
    )?;
    Ok(n as i32)
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
    let conn = pool.get()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO recipe_versions (id, recipe_id, version_number, prompt_template, input_schema, sample_inputs, description, changes_summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![id, recipe_id, version_number, prompt_template, input_schema, sample_inputs, description, changes_summary, now],
    )?;
    let conn2 = pool.get()?;
    conn2.query_row(
        "SELECT * FROM recipe_versions WHERE id = ?1",
        [&id],
        row_to_version,
    ).map_err(AppError::Database)
}

pub fn revert_to_version(pool: &DbPool, recipe_id: &str, version_id: &str) -> Result<RecipeDefinition, AppError> {
    let conn = pool.get()?;
    let version = conn.query_row(
        "SELECT * FROM recipe_versions WHERE id = ?1 AND recipe_id = ?2",
        rusqlite::params![version_id, recipe_id],
        row_to_version,
    ).map_err(|_| AppError::NotFound(format!("Version {version_id} not found")))?;

    // Snapshot the current recipe state before overwriting so the user can recover it
    let current = get_by_id(pool, recipe_id)?;
    let latest = get_latest_version_number(pool, recipe_id)?;
    let snapshot_version = if latest == 0 { 1 } else { latest + 1 };
    create_version(
        pool,
        recipe_id,
        snapshot_version,
        &current.prompt_template,
        current.input_schema.as_deref(),
        current.sample_inputs.as_deref(),
        current.description.as_deref(),
        Some(&format!("Snapshot before revert to v{}", version.version_number)),
    )?;

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE recipe_definitions SET prompt_template = ?1, input_schema = ?2, sample_inputs = ?3, updated_at = ?4 WHERE id = ?5",
        rusqlite::params![version.prompt_template, version.input_schema, version.sample_inputs, now, recipe_id],
    )?;

    get_by_id(pool, recipe_id)
}
