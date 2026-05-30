//! IPC commands for the cross-source incidents inbox.
//!
//! See `src/features/overview/sub_incidents/DESIGN.md` for the architecture.
//! These commands expose the read paths and lifecycle transitions; the
//! per-source promoters are wired at each existing audit-INSERT site (see
//! `engine/audit_incidents_promoter.rs`).

use std::sync::Arc;
use tauri::State;

use crate::db::models::{AuditIncident, AuditIncidentSummary, IncidentFilters};
use crate::db::repos::execution::audit_incidents as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

const DEFAULT_LIMIT: i64 = 100;
const MAX_LIMIT: i64 = 500;

fn clamp_limit(value: Option<i64>) -> i64 {
    value.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

#[tauri::command]
pub fn list_audit_incidents(
    state: State<'_, Arc<AppState>>,
    filters: Option<IncidentFilters>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<AuditIncident>, AppError> {
    require_auth_sync(&state)?;
    let filters = filters.unwrap_or_default();
    let limit = clamp_limit(limit);
    let offset = offset.unwrap_or(0).max(0);
    repo::list(&state.db, &filters, limit, offset)
}

#[tauri::command]
pub fn get_audit_incidents_summary(
    state: State<'_, Arc<AppState>>,
) -> Result<AuditIncidentSummary, AppError> {
    require_auth_sync(&state)?;
    repo::summary(&state.db)
}

#[tauri::command]
pub fn get_audit_incident(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<AuditIncident, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn acknowledge_audit_incident(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::acknowledge(&state.db, &id)
}

/// Mark an incident as actively being worked ("In Progress"): the middle state
/// of the `open → in_progress → resolved` escalation lifecycle. Set when the
/// user (or Athena, via the detail modal) commits to fixing the blocker.
#[tauri::command]
pub fn set_incident_in_progress(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::start_progress(&state.db, &id)
}

#[tauri::command]
pub fn resolve_audit_incident(
    state: State<'_, Arc<AppState>>,
    id: String,
    resolution_note: Option<String>,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::resolve(&state.db, &id, resolution_note.as_deref())
}

#[tauri::command]
pub fn dismiss_audit_incident(
    state: State<'_, Arc<AppState>>,
    id: String,
    resolution_note: Option<String>,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::dismiss(&state.db, &id, resolution_note.as_deref())
}

#[tauri::command]
pub fn reopen_audit_incident(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::reopen(&state.db, &id)
}

#[tauri::command]
pub fn bulk_acknowledge_audit_incidents(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::bulk_acknowledge(&state.db, &ids)
}

#[tauri::command]
pub fn bulk_resolve_audit_incidents(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
    resolution_note: Option<String>,
) -> Result<i64, AppError> {
    require_auth_sync(&state)?;
    repo::bulk_resolve(&state.db, &ids, resolution_note.as_deref())
}
