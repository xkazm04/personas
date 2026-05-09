//! Tauri command surface for the connector_explorer module.
//!
//! Single command: take a URL, return a draft connector manifest produced
//! by `engine::connector_explorer::explore_url`. See
//! `engine/connector_explorer/DESIGN.md` for the v1 boundary.

use std::sync::Arc;

use tauri::State;

use crate::engine::connector_explorer::{
    explore_url, ConnectorManifestDraft, ExplorerOptions,
};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub async fn connector_explorer_explore(
    state: State<'_, Arc<AppState>>,
    url: String,
) -> Result<ConnectorManifestDraft, AppError> {
    require_auth_sync(&state)?;

    if url.trim().is_empty() {
        return Err(AppError::Validation(
            "connector_explorer_explore: url is empty".into(),
        ));
    }

    explore_url(url.trim(), ExplorerOptions::default()).await
}
