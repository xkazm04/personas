//! Test Automation HTTP Server
//!
//! Available in two modes:
//!
//! 1. **Dev mode** (compile-time): `--features test-automation` → port 17320
//! 2. **Production mode** (env var): `PERSONAS_TEST_PORT=17321` → custom port
//!
//! Starts a lightweight HTTP server on `127.0.0.1:<port>` that bridges external
//! test drivers (MCP servers, scripts) to the running Tauri WebView via JS eval.
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

#[derive(Deserialize)]
struct ScreenshotRequest {
    /// Absolute directory to save the PNG into. Created if missing.
    save_dir: String,
    /// Filename without extension. `.png` is appended.
    filename: String,
    /// Optional max width in pixels. Image is downscaled preserving aspect ratio
    /// if the captured window is wider. Defaults to 1280 to keep guide assets
    /// lightweight.
    #[serde(default)]
    max_width: Option<u32>,
    /// Optional substring of the OS window title to capture. Defaults to
    /// "Personas". Falls back to the primary monitor if no match.
    #[serde(default)]
    window_title: Option<String>,
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

async fn handle_screenshot(
    AxumState(_state): AxumState<ServerState>,
    Json(req): Json<ScreenshotRequest>,
) -> Result<String, (StatusCode, String)> {
    use std::path::PathBuf;

    let save_dir = PathBuf::from(&req.save_dir);
    tokio::fs::create_dir_all(&save_dir).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create save dir {}: {e}", save_dir.display()),
        )
    })?;

    let filename = if req.filename.ends_with(".png") {
        req.filename.clone()
    } else {
        format!("{}.png", req.filename)
    };
    let out_path = save_dir.join(&filename);
    let target_title = req.window_title.clone().unwrap_or_else(|| "Personas".to_string());
    let max_width = req.max_width.unwrap_or(1280);

    let out_path_owned = out_path.clone();
    let result = tokio::task::spawn_blocking(move || -> Result<(u32, u32), String> {
        use xcap::{Monitor, Window};

        let mut captured: Option<image::RgbaImage> = None;

        if let Ok(windows) = Window::all() {
            let hit = windows
                .iter()
                .find(|w| w.title().map(|t| t == target_title).unwrap_or(false))
                .or_else(|| {
                    windows.iter().find(|w| {
                        w.title()
                            .map(|t| t.contains(target_title.as_str()))
                            .unwrap_or(false)
                    })
                });
            if let Some(w) = hit {
                match w.capture_image() {
                    Ok(img) => captured = Some(img),
                    Err(e) => tracing::warn!(
                        "Window capture failed for '{target_title}': {e}. Falling back to primary monitor."
                    ),
                }
            }
        }

        if captured.is_none() {
            let monitors = Monitor::all()
                .map_err(|e| format!("Failed to enumerate monitors: {e}"))?;
            let primary = monitors
                .into_iter()
                .next()
                .ok_or_else(|| "No monitors available for capture".to_string())?;
            let img = primary
                .capture_image()
                .map_err(|e| format!("Monitor capture failed: {e}"))?;
            captured = Some(img);
        }

        let img = captured.ok_or_else(|| "No capture produced".to_string())?;
        let (orig_w, orig_h) = (img.width(), img.height());

        // Downscale if wider than max_width, preserving aspect ratio.
        let resized = if orig_w > max_width {
            let new_h = ((orig_h as f32) * (max_width as f32 / orig_w as f32)).round() as u32;
            image::imageops::resize(&img, max_width, new_h, image::imageops::FilterType::Lanczos3)
        } else {
            img
        };
        let (final_w, final_h) = (resized.width(), resized.height());

        resized
            .save(&out_path_owned)
            .map_err(|e| format!("Failed to write PNG to {}: {e}", out_path_owned.display()))?;

        Ok((final_w, final_h))
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Capture task join error: {e}"),
        )
    })?;

    let (width, height) =
        result.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(serde_json::json!({
        "success": true,
        "path": out_path.to_string_lossy(),
        "width": width,
        "height": height,
    })
    .to_string())
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
    body: Option<Json<serde_json::Value>>,
) -> Result<String, (StatusCode, String)> {
    // Direct promote via Tauri command — bypasses bridge store dependency.
    // Accepts optional JSON body with session_id and persona_id to skip bridge getState.
    let (session_id, persona_id) = if let Some(Json(ref b)) = body {
        let sid = b.get("session_id").and_then(|v| v.as_str()).map(|s| s.to_string());
        let pid = b.get("persona_id").and_then(|v| v.as_str()).map(|s| s.to_string());
        if sid.is_some() {
            (sid, pid)
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    // If not provided in body, get from WebView store
    let session_id = if let Some(sid) = session_id {
        sid
    } else {
        let state_json = eval_bridge_method(&state, "getState", &serde_json::json!({})).await?;
        let state_val: serde_json::Value = serde_json::from_str(&state_json)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Parse state: {e}")))?;
        state_val.get("buildSessionId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| (StatusCode::BAD_REQUEST, "No buildSessionId in state".to_string()))?
            .to_string()
    };

    // Resolve persona_id: prefer body, then DB lookup
    let persona_id = persona_id
        .or_else(|| {
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

// ── Overview & credential helpers ───────────────────────────────────────────

#[derive(Deserialize)]
struct OverviewCountsRequest {
    persona_id: String,
}

async fn handle_overview_counts(
    AxumState(state): AxumState<ServerState>,
    Json(body): Json<OverviewCountsRequest>,
) -> Result<String, (StatusCode, String)> {
    eval_bridge_method_with_timeout(
        &state,
        "getOverviewCounts",
        &serde_json::json!({ "personaId": body.persona_id }),
        BRIDGE_TIMEOUT_MUTATION,
    )
    .await
}

#[derive(Deserialize)]
struct PersonaDetailRequest {
    persona_id: String,
}

/// Phase C2 — fetch a persona's detail (incl. design_context, triggers,
/// subscriptions) so the sweep harness can validate the post-adoption shape.
async fn handle_persona_detail(
    AxumState(state): AxumState<ServerState>,
    Json(body): Json<PersonaDetailRequest>,
) -> Result<String, (StatusCode, String)> {
    eval_bridge_method_with_timeout(
        &state,
        "getPersonaDetail",
        &serde_json::json!({ "personaId": body.persona_id }),
        BRIDGE_TIMEOUT_DEFAULT,
    )
    .await
}

async fn handle_list_credentials(
    AxumState(state): AxumState<ServerState>,
) -> Result<String, (StatusCode, String)> {
    eval_bridge_method_with_timeout(&state, "listCredentials", &serde_json::json!({}), BRIDGE_TIMEOUT_DEFAULT).await
}

async fn handle_list_cli_capturable(
    AxumState(state): AxumState<ServerState>,
) -> Result<String, (StatusCode, String)> {
    eval_bridge_method_with_timeout(
        &state,
        "listCliCapturable",
        &serde_json::json!({}),
        BRIDGE_TIMEOUT_DEFAULT,
    )
    .await
}

#[derive(Deserialize)]
struct CliCaptureRunRequest {
    service_type: String,
}

async fn handle_cli_capture_run(
    AxumState(state): AxumState<ServerState>,
    Json(req): Json<CliCaptureRunRequest>,
) -> Result<String, (StatusCode, String)> {
    // CLI subprocesses cap at 5s each; allow generous bridge timeout so the
    // test driver sees the full error instead of a gateway timeout.
    eval_bridge_method_with_timeout(
        &state,
        "cliCaptureRun",
        &serde_json::json!({ "serviceType": req.service_type }),
        60,
    )
    .await
}

async fn handle_health() -> &'static str {
    r#"{"status":"ok","server":"personas-test-automation","version":"0.2.0"}"#
}

// ── Server startup ──────────────────────────────────────────────────────────

/// Default port for dev mode (`--features test-automation`).
pub const DEFAULT_PORT: u16 = 17320;

/// Check if production test mode is enabled via env var.
/// Returns the port if `PERSONAS_TEST_PORT` is set to a valid number.
pub fn env_test_port() -> Option<u16> {
    std::env::var("PERSONAS_TEST_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
}

pub fn start_server(app_handle: AppHandle, pending: PendingResponses, port: u16) {
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
        .route("/screenshot", post(handle_screenshot))
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
        // Overview & credential helpers
        .route("/overview-counts", post(handle_overview_counts))
        .route("/persona-detail", post(handle_persona_detail))
        .route("/list-credentials", get(handle_list_credentials))
        .route("/list-cli-capturable", get(handle_list_cli_capturable))
        .route("/cli-capture-run", post(handle_cli_capture_run))
        .with_state(state);

    let addr = format!("127.0.0.1:{}", port);
    let addr_clone = addr.clone();
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::bind(&addr).await {
            Ok(listener) => {
                tracing::info!("Test automation server listening on http://{}", addr);
                if let Err(e) = axum::serve(listener, app).await {
                    tracing::error!("Test automation server error: {}", e);
                }
            }
            Err(e) => {
                tracing::error!(
                    "Failed to bind test automation server on {}: {}",
                    addr_clone, e
                );
            }
        }
    });
}
