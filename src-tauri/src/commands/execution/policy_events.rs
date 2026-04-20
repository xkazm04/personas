//! IPC commands for inspecting generation-policy enforcement events.
//!
//! The dispatcher persists every silent drop / auto-resolve to
//! `policy_events`. The Execution Detail "Policy Events" tab calls
//! `get_policy_events_for_execution` to render the audit trail so authors
//! can verify their declared `review_policy` / `memory_policy` / events
//! policies are firing as expected.

use std::sync::Arc;
use tauri::State;

use crate::db::models::PolicyEvent;
use crate::db::repos::execution::policy_events as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn get_policy_events_for_execution(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
) -> Result<Vec<PolicyEvent>, AppError> {
    require_auth_sync(&state)?;
    repo::list_by_execution(&state.db, &execution_id)
}
