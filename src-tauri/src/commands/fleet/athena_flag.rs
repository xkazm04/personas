//! Athena flag commands: the per-session grant and the per-persona default.
//!
//! The two live in different tables with different lifetimes (see migration
//! e57): the session flag IS the grant, the persona flag only stamps future
//! sessions. Neither command touches the other's row.
//!
//! NO `#[requires(auth)]` ON EITHER COMMAND, DELIBERATELY. The macro's `auth` arm
//! expands to `require_auth_sync`, whose entire body is `Ok(())`
//! (`ipc_auth.rs:455-457`), so the annotation cannot fail and reports a tier the
//! code does not enforce. The census rule `unfalsifiable-tier-guard` baselines 92
//! existing sites of exactly that and names deleting the annotation as the legal
//! fix for the `auth` tier, precisely because its only effect is to make a reader
//! believe a check happened. The real gate is the router-level
//! `ipc_auth::wrap_invoke_handler`, which these commands pass through like every
//! other. Do not "restore" the attribute to match the neighbours.

use std::sync::Arc;

use tauri::{AppHandle, State};

use super::pty;
use super::registry::registry;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::fleet_sessions;
use crate::error::AppError;
use crate::AppState;

/// Grant or revoke Athena's hold on one session. Returns the new value.
///
/// Order matters: the registry entry changes first (a running session reflects
/// it immediately), then the DB row is written DIRECTLY, then the change event
/// fires. The direct write has to precede the event because the event persists
/// the registry row through `upsert`, whose `athena_flagged` merge keeps a
/// stored 1 against a 0; only the setter can revoke.
///
/// A session with no durable row yet (no `claude_session_id`) is not an error:
/// the registry holds the grant and the first persist carries it.
#[tauri::command]
pub fn fleet_set_athena_flag(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    session_id: String,
    flagged: bool,
) -> Result<bool, AppError> {
    if !registry().set_athena_flagged(&session_id, flagged) {
        return Err(AppError::NotFound(format!("fleet session {session_id}")));
    }
    match fleet_sessions::set_athena_flagged(&state.db, &session_id, flagged) {
        Ok(_) | Err(AppError::NotFound(_)) => {}
        Err(err) => return Err(err),
    }
    pty::emit_registry_changed(&app, "athena_flag", &session_id);
    Ok(flagged)
}

/// Set a persona's Athena auto-flag: the default that stamps its FUTURE
/// sessions. Grants nothing to a session that already exists.
#[tauri::command]
pub fn persona_set_athena_auto_flag(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    enabled: bool,
) -> Result<bool, AppError> {
    persona_repo::set_athena_auto_flag(&state.db, &persona_id, enabled)
}
