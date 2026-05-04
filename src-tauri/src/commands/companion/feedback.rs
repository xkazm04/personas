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
    /// True when the wrench-send / self-improve UI should be exposed.
    /// Tied to `cfg!(debug_assertions)` for now — flipping requires a
    /// rebuild. Future: backed by a runtime setting.
    pub self_improve_enabled: bool,
}

#[tauri::command]
pub fn companion_beta_flags() -> CompanionBetaFlags {
    CompanionBetaFlags {
        self_improve_enabled: cfg!(debug_assertions),
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
        return Err(AppError::Internal(
            "self-improve: feedback is empty".into(),
        ));
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
