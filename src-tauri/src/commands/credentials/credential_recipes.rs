use std::sync::Arc;
use tauri::State;

use crate::db::models::{CreateCredentialRecipeInput, CredentialRecipe};
use crate::db::repos::resources::credential_recipes as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn get_credential_recipe(
    state: State<'_, Arc<AppState>>,
    connector_name: String,
) -> Result<Option<CredentialRecipe>, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_connector(&state.db, &connector_name)
}

#[tauri::command]
pub fn list_credential_recipes(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<CredentialRecipe>, AppError> {
    require_auth_sync(&state)?;
    repo::list_all(&state.db)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn upsert_credential_recipe(
    state: State<'_, Arc<AppState>>,
    connector_name: String,
    connector_label: String,
    category: String,
    color: String,
    oauth_type: Option<String>,
    fields_json: String,
    healthcheck_json: Option<String>,
    setup_instructions: Option<String>,
    summary: Option<String>,
    docs_url: Option<String>,
    source: Option<String>,
) -> Result<CredentialRecipe, AppError> {
    require_auth_sync(&state)?;
    repo::upsert(
        &state.db,
        CreateCredentialRecipeInput {
            connector_name,
            connector_label,
            category,
            color,
            oauth_type,
            fields_json,
            healthcheck_json,
            setup_instructions,
            summary,
            docs_url,
            source: source.unwrap_or_else(|| "design".to_string()),
        },
    )
}

#[tauri::command]
pub fn use_credential_recipe(
    state: State<'_, Arc<AppState>>,
    connector_name: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::increment_usage(&state.db, &connector_name)
}
