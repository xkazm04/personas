use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;
use url::Url;

use crate::cloud;
use crate::cloud::client::CloudClient;
use crate::db::models::UpdateExecutionStatus;
use crate::db::repos::core::personas;
use crate::db::repos::execution::executions;
use crate::db::repos::resources::tools;
use crate::engine;
use crate::error::AppError;
use crate::ipc_auth::require_privileged;
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
// Helpers
// ---------------------------------------------------------------------------

/// Validate that a cloud orchestrator URL is well-formed and uses a safe scheme.
///
/// Enforces HTTPS for all remote hosts. HTTP is only permitted for loopback
/// addresses (`localhost`, `127.0.0.1`, `[::1]`) to support local development.
fn validate_cloud_url(raw: &str) -> Result<Url, AppError> {
    let parsed = Url::parse(raw)
        .map_err(|e| AppError::Cloud(format!("Invalid orchestrator URL: {e}")))?;

    match parsed.scheme() {
        "https" => Ok(parsed),
        "http" => {
            let host = parsed.host_str().unwrap_or("");
            if host == "localhost" || host == "127.0.0.1" || host == "[::1]" {
                Ok(parsed)
            } else {
                Err(AppError::Cloud(
                    "HTTP is only allowed for localhost. Use HTTPS for remote orchestrators \
                     to protect your API key in transit."
                        .into(),
                ))
            }
        }
        other => Err(AppError::Cloud(format!(
            "Unsupported URL scheme \"{other}://\". Use HTTPS (or HTTP for localhost)."
        ))),
    }
}

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
    require_privileged(&state, "cloud_connect").await?;
    if url.trim().is_empty() {
        return Err(AppError::Cloud("Cloud orchestrator URL must not be empty".into()));
    }
    if api_key.trim().is_empty() {
        return Err(AppError::Cloud("API key must not be empty".into()));
    }

    let parsed = validate_cloud_url(url.trim())?;
    let normalized = parsed.as_str().trim_end_matches('/').to_string();

    let client = Arc::new(CloudClient::new(normalized.clone(), api_key.clone()));

    // Verify the orchestrator is actually reachable before storing credentials
    client.health().await.map_err(|e| {
        AppError::Cloud(format!("Cloud orchestrator is not reachable: {e}"))
    })?;

    // Only persist credentials after we've confirmed the connection works
    cloud::config::store_cloud_config(&normalized, &api_key)
        .map_err(|e| AppError::Cloud(format!("Failed to store cloud config: {e}")))?;

    // Push Supabase user token to the cloud client for per-user isolation
    if let Some(ref token) = state.auth.lock().await.access_token {
        client.set_user_token(Some(token.clone())).await;
    }

    *state.cloud_client.lock().await = Some(client);

    tracing::info!(url = %normalized, "Connected to cloud orchestrator");
    Ok(())
}

/// Reconnect to the cloud orchestrator using credentials already stored in the
/// OS keyring.  Called automatically on app startup so users don't have to
/// re-enter their URL and API key every session.
#[tauri::command]
pub async fn cloud_reconnect_from_keyring(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    require_privileged(&state, "cloud_reconnect_from_keyring").await?;
    // Already connected — nothing to do
    if state.cloud_client.lock().await.is_some() {
        return Ok(());
    }

    let (url, api_key) = cloud::config::load_cloud_config()
        .ok_or_else(|| AppError::Cloud("No cloud credentials stored in keyring".into()))?;

    // Validate stored URL in case it was saved before URL validation was added
    validate_cloud_url(&url)?;

    let client = Arc::new(CloudClient::new(url.clone(), api_key));

    client.health().await.map_err(|e| {
        AppError::Cloud(format!("Cloud orchestrator is not reachable: {e}"))
    })?;

    // Push Supabase user token to the cloud client for per-user isolation
    if let Some(ref token) = state.auth.lock().await.access_token {
        client.set_user_token(Some(token.clone())).await;
    }

    *state.cloud_client.lock().await = Some(client);

    tracing::info!(url = %url, "Auto-reconnected to cloud orchestrator from keyring");
    Ok(())
}

/// Disconnect from the cloud orchestrator.
/// Cancels all active cloud polling loops, clears keyring credentials and
/// drops the in-memory client.
#[tauri::command]
pub async fn cloud_disconnect(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    require_privileged(&state, "cloud_disconnect").await?;
    // Cancel every in-flight cloud execution so polling loops stop immediately
    // and no further requests are sent to the endpoint.
    let active_ids: Vec<String> = state
        .cloud_exec_ids
        .lock()
        .await
        .keys()
        .cloned()
        .collect();

    for exec_id in &active_ids {
        state
            .engine
            .cancel_cloud_execution(exec_id, &state.db, None)
            .await;
    }
    state.cloud_exec_ids.lock().await.clear();

    cloud::config::clear_cloud_config();
    *state.cloud_client.lock().await = None;

    tracing::info!(
        cancelled_executions = active_ids.len(),
        "Disconnected from cloud orchestrator"
    );
    Ok(())
}

/// Return the current cloud connection configuration, if any.
#[tauri::command]
pub async fn cloud_get_config(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<CloudConfig>, AppError> {
    require_privileged(&state, "cloud_get_config").await?;
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
    require_privileged(&state, "cloud_status").await?;
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
    require_privileged(&state, "cloud_execute_persona").await?;
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
        None,
    );

    let exec = executions::create(&state.db, &persona_id, None, input_data.clone(), None, None)?;

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
    let exec_ids_map = state.cloud_exec_ids.clone();

    let handle = tokio::spawn(async move {
        let result = cloud::runner::run_cloud_execution(
            app_clone,
            client_clone,
            exec_id.clone(),
            cloud_exec_id,
            cancelled_clone.clone(),
        )
        .await;

        // Clean up the local→cloud execution ID mapping
        exec_ids_map.lock().await.remove(&exec_id);

        if !cancelled_clone.load(Ordering::Acquire) {
            let status = if result.success { crate::engine::types::ExecutionState::Completed } else { crate::engine::types::ExecutionState::Failed };
            let update = UpdateExecutionStatus {
                status,
                error_message: result.error,
                duration_ms: Some(result.duration_ms as i64),
                cost_usd: result.cost_usd,
                ..Default::default()
            };

            if let Err(e) = executions::update_status(&pool, &exec_id, update.clone()) {
                tracing::error!(
                    execution_id = %exec_id,
                    error = %e,
                    "Cloud execution DB status update failed, retrying in 1s",
                );
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                if let Err(e2) = executions::update_status(&pool, &exec_id, update) {
                    tracing::error!(
                        execution_id = %exec_id,
                        error = %e2,
                        "Cloud execution DB status update failed on retry — execution stuck as running",
                    );
                }
            }

            tracing::info!(
                execution_id = %exec_id,
                persona_id = %persona_id_clone,
                status = %status,
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
    require_privileged(&state, "cloud_cancel_execution").await?;
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
    require_privileged(&state, "cloud_oauth_authorize").await?;
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
    require_privileged(&state, "cloud_oauth_callback").await?;
    let client = get_cloud_client(&state).await?;
    client.oauth_callback(&code, &oauth_state).await
}

/// Check the current OAuth status with the cloud orchestrator.
#[tauri::command]
pub async fn cloud_oauth_status(
    state: State<'_, Arc<AppState>>,
) -> Result<cloud::client::CloudOAuthStatusResponse, AppError> {
    require_privileged(&state, "cloud_oauth_status").await?;
    let client = get_cloud_client(&state).await?;
    client.oauth_status().await
}

/// Refresh the OAuth token via the cloud orchestrator.
#[tauri::command]
pub async fn cloud_oauth_refresh(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_privileged(&state, "cloud_oauth_refresh").await?;
    let client = get_cloud_client(&state).await?;
    client.oauth_refresh().await
}

/// Disconnect OAuth credentials from the cloud orchestrator.
#[tauri::command]
pub async fn cloud_oauth_disconnect(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    require_privileged(&state, "cloud_oauth_disconnect").await?;
    let client = get_cloud_client(&state).await?;
    client.oauth_disconnect().await
}

// ---------------------------------------------------------------------------
// Cloud Deployment Commands
// ---------------------------------------------------------------------------

/// Deploy a persona as a managed cloud API endpoint.
/// Syncs the persona to the cloud orchestrator and creates a deployment.
#[tauri::command]
pub async fn cloud_deploy_persona(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<cloud::client::CloudDeployment, AppError> {
    require_privileged(&state, "cloud_deploy_persona").await?;
    let client = get_cloud_client(&state).await?;

    // Read the persona locally to use as label
    let persona = personas::get_by_id(&state.db, &persona_id)?;

    // First, sync the persona to the cloud orchestrator so it exists there
    let tools = tools::get_tools_for_persona(&state.db, &persona_id)?;
    let prompt = engine::prompt::assemble_prompt(&persona, &tools, None, None, None);

    // Upsert the persona on the cloud side
    let persona_body = serde_json::json!({
        "id": persona.id,
        "name": persona.name,
        "description": persona.description,
        "systemPrompt": prompt,
        "structuredPrompt": persona.structured_prompt,
        "enabled": true,
        "maxConcurrent": persona.max_concurrent,
        "timeoutMs": persona.timeout_ms,
        "modelProfile": persona.model_profile,
        "maxBudgetUsd": persona.max_budget_usd,
        "maxTurns": persona.max_turns,
    });

    client.upsert_persona(&persona_body).await?;

    // Now create the deployment
    let deployment = client
        .create_deployment(&persona_id, Some(&persona.name))
        .await?;

    tracing::info!(
        deployment_id = %deployment.id,
        slug = %deployment.slug,
        persona_id = %persona_id,
        "Persona deployed to cloud"
    );

    Ok(deployment)
}

/// List all cloud deployments.
#[tauri::command]
pub async fn cloud_list_deployments(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<cloud::client::CloudDeployment>, AppError> {
    require_privileged(&state, "cloud_list_deployments").await?;
    let client = get_cloud_client(&state).await?;
    client.list_deployments().await
}

/// Pause a cloud deployment (stops accepting incoming requests).
#[tauri::command]
pub async fn cloud_pause_deployment(
    state: State<'_, Arc<AppState>>,
    deployment_id: String,
) -> Result<cloud::client::CloudDeployment, AppError> {
    require_privileged(&state, "cloud_pause_deployment").await?;
    let client = get_cloud_client(&state).await?;
    client.pause_deployment(&deployment_id).await
}

/// Resume a paused cloud deployment.
#[tauri::command]
pub async fn cloud_resume_deployment(
    state: State<'_, Arc<AppState>>,
    deployment_id: String,
) -> Result<cloud::client::CloudDeployment, AppError> {
    require_privileged(&state, "cloud_resume_deployment").await?;
    let client = get_cloud_client(&state).await?;
    client.resume_deployment(&deployment_id).await
}

/// Remove a cloud deployment (undeploy).
#[tauri::command]
pub async fn cloud_undeploy(
    state: State<'_, Arc<AppState>>,
    deployment_id: String,
) -> Result<(), AppError> {
    require_privileged(&state, "cloud_undeploy").await?;
    let client = get_cloud_client(&state).await?;
    client.delete_deployment(&deployment_id).await?;
    tracing::info!(deployment_id = %deployment_id, "Cloud deployment removed");
    Ok(())
}

/// Get the cloud orchestrator base URL (for building endpoint URLs in the UI).
#[tauri::command]
pub async fn cloud_get_base_url(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>, AppError> {
    require_privileged(&state, "cloud_get_base_url").await?;
    let client_guard = state.cloud_client.lock().await;
    Ok(client_guard.as_ref().map(|c| c.base_url().to_string()))
}
