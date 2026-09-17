//! Athena engine / tier settings and engine availability (Settings > Engine >
//! Athena tiers). The persisted layer above `companion::model_routing`; see
//! [`crate::companion::engine_settings`] for the resolution order.

use std::sync::Arc;

use tauri::State;

use crate::companion::engine_settings::{self, AthenaEngineSettings, EngineAvailability};
use crate::error::AppError;
use crate::AppState;

/// The persisted tier table with calibrated defaults filled in.
#[tauri::command]
pub fn companion_get_engine_settings(
    state: State<'_, Arc<AppState>>,
) -> Result<AthenaEngineSettings, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    engine_settings::load(&state.db)
}

/// Persist the whole tier table; effort values are validated, an invalid
/// one is rejected rather than silently dropped.
#[tauri::command]
pub fn companion_set_engine_settings(
    state: State<'_, Arc<AppState>>,
    settings: AthenaEngineSettings,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    engine_settings::save(&state.db, &settings)
}

/// Probe each engine through the binary resolution the real turn uses:
/// `claude --version`, `grok --version` + `grok models` (10 s cap each, no
/// console window). A missing binary is a product state (`installed:
/// false` with the reason), never an error.
#[tauri::command]
pub async fn companion_probe_engines(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<EngineAvailability>, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    Ok(crate::companion::session::probe_engines().await)
}
