//! Tauri-channel + DB-update glue for build-session events.
//!
//! Keeps IPC, persistence, and process-registry bookkeeping out of the
//! run_session event loop. Every outbound build event goes through
//! `dual_emit` so listeners on BOTH the per-component Channel and the
//! global Tauri event bus receive it.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::Emitter;

use crate::db::models::{BuildEvent, BuildPhase, UpdateBuildSession};
use crate::db::repos::core::build_sessions as build_session_repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ActiveProcessRegistry;

use super::super::event_registry::event_name;
use super::SessionHandle;

/// Payload emitted on `build-oneshot-terminal` when an autonomous build
/// reaches `Promoted` or `Failed`. Frontend listener (eventBridge.ts)
/// converts this into a notification-bell entry with a deep-link back to
/// the persona's draft.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildOneShotTerminalPayload {
    pub session_id: String,
    pub persona_id: String,
    pub persona_name: Option<String>,
    /// Either `"promoted"` or `"failed"` — matches `BuildPhase::as_str()`.
    pub phase: String,
    pub success: bool,
    pub error_message: Option<String>,
}

/// Update the session phase in the database.
pub(super) fn update_phase(
    pool: &DbPool,
    session_id: &str,
    phase: BuildPhase,
) -> Result<(), AppError> {
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
///
/// The dual-channel design assumes at-least-one delivery. If BOTH paths fail
/// (Channel dropped because the component unmounted AND no global listener
/// bound), the runner will keep advancing phases while the frontend has no
/// idea anything happened — the user sees a frozen build. Log a warning in
/// that case so the loss is at least visible in tracing output.
pub(super) fn dual_emit(
    pool: &DbPool,
    channel: &Channel<BuildEvent>,
    app: &tauri::AppHandle,
    event: &BuildEvent,
) {
    let (session_id, variant) = event_meta(event);
    let channel_result = channel.send(event.clone());
    if let Err(error) = &channel_result {
        warn_emit_failure_once(
            session_id,
            "channel",
            variant,
            format_args!("{error:?}"),
            "BuildSession dual_emit: component Channel send failed",
        );
    }

    let emit_result = app.emit(event_name::BUILD_SESSION_EVENT, event);
    if let Err(error) = &emit_result {
        warn_emit_failure_once(
            session_id,
            "tauri",
            variant,
            format_args!("{error:?}"),
            "BuildSession dual_emit: global Tauri emit failed",
        );
        if let Err(touch_error) = build_session_repo::update(pool, session_id, &Default::default())
        {
            tracing::warn!(
                session_id = %session_id,
                event_variant = variant,
                error = ?touch_error,
                "BuildSession dual_emit: failed to stamp session after Tauri emit error"
            );
        }
    }

    if channel_result.is_err() && emit_result.is_err() {
        tracing::warn!(
            session_id = %session_id,
            event_variant = variant,
            channel_error = ?channel_result.err(),
            emit_error = ?emit_result.err(),
            "BuildSession dual_emit: both Channel and Tauri emit failed — frontend will not learn about this event"
        );
    }
}

fn warn_emit_failure_once(
    session_id: &str,
    channel: &str,
    variant: &'static str,
    error: std::fmt::Arguments<'_>,
    message: &'static str,
) {
    static WARNED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let key = format!("{session_id}:{channel}");
    let mut warned = WARNED
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if !warned.insert(key) {
        return;
    }
    tracing::warn!(
        session_id = %session_id,
        event_variant = variant,
        emit_channel = channel,
        error = %error,
        "{}",
        message
    );
}

/// Extract `(session_id, variant_token)` from a `BuildEvent` for diagnostic
/// logging. Variant tokens match the serde `snake_case` tag used on the wire.
fn event_meta(event: &BuildEvent) -> (&str, &'static str) {
    match event {
        BuildEvent::CellUpdate { session_id, .. } => (session_id, "cell_update"),
        BuildEvent::Question { session_id, .. } => (session_id, "question"),
        BuildEvent::Progress { session_id, .. } => (session_id, "progress"),
        BuildEvent::Error { session_id, .. } => (session_id, "error"),
        BuildEvent::SessionStatus { session_id, .. } => (session_id, "session_status"),
        BuildEvent::BehaviorCoreUpdate { session_id, .. } => (session_id, "behavior_core_update"),
        BuildEvent::CapabilityEnumerationUpdate { session_id, .. } => {
            (session_id, "capability_enumeration_update")
        }
        BuildEvent::CapabilityResolutionUpdate { session_id, .. } => {
            (session_id, "capability_resolution_update")
        }
        BuildEvent::PersonaResolutionUpdate { session_id, .. } => {
            (session_id, "persona_resolution_update")
        }
        BuildEvent::ClarifyingQuestionV3 { session_id, .. } => {
            (session_id, "clarifying_question_v3")
        }
    }
}

/// Emit a SessionStatus event via Channel + Tauri.
pub(super) fn emit_session_status(
    pool: &DbPool,
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
    dual_emit(pool, channel, app, &event);
}

/// Emit an Error event via Channel + Tauri.
pub(super) fn emit_error(
    pool: &DbPool,
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
    dual_emit(pool, channel, app, &event);
}

/// Fire the one-shot terminal notification trio: OS notification (via
/// tauri-plugin-notification), in-app bell entry (via the
/// `build-oneshot-terminal` event listened to by eventBridge), and a
/// `SessionStatus` build event so any open Glyph view also flips state.
///
/// Best-effort: any send error is logged but does not bubble — terminal
/// state is already persisted in the DB by the orchestrator.
pub(super) fn send_terminal_notification(
    app: &tauri::AppHandle,
    session_id: &str,
    persona_id: &str,
    persona_name: Option<String>,
    phase: BuildPhase,
    error_message: Option<String>,
) {
    let success = matches!(phase, BuildPhase::Promoted);

    let title = if success {
        "Build complete".to_string()
    } else {
        "Build failed".to_string()
    };
    let display_name = persona_name
        .clone()
        .unwrap_or_else(|| "Your draft".to_string());
    let body = if success {
        format!("'{display_name}' is ready. Click to review and run it.")
    } else if let Some(ref err) = error_message {
        format!("'{display_name}' didn't land: {err}")
    } else {
        format!("'{display_name}' didn't land. Click to inspect what went wrong.")
    };

    crate::notifications::send(app, &title, &body);

    let payload = BuildOneShotTerminalPayload {
        session_id: session_id.to_string(),
        persona_id: persona_id.to_string(),
        persona_name,
        phase: phase.as_str().to_string(),
        success,
        error_message,
    };
    let _ = app.emit(event_name::BUILD_ONESHOT_TERMINAL, &payload);
}

/// Remove the session handle from the in-memory map and unregister from
/// the process registry.
pub(super) fn cleanup_session(
    sessions_map: &Arc<Mutex<HashMap<String, SessionHandle>>>,
    registry: &ActiveProcessRegistry,
    session_id: &str,
    generation: u64,
) {
    {
        let mut sessions = sessions_map.lock().unwrap_or_else(|e| e.into_inner());
        let should_remove = sessions
            .get(session_id)
            .is_some_and(|handle| handle.generation == generation);
        if should_remove {
            sessions.remove(session_id);
        }
    }
    registry.unregister_run("build_session", session_id);
}
