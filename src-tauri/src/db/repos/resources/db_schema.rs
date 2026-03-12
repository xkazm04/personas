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

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Create an in-memory SQLite database with the full schema applied,
    /// plus a seeded credential row for FK references.
    fn test_pool() -> crate::db::DbPool {
        // Use a file:...:memory: URI with shared cache so multiple pool connections
        // see the same in-memory database (plain :memory: creates separate DBs).
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:testdb_{id}?mode=memory&cache=shared");

        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder().max_size(4).build(manager).unwrap();
        {
            let conn = pool.get().unwrap();
            // Enable foreign keys (SQLite requires this per-connection)
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).unwrap();
            // Seed test credentials for FK references
            conn.execute(
                "INSERT INTO persona_credentials (id, name, service_type, encrypted_data, iv, created_at, updated_at)
                 VALUES ('cred-1', 'Test DB', 'supabase', 'enc', 'iv', datetime('now'), datetime('now'))",
                [],
            ).unwrap();
            conn.execute(
                "INSERT INTO persona_credentials (id, name, service_type, encrypted_data, iv, created_at, updated_at)
                 VALUES ('cred-2', 'Another DB', 'neon', 'enc', 'iv', datetime('now'), datetime('now'))",
                [],
            ).unwrap();
        }
        pool
    }

    // -- Schema Tables -----------------------------------------------

    #[test]
    fn test_create_table() {
        let pool = test_pool();
        let t = create_table(&pool, "cred-1", "users", Some("User accounts"), None).unwrap();
        assert_eq!(t.credential_id, "cred-1");
        assert_eq!(t.table_name, "users");
        assert_eq!(t.display_label.as_deref(), Some("User accounts"));
        assert!(!t.id.is_empty());
        assert!(!t.created_at.is_empty());
    }

    #[test]
    fn test_create_table_empty_name() {
        let pool = test_pool();
        let result = create_table(&pool, "cred-1", "", None, None);
        assert!(result.is_err());
        let err = format!("{}", result.unwrap_err());
        assert!(err.contains("Table name cannot be empty"));
    }

    #[test]
    fn test_create_table_whitespace_name() {
        let pool = test_pool();
        let result = create_table(&pool, "cred-1", "   ", None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_table_duplicate() {
        let pool = test_pool();
        create_table(&pool, "cred-1", "orders", None, None).unwrap();
        let result = create_table(&pool, "cred-1", "orders", None, None);
        assert!(result.is_err()); // UNIQUE constraint violation
    }

    #[test]
    fn test_create_table_same_name_different_credential() {
        let pool = test_pool();
        let t1 = create_table(&pool, "cred-1", "users", None, None).unwrap();
        let t2 = create_table(&pool, "cred-2", "users", None, None).unwrap();
        assert_ne!(t1.id, t2.id); // Different credentials -> both succeed
    }

    #[test]
    fn test_list_tables_empty() {
        let pool = test_pool();
        let tables = list_tables(&pool, "cred-1").unwrap();
        assert!(tables.is_empty());
    }

    #[test]
    fn test_list_tables_ordered() {
        let pool = test_pool();
        create_table(&pool, "cred-1", "zebra", None, None).unwrap();
        create_table(&pool, "cred-1", "alpha", None, None).unwrap();

        let tables = list_tables(&pool, "cred-1").unwrap();
        assert_eq!(tables.len(), 2);
        // Both have sort_order=0, so ordered alphabetically by table_name
        assert_eq!(tables[0].table_name, "alpha");
        assert_eq!(tables[1].table_name, "zebra");
    }

    #[test]
    fn test_list_tables_sort_order_takes_priority() {
        let pool = test_pool();
        let t1 = create_table(&pool, "cred-1", "zebra", None, None).unwrap();
        let _t2 = create_table(&pool, "cred-1", "alpha", None, None).unwrap();

        // Set zebra to sort_order=-1 so it comes first despite alphabetical order
        update_table(&pool, &t1.id, None, None, None, None, Some(-1)).unwrap();

        let tables = list_tables(&pool, "cred-1").unwrap();
        assert_eq!(tables[0].table_name, "zebra");
        assert_eq!(tables[1].table_name, "alpha");
    }

    #[test]
    fn test_update_table_name() {
        let pool = test_pool();
        let t = create_table(&pool, "cred-1", "old_name", None, None).unwrap();
        let original_updated = t.updated_at.clone();

        // Small delay to ensure updated_at changes
        std::thread::sleep(std::time::Duration::from_millis(10));

        let updated = update_table(&pool, &t.id, Some("new_name"), None, None, None, None).unwrap();
        assert_eq!(updated.table_name, "new_name");
        assert_ne!(updated.updated_at, original_updated);
    }

    #[test]
    fn test_update_table_favorite() {
        let pool = test_pool();
        let t = create_table(&pool, "cred-1", "users", None, None).unwrap();
        assert!(!t.is_favorite);

        let updated = update_table(&pool, &t.id, None, None, None, Some(true), None).unwrap();
        assert!(updated.is_favorite);

        let toggled = update_table(&pool, &t.id, None, None, None, Some(false), None).unwrap();
        assert!(!toggled.is_favorite);
    }

    #[test]
    fn test_update_table_column_hints() {
        let pool = test_pool();
        let t = create_table(&pool, "cred-1", "users", None, None).unwrap();
        assert!(t.column_hints.is_none());

        let hints = r#"[{"name":"id","type":"int","pk":true},{"name":"email","type":"text"}]"#;
        let updated = update_table(&pool, &t.id, None, None, Some(hints), None, None).unwrap();
        assert_eq!(updated.column_hints.as_deref(), Some(hints));
    }

    #[test]
    fn test_delete_table() {
        let pool = test_pool();
        let t = create_table(&pool, "cred-1", "users", None, None).unwrap();
        assert!(delete_table(&pool, &t.id).unwrap());

        let tables = list_tables(&pool, "cred-1").unwrap();
        assert!(tables.is_empty());
    }

    #[test]
    fn test_delete_table_not_found() {
        let pool = test_pool();
        assert!(!delete_table(&pool, "nonexistent-id").unwrap());
    }

    #[test]
    fn test_get_table_by_id_not_found() {
        let pool = test_pool();
        let result = get_table_by_id(&pool, "nonexistent");
        assert!(result.is_err());
        let err = format!("{}", result.unwrap_err());
        assert!(err.contains("NotFound") || err.contains("not found") || err.contains("DbSchemaTable"));
    }

    // -- Saved Queries -----------------------------------------------

    #[test]
    fn test_create_query() {
        let pool = test_pool();
        let q = create_query(&pool, "cred-1", "List users", "SELECT * FROM users", None).unwrap();
        assert_eq!(q.credential_id, "cred-1");
        assert_eq!(q.title, "List users");
        assert_eq!(q.query_text, "SELECT * FROM users");
        assert_eq!(q.language, "sql"); // default
        assert!(q.last_run_at.is_none());
        assert!(!q.id.is_empty());
    }

    #[test]
    fn test_create_query_custom_language() {
        let pool = test_pool();
        let q = create_query(&pool, "cred-1", "Get key", "GET mykey", Some("redis")).unwrap();
        assert_eq!(q.language, "redis");
    }

    #[test]
    fn test_create_query_empty_title() {
        let pool = test_pool();
        let result = create_query(&pool, "cred-1", "", "SELECT 1", None);
        assert!(result.is_err());
        let err = format!("{}", result.unwrap_err());
        assert!(err.contains("Query title cannot be empty"));
    }

    #[test]
    fn test_list_queries_empty() {
        let pool = test_pool();
        let queries = list_queries(&pool, "cred-1").unwrap();
        assert!(queries.is_empty());
    }

    #[test]
    fn test_list_queries_ordered() {
        let pool = test_pool();
        create_query(&pool, "cred-1", "Zebra query", "SELECT 1", None).unwrap();
        create_query(&pool, "cred-1", "Alpha query", "SELECT 2", None).unwrap();

        let queries = list_queries(&pool, "cred-1").unwrap();
        assert_eq!(queries.len(), 2);
        assert_eq!(queries[0].title, "Alpha query");
        assert_eq!(queries[1].title, "Zebra query");
    }

    #[test]
    fn test_update_query_title() {
        let pool = test_pool();
        let q = create_query(&pool, "cred-1", "Old title", "SELECT 1", None).unwrap();

        let updated = update_query(&pool, &q.id, Some("New title"), None, None, None, None).unwrap();
        assert_eq!(updated.title, "New title");
    }

    #[test]
    fn test_update_query_text() {
        let pool = test_pool();
        let q = create_query(&pool, "cred-1", "My query", "SELECT 1", None).unwrap();

        let updated = update_query(&pool, &q.id, None, Some("SELECT 2"), None, None, None).unwrap();
        assert_eq!(updated.query_text, "SELECT 2");
    }

    #[test]
    fn test_update_query_language() {
        let pool = test_pool();
        let q = create_query(&pool, "cred-1", "My query", "GET key", None).unwrap();
        assert_eq!(q.language, "sql");

        let updated = update_query(&pool, &q.id, None, None, Some("redis"), None, None).unwrap();
        assert_eq!(updated.language, "redis");
    }

    #[test]
    fn test_update_query_favorite() {
        let pool = test_pool();
        let q = create_query(&pool, "cred-1", "My query", "SELECT 1", None).unwrap();
        assert!(!q.is_favorite);

        let updated = update_query(&pool, &q.id, None, None, None, Some(true), None).unwrap();
        assert!(updated.is_favorite);
    }

    #[test]
    fn test_update_query_run_success() {
        let pool = test_pool();
        let q = create_query(&pool, "cred-1", "My query", "SELECT 1", None).unwrap();
        assert!(q.last_run_at.is_none());

        update_query_run(&pool, &q.id, true, 150).unwrap();

        let refreshed = get_query_by_id(&pool, &q.id).unwrap();
        assert!(refreshed.last_run_at.is_some());
        assert_eq!(refreshed.last_run_ok, Some(true));
        assert_eq!(refreshed.last_run_ms, Some(150));
    }

    #[test]
    fn test_update_query_run_failure() {
        let pool = test_pool();
        let q = create_query(&pool, "cred-1", "Bad query", "INVALID", None).unwrap();

        update_query_run(&pool, &q.id, false, 50).unwrap();

        let refreshed = get_query_by_id(&pool, &q.id).unwrap();
        assert_eq!(refreshed.last_run_ok, Some(false));
        assert_eq!(refreshed.last_run_ms, Some(50));
    }

    #[test]
    fn test_delete_query() {
        let pool = test_pool();
        let q = create_query(&pool, "cred-1", "To delete", "SELECT 1", None).unwrap();
        assert!(delete_query(&pool, &q.id).unwrap());

        let queries = list_queries(&pool, "cred-1").unwrap();
        assert!(queries.is_empty());
    }

    #[test]
    fn test_delete_query_not_found() {
        let pool = test_pool();
        assert!(!delete_query(&pool, "nonexistent-id").unwrap());
    }

    #[test]
    fn test_cascade_delete_credential() {
        let pool = test_pool();

        // Create tables and queries under cred-1
        create_table(&pool, "cred-1", "users", None, None).unwrap();
        create_table(&pool, "cred-1", "orders", None, None).unwrap();
        create_query(&pool, "cred-1", "Q1", "SELECT 1", None).unwrap();

        assert_eq!(list_tables(&pool, "cred-1").unwrap().len(), 2);
        assert_eq!(list_queries(&pool, "cred-1").unwrap().len(), 1);

        // Delete the parent credential -- should cascade
        let conn = pool.get().unwrap();
        // Re-enable FK enforcement on this connection
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute("DELETE FROM persona_credentials WHERE id = 'cred-1'", []).unwrap();
        drop(conn);

        assert_eq!(list_tables(&pool, "cred-1").unwrap().len(), 0);
        assert_eq!(list_queries(&pool, "cred-1").unwrap().len(), 0);
    }

    #[test]
    fn test_list_tables_only_for_credential() {
        let pool = test_pool();
        create_table(&pool, "cred-1", "users", None, None).unwrap();
        create_table(&pool, "cred-2", "products", None, None).unwrap();

        let cred1_tables = list_tables(&pool, "cred-1").unwrap();
        let cred2_tables = list_tables(&pool, "cred-2").unwrap();

        assert_eq!(cred1_tables.len(), 1);
        assert_eq!(cred1_tables[0].table_name, "users");
        assert_eq!(cred2_tables.len(), 1);
        assert_eq!(cred2_tables[0].table_name, "products");
    }
}
