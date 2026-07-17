use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use tauri::State;
use tokio_util::sync::CancellationToken;

use crate::db::models::{DbSavedQuery, DbSchemaTable, QueryResult};
use crate::db::repos::resources::db_schema as repo;
use crate::error::AppError;

use crate::AppState;
use personas_macros::requires;

/// Registry of in-flight user-initiated DB queries, keyed by a caller-supplied
/// `query_id`, so [`cancel_db_query`] can abort a running query. Entries are
/// removed as soon as the query settles (success, error, or cancel).
static IN_FLIGHT_QUERIES: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn register_query(query_id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    if let Ok(mut map) = IN_FLIGHT_QUERIES.lock() {
        // If a stale id lingers, cancel it before replacing.
        if let Some(old) = map.insert(query_id.to_string(), token.clone()) {
            old.cancel();
        }
    }
    token
}

fn deregister_query(query_id: &str) {
    if let Ok(mut map) = IN_FLIGHT_QUERIES.lock() {
        map.remove(query_id);
    }
}

// ============================================================================
// Schema Tables
// ============================================================================

#[tauri::command]
#[requires(privileged)]
pub fn list_db_schema_tables(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<DbSchemaTable>, AppError> {
    repo::list_tables(&state.db, &credential_id)
}

#[tauri::command]
#[requires(privileged)]
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
#[requires(privileged)]
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
#[requires(privileged)]
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
#[requires(privileged)]
pub fn list_db_saved_queries(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<DbSavedQuery>, AppError> {
    repo::list_queries(&state.db, &credential_id)
}

#[tauri::command]
#[requires(privileged)]
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
#[requires(privileged)]
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
#[requires(privileged)]
pub fn delete_db_saved_query(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete_query(&state.db, &id)
}

// ============================================================================
// Query Safety Classification
// ============================================================================

#[tauri::command]
pub fn classify_db_query(query_text: String) -> bool {
    crate::engine::db_query::is_mutation(&query_text)
}

/// Report a connector's honest query-capability class (full-SQL / SELECT-subset
/// / key-value / introspection-only) so the editor can advertise only what the
/// connector actually supports. Pure classification — no DB access.
#[tauri::command]
pub fn db_connector_capability(
    service_type: String,
) -> crate::engine::db_query::DbConnectorCapability {
    crate::engine::db_query::connector_capability(&service_type)
}

// ============================================================================
// Schema Introspection
// ============================================================================

#[tauri::command]
#[requires(privileged)]
pub async fn introspect_db_tables(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<QueryResult, AppError> {
    crate::engine::db_query::introspect_tables(&state.db, &credential_id, Some(&state.user_db))
        .await
}

#[tauri::command]
#[requires(privileged)]
pub async fn introspect_db_columns(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    table_name: String,
) -> Result<QueryResult, AppError> {
    crate::engine::db_query::introspect_columns(
        &state.db,
        &credential_id,
        &table_name,
        Some(&state.user_db),
    )
    .await
}

// ============================================================================
// Query Execution
// ============================================================================

#[allow(clippy::too_many_arguments)]
#[tauri::command]
#[requires(privileged)]
pub async fn execute_db_query(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    query_text: String,
    saved_query_id: Option<String>,
    allow_mutation: Option<bool>,
    ddl_only: Option<bool>,
    query_id: Option<String>,
) -> Result<QueryResult, AppError> {
    // Register a cancellation token when the caller supplies a query_id so a
    // Cancel action can interrupt this run. Enforced deregistration on every
    // exit path keeps the registry from leaking.
    let cancel = query_id.as_deref().map(register_query);

    let result = crate::engine::db_query::execute_query_cancellable(
        &state.db,
        &credential_id,
        &query_text,
        Some(&state.user_db),
        allow_mutation.unwrap_or(false),
        ddl_only.unwrap_or(false),
        cancel.as_ref(),
    )
    .await;

    if let Some(id) = query_id.as_deref() {
        deregister_query(id);
    }

    if let Some(id) = saved_query_id {
        let success = result.is_ok();
        let duration_ms = result.as_ref().map(|r| r.duration_ms as i64).unwrap_or(0);
        if let Err(e) = repo::update_query_run(&state.db, &id, success, duration_ms) {
            tracing::warn!(query_id = %id, error = %e, "Failed to update query run stats");
        }
    }

    result
}

/// Cancel an in-flight [`execute_db_query`] run by its `query_id`. Aborts the
/// connector HTTP request or interrupts the running local SQLite statement.
/// No-op if the query already settled or the id is unknown.
#[tauri::command]
#[requires(privileged)]
pub fn cancel_db_query(
    state: State<'_, Arc<AppState>>,
    query_id: String,
) -> Result<(), AppError> {
    let _ = &state; // required by #[requires(privileged)] session guard
    if let Ok(mut map) = IN_FLIGHT_QUERIES.lock() {
        if let Some(token) = map.remove(&query_id) {
            token.cancel();
        }
    }
    Ok(())
}
