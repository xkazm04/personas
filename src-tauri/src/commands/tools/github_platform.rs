use std::sync::Arc;
use tauri::State;

use crate::engine::platforms::github::{self, GitHubPermissions, GitHubRepo, PatchReleaseOutcome};
use crate::error::AppError;
use crate::AppState;
use personas_macros::requires;

/// List repositories accessible to the GitHub credential.
#[tauri::command]
#[requires(privileged)]
pub async fn github_list_repos(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<GitHubRepo>, AppError> {
    let client = github::build_client_from_credential(&state.db, &credential_id)?;
    client.list_repos().await
}

/// Check GitHub PAT permissions (repo, workflow scopes).
#[tauri::command]
#[requires(privileged)]
pub async fn github_check_permissions(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<GitHubPermissions, AppError> {
    let client = github::build_client_from_credential(&state.db, &credential_id)?;
    client.check_permissions().await
}

/// CICD primitive: cut a patch release on `{owner}/{repo}` if the default
/// branch advanced since the last release (a merge landed). Increments the
/// PATCH number of the latest release tag. `dry_run` reports what it would do
/// without creating anything. Requires a GitHub PAT with the `repo` scope.
#[tauri::command]
#[requires(privileged)]
pub async fn github_create_patch_release(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    owner: String,
    repo: String,
    base_branch: String,
    dry_run: bool,
) -> Result<PatchReleaseOutcome, AppError> {
    let client = github::build_client_from_credential(&state.db, &credential_id)?;
    client
        .create_patch_release(&owner, &repo, &base_branch, dry_run)
        .await
}
