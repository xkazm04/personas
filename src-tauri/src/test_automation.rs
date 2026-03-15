//! Test Automation HTTP Server
//!
//! Feature-gated behind `test-automation`. Starts a lightweight HTTP server on
//! `127.0.0.1:17320` that bridges external test drivers (MCP servers, scripts)
//! to the running Tauri WebView via JavaScript evaluation.
//!
//! Architecture:
//!   MCP Server ──HTTP──▶ this module ──eval()──▶ WebView bridge (window.__TEST__)
//!                                     ◀──invoke──┘ (result via __test_respond command)

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State as AxumState;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tokio::sync::{oneshot, Mutex};

/// Map of request ID → oneshot sender, used to route JS bridge responses
/// back to the correct HTTP handler.
pub type PendingResponses = Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>;

#[derive(Clone)]
struct ServerState {
    app_handle: AppHandle,
    pending: PendingResponses,
}

// ── Tauri command (called from JS bridge to deliver results) ────────────────

#[tauri::command]
pub async fn __test_respond(
    id: String,
    result: String,
    pending: tauri::State<'_, PendingResponses>,
) -> Result<(), String> {
    let mut map = pending.lock().await;
    if let Some(sender) = map.remove(&id) {
        let _ = sender.send(result);
    }
    Ok(())
}

// ── HTTP request/response types ─────────────────────────────────────────────

#[derive(Deserialize)]
struct NavigateRequest {
    section: String,
}

#[derive(Deserialize)]
struct ClickRequest {
    selector: String,
}

#[derive(Deserialize)]
struct TypeRequest {
    selector: String,
    text: String,
}

#[derive(Deserialize)]
struct QueryRequest {
    selector: String,
}

#[derive(Deserialize)]
struct FindTextRequest {
    text: String,
}

#[derive(Deserialize)]
struct WaitRequest {
    selector: String,
    #[serde(default = "default_timeout")]
    timeout_ms: u64,
}

fn default_timeout() -> u64 {
    5000
}

#[derive(Deserialize)]
struct EvalRequest {
    js: String,
}

// ── Core eval + response machinery ──────────────────────────────────────────

async fn eval_bridge_method(
    state: &ServerState,
    method: &str,
    params: &serde_json::Value,
) -> Result<String, (StatusCode, String)> {
    let id = uuid::Uuid::new_v4().to_string();

    // Create oneshot channel for the response
    let (tx, rx) = oneshot::channel::<String>();
    {
        let mut map = state.pending.lock().await;
        map.insert(id.clone(), tx);
    }

    // Build JS to call the bridge's __exec__ dispatcher
    let params_json = serde_json::to_string(params).unwrap_or_else(|_| "{}".to_string());
    let js = format!(
        r#"window.__TEST__.__exec__("{id}", "{method}", {params_json});"#,
    );

    // Evaluate JS in the WebView
    let webview = state
        .app_handle
        .get_webview_window("main")
        .ok_or_else(|| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "WebView window 'main' not found".to_string(),
            )
        })?;

    webview.eval(&js).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to eval JS: {e}"),
        )
    })?;

    // Wait for the JS bridge to respond via __test_respond
    match tokio::time::timeout(Duration::from_secs(15), rx).await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(_)) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Response channel dropped".to_string(),
        )),
        Err(_) => {
            // Clean up the pending entry on timeout
            let mut map = state.pending.lock().await;
            map.remove(&id);
            Err((
                StatusCode::GATEWAY_TIMEOUT,
                "Bridge response timeout (15s)".to_string(),
            ))
        }
    }
}

// ── HTTP handlers ───────────────────────────────────────────────────────────

async fn handle_navigate(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<NavigateRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "section": req.section });
    eval_bridge_method(&state, "navigate", &params).await
}

async fn handle_click(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<ClickRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "selector": req.selector });
    eval_bridge_method(&state, "click", &params).await
}

async fn handle_type(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<TypeRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "selector": req.selector, "text": req.text });
    eval_bridge_method(&state, "typeText", &params).await
}

async fn handle_query(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<QueryRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "selector": req.selector });
    eval_bridge_method(&state, "query", &params).await
}

async fn handle_find_text(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<FindTextRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "text": req.text });
    eval_bridge_method(&state, "findText", &params).await
}

async fn handle_state(
    AxumState(state): AxumState<ServerState>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({});
    eval_bridge_method(&state, "getState", &params).await
}

async fn handle_wait(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<WaitRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "selector": req.selector, "timeoutMs": req.timeout_ms });
    eval_bridge_method(&state, "waitFor", &params).await
}

async fn handle_list_interactive(
    AxumState(state): AxumState<ServerState>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({});
    eval_bridge_method(&state, "listInteractive", &params).await
}

async fn handle_eval(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<EvalRequest>,
) -> Result<String, (StatusCode, String)> {
    let webview = state
        .app_handle
        .get_webview_window("main")
        .ok_or_else(|| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "WebView window 'main' not found".to_string(),
            )
        })?;

    webview.eval(&req.js).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to eval JS: {e}"),
        )
    })?;

    Ok(r#"{"success": true}"#.to_string())
}

// ── Workflow macro handlers ──────────────────────────────────────────────────

#[derive(Deserialize)]
struct SelectAgentRequest {
    name_or_id: String,
}

#[derive(Deserialize)]
struct EditorTabRequest {
    tab: String,
}

#[derive(Deserialize)]
struct FillFieldRequest {
    test_id: String,
    value: String,
}

#[derive(Deserialize)]
struct ClickTestIdRequest {
    test_id: String,
}

#[derive(Deserialize)]
struct SearchAgentsRequest {
    query: String,
}

#[derive(Deserialize)]
struct SettingsTabRequest {
    tab: String,
}

#[derive(Deserialize)]
struct WaitToastRequest {
    text: String,
    #[serde(default = "default_timeout")]
    timeout_ms: u64,
}

async fn handle_select_agent(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<SelectAgentRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "nameOrId": req.name_or_id });
    eval_bridge_method(&state, "selectAgent", &params).await
}

async fn handle_open_editor_tab(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<EditorTabRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "tab": req.tab });
    eval_bridge_method(&state, "openEditorTab", &params).await
}

async fn handle_start_create_agent(
    AxumState(state): AxumState<ServerState>,
) -> Result<String, (StatusCode, String)> {
    eval_bridge_method(&state, "startCreateAgent", &serde_json::json!({})).await
}

async fn handle_snapshot(
    AxumState(state): AxumState<ServerState>,
) -> Result<String, (StatusCode, String)> {
    eval_bridge_method(&state, "getSnapshot", &serde_json::json!({})).await
}

async fn handle_agent_cards(
    AxumState(state): AxumState<ServerState>,
) -> Result<String, (StatusCode, String)> {
    eval_bridge_method(&state, "getAgentCards", &serde_json::json!({})).await
}

async fn handle_fill_field(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<FillFieldRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "testId": req.test_id, "value": req.value });
    eval_bridge_method(&state, "fillField", &params).await
}

async fn handle_click_testid(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<ClickTestIdRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "testId": req.test_id });
    eval_bridge_method(&state, "clickTestId", &params).await
}

async fn handle_search_agents(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<SearchAgentsRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "query": req.query });
    eval_bridge_method(&state, "searchAgents", &params).await
}

async fn handle_open_settings_tab(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<SettingsTabRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "tab": req.tab });
    eval_bridge_method(&state, "openSettingsTab", &params).await
}

async fn handle_wait_toast(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<WaitToastRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "text": req.text, "timeoutMs": req.timeout_ms });
    eval_bridge_method(&state, "waitForToast", &params).await
}

async fn handle_health() -> &'static str {
    r#"{"status":"ok","server":"personas-test-automation","version":"0.2.0"}"#
}

// ── Server startup ──────────────────────────────────────────────────────────

pub fn start_server(app_handle: AppHandle, pending: PendingResponses) {
    let state = ServerState {
        app_handle,
        pending,
    };

    let app = Router::new()
        // Health
        .route("/health", get(handle_health))
        // Primitives
        .route("/navigate", post(handle_navigate))
        .route("/click", post(handle_click))
        .route("/type", post(handle_type))
        .route("/query", post(handle_query))
        .route("/find-text", post(handle_find_text))
        .route("/state", get(handle_state))
        .route("/wait", post(handle_wait))
        .route("/list-interactive", get(handle_list_interactive))
        .route("/eval", post(handle_eval))
        // Workflow macros
        .route("/select-agent", post(handle_select_agent))
        .route("/open-editor-tab", post(handle_open_editor_tab))
        .route("/start-create-agent", post(handle_start_create_agent))
        .route("/snapshot", get(handle_snapshot))
        .route("/agent-cards", get(handle_agent_cards))
        .route("/fill-field", post(handle_fill_field))
        .route("/click-testid", post(handle_click_testid))
        .route("/search-agents", post(handle_search_agents))
        .route("/open-settings-tab", post(handle_open_settings_tab))
        .route("/wait-toast", post(handle_wait_toast))
        .with_state(state);

    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::bind("127.0.0.1:17320").await {
            Ok(listener) => {
                tracing::info!("Test automation server listening on http://127.0.0.1:17320");
                if let Err(e) = axum::serve(listener, app).await {
                    tracing::error!("Test automation server error: {}", e);
                }
            }
            Err(e) => {
                tracing::error!(
                    "Failed to bind test automation server on 127.0.0.1:17320: {}",
                    e
                );
            }
        }
    });
}
