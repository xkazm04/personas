//! Self-Evolving Team v1 — read commands over the learning ledger.
//!
//! The write path is entirely engine-side (`team_assignment_learning`, fired
//! by the orchestrator's terminal hook); the frontend only READS: outcome
//! records (with per-step trust-delta evidence), the team's trust board, and
//! the distilled lessons. All errors ride the AppError envelope.

use std::sync::Arc;

use tauri::State;

use crate::db::models::{AssignmentOutcome, TeamMemberTrust, TeamMemory};
use crate::db::repos::orchestration::assignment_outcomes as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// The learning record for one assignment, or `None` when the assignment
/// finished before this feature existed (the UI shows an honest empty state
/// rather than inventing history).
#[tauri::command]
pub fn get_assignment_outcome(
    state: State<'_, Arc<AppState>>,
    assignment_id: String,
) -> Result<Option<AssignmentOutcome>, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_assignment(&state.db, &assignment_id)
}

/// Recent learning records for a team (newest first).
#[tauri::command]
pub fn list_assignment_outcomes(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    limit: Option<i64>,
) -> Result<Vec<AssignmentOutcome>, AppError> {
    require_auth_sync(&state)?;
    repo::list_for_team(&state.db, &team_id, limit.unwrap_or(20))
}

/// The team's outcome-learned trust board (Brier-updated, floored).
#[tauri::command]
pub fn list_team_member_trust(
    state: State<'_, Arc<AppState>>,
    team_id: String,
) -> Result<Vec<TeamMemberTrust>, AppError> {
    require_auth_sync(&state)?;
    repo::list_trust_for_team(&state.db, &team_id)
}

/// The lessons past retrospectives distilled for this team — the same rows
/// the matching prompt's "team lessons" section retrieves.
#[tauri::command]
pub fn list_team_lessons(
    state: State<'_, Arc<AppState>>,
    team_id: String,
    limit: Option<i64>,
) -> Result<Vec<TeamMemory>, AppError> {
    require_auth_sync(&state)?;
    repo::list_team_lessons(&state.db, &team_id, limit.unwrap_or(10))
}
