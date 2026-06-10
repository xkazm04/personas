//! Tauri IPC for the system-operation automations primitive.
//!
//! These power the Chain Studio "System events" rail (a committed route =
//! one automation) and the Context Map "Plan update" button (a weekly
//! context-scan schedule). See `engine::system_ops` for the runtime.

use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::db::models::{SystemOpAutomation, SystemOpKindMeta};
use crate::db::repos::system_ops as repo;
use crate::engine::system_ops as ops;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Catalog of available system operations (for the Studio target rail).
#[tauri::command]
pub fn system_ops_list_kinds(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SystemOpKindMeta>, AppError> {
    require_auth_sync(&state)?;
    Ok(ops::list_kinds())
}

/// All persisted automations (trigger → system op).
#[tauri::command]
pub fn system_ops_list_automations(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SystemOpAutomation>, AppError> {
    require_auth_sync(&state)?;
    repo::list(&state.db)
}

/// Create an automation. `trigger_kind` is `"schedule"` (provide `cron`) or
/// `"event"` (provide `listen_event_type`). For schedule kinds the next fire
/// time is computed here from the cron.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn system_ops_create_automation(
    state: State<'_, Arc<AppState>>,
    op_kind: String,
    params_json: String,
    trigger_kind: String,
    cron: Option<String>,
    timezone: Option<String>,
    listen_event_type: Option<String>,
    source_filter: Option<String>,
    label: Option<String>,
) -> Result<SystemOpAutomation, AppError> {
    require_auth_sync(&state)?;

    if !ops::is_known_kind(&op_kind) {
        return Err(AppError::Validation(format!(
            "Unknown system op kind: {op_kind}"
        )));
    }
    // Validate params parse to JSON (the runner reads typed fields out of it).
    serde_json::from_str::<serde_json::Value>(&params_json)
        .map_err(|e| AppError::Validation(format!("params_json is not valid JSON: {e}")))?;

    match trigger_kind.as_str() {
        "schedule" => {
            if cron.as_deref().map(str::trim).unwrap_or("").is_empty() {
                return Err(AppError::Validation(
                    "schedule automations require a cron expression".into(),
                ));
            }
        }
        "event" => {
            if listen_event_type
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
            {
                return Err(AppError::Validation(
                    "event automations require a listen_event_type".into(),
                ));
            }
        }
        other => {
            return Err(AppError::Validation(format!(
                "Unknown trigger kind: {other}"
            )))
        }
    }

    let id = uuid::Uuid::new_v4().to_string();
    let next_run_at = if trigger_kind == "schedule" {
        cron.as_deref()
            .and_then(|c| ops::compute_next_run_at(c, &id, timezone.as_deref()))
    } else {
        None
    };

    repo::create(
        &state.db,
        repo::NewAutomation {
            id: &id,
            op_kind: &op_kind,
            params_json: &params_json,
            trigger_kind: &trigger_kind,
            cron: cron.as_deref(),
            timezone: timezone.as_deref(),
            listen_event_type: listen_event_type.as_deref(),
            source_filter: source_filter.as_deref(),
            next_run_at: next_run_at.as_deref(),
            label: label.as_deref(),
        },
    )
}

#[tauri::command]
pub fn system_ops_set_enabled(
    state: State<'_, Arc<AppState>>,
    id: String,
    enabled: bool,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::set_enabled(&state.db, &id, enabled)
}

#[tauri::command]
pub fn system_ops_delete_automation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

/// Run an automation's operation right now (does not change its schedule).
#[tauri::command]
pub fn system_ops_run_now(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let a = repo::get(&state.db, &id)?;
    let params: serde_json::Value =
        serde_json::from_str(&a.params_json).unwrap_or(serde_json::Value::Null);
    let detail = ops::run_op(&app, &state.db, &a.op_kind, &params, "manual")?;
    let _ = repo::mark_run(&state.db, &id, "ok", Some(&detail), a.next_run_at.as_deref());
    Ok(detail)
}
