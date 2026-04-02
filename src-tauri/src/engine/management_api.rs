//! Management API -- extends the webhook HTTP server with /api/* routes
//! for persona execution, lab operations, and version management.
//!
//! These endpoints allow external tools (MCP servers, CLI scripts) to control
//! Personas without going through the Tauri IPC layer.

use std::sync::Arc;
use tauri::Manager;

use axum::{
    extract::{Path, Query, State as AxumState},
    http::{header, Method, StatusCode},
    response::IntoResponse,
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
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::engine::test_runner::{self, TestModelConfig};
use crate::engine::types::EphemeralPersona;
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
        .with_state(Arc::new(state))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]),
        )
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
