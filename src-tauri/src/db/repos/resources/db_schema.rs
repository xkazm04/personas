use rusqlite::{params, Row};

use crate::db::models::{DbSavedQuery, DbSchemaTable};
use crate::db::DbPool;
use crate::error::AppError;

// ============================================================================
// Schema Tables
// ============================================================================

fn row_to_schema_table(row: &Row) -> rusqlite::Result<DbSchemaTable> {
    Ok(DbSchemaTable {
        id: row.get("id")?,
        credential_id: row.get("credential_id")?,
        table_name: row.get("table_name")?,
        display_label: row.get("display_label")?,
        column_hints: row.get("column_hints")?,
        is_favorite: row.get::<_, i32>("is_favorite")? != 0,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_tables(pool: &DbPool, credential_id: &str) -> Result<Vec<DbSchemaTable>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM db_schema_tables WHERE credential_id = ?1 ORDER BY sort_order, table_name",
    )?;
    let rows = stmt.query_map(params![credential_id], row_to_schema_table)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_table_by_id(pool: &DbPool, id: &str) -> Result<DbSchemaTable, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM db_schema_tables WHERE id = ?1",
        params![id],
        row_to_schema_table,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("DbSchemaTable {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn create_table(
    pool: &DbPool,
    credential_id: &str,
    table_name: &str,
    display_label: Option<&str>,
    column_hints: Option<&str>,
) -> Result<DbSchemaTable, AppError> {
    if table_name.trim().is_empty() {
        return Err(AppError::Validation("Table name cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO db_schema_tables (id, credential_id, table_name, display_label, column_hints, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, credential_id, table_name, display_label, column_hints, now],
    )?;

    get_table_by_id(pool, &id)
}

pub fn update_table(
    pool: &DbPool,
    id: &str,
    table_name: Option<&str>,
    display_label: Option<&str>,
    column_hints: Option<&str>,
    is_favorite: Option<bool>,
    sort_order: Option<i64>,
) -> Result<DbSchemaTable, AppError> {
    get_table_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    if let Some(name) = table_name {
        conn.execute(
            "UPDATE db_schema_tables SET table_name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, id],
        )?;
    }
    if let Some(label) = display_label {
        conn.execute(
            "UPDATE db_schema_tables SET display_label = ?1, updated_at = ?2 WHERE id = ?3",
            params![label, now, id],
        )?;
    }
    if let Some(hints) = column_hints {
        conn.execute(
            "UPDATE db_schema_tables SET column_hints = ?1, updated_at = ?2 WHERE id = ?3",
            params![hints, now, id],
        )?;
    }
    if let Some(fav) = is_favorite {
        let fav_int: i32 = if fav { 1 } else { 0 };
        conn.execute(
            "UPDATE db_schema_tables SET is_favorite = ?1, updated_at = ?2 WHERE id = ?3",
            params![fav_int, now, id],
        )?;
    }
    if let Some(order) = sort_order {
        conn.execute(
            "UPDATE db_schema_tables SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
            params![order, now, id],
        )?;
    }

    get_table_by_id(pool, id)
}

pub fn delete_table(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM db_schema_tables WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ============================================================================
// Saved Queries
// ============================================================================

fn row_to_saved_query(row: &Row) -> rusqlite::Result<DbSavedQuery> {
    Ok(DbSavedQuery {
        id: row.get("id")?,
        credential_id: row.get("credential_id")?,
        title: row.get("title")?,
        query_text: row.get("query_text")?,
        language: row.get("language")?,
        last_run_at: row.get("last_run_at")?,
        last_run_ok: row.get::<_, Option<i32>>("last_run_ok")?.map(|v| v != 0),
        last_run_ms: row.get("last_run_ms")?,
        is_favorite: row.get::<_, i32>("is_favorite")? != 0,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_queries(pool: &DbPool, credential_id: &str) -> Result<Vec<DbSavedQuery>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM db_saved_queries WHERE credential_id = ?1 ORDER BY sort_order, title",
    )?;
    let rows = stmt.query_map(params![credential_id], row_to_saved_query)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_query_by_id(pool: &DbPool, id: &str) -> Result<DbSavedQuery, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM db_saved_queries WHERE id = ?1",
        params![id],
        row_to_saved_query,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("DbSavedQuery {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn create_query(
    pool: &DbPool,
    credential_id: &str,
    title: &str,
    query_text: &str,
    language: Option<&str>,
) -> Result<DbSavedQuery, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Query title cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let lang = language.unwrap_or("sql");

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO db_saved_queries (id, credential_id, title, query_text, language, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, credential_id, title, query_text, lang, now],
    )?;

    get_query_by_id(pool, &id)
}

pub fn update_query(
    pool: &DbPool,
    id: &str,
    title: Option<&str>,
    query_text: Option<&str>,
    language: Option<&str>,
    is_favorite: Option<bool>,
    sort_order: Option<i64>,
) -> Result<DbSavedQuery, AppError> {
    get_query_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    if let Some(t) = title {
        conn.execute(
            "UPDATE db_saved_queries SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![t, now, id],
        )?;
    }
    if let Some(qt) = query_text {
        conn.execute(
            "UPDATE db_saved_queries SET query_text = ?1, updated_at = ?2 WHERE id = ?3",
            params![qt, now, id],
        )?;
    }
    if let Some(l) = language {
        conn.execute(
            "UPDATE db_saved_queries SET language = ?1, updated_at = ?2 WHERE id = ?3",
            params![l, now, id],
        )?;
    }
    if let Some(fav) = is_favorite {
        let fav_int: i32 = if fav { 1 } else { 0 };
        conn.execute(
            "UPDATE db_saved_queries SET is_favorite = ?1, updated_at = ?2 WHERE id = ?3",
            params![fav_int, now, id],
        )?;
    }
    if let Some(order) = sort_order {
        conn.execute(
            "UPDATE db_saved_queries SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
            params![order, now, id],
        )?;
    }

    get_query_by_id(pool, id)
}

pub fn update_query_run(
    pool: &DbPool,
    id: &str,
    success: bool,
    duration_ms: i64,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let ok_int: i32 = if success { 1 } else { 0 };
    let conn = pool.get()?;
    conn.execute(
        "UPDATE db_saved_queries SET last_run_at = ?1, last_run_ok = ?2, last_run_ms = ?3, updated_at = ?1 WHERE id = ?4",
        params![now, ok_int, duration_ms, id],
    )?;
    Ok(())
}

pub fn delete_query(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM db_saved_queries WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}
