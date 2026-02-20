use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::cloud;
use crate::cloud::client::CloudClient;
use crate::db::models::UpdateExecutionStatus;
use crate::db::repos::{executions, personas, tools};
use crate::engine;
use crate::error::AppError;
use crate::AppState;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CloudConfig {
    pub url: String,
    pub is_connected: bool,
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async fn get_cloud_client(state: &AppState) -> Result<Arc<CloudClient>, AppError> {
    state
        .cloud_client
        .lock()
        .await
        .clone()
        .ok_or_else(|| AppError::Cloud("Not connected to cloud orchestrator".into()))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Connect to a cloud orchestrator by URL and API key.
/// Stores credentials in the OS keyring and initialises the in-memory client.
#[tauri::command]
pub async fn cloud_connect(
    state: State<'_, Arc<AppState>>,
    url: String,
    api_key: String,
) -> Result<(), AppError> {
    if url.trim().is_empty() {
        return Err(AppError::Cloud("Cloud orchestrator URL must not be empty".into()));
    }
    if api_key.trim().is_empty() {
        return Err(AppError::Cloud("API key must not be empty".into()));
    }

    cloud::config::store_cloud_config(&url, &api_key)
        .map_err(|e| AppError::Cloud(format!("Failed to store cloud config: {e}")))?;

    let client = Arc::new(CloudClient::new(url.clone(), api_key.clone()));
    *state.cloud_client.lock().await = Some(client);

    tracing::info!(url = %url, "Connected to cloud orchestrator");
    Ok(())
}

/// Disconnect from the cloud orchestrator.
/// Clears keyring credentials and drops the in-memory client.
#[tauri::command]
pub async fn cloud_disconnect(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    cloud::config::clear_cloud_config();
    *state.cloud_client.lock().await = None;

    tracing::info!("Disconnected from cloud orchestrator");
    Ok(())
}

/// Return the current cloud connection configuration, if any.
#[tauri::command]
pub async fn cloud_get_config(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<CloudConfig>, AppError> {
    let is_connected = state.cloud_client.lock().await.is_some();

    match cloud::config::load_cloud_config() {
        Some((url, _)) => Ok(Some(CloudConfig { url, is_connected })),
        None => Ok(None),
    }
}

/// Query the cloud orchestrator's current status.
#[tauri::command]
pub async fn cloud_status(
    state: State<'_, Arc<AppState>>,
) -> Result<cloud::client::CloudStatusResponse, AppError> {
    let client = get_cloud_client(&state).await?;
    client.status().await
}

/// Submit a persona for cloud execution.
#[tauri::command]
pub async fn cloud_execute_persona(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    persona_id: String,
    input_data: Option<String>,
) -> Result<String, AppError> {
    let client = get_cloud_client(&state).await?;

    let persona = personas::get_by_id(&state.db, &persona_id)?;
    let tools = tools::get_tools_for_persona(&state.db, &persona_id)?;

    let input_value: Option<serde_json::Value> = input_data
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    let prompt = engine::prompt::assemble_prompt(
        &persona,
        &tools,
        input_value.as_ref(),
        None,
    );

    let exec = executions::create(&state.db, &persona_id, None, input_data.clone(), None)?;

    let timeout_ms = if persona.timeout_ms > 0 {
        persona.timeout_ms as u64
    } else {
        600_000
    };

    let cloud_resp = client
        .submit_execution(&prompt, &persona_id, Some(timeout_ms))
        .await?;

    state
        .cloud_exec_ids
        .lock()
        .await
        .insert(exec.id.clone(), cloud_resp.execution_id.clone());

    let cancelled = Arc::new(AtomicBool::new(false));

    let exec_id = exec.id.clone();
    let cloud_exec_id = cloud_resp.execution_id.clone();
    let persona_id_clone = persona_id.clone();
    let pool = state.db.clone();
    let client_clone = client.clone();
    let cancelled_clone = cancelled.clone();
    let app_clone = app.clone();

    let handle = tokio::spawn(async move {
        let result = cloud::runner::run_cloud_execution(
            app_clone,
            client_clone,
            exec_id.clone(),
            cloud_exec_id,
            cancelled_clone.clone(),
        )
        .await;

        if !cancelled_clone.load(Ordering::Acquire) {
            let status = if result.success { "completed" } else { "failed" };
            let _ = executions::update_status(
                &pool,
                &exec_id,
                UpdateExecutionStatus {
                    status: status.into(),
                    error_message: result.error,
                    duration_ms: Some(result.duration_ms as i64),
                    cost_usd: result.cost_usd,
                    ..Default::default()
                },
            );

            tracing::info!(
                execution_id = %exec_id,
                persona_id = %persona_id_clone,
                status = status,
                duration_ms = result.duration_ms,
                "Cloud execution finished"
            );
        }
    });

    state
        .engine
        .register_cloud_task(&persona_id, exec.id.clone(), cancelled, handle)
        .await;

    tracing::info!(
        execution_id = %exec.id,
        persona_id = %persona_id,
        cloud_execution_id = %cloud_resp.execution_id,
        "Cloud execution submitted"
    );

    Ok(exec.id)
}

/// Cancel a running cloud execution.
#[tauri::command]
pub async fn cloud_cancel_execution(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
) -> Result<bool, AppError> {
    let cloud_exec_id = state
        .cloud_exec_ids
        .lock()
        .await
        .get(&execution_id)
        .cloned();

    let cancelled = state
        .engine
        .cancel_cloud_execution(&execution_id, &state.db, None)
        .await;

    if let Some(cloud_id) = cloud_exec_id {
        if let Ok(client) = get_cloud_client(&state).await {
            let _ = client.cancel_execution(&cloud_id).await;
        }
    }

    state.cloud_exec_ids.lock().await.remove(&execution_id);

    if cancelled {
        tracing::info!(execution_id = %execution_id, "Cloud execution cancelled");
    }

    Ok(cancelled)
}

/// Initiate OAuth authorization via the cloud orchestrator.
#[tauri::command]
pub async fn cloud_oauth_authorize(
    state: State<'_, Arc<AppState>>,
) -> Result<cloud::client::CloudOAuthAuthorizeResponse, AppError> {
    let client = get_cloud_client(&state).await?;
    let resp = client.oauth_authorize().await?;

    let _ = open::that(&resp.auth_url);

    tracing::info!("Opened browser for cloud OAuth authorization");
    Ok(resp)
}

/// Handle the OAuth callback from the cloud orchestrator.
#[tauri::command]
pub async fn cloud_oauth_callback(
    state: State<'_, Arc<AppState>>,
    code: String,
    oauth_state: String,
) -> Result<serde_json::Value, AppError> {
    let client = get_cloud_client(&state).await?;
    client.oauth_callback(&code, &oauth_state).await
}

/// Check the current OAuth status with the cloud orchestrator.
#[tauri::command]
pub async fn cloud_oauth_status(
    state: State<'_, Arc<AppState>>,
) -> Result<cloud::client::CloudOAuthStatusResponse, AppError> {
    let client = get_cloud_client(&state).await?;
    client.oauth_status().await
}

/// Refresh the OAuth token via the cloud orchestrator.
#[tauri::command]
pub async fn cloud_oauth_refresh(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    let client = get_cloud_client(&state).await?;
    client.oauth_refresh().await
}

/// Disconnect OAuth credentials from the cloud orchestrator.
#[tauri::command]
pub async fn cloud_oauth_disconnect(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    let client = get_cloud_client(&state).await?;
    client.oauth_disconnect().await
}
