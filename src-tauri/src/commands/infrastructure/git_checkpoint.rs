//! Tauri commands for dev-tools git checkpointing (fabro F5).
//!
//! Thin wrappers over [`crate::engine::git_checkpoint`]. They operate on a
//! caller-supplied repository directory (a dev-tools project working tree) and a
//! run id, so a dev-tools task can checkpoint each agent stage and later roll
//! back or fork a new attempt. The stage→SHA index is returned to the caller to
//! persist; a future enhancement can move it into a `dev_run_checkpoints` table.
//!
//! These run `git reset`/`checkout` on the given directory and are auth-gated;
//! they are user-initiated actions against the user's own repositories.

use std::path::Path;
use std::sync::Arc;

use tauri::State;

use crate::engine::git_checkpoint;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Commit the working tree as a checkpoint on `personas/run/<run_id>`; returns the
/// commit SHA, or `None` when the tree was clean.
#[tauri::command]
pub async fn dev_checkpoint_stage(
    state: State<'_, Arc<AppState>>,
    repo_dir: String,
    run_id: String,
    stage: String,
    status: String,
) -> Result<Option<String>, AppError> {
    require_auth_sync(&state)?;
    git_checkpoint::checkpoint_stage(Path::new(&repo_dir), &run_id, &stage, &status)
        .await
        .map_err(AppError::Internal)
}

/// Fork a fresh run branch from a checkpoint SHA (verifies ancestry first).
#[tauri::command]
pub async fn dev_fork_from_checkpoint(
    state: State<'_, Arc<AppState>>,
    repo_dir: String,
    sha: String,
    new_run_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    git_checkpoint::fork_from_checkpoint(Path::new(&repo_dir), &sha, &new_run_id)
        .await
        .map_err(AppError::Internal)
}

/// Hard-reset the working tree to a checkpoint SHA (rollback).
#[tauri::command]
pub async fn dev_rollback_to_checkpoint(
    state: State<'_, Arc<AppState>>,
    repo_dir: String,
    sha: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    git_checkpoint::rollback_to(Path::new(&repo_dir), &sha)
        .await
        .map_err(AppError::Internal)
}
