//! Management API -- extends the webhook HTTP server with /api/* routes
//! for persona execution, lab operations, and version management.
//!
//! These endpoints allow external tools (MCP servers, CLI scripts, A2A clients)
//! to control Personas without going through the Tauri IPC layer.
//!
//! All routes are gated by the [`require_api_key`] middleware which validates a
//! `Bearer` token against the `external_api_keys` table. The desktop frontend
//! uses a process-scoped "system" key created on first call to
//! [`get_or_create_system_api_key`].

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::sync::Mutex;
use tauri::Manager;

use axum::{
    extract::{Path, Query, Request, State as AxumState},
    http::{header, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use tower_http::cors::{Any, CorsLayer};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::db::models::*;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::metrics as metrics_repo;
use crate::db::repos::lab::arena as arena_repo;
use crate::db::repos::lab::ab as ab_repo;
use crate::db::repos::lab::matrix as matrix_repo;
use crate::db::repos::lab::eval as eval_repo;
use crate::db::repos::resources::external_api_keys as api_key_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::engine::a2a::types::{
    A2ARequest, A2AResponse, AgentCapabilities, AgentCard, AgentSkill,
};
use crate::engine::test_runner::{self, TestModelConfig};
use crate::engine::types::EphemeralPersona;
use crate::error::AppError;
use crate::ActiveProcessRegistry;

// =============================================================================
// Shared state for the management API
// =============================================================================

#[derive(Clone)]
pub struct ManagementState {
    pub pool: DbPool,
    pub app: AppHandle,
    pub process_registry: Arc<ActiveProcessRegistry>,
}

// =============================================================================
// Router construction
// =============================================================================

pub fn management_router(state: ManagementState) -> Router {
    let state_arc = Arc::new(state);
    Router::new()
        // Personas
        .route("/api/personas", get(list_personas))
        .route("/api/personas/{persona_id}", get(get_persona))
        // Executions
        .route("/api/execute/{persona_id}", post(execute_persona))
        .route("/api/executions", get(list_executions))
        .route("/api/executions/{id}", get(get_execution))
        // Lab
        .route("/api/lab/arena/{persona_id}", post(start_arena))
        .route("/api/lab/matrix/{persona_id}", post(start_matrix))
        .route("/api/lab/cancel/{run_id}", post(cancel_lab_run))
        .route("/api/lab/improve/{persona_id}/{run_id}", post(improve_prompt))
        // Versions
        .route("/api/versions/{persona_id}", get(list_versions))
        .route("/api/versions/{version_id}/tag", post(tag_version))
        .route("/api/versions/{version_id}/rollback", post(rollback_version))
        .route("/api/versions/{run_id}/accept", post(accept_draft))
        // Automation settings
        .route("/api/settings/auto-optimize/{persona_id}", get(get_auto_optimize).post(set_auto_optimize))
        .route("/api/settings/health-watch/{persona_id}", get(get_health_watch).post(set_health_watch))
        // Credential proxy -- route HTTP calls through stored credentials
        .route("/api/proxy/{credential_id}", post(proxy_request))
        // A2A Gateway -- agent card discovery + JSON-RPC entry point
        .route("/agent-card/{persona_id}", get(get_agent_card))
        .route("/a2a/{persona_id}", post(handle_a2a_request))
        .with_state(state_arc.clone())
        // Auth middleware runs INSIDE the CORS layer so OPTIONS preflight
        // requests do not require an API key.
        .layer(middleware::from_fn_with_state(state_arc, require_api_key))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]),
        )
}

// =============================================================================
// API key auth middleware
// =============================================================================

/// Require a valid `Authorization: Bearer <token>` header. Tokens are checked
/// against `external_api_keys`. Disabled / revoked / unknown tokens return
/// 401. The middleware never logs token plaintext — only the prefix when a
/// match succeeds, for traceability.
async fn require_api_key(
    AxumState(state): AxumState<Arc<ManagementState>>,
    req: Request,
    next: Next,
) -> Result<Response, (StatusCode, Json<ApiResult>)> {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(str::to_string);

    let Some(token) = token else {
        return Err(err_json_tuple(StatusCode::UNAUTHORIZED, "missing api key"));
    };

    match api_key_repo::find_by_token(&state.pool, &token) {
        Ok(Some(key)) => {
            tracing::debug!(prefix = %key.key_prefix, "external api key accepted");
            Ok(next.run(req).await)
        }
        Ok(None) => Err(err_json_tuple(
            StatusCode::UNAUTHORIZED,
            "invalid api key",
        )),
        Err(e) => {
            tracing::error!(error = %e, "api key lookup failed");
            Err(err_json_tuple(
                StatusCode::INTERNAL_SERVER_ERROR,
                "auth lookup failed",
            ))
        }
    }
}

// =============================================================================
// System API key bootstrap
// =============================================================================

/// Process-scoped cache of the "system" API key plaintext. The key is rotated
/// on every app start: previous system keys are revoked and a fresh one is
/// minted. The frontend fetches it via the `get_system_api_key` Tauri command
/// and uses it to authenticate direct HTTP fetches against the management API.
static SYSTEM_API_KEY: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn system_api_key_cache() -> &'static Mutex<Option<String>> {
    SYSTEM_API_KEY.get_or_init(|| Mutex::new(None))
}

/// Return the cached system API key plaintext, creating one on first call.
/// Concurrent callers race the lock; only the first one through actually mints
/// a fresh key. Subsequent callers return the cached value.
pub fn get_or_create_system_api_key(pool: &DbPool) -> Result<String, AppError> {
    let cache = system_api_key_cache();
    {
        let guard = cache.lock().expect("system api key mutex poisoned");
        if let Some(token) = guard.as_ref() {
            return Ok(token.clone());
        }
    }

    // Revoke any leftover system keys from prior process runs to keep the
    // table tidy and prevent stale tokens from accumulating.
    if let Ok(existing) = api_key_repo::list(pool) {
        for key in existing.iter().filter(|k| k.name == "system" && k.enabled) {
            let _ = api_key_repo::revoke(pool, &key.id);
        }
    }

    let resp = api_key_repo::create(
        pool,
        "system",
        vec!["personas:read".into(), "personas:execute".into()],
    )?;

    let mut guard = cache.lock().expect("system api key mutex poisoned");
    // Another thread may have raced us — prefer their value if so.
    if let Some(existing) = guard.as_ref() {
        return Ok(existing.clone());
    }
    *guard = Some(resp.plaintext_token.clone());
    Ok(resp.plaintext_token)
}

// =============================================================================
// Request/Response types
// =============================================================================

#[derive(Deserialize)]
struct ExecuteInput {
    input_data: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct LabStartInput {
    models: Vec<TestModelConfig>,
    #[serde(default)]
    use_case_filter: Option<String>,
    /// Only for matrix: the improvement instruction
    #[serde(default)]
    instruction: Option<String>,
}

#[derive(Deserialize)]
struct ImproveInput {
    /// "arena", "ab", "matrix", or "eval"
    mode: String,
}

#[derive(Deserialize)]
struct TagInput {
    tag: String,
}

#[derive(Deserialize)]
struct ListQuery {
    limit: Option<i64>,
    status: Option<String>,
    persona_id: Option<String>,
}

#[derive(Serialize)]
struct ApiResult {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn ok_json(data: impl Serialize) -> impl IntoResponse {
    Json(ApiResult {
        success: true,
        data: serde_json::to_value(data).ok(),
        error: None,
    })
}

fn err_json(status: StatusCode, msg: &str) -> (StatusCode, Json<ApiResult>) {
    (status, Json(ApiResult {
        success: false,
        data: None,
        error: Some(msg.to_string()),
    }))
}

/// Variant of `err_json` whose return type is the exact tuple expected by
/// the auth middleware (`Result<Response, (StatusCode, Json<ApiResult>)>`).
fn err_json_tuple(status: StatusCode, msg: &str) -> (StatusCode, Json<ApiResult>) {
    err_json(status, msg)
}

// =============================================================================
// Credential proxy endpoint
// =============================================================================

#[derive(Deserialize)]
struct ProxyRequestBody {
    method: String,
    path: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<String>,
}

/// Proxy an HTTP request through a stored credential's auth strategy.
///
/// Credential secrets never leave the server — the CLI subprocess sends requests
/// here with a credential ID, and auth headers are injected server-side.
async fn proxy_request(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(credential_id): Path<String>,
    Json(input): Json<ProxyRequestBody>,
) -> impl IntoResponse {
    match crate::engine::api_proxy::execute_api_request(
        &state.pool,
        &credential_id,
        &input.method,
        &input.path,
        input.headers,
        input.body,
    ).await {
        Ok(resp) => ok_json(resp).into_response(),
        Err(e) => {
            let msg = format!("{e}");
            err_json(StatusCode::BAD_GATEWAY, &msg).into_response()
        }
    }
}

// =============================================================================
// Persona endpoints
// =============================================================================

async fn list_personas(
    AxumState(state): AxumState<Arc<ManagementState>>,
) -> impl IntoResponse {
    match persona_repo::get_all(&state.pool) {
        Ok(personas) => {
            let summary: Vec<serde_json::Value> = personas.iter().map(|p| {
                serde_json::json!({
                    "id": p.id,
                    "name": p.name,
                    "description": p.description,
                    "enabled": p.enabled,
                    "icon": p.icon,
                    "color": p.color,
                })
            }).collect();
            ok_json(summary).into_response()
        }
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn get_persona(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
) -> impl IntoResponse {
    match persona_repo::get_by_id(&state.pool, &persona_id) {
        Ok(p) => ok_json(serde_json::json!({
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "enabled": p.enabled,
            "system_prompt": p.system_prompt.chars().take(500).collect::<String>(),
        })).into_response(),
        Err(_) => err_json(StatusCode::NOT_FOUND, "Persona not found").into_response(),
    }
}

// =============================================================================
// Execution endpoints
// =============================================================================

async fn execute_persona(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    Json(input): Json<ExecuteInput>,
) -> impl IntoResponse {
    let persona = match persona_repo::get_by_id(&state.pool, &persona_id) {
        Ok(p) => p,
        Err(_) => return err_json(StatusCode::NOT_FOUND, "Persona not found").into_response(),
    };

    if !persona.enabled {
        return err_json(StatusCode::BAD_REQUEST, "Persona is disabled").into_response();
    }

    // Create execution record
    let input_str = input.input_data.as_ref().map(|v| v.to_string());
    let execution = match exec_repo::create(&state.pool, &persona_id, None, input_str, None, None) {
        Ok(e) => e,
        Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &format!("Failed to create execution: {e}")).into_response(),
    };

    // Get tools
    let tools = tool_repo::get_tools_for_persona(&state.pool, &persona_id).unwrap_or_default();

    // Start via engine
    let app_state: tauri::State<'_, Arc<crate::AppState>> = match state.app.try_state() {
        Some(s) => s,
        None => return err_json(StatusCode::INTERNAL_SERVER_ERROR, "App state not available").into_response(),
    };

    match app_state.engine.start_execution(
        state.app.clone(),
        state.pool.clone(),
        execution.id.clone(),
        persona,
        tools,
        input.input_data,
        None,
    ).await {
        Ok(()) => ok_json(serde_json::json!({
            "execution_id": execution.id,
            "status": "queued",
        })).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn list_executions(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    match exec_repo::get_all_global(&state.pool, q.limit, q.status.as_deref(), q.persona_id.as_deref()) {
        Ok(rows) => ok_json(rows).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn get_execution(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match exec_repo::get_by_id(&state.pool, &id) {
        Ok(exec) => ok_json(exec).into_response(),
        Err(_) => err_json(StatusCode::NOT_FOUND, "Execution not found").into_response(),
    }
}

// =============================================================================
// Lab endpoints
// =============================================================================

async fn start_arena(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    Json(input): Json<LabStartInput>,
) -> impl IntoResponse {
    let persona = match persona_repo::get_by_id(&state.pool, &persona_id) {
        Ok(p) => p,
        Err(_) => return err_json(StatusCode::NOT_FOUND, "Persona not found").into_response(),
    };
    let tools = tool_repo::get_tools_for_persona(&state.pool, &persona_id).unwrap_or_default();
    let ephemeral = EphemeralPersona::from_persisted(persona, tools);

    if input.models.is_empty() {
        return err_json(StatusCode::BAD_REQUEST, "No models provided").into_response();
    }

    let models_json = serde_json::to_string(
        &input.models.iter().map(|m| &m.id).collect::<Vec<_>>(),
    ).unwrap_or_default();

    let run = match arena_repo::create_run(&state.pool, &persona_id, &models_json, input.use_case_filter.as_deref()) {
        Ok(r) => r,
        Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };

    let run_id = run.id.clone();
    let (cancelled, run_guard) = state.process_registry.register_run_guarded("test", &run_id);
    let pool = state.pool.clone();
    let app = state.app.clone();
    let use_case_filter = input.use_case_filter;
    let models = input.models;

    tokio::spawn(async move {
        let _guard = run_guard;
        test_runner::run_arena_test(app, pool, run_id, ephemeral, models, std::env::temp_dir(), cancelled, use_case_filter).await;
    });

    ok_json(serde_json::json!({ "run_id": run.id, "status": "started" })).into_response()
}

async fn start_matrix(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    Json(input): Json<LabStartInput>,
) -> impl IntoResponse {
    let instruction = match input.instruction {
        Some(ref i) if !i.is_empty() => i.clone(),
        _ => return err_json(StatusCode::BAD_REQUEST, "instruction is required for matrix runs").into_response(),
    };

    let persona = match persona_repo::get_by_id(&state.pool, &persona_id) {
        Ok(p) => p,
        Err(_) => return err_json(StatusCode::NOT_FOUND, "Persona not found").into_response(),
    };
    let tools = tool_repo::get_tools_for_persona(&state.pool, &persona_id).unwrap_or_default();
    let ephemeral = EphemeralPersona::from_persisted(persona, tools);

    if input.models.is_empty() {
        return err_json(StatusCode::BAD_REQUEST, "No models provided").into_response();
    }

    let models_json = serde_json::to_string(
        &input.models.iter().map(|m| &m.id).collect::<Vec<_>>(),
    ).unwrap_or_default();

    let run = match matrix_repo::create_run(&state.pool, &persona_id, &instruction, &models_json, input.use_case_filter.as_deref()) {
        Ok(r) => r,
        Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };

    let run_id = run.id.clone();
    let (cancelled, run_guard) = state.process_registry.register_run_guarded("test", &run_id);
    let pool = state.pool.clone();
    let app = state.app.clone();
    let use_case_filter = input.use_case_filter;
    let models = input.models;

    tokio::spawn(async move {
        let _guard = run_guard;
        test_runner::run_matrix_test(app, pool, run_id, ephemeral, instruction, models, cancelled, use_case_filter).await;
    });

    ok_json(serde_json::json!({ "run_id": run.id, "status": "started" })).into_response()
}

async fn cancel_lab_run(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    state.process_registry.cancel_run("test", &run_id);
    let now = chrono::Utc::now().to_rfc3339();

    // Try cancelling in each lab table (only one will match)
    let _ = arena_repo::update_run_status(&state.pool, &run_id, LabRunStatus::Cancelled, None, None, None, Some(&now));
    let _ = matrix_repo::update_run_status(&state.pool, &run_id, LabRunStatus::Cancelled, None, None, None, Some(&now));
    let _ = ab_repo::update_run_status(&state.pool, &run_id, LabRunStatus::Cancelled, None, None, None, Some(&now));
    let _ = eval_repo::update_run_status(&state.pool, &run_id, LabRunStatus::Cancelled, None, None, None, Some(&now));

    ok_json(serde_json::json!({ "run_id": run_id, "status": "cancelled" }))
}

async fn improve_prompt(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path((persona_id, run_id)): Path<(String, String)>,
    Json(input): Json<ImproveInput>,
) -> impl IntoResponse {
    let persona = match persona_repo::get_by_id(&state.pool, &persona_id) {
        Ok(p) => p,
        Err(_) => return err_json(StatusCode::NOT_FOUND, "Persona not found").into_response(),
    };
    let _tools = tool_repo::get_tools_for_persona(&state.pool, &persona_id).unwrap_or_default();

    // Load results based on mode
    let results_text = match load_lab_results_for_improvement(&state.pool, &run_id, &input.mode) {
        Ok(text) => text,
        Err(e) => return err_json(StatusCode::BAD_REQUEST, &e).into_response(),
    };

    // Generate improvement via LLM
    match test_runner::generate_targeted_improvements(&state.pool, &persona, &results_text, None).await {
        Ok((_, version_text)) => {
            // Save as new prompt version
            let version_id = metrics_repo::create_prompt_version_if_changed(
                &state.pool,
                &persona_id,
                Some(version_text.clone()),
                None,
            );
            ok_json(serde_json::json!({
                "improved": true,
                "version_id": version_id.ok().flatten(),
                "preview": version_text.chars().take(500).collect::<String>(),
            })).into_response()
        }
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &format!("Improvement failed: {e}")).into_response(),
    }
}

fn load_lab_results_for_improvement(pool: &DbPool, run_id: &str, mode: &str) -> Result<String, String> {
    let text = match mode {
        "arena" => {
            let results = arena_repo::get_results_by_run(pool, run_id).map_err(|e| e.to_string())?;
            serde_json::to_string_pretty(&results).map_err(|e| e.to_string())?
        }
        "matrix" => {
            let results = matrix_repo::get_results_by_run(pool, run_id).map_err(|e| e.to_string())?;
            serde_json::to_string_pretty(&results).map_err(|e| e.to_string())?
        }
        "ab" => {
            let results = ab_repo::get_results_by_run(pool, run_id).map_err(|e| e.to_string())?;
            serde_json::to_string_pretty(&results).map_err(|e| e.to_string())?
        }
        "eval" => {
            let results = eval_repo::get_results_by_run(pool, run_id).map_err(|e| e.to_string())?;
            serde_json::to_string_pretty(&results).map_err(|e| e.to_string())?
        }
        _ => return Err(format!("Unknown mode: {mode}. Use arena, matrix, ab, or eval.")),
    };
    Ok(text)
}

// =============================================================================
// Version endpoints
// =============================================================================

async fn list_versions(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
) -> impl IntoResponse {
    match metrics_repo::get_prompt_versions(&state.pool, &persona_id, Some(20)) {
        Ok(versions) => ok_json(versions).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn tag_version(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(version_id): Path<String>,
    Json(input): Json<TagInput>,
) -> impl IntoResponse {
    match metrics_repo::update_prompt_version_tag(&state.pool, &version_id, &input.tag) {
        Ok(v) => ok_json(v).into_response(),
        Err(e) => err_json(StatusCode::BAD_REQUEST, &e.to_string()).into_response(),
    }
}

async fn rollback_version(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(version_id): Path<String>,
) -> impl IntoResponse {
    match metrics_repo::update_prompt_version_tag(&state.pool, &version_id, "production") {
        Ok(v) => ok_json(v).into_response(),
        Err(e) => err_json(StatusCode::BAD_REQUEST, &e.to_string()).into_response(),
    }
}

async fn accept_draft(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    let run = match matrix_repo::get_run_by_id(&state.pool, &run_id) {
        Ok(r) => r,
        Err(_) => return err_json(StatusCode::NOT_FOUND, "Matrix run not found").into_response(),
    };

    let draft_json = match run.draft_prompt_json {
        Some(d) => d,
        None => return err_json(StatusCode::BAD_REQUEST, "No draft available").into_response(),
    };

    // Apply draft to persona
    let conn = match state.pool.get() {
        Ok(c) => c,
        Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    };
    let now = chrono::Utc::now().to_rfc3339();
    if let Err(e) = conn.execute(
        "UPDATE personas SET structured_prompt = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![draft_json, now, run.persona_id],
    ) {
        return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response();
    }

    let _ = matrix_repo::accept_draft(&state.pool, &run_id);
    let _ = metrics_repo::create_prompt_version_if_changed(&state.pool, &run.persona_id, Some(draft_json), None);

    ok_json(serde_json::json!({ "accepted": true, "persona_id": run.persona_id })).into_response()
}

// =============================================================================
// Automation settings endpoints
// =============================================================================

use crate::db::settings_keys;
use crate::db::repos::core::settings;

#[derive(Deserialize, Serialize)]
struct AutoOptimizeConfig {
    enabled: bool,
    #[serde(default = "default_optimize_cron")]
    cron: String,
    #[serde(default = "default_min_score")]
    min_score: u32,
    #[serde(default = "default_models")]
    models: Vec<String>,
}

fn default_optimize_cron() -> String { "0 2 * * 0".into() } // Sunday 2 AM
fn default_min_score() -> u32 { 80 }
fn default_models() -> Vec<String> { vec!["sonnet".into()] }

#[derive(Deserialize, Serialize)]
struct HealthWatchConfig {
    enabled: bool,
    #[serde(default = "default_interval_hours")]
    interval_hours: u32,
    #[serde(default = "default_error_threshold")]
    error_threshold: u32,
}

fn default_interval_hours() -> u32 { 6 }
fn default_error_threshold() -> u32 { 30 }

async fn get_auto_optimize(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
) -> impl IntoResponse {
    let key = format!("{}{}", settings_keys::AUTO_OPTIMIZE_PREFIX, persona_id);
    match settings::get(&state.pool, &key) {
        Ok(Some(json)) => {
            let config: AutoOptimizeConfig = serde_json::from_str(&json).unwrap_or(AutoOptimizeConfig {
                enabled: false, cron: default_optimize_cron(), min_score: default_min_score(), models: default_models(),
            });
            ok_json(config).into_response()
        }
        _ => ok_json(AutoOptimizeConfig {
            enabled: false, cron: default_optimize_cron(), min_score: default_min_score(), models: default_models(),
        }).into_response(),
    }
}

async fn set_auto_optimize(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    Json(config): Json<AutoOptimizeConfig>,
) -> impl IntoResponse {
    let key = format!("{}{}", settings_keys::AUTO_OPTIMIZE_PREFIX, persona_id);
    let json = serde_json::to_string(&config).unwrap_or_default();
    match settings::set(&state.pool, &key, &json) {
        Ok(()) => ok_json(config).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

async fn get_health_watch(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
) -> impl IntoResponse {
    let key = format!("{}{}", settings_keys::HEALTH_WATCH_PREFIX, persona_id);
    match settings::get(&state.pool, &key) {
        Ok(Some(json)) => {
            let config: HealthWatchConfig = serde_json::from_str(&json).unwrap_or(HealthWatchConfig {
                enabled: false, interval_hours: default_interval_hours(), error_threshold: default_error_threshold(),
            });
            ok_json(config).into_response()
        }
        _ => ok_json(HealthWatchConfig {
            enabled: false, interval_hours: default_interval_hours(), error_threshold: default_error_threshold(),
        }).into_response(),
    }
}

async fn set_health_watch(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    Json(config): Json<HealthWatchConfig>,
) -> impl IntoResponse {
    let key = format!("{}{}", settings_keys::HEALTH_WATCH_PREFIX, persona_id);
    let json = serde_json::to_string(&config).unwrap_or_default();
    match settings::set(&state.pool, &key, &json) {
        Ok(()) => ok_json(config).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()).into_response(),
    }
}

// =============================================================================
// A2A Gateway -- agent card discovery
// =============================================================================

/// Build an A2A `AgentCard` from a persona's existing fields plus its
/// `design_context.use_cases` (each use case becomes a `skill`). Personas
/// without use cases get a single fallback skill.
fn build_agent_card(persona: &Persona, host_origin: &str) -> AgentCard {
    let ctx = persona.parsed_design_context();

    let skills: Vec<AgentSkill> = match ctx.use_cases.as_ref() {
        Some(uses) if !uses.is_empty() => uses
            .iter()
            .map(|u| AgentSkill {
                id: u.id.clone(),
                name: u.title.clone(),
                description: u.description.clone(),
                tags: u
                    .category
                    .as_ref()
                    .map(|c| vec![c.clone()])
                    .unwrap_or_default(),
                examples: Vec::new(),
                input_modes: vec!["text".into()],
                output_modes: vec!["text".into()],
            })
            .collect(),
        _ => vec![AgentSkill {
            id: "default".into(),
            name: persona.name.clone(),
            description: persona.description.clone().unwrap_or_default(),
            tags: Vec::new(),
            examples: Vec::new(),
            input_modes: vec!["text".into()],
            output_modes: vec!["text".into()],
        }],
    };

    AgentCard {
        name: persona.name.clone(),
        description: persona.description.clone(),
        url: format!("{host_origin}/a2a/{}", persona.id),
        version: env!("CARGO_PKG_VERSION").to_string(),
        capabilities: AgentCapabilities {
            streaming: false,
            push_notifications: false,
            state_transition_history: false,
        },
        skills,
        default_input_modes: vec!["text".into()],
        default_output_modes: vec!["text".into()],
    }
}

/// Derive the request's host origin (`scheme://host`) for use as the
/// canonical URL prefix in agent cards. Falls back to the loopback address
/// when the `Host` header is absent.
fn host_origin_from_request(headers: &axum::http::HeaderMap) -> String {
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("127.0.0.1:9420");
    // Management API is HTTP-only on localhost; if a proxy ever fronts it,
    // the X-Forwarded-Proto header would override this. Keep simple for now.
    format!("http://{host}")
}

async fn get_agent_card(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    headers: axum::http::HeaderMap,
) -> Result<Json<AgentCard>, (StatusCode, Json<ApiResult>)> {
    let persona = match persona_repo::find_by_id_if_exposed(&state.pool, &persona_id) {
        Ok(Some(p)) => p,
        Ok(None) => {
            return Err(err_json(StatusCode::NOT_FOUND, "Persona not found"));
        }
        Err(e) => {
            return Err(err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                &e.to_string(),
            ));
        }
    };
    let origin = host_origin_from_request(&headers);
    Ok(Json(build_agent_card(&persona, &origin)))
}

// =============================================================================
// A2A Gateway -- JSON-RPC entry point
// =============================================================================

/// Translate an A2A `message/send` request into the existing `execute_persona`
/// flow and wrap the result in the A2A response envelope.
///
/// Streaming (`message/stream`) and other A2A methods return JSON-RPC
/// `-32601 Method not found`.
// TODO(a2a-streaming): wire up `message/stream` once the engine exposes a
// synchronous-text streaming surface for the management API.
async fn handle_a2a_request(
    AxumState(state): AxumState<Arc<ManagementState>>,
    Path(persona_id): Path<String>,
    Json(req): Json<A2ARequest>,
) -> impl IntoResponse {
    let req_id = req.id.clone().unwrap_or(serde_json::Value::Null);

    if req.method != "message/send" {
        let body = A2AResponse::error(req_id, -32601, "Method not found");
        return (StatusCode::OK, Json(serde_json::to_value(body).unwrap_or_default())).into_response();
    }

    let params = match req.params {
        Some(p) => p,
        None => {
            let body = A2AResponse::error(
                req_id,
                -32602,
                "Invalid params: missing message",
            );
            return (StatusCode::BAD_REQUEST, Json(serde_json::to_value(body).unwrap_or_default())).into_response();
        }
    };

    let prompt_text = match params.message.collect_text() {
        Some(t) => t,
        None => {
            let body = A2AResponse::error(
                req_id,
                -32602,
                "Invalid params: message must contain at least one text part",
            );
            return (StatusCode::BAD_REQUEST, Json(serde_json::to_value(body).unwrap_or_default())).into_response();
        }
    };

    // Look up persona via the exposure-gated helper. Personas with
    // `gateway_exposure = local_only` are reported as "not exposed" — we
    // never leak their existence to external consumers.
    let persona = match persona_repo::find_by_id_if_exposed(&state.pool, &persona_id) {
        Ok(Some(p)) => p,
        Ok(None) => {
            let body = A2AResponse::error(
                req_id,
                -32602,
                "Agent not found or not exposed",
            );
            return (StatusCode::NOT_FOUND, Json(serde_json::to_value(body).unwrap_or_default())).into_response();
        }
        Err(e) => {
            let body = A2AResponse::error(
                req_id,
                -32603,
                format!("Internal error: {e}"),
            );
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::to_value(body).unwrap_or_default())).into_response();
        }
    };

    if !persona.enabled {
        let body = A2AResponse::error(req_id, -32603, "Agent is disabled");
        return (StatusCode::OK, Json(serde_json::to_value(body).unwrap_or_default())).into_response();
    }

    // InviteOnly is treated identically to Public for now; scope-based
    // filtering arrives with the rate-limiter / per-key scopes finding.
    if matches!(persona.gateway_exposure, PersonaGatewayExposure::InviteOnly) {
        tracing::debug!(
            persona_id = %persona.id,
            "invite_only persona served as public until scopes ship"
        );
    }

    // Wrap the user-supplied text into the engine's input shape and route
    // through the same path used by `/api/execute`.
    let input_value = serde_json::json!({ "input": prompt_text });
    match run_persona_synchronous(&state, persona, input_value).await {
        Ok(text) => {
            let body = A2AResponse::success(req_id, text);
            (StatusCode::OK, Json(serde_json::to_value(body).unwrap_or_default())).into_response()
        }
        Err(e) => {
            let body = A2AResponse::error(req_id, -32603, format!("Internal error: {e}"));
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::to_value(body).unwrap_or_default())).into_response()
        }
    }
}

/// Execute a persona synchronously and return its final text output.
///
/// The existing `/api/execute` handler is fire-and-forget — it returns an
/// execution ID immediately. For A2A we need to block until completion, so
/// we kick off the same engine call and then poll the executions table for
/// terminal status.
async fn run_persona_synchronous(
    state: &ManagementState,
    persona: Persona,
    input: serde_json::Value,
) -> Result<String, AppError> {
    // 1. Create the execution row up front.
    let persona_id = persona.id.clone();
    let input_str = Some(input.to_string());
    let execution = exec_repo::create(&state.pool, &persona_id, None, input_str, None, None)
        .map_err(|e| AppError::Internal(format!("Failed to create execution: {e}")))?;

    let tools = tool_repo::get_tools_for_persona(&state.pool, &persona_id).unwrap_or_default();

    // 2. Hand off to the engine.
    let app_state: tauri::State<'_, Arc<crate::AppState>> = state
        .app
        .try_state()
        .ok_or_else(|| AppError::Internal("App state not available".into()))?;

    app_state
        .engine
        .start_execution(
            state.app.clone(),
            state.pool.clone(),
            execution.id.clone(),
            persona,
            tools,
            Some(input),
            None,
        )
        .await
        .map_err(|e| AppError::Execution(e.to_string()))?;

    // 3. Poll the execution until it reaches a terminal state. The cap is
    //    intentionally generous; the engine has its own per-persona timeout
    //    that will fail the row faster than this loop unwinds.
    const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);
    const MAX_WAIT: std::time::Duration = std::time::Duration::from_secs(600);
    let started = std::time::Instant::now();

    loop {
        let row = exec_repo::get_by_id(&state.pool, &execution.id)?;
        let status = row.status.as_str();
        match status {
            "completed" | "success" => {
                return Ok(row
                    .output_data
                    .unwrap_or_else(|| "".to_string()));
            }
            "failed" | "error" | "cancelled" | "timeout" => {
                return Err(AppError::Execution(
                    row.error_message.unwrap_or_else(|| status.to_string()),
                ));
            }
            _ => {
                if started.elapsed() > MAX_WAIT {
                    return Err(AppError::Execution(
                        "A2A execution timed out waiting for terminal status".into(),
                    ));
                }
                tokio::time::sleep(POLL_INTERVAL).await;
            }
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Build a fresh in-memory pool with full schema. Mirrors the helper used
    /// by `external_api_keys.rs`'s tests.
    fn test_pool() -> DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:mgmt_api_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("test pool build");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).expect("migrations");
        }
        pool
    }

    #[test]
    fn system_api_key_is_cached_across_calls() {
        // Reset the cache so the test is hermetic regardless of test order.
        {
            let cache = system_api_key_cache();
            *cache.lock().unwrap() = None;
        }
        let pool = test_pool();
        let a = get_or_create_system_api_key(&pool).expect("first");
        let b = get_or_create_system_api_key(&pool).expect("second");
        assert_eq!(a, b, "cached system key must be stable across calls");
        assert!(a.starts_with("pk_"));
    }

    #[test]
    fn agent_card_uses_design_context_use_cases() {
        let now = chrono::Utc::now().to_rfc3339();
        let design_context = serde_json::json!({
            "useCases": [
                {
                    "id": "uc-1",
                    "title": "Summarize emails",
                    "description": "Reads and summarizes incoming email threads.",
                    "category": "email"
                }
            ]
        })
        .to_string();
        let persona = Persona {
            id: "p-1".into(),
            project_id: "default".into(),
            name: "Email Buddy".into(),
            description: Some("Summarizes email".into()),
            system_prompt: "You summarize email.".into(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            sensitive: false,
            headless: false,
            max_concurrent: 1,
            timeout_ms: 30_000,
            notification_channels: None,
            last_design_result: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: Some(design_context),
            group_id: None,
            source_review_id: None,
            trust_level: PersonaTrustLevel::Verified,
            trust_origin: PersonaTrustOrigin::Builtin,
            trust_verified_at: None,
            trust_score: 1.0,
            parameters: None,
            gateway_exposure: PersonaGatewayExposure::Public,
            created_at: now.clone(),
            updated_at: now,
        };
        let card = build_agent_card(&persona, "http://localhost:9420");
        assert_eq!(card.name, "Email Buddy");
        assert_eq!(card.url, "http://localhost:9420/a2a/p-1");
        assert_eq!(card.skills.len(), 1);
        assert_eq!(card.skills[0].id, "uc-1");
        assert_eq!(card.skills[0].name, "Summarize emails");
        assert_eq!(card.skills[0].tags, vec!["email".to_string()]);
        assert!(!card.capabilities.streaming);
    }

    #[test]
    fn agent_card_falls_back_to_default_skill_when_no_use_cases() {
        let now = chrono::Utc::now().to_rfc3339();
        let persona = Persona {
            id: "p-2".into(),
            project_id: "default".into(),
            name: "Helper".into(),
            description: Some("Generic helper".into()),
            system_prompt: "Help.".into(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            sensitive: false,
            headless: false,
            max_concurrent: 1,
            timeout_ms: 30_000,
            notification_channels: None,
            last_design_result: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            group_id: None,
            source_review_id: None,
            trust_level: PersonaTrustLevel::Verified,
            trust_origin: PersonaTrustOrigin::Builtin,
            trust_verified_at: None,
            trust_score: 1.0,
            parameters: None,
            gateway_exposure: PersonaGatewayExposure::Public,
            created_at: now.clone(),
            updated_at: now,
        };
        let card = build_agent_card(&persona, "http://x");
        assert_eq!(card.skills.len(), 1);
        assert_eq!(card.skills[0].id, "default");
        assert_eq!(card.skills[0].name, "Helper");
        assert_eq!(card.skills[0].description, "Generic helper");
    }

    #[test]
    fn host_origin_falls_back_to_loopback_without_host_header() {
        let headers = axum::http::HeaderMap::new();
        assert_eq!(host_origin_from_request(&headers), "http://127.0.0.1:9420");
    }

    #[test]
    fn host_origin_uses_supplied_host_header() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(header::HOST, "personas.local:8080".parse().unwrap());
        assert_eq!(host_origin_from_request(&headers), "http://personas.local:8080");
    }
}
