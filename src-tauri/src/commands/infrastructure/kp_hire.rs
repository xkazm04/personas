//! The IPC door onto the outbound hire.
//!
//! One command, one call into `engine::kp_hire_request`, per the adapter rule.
//! The operation itself — endpoint resolution, the active-persona cap, the POST,
//! the ledger and the project memory — lives in the engine module, because the
//! bridge route (`POST /dev-tools/hire`) and the attention loop's `hires` verb
//! are two further callers of exactly the same operation and must not each get
//! their own interpretation of it.

use std::sync::Arc;

use tauri::State;

use crate::engine::kp_hire_request::{self, HireRequestInput, HireRequestOutcome};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::state::AppState;

/// Ask kp to compose a role from a need and dispatch it back as a persona.
///
/// Async rather than sync because the body is an HTTP call kp may take minutes
/// to answer — a sync command would hold the IPC worker for the whole
/// composition. No `spawn_blocking`: unlike the adoption commands this body is
/// already a future, and its DB touches are two point lookups either side of
/// the await.
#[tauri::command]
pub async fn request_hire_from_kp(
    state: State<'_, Arc<AppState>>,
    input: HireRequestInput,
) -> Result<HireRequestOutcome, AppError> {
    require_auth(&state).await?;
    kp_hire_request::request_hire(&state.db, input.into()).await
}
