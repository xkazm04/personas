//! Tauri commands for the companion's sensory layer (per-source capture
//! gates over the ambient context window). Phase 2 v1 of the Athena
//! desktop-aware roadmap — see
//! `docs/concepts/athena-desktop-aware-phase1-audit.md` for the audit
//! that surfaced capture-time gating as a requirement.
//!
//! ## Privacy contract
//!
//! Every per-source toggle defaults OFF. The frontend is the only path
//! that flips them ON, and disabling a source via this command purges
//! the prior signals from that source from the rolling window — "stop
//! capturing AND drop what was captured."
//!
//! ## Surface (3 commands)
//!
//! - `companion_get_sensory_state` — read current toggle state + per-source
//!   counts in the rolling window. Used by the Setup UI to render
//!   toggle positions and the "What did Athena see?" panel headers.
//! - `companion_set_sensory_source_enabled(source, enabled)` — flip a
//!   single source. Returns the number of signals purged when
//!   transitioning from on → off (0 on the off → on direction).
//! - `companion_purge_sensory_source(source)` — explicit revoke without
//!   changing the gate. Useful when the user wants to clear what's
//!   currently visible without disabling capture for the future.

use std::sync::Arc;

use tauri::State;

use crate::engine::ambient_context::SensorySourceState;
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

/// Read the current sensory state — per-source toggles + per-source
/// signal counts in the rolling window + lifetime total. Pure read;
/// no side effects.
#[tauri::command]
pub async fn companion_get_sensory_state(
    state: State<'_, Arc<AppState>>,
) -> Result<SensorySourceState, AppError> {
    ipc_auth::require_auth(&state).await?;
    let guard = state.ambient_context.lock().await;
    Ok(guard.source_state())
}

/// Set a per-source capture gate. When transitioning from on → off,
/// signals from that source are purged from the rolling window
/// (the privacy promise — "I disabled it, so it's gone too").
///
/// `source` must be one of `"clipboard"`, `"file_watcher"`, `"app_focus"`.
/// Unknown sources are a no-op (returns 0 purged) — the underlying gate
/// store fails closed.
///
/// Returns the number of signals purged from the rolling window
/// (0 on enable, ≥0 on disable depending on what was captured).
#[tauri::command]
pub async fn companion_set_sensory_source_enabled(
    state: State<'_, Arc<AppState>>,
    source: String,
    enabled: bool,
) -> Result<u32, AppError> {
    ipc_auth::require_auth(&state).await?;
    let mut guard = state.ambient_context.lock().await;
    let purged = guard.set_source_enabled(&source, enabled);
    Ok(purged as u32)
}

/// Purge a source's signals without changing its capture gate. Lets the
/// user clear "what Athena currently sees" without committing to a full
/// opt-out. Capture continues afterward if the gate is on.
///
/// Returns the number of signals purged.
#[tauri::command]
pub async fn companion_purge_sensory_source(
    state: State<'_, Arc<AppState>>,
    source: String,
) -> Result<u32, AppError> {
    ipc_auth::require_auth(&state).await?;
    let mut guard = state.ambient_context.lock().await;
    // Implemented via the same code path as set_source_enabled(false) on
    // an already-enabled source: toggle off (purges), then toggle back on
    // if it was originally on. This keeps the purge logic in one place.
    let was_enabled = guard.is_source_enabled(&source);
    let purged = guard.set_source_enabled(&source, false);
    if was_enabled {
        // Re-enable — purge already happened, this just restores capture.
        guard.set_source_enabled(&source, true);
    }
    Ok(purged as u32)
}
