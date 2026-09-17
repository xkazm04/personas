//! Athena engine / tier settings and engine availability (Settings > Engine >
//! Athena tiers). The persisted layer above `companion::model_routing`; see
//! [`crate::companion::engine_settings`] for the resolution order.

use std::sync::Arc;

use tauri::State;

use crate::companion::engine_settings::{
    self, AthenaEngine, AthenaEngineSettings, EngineAvailability,
};
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

/// Probe each engine through the spawn door the real turn uses.
///
/// STUB (wire contract committed ahead of the build fan-out): reports the
/// Claude engine as installed with the catalog models and Grok as not yet
/// probed. WP1 replaces the body with a real `--version` / `grok models`
/// probe; the signature and the returned shape are final.
#[tauri::command]
pub async fn companion_probe_engines(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<EngineAvailability>, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    Ok(vec![
        EngineAvailability {
            engine: AthenaEngine::Claude,
            installed: true,
            version: None,
            models: vec![
                personas_core::model_ids::OPUS_CURRENT.to_string(),
                personas_core::model_ids::SONNET_CURRENT.to_string(),
                personas_core::model_ids::HAIKU_CURRENT.to_string(),
            ],
            detail: None,
        },
        EngineAvailability {
            engine: AthenaEngine::Grok,
            installed: false,
            version: None,
            models: personas_core::model_ids::GROK_MODELS
                .iter()
                .map(|m| m.to_string())
                .collect(),
            detail: Some("probe not implemented yet".to_string()),
        },
    ])
}
