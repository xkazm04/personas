//! Reversible Agent — IPC surface over the change journal.
//!
//! Read side: the Execution Data Diff (exact rows a run
//! created/modified/deleted, with before-images and conflict predictions).
//! Write side: `undo_execution` — reverse-replay of the run's journal in one
//! transaction with conflict parking. The UI consent-gates the undo; the
//! command itself is privileged (it mutates arbitrary allowlisted tables).

use std::sync::Arc;

use tauri::State;

use crate::db::repos::execution::change_journal as journal_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;
use personas_macros::requires;

/// The exact rows this execution created/modified/deleted, newest first,
/// with before-images (ciphertext for encrypted columns — never decrypted)
/// and a per-row later-foreign-write conflict prediction.
#[tauri::command]
pub fn get_execution_data_diff(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
) -> Result<journal_repo::ExecutionDataDiff, AppError> {
    require_auth_sync(&state)?;
    journal_repo::get_execution_data_diff(&state.db, &execution_id)
}

/// Reverse-replay every live journal entry of the execution in ONE
/// transaction. Rows modified since by another writer are flagged
/// `conflict` and parked — never clobbered. Idempotent: already-processed
/// entries are skipped.
#[tauri::command]
#[requires(privileged)]
pub fn undo_execution(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
) -> Result<journal_repo::UndoExecutionResult, AppError> {
    journal_repo::undo_execution(&state.db, &execution_id)
}
