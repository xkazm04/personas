use std::sync::Arc;
use tauri::State;

use crate::db::models::{DbSavedQuery, DbSchemaTable, QueryResult};
use crate::db::repos::resources::db_schema as repo;
use crate::error::AppError;
use crate::AppState;

// ============================================================================
// Schema Tables
// ============================================================================

#[tauri::command]
pub fn list_db_schema_tables(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<DbSchemaTable>, AppError> {
    repo::list_tables(&state.db, &credential_id)
}

#[tauri::command]
pub fn create_db_schema_table(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    table_name: String,
    display_label: Option<String>,
    column_hints: Option<String>,
) -> Result<DbSchemaTable, AppError> {
    repo::create_table(
        &state.db,
        &credential_id,
        &table_name,
        display_label.as_deref(),
        column_hints.as_deref(),
    )
}

#[tauri::command]
pub fn update_db_schema_table(
    state: State<'_, Arc<AppState>>,
    id: String,
    table_name: Option<String>,
    display_label: Option<String>,
    column_hints: Option<String>,
    is_favorite: Option<bool>,
    sort_order: Option<i64>,
) -> Result<DbSchemaTable, AppError> {
    repo::update_table(
        &state.db,
        &id,
        table_name.as_deref(),
        display_label.as_deref(),
        column_hints.as_deref(),
        is_favorite,
        sort_order,
    )
}

#[tauri::command]
pub fn delete_db_schema_table(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete_table(&state.db, &id)
}

// ============================================================================
// Saved Queries
// ============================================================================

#[tauri::command]
pub fn list_db_saved_queries(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<DbSavedQuery>, AppError> {
    repo::list_queries(&state.db, &credential_id)
}

#[tauri::command]
pub fn create_db_saved_query(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    title: String,
    query_text: String,
    language: Option<String>,
) -> Result<DbSavedQuery, AppError> {
    repo::create_query(
        &state.db,
        &credential_id,
        &title,
        &query_text,
        language.as_deref(),
    )
}

#[tauri::command]
pub fn update_db_saved_query(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: Option<String>,
    query_text: Option<String>,
    language: Option<String>,
    is_favorite: Option<bool>,
    sort_order: Option<i64>,
) -> Result<DbSavedQuery, AppError> {
    repo::update_query(
        &state.db,
        &id,
        title.as_deref(),
        query_text.as_deref(),
        language.as_deref(),
        is_favorite,
        sort_order,
    )
}

#[tauri::command]
pub fn delete_db_saved_query(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete_query(&state.db, &id)
}

// ============================================================================
// Schema Introspection
// ============================================================================

#[tauri::command]
pub async fn introspect_db_tables(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<QueryResult, AppError> {
    crate::engine::db_query::introspect_tables(&state.db, &credential_id).await
}

#[tauri::command]
pub async fn introspect_db_columns(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    table_name: String,
) -> Result<QueryResult, AppError> {
    crate::engine::db_query::introspect_columns(&state.db, &credential_id, &table_name).await
}

// ============================================================================
// Query Execution
// ============================================================================

#[tauri::command]
pub async fn execute_db_query(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    query_text: String,
) -> Result<QueryResult, AppError> {
    let result = crate::engine::db_query::execute_query(&state.db, &credential_id, &query_text).await?;

    // Update last_run stats if we can find a matching saved query
    // (fire-and-forget — don't fail the execution if this errors)
    let duration_ms = result.duration_ms as i64;
    let success = true;
    let db = state.db.clone();
    let cred_id = credential_id.clone();
    tokio::spawn(async move {
        if let Ok(queries) = repo::list_queries(&db, &cred_id) {
            for q in queries {
                if q.query_text.trim() == query_text.trim() {
                    let _ = repo::update_query_run(&db, &q.id, success, duration_ms);
                    break;
                }
            }
        }
    });

    Ok(result)
}
