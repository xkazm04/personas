//! Tauri commands for the persisted design-decision log.
//!
//! The dispatcher auto-persists every `show_decision_log` entry into
//! `companion_design_decision`. These commands give the frontend a
//! retrospective view — list everything Athena's ever decided, or
//! filter by persona context (persona id / build session id / intent
//! string).
//!
//! No write commands here: design decisions are immutable audit-trail
//! rows. To "edit" one, Athena emits a fresh `show_decision_log` with
//! the corrected entry; the original stays put so retrospective
//! analysis sees the actual sequence of choices.

use std::sync::Arc;

use tauri::State;

use crate::companion::brain::decisions::{self, DesignDecision};
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

#[tauri::command]
pub async fn companion_list_design_decisions(
    state: State<'_, Arc<AppState>>,
    persona_context: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<DesignDecision>, AppError> {
    ipc_auth::require_auth(&state).await?;
    let cap = limit.unwrap_or(100).clamp(1, 500);
    match persona_context.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(ctx) => decisions::list_by_context(&state.user_db, ctx, cap),
        None => decisions::list_recent(&state.user_db, cap),
    }
}
