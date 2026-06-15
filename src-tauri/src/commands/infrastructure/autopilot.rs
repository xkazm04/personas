//! Per-project autopilot commands — the cockpit's single autonomy switch
//! (docs/plans/kpi-driven-orchestration.md, direction D2).
//!
//! Thin wrappers over the `autopilot_mode:<project_id>` app-setting: the
//! engine-side semantics (mode → capability, global fallback) live in
//! `engine/autopilot.rs`; the subscriptions read it each tick.

use std::sync::Arc;

use tauri::State;

use crate::engine::autopilot::{self, AutopilotMode};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// The project's explicit autopilot mode (`off`/`measure`/`suggest`/`full`),
/// or `None` when unset (the project follows the legacy global flags). The UI
/// shows `None` as `off` — the safe default for the common all-global-off case.
#[tauri::command]
pub async fn dev_tools_get_autopilot_mode(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Option<String>, AppError> {
    require_auth(&state).await?;
    let value = crate::db::repos::core::settings::get(&state.db, &autopilot::setting_key(&project_id))?;
    Ok(value)
}

/// Set (or clear) a project's autopilot mode. Passing `off`/`measure`/`suggest`/
/// `full` writes the explicit override; passing an empty string clears it (the
/// project reverts to following the global flags). Returns the stored mode (or
/// `None` when cleared).
#[tauri::command]
pub async fn dev_tools_set_autopilot_mode(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    mode: String,
) -> Result<Option<String>, AppError> {
    require_auth(&state).await?;
    let key = autopilot::setting_key(&project_id);
    let trimmed = mode.trim();
    if trimmed.is_empty() {
        crate::db::repos::core::settings::delete(&state.db, &key)?;
        return Ok(None);
    }
    let parsed = AutopilotMode::parse(trimmed).ok_or_else(|| {
        AppError::Validation(format!(
            "autopilot mode must be off|measure|suggest|full, got {trimmed:?}"
        ))
    })?;
    crate::db::repos::core::settings::set(&state.db, &key, parsed.as_str())?;
    Ok(Some(parsed.as_str().to_string()))
}
