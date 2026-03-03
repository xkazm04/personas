use rusqlite::params;

use crate::db::DbPool;
use crate::error::AppError;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlaywrightProcedure {
    pub id: String,
    pub connector_name: String,
    pub procedure_json: String,
    pub field_keys: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Save a new playwright procedure for a connector type.
pub fn save(pool: &DbPool, connector_name: &str, procedure_json: &str, field_keys: &str) -> Result<PlaywrightProcedure, AppError> {
    let conn = pool.get()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Deactivate any existing active procedure for this connector
    conn.execute(
        "UPDATE playwright_procedures SET is_active = 0, updated_at = ?1 WHERE connector_name = ?2 AND is_active = 1",
        params![now, connector_name],
    )?;

    conn.execute(
        "INSERT INTO playwright_procedures (id, connector_name, procedure_json, field_keys, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
        params![id, connector_name, procedure_json, field_keys, now],
    )?;

    Ok(PlaywrightProcedure {
        id,
        connector_name: connector_name.to_string(),
        procedure_json: procedure_json.to_string(),
        field_keys: field_keys.to_string(),
        is_active: true,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Get the active procedure for a connector, if any.
pub fn get_active(pool: &DbPool, connector_name: &str) -> Result<Option<PlaywrightProcedure>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, connector_name, procedure_json, field_keys, is_active, created_at, updated_at
         FROM playwright_procedures
         WHERE connector_name = ?1 AND is_active = 1
         LIMIT 1"
    )?;

    let result = stmt.query_row(params![connector_name], |row| {
        Ok(PlaywrightProcedure {
            id: row.get(0)?,
            connector_name: row.get(1)?,
            procedure_json: row.get(2)?,
            field_keys: row.get(3)?,
            is_active: row.get::<_, i32>(4)? != 0,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    });

    match result {
        Ok(proc) => Ok(Some(proc)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

/// List all procedures (active and inactive) for a connector.
pub fn list_for_connector(pool: &DbPool, connector_name: &str) -> Result<Vec<PlaywrightProcedure>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, connector_name, procedure_json, field_keys, is_active, created_at, updated_at
         FROM playwright_procedures
         WHERE connector_name = ?1
         ORDER BY created_at DESC"
    )?;

    let rows = stmt.query_map(params![connector_name], |row| {
        Ok(PlaywrightProcedure {
            id: row.get(0)?,
            connector_name: row.get(1)?,
            procedure_json: row.get(2)?,
            field_keys: row.get(3)?,
            is_active: row.get::<_, i32>(4)? != 0,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(rows)
}
