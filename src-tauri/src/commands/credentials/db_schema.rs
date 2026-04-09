use std::sync::Arc;
use tauri::State;

use crate::db::models::{DbSavedQuery, DbSchemaTable, QueryResult};
use crate::db::repos::resources::db_schema as repo;
use crate::error::AppError;
use crate::ipc_auth::{require_privileged, require_privileged_sync};
use crate::AppState;

// ============================================================================
// Schema Tables
// ============================================================================

#[tauri::command]
pub fn list_db_schema_tables(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<DbSchemaTable>, AppError> {
    require_privileged_sync(&state, "list_db_schema_tables")?;
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
    require_privileged_sync(&state, "create_db_schema_table")?;
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
    require_privileged_sync(&state, "update_db_schema_table")?;
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
    require_privileged_sync(&state, "delete_db_schema_table")?;
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
    require_privileged_sync(&state, "list_db_saved_queries")?;
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
    require_privileged_sync(&state, "create_db_saved_query")?;
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
    require_privileged_sync(&state, "update_db_saved_query")?;
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
    require_privileged_sync(&state, "delete_db_saved_query")?;
    repo::delete_query(&state.db, &id)
}

// ============================================================================
// Query Safety Classification
// ============================================================================

#[tauri::command]
pub fn classify_db_query(query_text: String) -> bool {
    crate::engine::db_query::is_mutation(&query_text)
}

// ============================================================================
// Schema Introspection
// ============================================================================

#[tauri::command]
pub async fn introspect_db_tables(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<QueryResult, AppError> {
    require_privileged(&state, "introspect_db_tables").await?;
    crate::engine::db_query::introspect_tables(&state.db, &credential_id, Some(&state.user_db)).await
}

#[tauri::command]
pub async fn introspect_db_columns(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    table_name: String,
) -> Result<QueryResult, AppError> {
    require_privileged(&state, "introspect_db_columns").await?;
    crate::engine::db_query::introspect_columns(&state.db, &credential_id, &table_name, Some(&state.user_db)).await
}

// ============================================================================
// Query Execution
// ============================================================================

#[tauri::command]
pub async fn execute_db_query(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    query_text: String,
    saved_query_id: Option<String>,
    allow_mutation: Option<bool>,
    ddl_only: Option<bool>,
) -> Result<QueryResult, AppError> {
    require_privileged(&state, "execute_db_query").await?;
    let result = crate::engine::db_query::execute_query(
        &state.db,
        &credential_id,
        &query_text,
        Some(&state.user_db),
        allow_mutation.unwrap_or(false),
        ddl_only.unwrap_or(false),
    ).await;

    // Update last_run stats if we have a saved query ID
    // (fire-and-forget -- don't fail the execution if this errors)
    if let Some(id) = saved_query_id {
        let db = state.db.clone();
        let success = result.is_ok();
        let duration_ms = result.as_ref().map(|r| r.duration_ms as i64).unwrap_or(0);
        
        tokio::spawn(async move {
            let _ = repo::update_query_run(&db, &id, success, duration_ms);
        });
    }

    result
}
