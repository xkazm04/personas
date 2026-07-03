//! Phase 4: self-improve loop. The "wrench-send" button on the composer
//! pipes user feedback into a separate Claude CLI coding session at the
//! repo root via `companion_request_improvement`. The button itself is
//! gated by `companion_beta_flags` (off in release builds).

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::companion::dev_session::{self, ImprovementOutcome};
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionBetaFlags {
    /// True when the DEV MODE toggle (the wrench in the companion header)
    /// should be exposed at all — i.e. this is a debug build running from
    /// a source checkout. Whether the mode is *on* is the runtime setting
    /// `companion_dev_mode` (see `chat::dev_mode_enabled`); this flag only
    /// gates visibility of the affordance. Replaces the old
    /// `self_improve_enabled` wrench-send gate (superseded by dev mode —
    /// docs/tests/athena/dev-mode-direction.md).
    pub dev_mode_available: bool,
}

#[tauri::command]
pub fn companion_beta_flags() -> CompanionBetaFlags {
    CompanionBetaFlags {
        dev_mode_available: cfg!(debug_assertions),
    }
}

#[tauri::command]
pub async fn companion_request_improvement(
    state: State<'_, Arc<AppState>>,
    feedback: String,
) -> Result<ImprovementOutcome, AppError> {
    ipc_auth::require_auth(&state).await?;

    // Defense in depth: refuse the call entirely outside dev builds even
    // if a frontend somehow surfaces the trigger. The flag-query above
    // already hides the UI; this is the second lock.
    if !cfg!(debug_assertions) {
        return Err(AppError::Internal(
            "self-improve is disabled in release builds".into(),
        ));
    }

    if feedback.trim().is_empty() {
        return Err(AppError::Internal("self-improve: feedback is empty".into()));
    }

    #[cfg(feature = "ml")]
    {
        let embedder = state.embedding_manager.clone();
        dev_session::run_improvement(&state.user_db, embedder.as_ref(), feedback).await
    }
    #[cfg(not(feature = "ml"))]
    {
        dev_session::run_improvement(&state.user_db, feedback).await
    }
}

/// Record one lightweight behavioral UX signal (F3) — fire-and-forget from the
/// frontend (refine-chip clicks, walkthrough completion, decision-queue usage).
/// `payload_json` is a tiny numbers/enums blob, never raw user content. Feeds
/// the weekly profile-synthesis pass; never blocks the UI.
#[tauri::command]
pub fn companion_record_ux_signal(
    state: State<'_, Arc<AppState>>,
    kind: String,
    payload_json: String,
) -> Result<(), AppError> {
    ipc_auth::require_auth_sync(&state)?;
    crate::companion::brain::profile_synthesis::record_signal(&state.user_db, &kind, &payload_json)
}
