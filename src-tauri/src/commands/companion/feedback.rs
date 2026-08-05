//! Companion beta flags + lightweight UX signals. The Phase 4 wrench-send
//! self-improve pipeline that lived here is retired and fully removed
//! (superseded by dev mode — docs/tests/athena/dev-mode-direction.md);
//! the boot-time recovery sweep it needed is gone with it.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

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
