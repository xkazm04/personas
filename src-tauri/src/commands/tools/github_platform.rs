use std::sync::Arc;
use tauri::State;

use crate::engine::platforms::github::{self, GitHubPermissions, GitHubRepo};
use crate::error::AppError;
use crate::AppState;

/// List repositories accessible to the GitHub credential.
#[tauri::command]
pub async fn github_list_repos(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<GitHubRepo>, AppError> {
    let client = github::build_client_from_credential(&state.db, &credential_id)?;
    client.list_repos().await
}

/// Check GitHub PAT permissions (repo, workflow scopes).
#[tauri::command]
pub async fn github_check_permissions(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<GitHubPermissions, AppError> {
    let client = github::build_client_from_credential(&state.db, &credential_id)?;
    client.check_permissions().await
}
