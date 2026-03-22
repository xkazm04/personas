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

/// Default timeout for quick bridge operations (query, navigate, etc.)
const BRIDGE_TIMEOUT_DEFAULT: u64 = 15;
/// Longer timeout for operations that trigger state changes (click, fill-field)
/// which may cause React re-renders and brief JS thread blocking during lab runs.
const BRIDGE_TIMEOUT_MUTATION: u64 = 30;
/// Maximum timeout for explicit wait operations (wait-for, wait-toast).
const BRIDGE_TIMEOUT_WAIT_MAX: u64 = 300;

async fn eval_bridge_method(
    state: &ServerState,
    method: &str,
    params: &serde_json::Value,
) -> Result<String, (StatusCode, String)> {
    eval_bridge_method_with_timeout(state, method, params, BRIDGE_TIMEOUT_DEFAULT).await
}

async fn eval_bridge_method_with_timeout(
    state: &ServerState,
    method: &str,
    params: &serde_json::Value,
    timeout_secs: u64,
) -> Result<String, (StatusCode, String)> {
    // Try up to 2 times — first attempt + one retry on timeout
    for attempt in 0..2u8 {
        match try_eval_bridge(state, method, params, timeout_secs).await {
            Ok(result) => return Ok(result),
            Err(e) if e.0 == StatusCode::GATEWAY_TIMEOUT && attempt == 0 => {
                // First timeout — retry once after a brief pause to let the JS thread breathe
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
            Err(e) => return Err(e),
        }
    }
    unreachable!()
}

async fn try_eval_bridge(
    state: &ServerState,
    method: &str,
    params: &serde_json::Value,
    timeout_secs: u64,
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
    match tokio::time::timeout(Duration::from_secs(timeout_secs), rx).await {
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
                format!("Bridge response timeout ({timeout_secs}s)"),
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
    eval_bridge_method_with_timeout(&state, "click", &params, BRIDGE_TIMEOUT_MUTATION).await
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
    // Wait timeout = JS-side timeout + generous buffer for bridge overhead
    let bridge_timeout = (req.timeout_ms / 1000).max(BRIDGE_TIMEOUT_DEFAULT) + 10;
    eval_bridge_method_with_timeout(&state, "waitFor", &params, bridge_timeout.min(BRIDGE_TIMEOUT_WAIT_MAX)).await
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

#[derive(Deserialize)]
struct AnswerQuestionRequest {
    cell_key: String,
    option_index: u64,
}

#[derive(Deserialize)]
struct DeleteAgentRequest {
    name_or_id: String,
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
    eval_bridge_method_with_timeout(&state, "fillField", &params, BRIDGE_TIMEOUT_MUTATION).await
}

async fn handle_click_testid(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<ClickTestIdRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "testId": req.test_id });
    eval_bridge_method_with_timeout(&state, "clickTestId", &params, BRIDGE_TIMEOUT_MUTATION).await
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
    let bridge_timeout = (req.timeout_ms / 1000).max(BRIDGE_TIMEOUT_DEFAULT) + 10;
    eval_bridge_method_with_timeout(&state, "waitForToast", &params, bridge_timeout.min(BRIDGE_TIMEOUT_WAIT_MAX)).await
}

async fn handle_answer_question(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<AnswerQuestionRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "cellKey": req.cell_key, "optionIndex": req.option_index });
    eval_bridge_method(&state, "answerBuildQuestion", &params).await
}

async fn handle_delete_agent(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<DeleteAgentRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "nameOrId": req.name_or_id });
    eval_bridge_method_with_timeout(&state, "deleteAgent", &params, BRIDGE_TIMEOUT_MUTATION).await
}

async fn handle_promote_build(
    AxumState(state): AxumState<ServerState>,
) -> Result<String, (StatusCode, String)> {
    // Direct promote via Tauri command — bypasses bridge store dependency.
    // Gets session_id from the WebView store, then resolves persona_id from DB.
    let state_json = eval_bridge_method(&state, "getState", &serde_json::json!({})).await?;
    let state_val: serde_json::Value = serde_json::from_str(&state_json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Parse state: {e}")))?;

    let session_id = state_val.get("buildSessionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "No buildSessionId in state".to_string()))?
        .to_string();

    // Resolve persona_id: prefer store value, fall back to DB lookup
    let persona_id = state_val.get("buildPersonaId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            // DB lookup via build_sessions table
            let app_state = state.app_handle.state::<std::sync::Arc<crate::AppState>>();
            let conn = app_state.db.get().ok()?;
            conn.query_row(
                "SELECT persona_id FROM build_sessions WHERE id = ?1",
                rusqlite::params![session_id],
                |row| row.get::<_, String>(0),
            ).ok()
        })
        .ok_or_else(|| (StatusCode::BAD_REQUEST, format!("No persona_id for session {session_id}")))?;

    tracing::info!(session_id = %session_id, persona_id = %persona_id, "test_automation: promote_build via direct invoke");

    // Call the promote command directly
    let app_state = state.app_handle.state::<std::sync::Arc<crate::AppState>>();
    let result = crate::commands::design::build_sessions::promote_build_draft_inner(
        &app_state, session_id.clone(), persona_id.clone()
    ).await;

    match result {
        Ok(val) => {
            // Refresh the persona list in the WebView
            let _ = eval_bridge_method(&state, "navigate", &serde_json::json!({"section": "personas"})).await;
            Ok(serde_json::json!({"success": true, "result": val, "personaId": persona_id}).to_string())
        }
        Err(e) => {
            tracing::error!(error = %e, "test_automation: promote_build failed");
            Ok(serde_json::json!({"success": false, "error": e.to_string()}).to_string())
        }
    }
}

#[derive(Deserialize)]
struct ExecutePersonaRequest {
    name_or_id: String,
}

async fn handle_execute_persona(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<ExecutePersonaRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "nameOrId": req.name_or_id });
    eval_bridge_method_with_timeout(&state, "executePersona", &params, BRIDGE_TIMEOUT_MUTATION).await
}

#[derive(Deserialize)]
struct AdoptTemplateRequest {
    template_name: String,
    design_result_json: String,
}

async fn handle_adopt_template(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<AdoptTemplateRequest>,
) -> Result<String, (StatusCode, String)> {
    // Direct Rust call — bypasses bridge for reliability
    let app_state = state.app_handle.state::<std::sync::Arc<crate::AppState>>();
    match crate::commands::design::template_adopt::instant_adopt_template_inner(
        &app_state,
        req.template_name.clone(),
        req.design_result_json,
    ) {
        Ok(val) => {
            // Refresh persona list in the webview
            let _ = eval_bridge_method(&state, "navigate", &serde_json::json!({"section": "personas"})).await;
            Ok(serde_json::json!({"success": true, "result": val}).to_string())
        }
        Err(e) => {
            tracing::error!(template = %req.template_name, error = %e, "adopt_template failed");
            Ok(serde_json::json!({"success": false, "error": e.to_string()}).to_string())
        }
    }
}

#[derive(Deserialize)]
struct OpenMatrixAdoptionRequest {
    review_id: String,
}

async fn handle_open_matrix_adoption(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<OpenMatrixAdoptionRequest>,
) -> Result<String, (StatusCode, String)> {
    let params = serde_json::json!({ "reviewId": req.review_id });
    eval_bridge_method_with_timeout(&state, "openMatrixAdoption", &params, 90).await
}

async fn handle_refresh_personas(
    AxumState(state): AxumState<ServerState>,
) -> Result<String, (StatusCode, String)> {
    eval_bridge_method_with_timeout(&state, "refreshPersonas", &serde_json::json!({}), BRIDGE_TIMEOUT_MUTATION).await
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
        .route("/answer-question", post(handle_answer_question))
        .route("/delete-agent", post(handle_delete_agent))
        .route("/promote-build", post(handle_promote_build))
        .route("/execute-persona", post(handle_execute_persona))
        .route("/adopt-template", post(handle_adopt_template))
        .route("/open-matrix-adoption", post(handle_open_matrix_adoption))
        .route("/refresh-personas", post(handle_refresh_personas))
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
