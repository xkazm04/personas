//! Tauri commands for desktop bridge execution and local agent runtime.

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::engine::desktop_bridges::BridgeActionResult;
use crate::engine::desktop_runtime::{
    BridgeConfig, DesktopPlan, PlanExecutionResult, RuntimeStatus,
};
use crate::engine::desktop_security::{self, DesktopCapability};
use crate::error::AppError;
use crate::AppState;

// ── Single bridge action ─────────────────────────────────────────────

/// Execute a single action on a desktop bridge.
///
/// The caller provides the bridge name, action JSON, and config overrides.
/// Security capabilities are checked before execution.
#[tauri::command]
pub async fn execute_desktop_bridge(
    state: State<'_, Arc<AppState>>,
    bridge: String,
    action: Value,
    config: Option<BridgeConfig>,
) -> Result<BridgeActionResult, AppError> {
    // Map bridge name to connector for permission check
    let connector_name = format!("desktop_{}", bridge);
    let required_cap = match bridge.as_str() {
        "vscode" | "docker" | "terminal" => DesktopCapability::ProcessSpawn,
        "obsidian" => DesktopCapability::FileRead,
        _ => return Err(AppError::Validation(format!("Unknown bridge: {bridge}"))),
    };

    desktop_security::check_permission(
        &state.desktop_approvals,
        &connector_name,
        &required_cap,
    )?;

    let config = config.unwrap_or_default();

    match bridge.as_str() {
        "vscode" => {
            let action = serde_json::from_value(action)
                .map_err(|e| AppError::Validation(format!("Invalid VS Code action: {e}")))?;
            let binary = config.vscode_binary.as_deref().unwrap_or("code");
            crate::engine::desktop_bridges::vscode::execute(binary, action).await
        }
        "docker" => {
            let action = serde_json::from_value(action)
                .map_err(|e| AppError::Validation(format!("Invalid Docker action: {e}")))?;
            let binary = config.docker_binary.as_deref().unwrap_or("docker");
            crate::engine::desktop_bridges::docker::execute(binary, action).await
        }
        "terminal" => {
            let action = serde_json::from_value(action)
                .map_err(|e| AppError::Validation(format!("Invalid Terminal action: {e}")))?;
            let shell = config.terminal_shell.as_deref().unwrap_or("bash");
            crate::engine::desktop_bridges::terminal::execute(shell, action, &config.env_vars)
                .await
        }
        "obsidian" => {
            let action = serde_json::from_value(action)
                .map_err(|e| AppError::Validation(format!("Invalid Obsidian action: {e}")))?;
            let vault = config
                .obsidian_vault_path
                .as_deref()
                .ok_or_else(|| AppError::Validation("Obsidian vault path not configured".into()))?;
            crate::engine::desktop_bridges::obsidian::execute(
                vault,
                config.obsidian_api_port,
                config.obsidian_api_key.as_deref(),
                action,
            )
            .await
        }
        _ => Err(AppError::Validation(format!("Unknown bridge: {bridge}"))),
    }
}

// ── Plan execution (runtime) ─────────────────────────────────────────

/// Execute a multi-step desktop plan via the local agent runtime.
#[tauri::command]
pub async fn execute_desktop_plan(
    state: State<'_, Arc<AppState>>,
    plan: DesktopPlan,
    config: Option<BridgeConfig>,
) -> Result<PlanExecutionResult, AppError> {
    let config = config.unwrap_or_default();
    state
        .desktop_runtime
        .execute_plan(plan, &state.desktop_approvals, &config)
        .await
}

/// Get the current runtime status (active plan, progress).
#[tauri::command]
pub async fn get_desktop_runtime_status(
    state: State<'_, Arc<AppState>>,
) -> Result<RuntimeStatus, AppError> {
    Ok(state.desktop_runtime.get_status().await)
}

/// Get the cached result of a previously executed plan.
#[tauri::command]
pub async fn get_desktop_plan_result(
    state: State<'_, Arc<AppState>>,
    plan_id: String,
) -> Result<Option<PlanExecutionResult>, AppError> {
    Ok(state.desktop_runtime.get_result(&plan_id).await)
}
