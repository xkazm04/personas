use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde::Serialize;
use tauri::{Emitter, State};
use crate::engine::event_registry::event_name;
use crate::engine::background::ZombieExecutionEvent;
use ts_rs::TS;
use url::Url;

use crate::cloud;
use crate::cloud::client::CloudClient;
use crate::db::models::{UpdateExecutionStatus, CreateSmeeRelayInput, UpdateSmeeRelayInput, SmeeRelay};
use crate::db::repos::core::personas;
use crate::db::repos::execution::executions;
use crate::db::repos::resources::tools;
use crate::db::repos::communication::smee_relays as smee_relay_repo;
use crate::engine;
use crate::error::AppError;
use crate::ipc_auth::require_cloud_auth;
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

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticStep {
    pub label: String,
    pub passed: bool,
    pub detail: String,
    /// Duration of this check in milliseconds.
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CloudDiagnostics {
    pub steps: Vec<DiagnosticStep>,
    /// Overall response time for the full diagnostic sequence in milliseconds.
    pub total_duration_ms: u64,
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

/// RAII guard that clears `cloud_connecting` on drop, ensuring the flag is
/// reset on all exit paths (success, early return, or error).
struct ConnectingGuard(Arc<AtomicBool>);
impl Drop for ConnectingGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
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
/// Returns the health-check round-trip latency in milliseconds.
#[tauri::command]
pub async fn cloud_connect(
    state: State<'_, Arc<AppState>>,
    url: String,
    api_key: String,
) -> Result<u64, AppError> {
    require_cloud_auth(&state, "cloud_connect").await?;

    // Reject concurrent connect attempts. The health check can take up to 30s
    // and without this guard two calls could race through health, keyring write,
    // and mutex set — potentially interleaving URL from one call with the API
    // key from another.
    if state.cloud_connecting.compare_exchange(
        false, true, Ordering::SeqCst, Ordering::SeqCst,
    ).is_err() {
        return Err(AppError::Cloud(
            "A cloud connection attempt is already in progress".into(),
        ));
    }
    // Ensure the flag is cleared on all exit paths (success or error).
    let _guard = ConnectingGuard(Arc::clone(&state.cloud_connecting));

    if url.trim().is_empty() {
        return Err(AppError::Cloud("Cloud orchestrator URL must not be empty".into()));
    }
    if api_key.trim().is_empty() {
        return Err(AppError::Cloud("API key must not be empty".into()));
    }

    let parsed = validate_cloud_url(url.trim())?;
    let normalized = parsed.as_str().trim_end_matches('/').to_string();

    let client = Arc::new(CloudClient::new(normalized.clone(), api_key.clone())?);

    // Verify the orchestrator is actually reachable before storing credentials
    // and measure round-trip latency of the health check.
    let health_start = Instant::now();
    client.health().await.map_err(|e| {
        AppError::Cloud(format!("Cloud orchestrator is not reachable: {e}"))
    })?;
    let latency_ms = health_start.elapsed().as_millis() as u64;

    // Only persist credentials after we've confirmed the connection works
    cloud::config::store_cloud_config(&normalized, &api_key)
        .map_err(|e| AppError::Cloud(format!("Failed to store cloud config: {e}")))?;

    // Push Supabase user token to the cloud client for per-user isolation
    if let Some(ref token) = state.auth.lock().await.access_token {
        client.set_user_token(Some(token.expose_secret().to_string())).await;
    }

    *state.cloud_client.lock().await = Some(client);

    tracing::info!(url = %normalized, latency_ms, "Connected to cloud orchestrator");
    Ok(latency_ms)
}

/// Reconnect to the cloud orchestrator using credentials already stored in the
/// OS keyring.  Called automatically on app startup so users don't have to
/// re-enter their URL and API key every session.
/// Returns the health-check round-trip latency in milliseconds.
#[tauri::command]
pub async fn cloud_reconnect_from_keyring(
    state: State<'_, Arc<AppState>>,
) -> Result<u64, AppError> {
    require_cloud_auth(&state, "cloud_reconnect_from_keyring").await?;
    // Already connected -- nothing to do
    if state.cloud_client.lock().await.is_some() {
        return Ok(0);
    }

    // Reject concurrent reconnect attempts (same guard as cloud_connect).
    if state.cloud_connecting.compare_exchange(
        false, true, Ordering::SeqCst, Ordering::SeqCst,
    ).is_err() {
        return Err(AppError::Cloud(
            "A cloud connection attempt is already in progress".into(),
        ));
    }
    let _guard = ConnectingGuard(Arc::clone(&state.cloud_connecting));

    // Re-check after acquiring the flag — another call may have connected
    // while we were waiting for the compare_exchange.
    if state.cloud_client.lock().await.is_some() {
        return Ok(0);
    }

    let (url, api_key) = cloud::config::load_cloud_config()
        .ok_or_else(|| AppError::Cloud("No cloud credentials stored in keyring".into()))?;

    // Validate stored URL in case it was saved before URL validation was added
    validate_cloud_url(&url)?;

    let client = Arc::new(CloudClient::new(url.clone(), api_key)?);

    let health_start = Instant::now();
    client.health().await.map_err(|e| {
        AppError::Cloud(format!("Cloud orchestrator is not reachable: {e}"))
    })?;
    let latency_ms = health_start.elapsed().as_millis() as u64;

    // Push Supabase user token to the cloud client for per-user isolation
    if let Some(ref token) = state.auth.lock().await.access_token {
        client.set_user_token(Some(token.expose_secret().to_string())).await;
    }

    *state.cloud_client.lock().await = Some(client);

    tracing::info!(url = %url, latency_ms, "Auto-reconnected to cloud orchestrator from keyring");
    Ok(latency_ms)
}

/// Disconnect from the cloud orchestrator.
/// Cancels all active cloud polling loops, clears keyring credentials and
/// drops the in-memory client.
#[tauri::command]
pub async fn cloud_disconnect(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    require_cloud_auth(&state, "cloud_disconnect").await?;
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
    require_cloud_auth(&state, "cloud_get_config").await?;
    let is_connected = state.cloud_client.lock().await.is_some();

    match cloud::config::load_cloud_config() {
        Some((url, _)) => Ok(Some(CloudConfig { url, is_connected })),
        None => Ok(None),
    }
}

/// Run step-by-step connection diagnostics against a cloud orchestrator URL.
///
/// Performs granular checks (DNS, TCP, TLS, HTTP, API compatibility) and
/// returns per-step pass/fail results so the UI can render a checklist.
#[tauri::command]
pub async fn cloud_diagnose(
    state: State<'_, Arc<AppState>>,
    url: String,
    api_key: String,
) -> Result<CloudDiagnostics, AppError> {
    require_cloud_auth(&state, "cloud_diagnose").await?;
    let overall_start = Instant::now();
    let mut steps: Vec<DiagnosticStep> = Vec::new();

    // -- Step 1: URL validation --
    let step_start = Instant::now();
    let parsed = match validate_cloud_url(url.trim()) {
        Ok(p) => {
            steps.push(DiagnosticStep {
                label: "URL format".into(),
                passed: true,
                detail: format!("Valid URL: {}", p.as_str().trim_end_matches('/')),
                duration_ms: step_start.elapsed().as_millis() as u64,
            });
            Some(p)
        }
        Err(e) => {
            steps.push(DiagnosticStep {
                label: "URL format".into(),
                passed: false,
                detail: format!("{e}"),
                duration_ms: step_start.elapsed().as_millis() as u64,
            });
            None
        }
    };

    let parsed = match parsed {
        Some(p) => p,
        None => {
            return Ok(CloudDiagnostics {
                steps,
                total_duration_ms: overall_start.elapsed().as_millis() as u64,
            });
        }
    };

    // -- Step 2: DNS resolution --
    let host_str = parsed.host_str().unwrap_or("");
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addr_target = format!("{}:{}", host_str, port);

    let step_start = Instant::now();
    let resolved = match tokio::net::lookup_host(&addr_target).await {
        Ok(mut addrs) => {
            let first = addrs.next();
            let detail = match &first {
                Some(a) => format!("Resolved to {a}"),
                None => "Resolved but no addresses returned".into(),
            };
            steps.push(DiagnosticStep {
                label: "DNS resolution".into(),
                passed: first.is_some(),
                detail,
                duration_ms: step_start.elapsed().as_millis() as u64,
            });
            first.is_some()
        }
        Err(e) => {
            steps.push(DiagnosticStep {
                label: "DNS resolution".into(),
                passed: false,
                detail: format!("Failed to resolve {host_str}: {e}"),
                duration_ms: step_start.elapsed().as_millis() as u64,
            });
            false
        }
    };

    if !resolved {
        return Ok(CloudDiagnostics {
            steps,
            total_duration_ms: overall_start.elapsed().as_millis() as u64,
        });
    }

    // -- Step 3: TLS handshake (skipped for HTTP/localhost) --
    let is_https = parsed.scheme() == "https";
    if is_https {
        let step_start = Instant::now();
        let tls_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .ok();

        let tls_ok = if let Some(c) = &tls_client {
            match c.head(parsed.as_str()).send().await {
                Ok(_) => {
                    steps.push(DiagnosticStep {
                        label: "TLS handshake".into(),
                        passed: true,
                        detail: "Secure connection established".into(),
                        duration_ms: step_start.elapsed().as_millis() as u64,
                    });
                    true
                }
                Err(e) => {
                    let is_tls = e.to_string().to_lowercase().contains("tls")
                        || e.to_string().to_lowercase().contains("ssl")
                        || e.to_string().to_lowercase().contains("certificate");
                    if is_tls {
                        steps.push(DiagnosticStep {
                            label: "TLS handshake".into(),
                            passed: false,
                            detail: format!("TLS error: {e}"),
                            duration_ms: step_start.elapsed().as_millis() as u64,
                        });
                        false
                    } else {
                        // Connection error but not TLS-specific -- TLS step is OK
                        steps.push(DiagnosticStep {
                            label: "TLS handshake".into(),
                            passed: true,
                            detail: "TLS layer OK (connection error is non-TLS)".into(),
                            duration_ms: step_start.elapsed().as_millis() as u64,
                        });
                        true
                    }
                }
            }
        } else {
            steps.push(DiagnosticStep {
                label: "TLS handshake".into(),
                passed: false,
                detail: "Failed to build HTTP client".into(),
                duration_ms: step_start.elapsed().as_millis() as u64,
            });
            false
        };

        if !tls_ok {
            return Ok(CloudDiagnostics {
                steps,
                total_duration_ms: overall_start.elapsed().as_millis() as u64,
            });
        }
    } else {
        steps.push(DiagnosticStep {
            label: "TLS handshake".into(),
            passed: true,
            detail: "Skipped (HTTP/localhost)".into(),
            duration_ms: 0,
        });
    }

    // -- Step 4: HTTP response --
    let normalized = parsed.as_str().trim_end_matches('/').to_string();
    let step_start = Instant::now();
    let health_url = format!("{normalized}/health");
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build HTTP client: {e}")))?;

    let http_result = http_client
        .get(&health_url)
        .bearer_auth(&api_key)
        .send()
        .await;

    match &http_result {
        Ok(resp) => {
            let status_code = resp.status().as_u16();
            let passed = resp.status().is_success();
            steps.push(DiagnosticStep {
                label: "HTTP response".into(),
                passed,
                detail: format!("HTTP {status_code} from /health"),
                duration_ms: step_start.elapsed().as_millis() as u64,
            });
        }
        Err(e) => {
            let detail = if e.is_timeout() {
                "Request timed out after 15s".into()
            } else if e.is_connect() {
                format!("Connection refused or reset: {e}")
            } else {
                format!("Request failed: {e}")
            };
            steps.push(DiagnosticStep {
                label: "HTTP response".into(),
                passed: false,
                detail,
                duration_ms: step_start.elapsed().as_millis() as u64,
            });

            return Ok(CloudDiagnostics {
                steps,
                total_duration_ms: overall_start.elapsed().as_millis() as u64,
            });
        }
    };

    // -- Step 5: API compatibility --
    let step_start = Instant::now();
    if let Ok(resp) = http_result {
        if resp.status().is_success() {
            match resp.json::<serde_json::Value>().await {
                Ok(body) => {
                    let has_status = body.get("status").is_some();
                    steps.push(DiagnosticStep {
                        label: "API compatibility".into(),
                        passed: has_status,
                        detail: if has_status {
                            format!(
                                "Health endpoint returned valid response (status: {})",
                                body["status"].as_str().unwrap_or("unknown")
                            )
                        } else {
                            "Health endpoint responded but missing expected 'status' field".into()
                        },
                        duration_ms: step_start.elapsed().as_millis() as u64,
                    });
                }
                Err(e) => {
                    steps.push(DiagnosticStep {
                        label: "API compatibility".into(),
                        passed: false,
                        detail: format!("Response is not valid JSON: {e}"),
                        duration_ms: step_start.elapsed().as_millis() as u64,
                    });
                }
            }
        } else {
            let status_code = resp.status().as_u16();
            let detail = match status_code {
                401 => "Authentication failed -- check your API key".into(),
                403 => "Access forbidden -- your API key may lack permissions".into(),
                404 => "Health endpoint not found -- is this the correct URL?".into(),
                _ => format!("Server returned HTTP {status_code}"),
            };
            steps.push(DiagnosticStep {
                label: "API compatibility".into(),
                passed: false,
                detail,
                duration_ms: step_start.elapsed().as_millis() as u64,
            });
        }
    }

    Ok(CloudDiagnostics {
        steps,
        total_duration_ms: overall_start.elapsed().as_millis() as u64,
    })
}

/// Query the cloud orchestrator's current status.
#[tauri::command]
pub async fn cloud_status(
    state: State<'_, Arc<AppState>>,
) -> Result<cloud::client::CloudStatusResponse, AppError> {
    require_cloud_auth(&state, "cloud_status").await?;
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
    require_cloud_auth(&state, "cloud_execute_persona").await?;
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
        #[cfg(feature = "desktop")] None,
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
    let app_for_emit = app.clone();
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

        if !cancelled_clone.load(Ordering::Acquire) {
            let status = if result.success { crate::engine::types::ExecutionState::Completed } else { crate::engine::types::ExecutionState::Failed };
            let update = UpdateExecutionStatus {
                status,
                error_message: result.error,
                duration_ms: Some(result.duration_ms as i64),
                cost_usd: result.cost_usd,
                ..Default::default()
            };

            // Exponential backoff: up to 3 retries (1s, 2s, 4s) before giving up.
            let mut persisted = false;
            let backoff_secs = [0u64, 1, 2, 4]; // first attempt is immediate
            for (attempt, &delay) in backoff_secs.iter().enumerate() {
                if delay > 0 {
                    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                }
                match executions::update_status(&pool, &exec_id, update.clone()) {
                    Ok(_) => {
                        if attempt > 0 {
                            tracing::info!(
                                execution_id = %exec_id,
                                attempt,
                                "Cloud execution DB status update succeeded on retry",
                            );
                        }
                        persisted = true;
                        break;
                    }
                    Err(e) => {
                        tracing::error!(
                            execution_id = %exec_id,
                            attempt,
                            error = %e,
                            "Cloud execution DB status update failed",
                        );
                    }
                }
            }

            if !persisted {
                tracing::error!(
                    execution_id = %exec_id,
                    "Cloud execution DB update exhausted all retries — execution stuck as running. \
                     Zombie sweep will recover it.",
                );
                // Notify frontend immediately so user doesn't wait for the
                // periodic zombie sweep (up to 30 min) to discover the issue.
                let _ = app_for_emit.emit(event_name::ZOMBIE_EXECUTIONS_DETECTED, ZombieExecutionEvent {
                    zombie_ids: vec![exec_id.clone()],
                    count: 1,
                });
            }

            tracing::info!(
                execution_id = %exec_id,
                persona_id = %persona_id_clone,
                status = %status,
                duration_ms = result.duration_ms,
                "Cloud execution finished"
            );
        }

        // Clean up the local->cloud execution ID mapping AFTER DB persist,
        // so cancellation remains possible during retry windows.
        exec_ids_map.lock().await.remove(&exec_id);
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
    require_cloud_auth(&state, "cloud_cancel_execution").await?;
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
    require_cloud_auth(&state, "cloud_oauth_authorize").await?;
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
    require_cloud_auth(&state, "cloud_oauth_callback").await?;
    let client = get_cloud_client(&state).await?;
    client.oauth_callback(&code, &oauth_state).await
}

/// Check the current OAuth status with the cloud orchestrator.
#[tauri::command]
pub async fn cloud_oauth_status(
    state: State<'_, Arc<AppState>>,
) -> Result<cloud::client::CloudOAuthStatusResponse, AppError> {
    require_cloud_auth(&state, "cloud_oauth_status").await?;
    let client = get_cloud_client(&state).await?;
    client.oauth_status().await
}

/// Refresh the OAuth token via the cloud orchestrator.
#[tauri::command]
pub async fn cloud_oauth_refresh(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_cloud_auth(&state, "cloud_oauth_refresh").await?;
    let client = get_cloud_client(&state).await?;
    client.oauth_refresh().await
}

/// Disconnect OAuth credentials from the cloud orchestrator.
#[tauri::command]
pub async fn cloud_oauth_disconnect(
    state: State<'_, Arc<AppState>>,
) -> Result<(), AppError> {
    require_cloud_auth(&state, "cloud_oauth_disconnect").await?;
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
    max_monthly_budget_usd: Option<f64>,
) -> Result<cloud::client::CloudDeployment, AppError> {
    require_cloud_auth(&state, "cloud_deploy_persona").await?;
    let client = get_cloud_client(&state).await?;

    // Read the persona locally to use as label
    let persona = personas::get_by_id(&state.db, &persona_id)?;

    // First, sync the persona to the cloud orchestrator so it exists there
    let tools = tools::get_tools_for_persona(&state.db, &persona_id)?;
    let prompt = engine::prompt::assemble_prompt(&persona, &tools, None, None, None, #[cfg(feature = "desktop")] None);

    // Upsert the persona on the cloud side
    let persona_body = serde_json::json!({
        "id": persona.id,
        "name": persona.name,
        "description": persona.description,
        "systemPrompt": prompt,
        "structuredPrompt": persona.structured_prompt,
        "icon": persona.icon,
        "color": persona.color,
        "enabled": true,
        "maxConcurrent": persona.max_concurrent,
        "timeoutMs": persona.timeout_ms,
        "modelProfile": persona.model_profile,
        "maxBudgetUsd": persona.max_budget_usd,
        "maxTurns": persona.max_turns,
        "designContext": persona.design_context,
        "groupId": persona.group_id,
    });

    client.upsert_persona(&persona_body).await?;

    // Now create the deployment
    let deployment = client
        .create_deployment(&persona_id, Some(&persona.name), max_monthly_budget_usd)
        .await?;

    tracing::info!(
        deployment_id = %deployment.id,
        slug = %deployment.slug,
        persona_id = %persona_id,
        "Persona deployed to cloud"
    );

    Ok(deployment)
}

/// Sync a persona's current local state to the cloud orchestrator.
/// This re-upserts the persona so that any active deployment reflects local edits
/// (system prompt, tools, timeout, model profile, etc.).
#[tauri::command]
pub async fn cloud_sync_persona(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<(), AppError> {
    require_cloud_auth(&state, "cloud_sync_persona").await?;
    let client = get_cloud_client(&state).await?;

    let persona = personas::get_by_id(&state.db, &persona_id)?;
    let tools_list = tools::get_tools_for_persona(&state.db, &persona_id)?;
    let prompt = engine::prompt::assemble_prompt(&persona, &tools_list, None, None, None, #[cfg(feature = "desktop")] None);

    let persona_body = serde_json::json!({
        "id": persona.id,
        "name": persona.name,
        "description": persona.description,
        "systemPrompt": prompt,
        "structuredPrompt": persona.structured_prompt,
        "icon": persona.icon,
        "color": persona.color,
        "enabled": true,
        "maxConcurrent": persona.max_concurrent,
        "timeoutMs": persona.timeout_ms,
        "modelProfile": persona.model_profile,
        "maxBudgetUsd": persona.max_budget_usd,
        "maxTurns": persona.max_turns,
        "designContext": persona.design_context,
        "groupId": persona.group_id,
    });

    client.upsert_persona(&persona_body).await?;

    tracing::info!(persona_id = %persona_id, "Persona synced to cloud");
    Ok(())
}

/// List all cloud deployments.
#[tauri::command]
pub async fn cloud_list_deployments(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<cloud::client::CloudDeployment>, AppError> {
    require_cloud_auth(&state, "cloud_list_deployments").await?;
    let client = get_cloud_client(&state).await?;
    client.list_deployments().await
}

/// Pause a cloud deployment (stops accepting incoming requests).
#[tauri::command]
pub async fn cloud_pause_deployment(
    state: State<'_, Arc<AppState>>,
    deployment_id: String,
) -> Result<cloud::client::CloudDeployment, AppError> {
    require_cloud_auth(&state, "cloud_pause_deployment").await?;
    let client = get_cloud_client(&state).await?;
    client.pause_deployment(&deployment_id).await
}

/// Resume a paused cloud deployment.
#[tauri::command]
pub async fn cloud_resume_deployment(
    state: State<'_, Arc<AppState>>,
    deployment_id: String,
) -> Result<cloud::client::CloudDeployment, AppError> {
    require_cloud_auth(&state, "cloud_resume_deployment").await?;
    let client = get_cloud_client(&state).await?;
    client.resume_deployment(&deployment_id).await
}

/// Remove a cloud deployment (undeploy).
#[tauri::command]
pub async fn cloud_undeploy(
    state: State<'_, Arc<AppState>>,
    deployment_id: String,
) -> Result<(), AppError> {
    require_cloud_auth(&state, "cloud_undeploy").await?;
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
    require_cloud_auth(&state, "cloud_get_base_url").await?;
    let client_guard = state.cloud_client.lock().await;
    Ok(client_guard.as_ref().map(|c| c.base_url().to_string()))
}

// ---------------------------------------------------------------------------
// Cloud Reviews (human-in-the-loop)
// ---------------------------------------------------------------------------

/// List pending cloud review requests.
#[tauri::command]
pub async fn cloud_list_pending_reviews(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<cloud::client::CloudReviewRequest>, AppError> {
    require_cloud_auth(&state, "cloud_list_pending_reviews").await?;
    let client = get_cloud_client(&state).await?;
    client.list_pending_reviews().await
}

/// Respond to a cloud review request (approve/reject).
#[tauri::command]
pub async fn cloud_respond_to_review(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
    review_id: String,
    decision: String,
    message: String,
) -> Result<serde_json::Value, AppError> {
    require_cloud_auth(&state, "cloud_respond_to_review").await?;
    let client = get_cloud_client(&state).await?;
    client.respond_to_review(&execution_id, &review_id, &decision, &message).await
}

// ---------------------------------------------------------------------------
// Execution History & Stats
// ---------------------------------------------------------------------------

/// List cloud execution history with optional filters.
#[tauri::command]
pub async fn cloud_list_executions(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    status: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<cloud::client::CloudExecution>, AppError> {
    require_cloud_auth(&state, "cloud_list_executions").await?;
    let client = get_cloud_client(&state).await?;
    client
        .list_executions(
            persona_id.as_deref(),
            status.as_deref(),
            limit,
            offset,
        )
        .await
}

/// Get aggregated execution statistics.
#[tauri::command]
pub async fn cloud_execution_stats(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
    period_days: Option<u32>,
) -> Result<cloud::client::CloudExecutionStats, AppError> {
    require_cloud_auth(&state, "cloud_execution_stats").await?;
    let client = get_cloud_client(&state).await?;
    client
        .execution_stats(persona_id.as_deref(), period_days)
        .await
}

/// Fetch the output lines for a completed (or in-progress) cloud execution.
///
/// Calls `poll_execution` with offset 0 to retrieve all available output from
/// the cloud tail buffer.
#[tauri::command]
pub async fn cloud_get_execution_output(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
) -> Result<Vec<String>, AppError> {
    require_cloud_auth(&state, "cloud_get_execution_output").await?;
    let client = get_cloud_client(&state).await?;
    let poll = client.poll_execution(&execution_id, 0).await?;
    Ok(poll.output)
}

// ---------------------------------------------------------------------------
// Cloud Triggers (schedules, webhooks, etc.)
// ---------------------------------------------------------------------------

/// List triggers for a cloud-deployed persona.
#[tauri::command]
pub async fn cloud_list_triggers(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<cloud::client::CloudTrigger>, AppError> {
    require_cloud_auth(&state, "cloud_list_triggers").await?;
    let client = get_cloud_client(&state).await?;
    client.list_persona_triggers(&persona_id).await
}

/// Create a cloud trigger.
#[tauri::command]
pub async fn cloud_create_trigger(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    trigger_type: String,
    config: Option<String>,
    enabled: Option<bool>,
    use_case_id: Option<String>,
) -> Result<cloud::client::CloudTrigger, AppError> {
    require_cloud_auth(&state, "cloud_create_trigger").await?;
    let client = get_cloud_client(&state).await?;
    let body = cloud::client::CreateCloudTriggerBody {
        persona_id,
        trigger_type,
        config,
        enabled,
        use_case_id,
    };
    client.create_trigger(&body).await
}

/// Update a cloud trigger.
#[tauri::command]
pub async fn cloud_update_trigger(
    state: State<'_, Arc<AppState>>,
    trigger_id: String,
    trigger_type: Option<String>,
    config: Option<String>,
    enabled: Option<bool>,
) -> Result<cloud::client::CloudTrigger, AppError> {
    require_cloud_auth(&state, "cloud_update_trigger").await?;
    let client = get_cloud_client(&state).await?;
    let body = cloud::client::UpdateCloudTriggerBody {
        trigger_type,
        config,
        enabled,
    };
    client.update_trigger(&trigger_id, &body).await
}

/// Delete a cloud trigger.
#[tauri::command]
pub async fn cloud_delete_trigger(
    state: State<'_, Arc<AppState>>,
    trigger_id: String,
) -> Result<(), AppError> {
    require_cloud_auth(&state, "cloud_delete_trigger").await?;
    let client = get_cloud_client(&state).await?;
    client.delete_trigger(&trigger_id).await
}

/// Get the current cloud webhook relay status.
#[tauri::command]
pub async fn cloud_webhook_relay_status(
    state: State<'_, Arc<AppState>>,
) -> Result<engine::cloud_webhook_relay::CloudWebhookRelayStatus, AppError> {
    require_cloud_auth(&state, "cloud_webhook_relay_status").await?;
    let connected = state.cloud_client.lock().await.is_some();
    let relay = state.cloud_webhook_relay_state.lock().await;
    Ok(engine::cloud_webhook_relay::CloudWebhookRelayStatus {
        connected,
        last_poll_at: relay.last_poll_at.clone(),
        active_webhook_triggers: relay.active_webhook_triggers,
        total_relayed: relay.total_relayed,
        error: relay.last_error.clone().or_else(|| {
            if !connected { Some("Not connected to cloud orchestrator".into()) } else { None }
        }),
    })
}

/// List recent firings for a cloud trigger.
#[tauri::command]
pub async fn cloud_list_trigger_firings(
    state: State<'_, Arc<AppState>>,
    trigger_id: String,
    limit: Option<u32>,
) -> Result<Vec<cloud::client::CloudTriggerFiring>, AppError> {
    require_cloud_auth(&state, "cloud_list_trigger_firings").await?;
    let client = get_cloud_client(&state).await?;
    client.list_trigger_firings(&trigger_id, limit).await
}

// ---------------------------------------------------------------------------
// Smee Relay CRUD
// ---------------------------------------------------------------------------

/// List all configured Smee relays.
#[tauri::command]
pub async fn smee_relay_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SmeeRelay>, AppError> {
    require_cloud_auth(&state, "smee_relay_list").await?;
    smee_relay_repo::list(&state.db)
}

/// Create a new Smee relay.
#[tauri::command]
pub async fn smee_relay_create(
    state: State<'_, Arc<AppState>>,
    input: CreateSmeeRelayInput,
) -> Result<SmeeRelay, AppError> {
    require_cloud_auth(&state, "smee_relay_create").await?;
    // Validate URL
    let stripped = input.channel_url.strip_prefix("https://smee.io/")
        .ok_or_else(|| AppError::Validation("Smee URL must be https://smee.io/<channel>".into()))?;
    if stripped.is_empty() || stripped.contains('/') {
        return Err(AppError::Validation("Smee URL must be https://smee.io/<channel>".into()));
    }
    let relay = smee_relay_repo::create(&state.db, input)?;
    state.smee_relay_notifier.notify();
    Ok(relay)
}

/// Update an existing Smee relay.
#[tauri::command]
pub async fn smee_relay_update(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateSmeeRelayInput,
) -> Result<SmeeRelay, AppError> {
    require_cloud_auth(&state, "smee_relay_update").await?;
    let relay = smee_relay_repo::update(&state.db, &id, input)?;
    state.smee_relay_notifier.notify();
    Ok(relay)
}

/// Set the status of a Smee relay (active/paused).
#[tauri::command]
pub async fn smee_relay_set_status(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: String,
) -> Result<SmeeRelay, AppError> {
    require_cloud_auth(&state, "smee_relay_set_status").await?;
    if !["active", "paused"].contains(&status.as_str()) {
        return Err(AppError::Validation("Status must be 'active' or 'paused'".into()));
    }
    let relay = smee_relay_repo::set_status(&state.db, &id, &status)?;
    state.smee_relay_notifier.notify();
    Ok(relay)
}

/// Delete a Smee relay.
#[tauri::command]
pub async fn smee_relay_delete(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_cloud_auth(&state, "smee_relay_delete").await?;
    smee_relay_repo::delete(&state.db, &id)?;
    state.smee_relay_notifier.notify();
    Ok(())
}
