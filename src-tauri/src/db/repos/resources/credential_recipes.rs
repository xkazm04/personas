use rusqlite::{params, Row};

use crate::db::models::{CreateCredentialRecipeInput, CredentialRecipe};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_recipe(row: &Row) -> rusqlite::Result<CredentialRecipe> {
    Ok(CredentialRecipe {
        id: row.get("id")?,
        connector_name: row.get("connector_name")?,
        connector_label: row.get("connector_label")?,
        category: row.get("category")?,
        color: row.get("color")?,
        oauth_type: row.get("oauth_type")?,
        fields_json: row.get("fields_json")?,
        healthcheck_json: row.get("healthcheck_json")?,
        setup_instructions: row.get("setup_instructions")?,
        summary: row.get("summary")?,
        docs_url: row.get("docs_url")?,
        source: row.get("source")?,
        usage_count: row.get("usage_count")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Look up a recipe by connector name. Returns None if not cached.
pub fn get_by_connector(pool: &DbPool, connector_name: &str) -> Result<Option<CredentialRecipe>, AppError> {
    let conn = pool.get()?;
    match conn.query_row(
        "SELECT * FROM credential_recipes WHERE connector_name = ?1",
        params![connector_name],
        row_to_recipe,
    ) {
        Ok(r) => Ok(Some(r)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

/// List all cached recipes.
pub fn list_all(pool: &DbPool) -> Result<Vec<CredentialRecipe>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT * FROM credential_recipes ORDER BY usage_count DESC, updated_at DESC")?;
    let rows = stmt.query_map([], row_to_recipe)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

/// Create or update (upsert) a recipe. If a recipe for this connector already exists,
/// update it with the new data.
pub fn upsert(pool: &DbPool, input: CreateCredentialRecipeInput) -> Result<CredentialRecipe, AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();

    // Check if recipe exists
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM credential_recipes WHERE connector_name = ?1",
            params![input.connector_name],
            |row| row.get(0),
        )
        .ok();

    let id = if let Some(existing_id) = existing {
        // Update existing recipe
        conn.execute(
            "UPDATE credential_recipes SET
                connector_label = ?1, category = ?2, color = ?3, oauth_type = ?4,
                fields_json = ?5, healthcheck_json = ?6, setup_instructions = ?7,
                summary = ?8, docs_url = ?9, source = ?10, updated_at = ?11
             WHERE id = ?12",
            params![
                input.connector_label, input.category, input.color, input.oauth_type,
                input.fields_json, input.healthcheck_json, input.setup_instructions,
                input.summary, input.docs_url, input.source, now, existing_id,
            ],
        )?;
        existing_id
    } else {
        // Insert new recipe
        let new_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO credential_recipes (id, connector_name, connector_label, category, color, oauth_type, fields_json, healthcheck_json, setup_instructions, summary, docs_url, source, usage_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, ?13)",
            params![
                new_id, input.connector_name, input.connector_label, input.category, input.color,
                input.oauth_type, input.fields_json, input.healthcheck_json, input.setup_instructions,
                input.summary, input.docs_url, input.source, now,
            ],
        )?;
        new_id
    };

    conn.query_row(
        "SELECT * FROM credential_recipes WHERE id = ?1",
        params![id],
        row_to_recipe,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("CredentialRecipe {id}")),
        other => AppError::Database(other),
    })
}

/// Increment usage count when a recipe is consumed by negotiator or autoCred.
pub fn increment_usage(pool: &DbPool, connector_name: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE credential_recipes SET usage_count = usage_count + 1, updated_at = ?1 WHERE connector_name = ?2",
        params![now, connector_name],
    )?;
    Ok(())
}

/// Delete a recipe by connector name.
pub fn delete_by_connector(pool: &DbPool, connector_name: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let affected = conn.execute(
        "DELETE FROM credential_recipes WHERE connector_name = ?1",
        params![connector_name],
    )?;
    Ok(affected > 0)
}
