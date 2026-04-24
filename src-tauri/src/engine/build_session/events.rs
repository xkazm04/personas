//! Tauri-channel + DB-update glue for build-session events.
//!
//! Keeps IPC, persistence, and process-registry bookkeeping out of the
//! run_session event loop. Every outbound build event goes through
//! `dual_emit` so listeners on BOTH the per-component Channel and the
//! global Tauri event bus receive it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;
use tauri::Emitter;

use crate::db::models::{BuildEvent, BuildPhase, UpdateBuildSession};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ActiveProcessRegistry;

use super::super::event_registry::event_name;
use super::SessionHandle;

/// Update the session phase in the database.
pub(super) fn update_phase(pool: &DbPool, session_id: &str, phase: BuildPhase) -> Result<(), AppError> {
    build_session_repo::update(
        pool,
        session_id,
        &UpdateBuildSession {
            phase: Some(phase.as_str().to_string()),
            ..Default::default()
        },
    )
}

/// Update the session phase to Failed and store the error message.
pub(super) fn update_phase_with_error(
    pool: &DbPool,
    session_id: &str,
    error: &str,
) -> Result<(), AppError> {
    build_session_repo::update(
        pool,
        session_id,
        &UpdateBuildSession {
            phase: Some(BuildPhase::Failed.as_str().to_string()),
            error_message: Some(Some(error.to_string())),
            cli_pid: Some(None),
            ..Default::default()
        },
    )
}

/// Dual-emit a BuildEvent via both Channel (component-scoped) and Tauri events (global).
/// Channel delivers to the attached component; Tauri event reaches the global listener.
pub(super) fn dual_emit(
    channel: &Channel<BuildEvent>,
    app: &tauri::AppHandle,
    event: &BuildEvent,
) {
    let _ = channel.send(event.clone());
    let _ = app.emit(event_name::BUILD_SESSION_EVENT, event);
}

/// Emit a SessionStatus event via Channel + Tauri.
pub(super) fn emit_session_status(
    channel: &Channel<BuildEvent>,
    app: &tauri::AppHandle,
    session_id: &str,
    phase: BuildPhase,
    resolved_count: usize,
    total_count: usize,
) {
    let event = BuildEvent::SessionStatus {
        session_id: session_id.to_string(),
        phase: phase.as_str().to_string(),
        resolved_count,
        total_count,
    };
    dual_emit(channel, app, &event);
}

/// Emit an Error event via Channel + Tauri.
pub(super) fn emit_error(
    channel: &Channel<BuildEvent>,
    app: &tauri::AppHandle,
    session_id: &str,
    message: &str,
    retryable: bool,
) {
    let event = BuildEvent::Error {
        session_id: session_id.to_string(),
        cell_key: None,
        message: message.to_string(),
        retryable,
    };
    dual_emit(channel, app, &event);
}

/// Remove the session handle from the in-memory map and unregister from
/// the process registry.
pub(super) fn cleanup_session(
    sessions_map: &Arc<Mutex<HashMap<String, SessionHandle>>>,
    registry: &ActiveProcessRegistry,
    session_id: &str,
) {
    {
        let mut sessions = sessions_map.lock().unwrap_or_else(|e| e.into_inner());
        sessions.remove(session_id);
    }
    registry.unregister_run("build_session", session_id);
}
