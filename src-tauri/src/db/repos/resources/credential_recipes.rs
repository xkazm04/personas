use rusqlite::params;

use crate::db::models::{CreateCredentialRecipeInput, CredentialRecipe};
use crate::db::DbPool;
use crate::error::AppError;

row_mapper!(row_to_recipe -> CredentialRecipe {
    id, connector_name, connector_label, category, color,
    oauth_type, fields_json, healthcheck_json, setup_instructions,
    summary, docs_url, source, usage_count, created_at, updated_at,
});

/// Look up a recipe by connector name. Returns None if not cached.
pub fn get_by_connector(pool: &DbPool, connector_name: &str) -> Result<Option<CredentialRecipe>, AppError> {
    timed_query!("credential_recipes", "credential_recipes::get_by_connector", {
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

    })
}

/// List all cached recipes.
pub fn list_all(pool: &DbPool) -> Result<Vec<CredentialRecipe>, AppError> {
    timed_query!("credential_recipes", "credential_recipes::list_all", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare("SELECT * FROM credential_recipes ORDER BY usage_count DESC, updated_at DESC")?;
        let rows = stmt.query_map([], row_to_recipe)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)

    })
}

/// Create or update (upsert) a recipe. If a recipe for this connector already exists,
/// update it with the new data.
pub fn upsert(pool: &DbPool, input: CreateCredentialRecipeInput) -> Result<CredentialRecipe, AppError> {
    timed_query!("credential_recipes", "credential_recipes::upsert", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();

        // The INSERT below uses ON CONFLICT(connector_name) DO UPDATE, so a
        // pre-check SELECT was redundant — removed to save a DB roundtrip.
        let new_id = uuid::Uuid::new_v4().to_string();
        let recipe = conn.query_row(
            "INSERT INTO credential_recipes (id, connector_name, connector_label, category, color, oauth_type, fields_json, healthcheck_json, setup_instructions, summary, docs_url, source, usage_count, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, ?13)
             ON CONFLICT(connector_name) DO UPDATE SET
                connector_label = excluded.connector_label,
                category = excluded.category,
                color = excluded.color,
                oauth_type = excluded.oauth_type,
                fields_json = excluded.fields_json,
                healthcheck_json = excluded.healthcheck_json,
                setup_instructions = excluded.setup_instructions,
                summary = excluded.summary,
                docs_url = excluded.docs_url,
                source = excluded.source,
                updated_at = excluded.updated_at
             RETURNING *",
            params![
                new_id, input.connector_name, input.connector_label, input.category, input.color,
                input.oauth_type, input.fields_json, input.healthcheck_json, input.setup_instructions,
                input.summary, input.docs_url, input.source, now,
            ],
            row_to_recipe,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::Internal("Failed to upsert credential recipe".into()),
            other => AppError::Database(other),
        })?;
        Ok(recipe)

    })
}

/// Increment usage count when a recipe is consumed by negotiator or autoCred.
pub fn increment_usage(pool: &DbPool, connector_name: &str) -> Result<(), AppError> {
    timed_query!("credential_recipes", "credential_recipes::increment_usage", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE credential_recipes SET usage_count = usage_count + 1, updated_at = ?1 WHERE connector_name = ?2",
            params![now, connector_name],
        )?;
        Ok(())

    })
}

/// Delete a recipe by connector name.
pub fn delete_by_connector(pool: &DbPool, connector_name: &str) -> Result<bool, AppError> {
    timed_query!("credential_recipes", "credential_recipes::delete_by_connector", {
        let conn = pool.get()?;
        let affected = conn.execute(
            "DELETE FROM credential_recipes WHERE connector_name = ?1",
            params![connector_name],
        )?;
        Ok(affected > 0)

    })
}
