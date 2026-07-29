//! Headless HTTP bridge for dev-tools context scans, mounted on the in-app
//! `local_http` server under `/dev-tools`. Lets a terminal trigger a
//! context-map scan (and register / list projects) WITHOUT the UI — the
//! original ask was a route to scan a project's context map directly.
//!
//! Loopback-only (the server binds 127.0.0.1). The underlying scan command is
//! already unauthenticated on the IPC surface (`require_auth` is a no-op), so
//! this exposes nothing the running app's frontend can't already do.
//!
//! Endpoints (mounted under `/dev-tools`):
//!   GET  /projects                          → list dev projects (find the project_id)
//!   POST /projects                          → register a project { name, root_path, tech_stack? }
//!   POST /scan-codebase                     → start a scan { project_id, root_path?, delta_mode? } → { scan_id }
//!   GET  /scan-status/{scan_id}             → { status, error, lines }
//!   POST /scan-kpis                         → start a KPI scan { project_id, context_id? } → { scan_id }
//!   GET  /kpi-scan-status/{scan_id}         → { status, error, lines }
//!   GET  /kpi-scan-prompt/{project_id}      → the KPI-scan prompt as plain text
//!   POST /scan-use-cases                    → start a feature scan { project_id } → { scan_id }
//!   GET  /use-case-scan-status/{scan_id}    → { status, error, lines }
//!   GET  /kpis/{project_id}?status=proposed → the project's KPIs (triage source)
//!   GET  /contexts/{project_id}             → every context (the per-context sweep walks these)
//!   POST /kpi-decision                      → adopt/adjust/reject one KPI → the updated row
//!
//! The last four exist for the `project-populate` skill, which conducts the
//! app's own scan lanes from a terminal: it gates each lane on freshness, then
//! walks the KPI proposals through the operator in waves. Everything it writes
//! lands through the same repo functions the UI uses, so a triaged proposal is
//! indistinguishable from one accepted on the Factory Overview cards.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::commands::infrastructure::context_generation::{launch_context_scan, scan_status_json};
use crate::commands::infrastructure::kpi_scan::{kpi_scan_prompt, kpi_scan_status_json, launch_kpi_scan};
use crate::commands::infrastructure::kpi_sim::{
    ingest_kpi_sim, prepare_kpi_sim, KpiSimIngestSummary, KpiSimPrepared,
};
use crate::commands::infrastructure::use_case_scan::{launch_use_case_scan, use_case_scan_status_json};
use crate::db::models::{DevContext, DevContextGroup, DevKpi, DevProject, DevUseCase};
use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::AppState;

#[derive(Clone)]
pub struct DevToolsHttp {
    pub app: AppHandle,
}

pub fn router(app: AppHandle) -> Router {
    Router::new()
        .route("/projects", get(list_projects).post(create_project))
        .route("/scan-codebase", post(scan_codebase))
        .route("/scan-status/{scan_id}", get(scan_status))
        .route("/scan-kpis", post(scan_kpis))
        .route("/kpi-scan-status/{scan_id}", get(kpi_scan_status))
        .route("/kpi-scan-prompt/{project_id}", get(kpi_scan_prompt_route))
        .route("/scan-use-cases", post(scan_use_cases))
        .route("/use-case-scan-status/{scan_id}", get(use_case_scan_status))
        .route("/kpis/{project_id}", get(list_kpis))
        .route("/kpi-decision", post(kpi_decision))
        .route("/context-groups/{project_id}", get(list_context_groups))
        .route("/contexts/{project_id}", get(list_contexts))
        .route("/use-cases/{project_id}", get(list_use_cases))
        .route("/kpi-sim/prepare", post(kpi_sim_prepare))
        .route("/kpi-sim/ingest", post(kpi_sim_ingest))
        .with_state(DevToolsHttp { app })
}

/// The port this bridge is reachable on, or `None` before `local_http` has
/// bound. Dispatched sessions need it to reach the routes above, and it is not
/// a constant: `local_http` takes the first free port at or above its preferred
/// one, so it can differ between app launches. Surfacing it lets a dispatch
/// brief name the CURRENT port as a hint while still telling the session to
/// re-probe the range if that port stops answering.
#[tauri::command]
pub fn dev_tools_bridge_port() -> Option<u16> {
    crate::local_http::port()
}

fn db(s: &DevToolsHttp) -> DbPool {
    s.app.state::<Arc<AppState>>().db.clone()
}
fn err(e: AppError) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

async fn list_projects(State(s): State<DevToolsHttp>) -> Result<Json<Vec<DevProject>>, (StatusCode, String)> {
    let projects = repo::list_projects(&db(&s), None).map_err(err)?;
    Ok(Json(projects))
}

#[derive(Deserialize)]
struct CreateProjectBody {
    name: String,
    root_path: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    tech_stack: Option<String>,
}

async fn create_project(
    State(s): State<DevToolsHttp>,
    Json(b): Json<CreateProjectBody>,
) -> Result<Json<DevProject>, (StatusCode, String)> {
    let p = repo::create_project(
        &db(&s),
        &b.name,
        &b.root_path,
        b.description.as_deref(),
        None,
        b.tech_stack.as_deref(),
        None,
        None,
    )
    .map_err(err)?;
    Ok(Json(p))
}

#[derive(Deserialize)]
struct ScanBody {
    project_id: String,
    #[serde(default)]
    root_path: Option<String>,
    #[serde(default)]
    delta_mode: Option<bool>,
}

async fn scan_codebase(
    State(s): State<DevToolsHttp>,
    Json(b): Json<ScanBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    let project = repo::get_project_by_id(&pool, &b.project_id).map_err(err)?;
    let root = b.root_path.as_deref().unwrap_or("");
    let res = launch_context_scan(s.app.clone(), &pool, &project, root, b.delta_mode.unwrap_or(false)).map_err(err)?;
    Ok(Json(res))
}

async fn scan_status(State(_s): State<DevToolsHttp>, Path(scan_id): Path<String>) -> Json<Value> {
    Json(scan_status_json(&scan_id))
}

#[derive(Deserialize)]
struct ScanKpisBody {
    project_id: String,
    /// Scope the scan to ONE context. Omit for the project-wide pass.
    /// A context scan proposes at most 4 KPIs, all bound to that context, and
    /// is gated only on that context's own untriaged queue — so a 236-context
    /// sweep is never blocked by one unreviewed subsystem.
    #[serde(default)]
    context_id: Option<String>,
}

async fn scan_kpis(
    State(s): State<DevToolsHttp>,
    Json(b): Json<ScanKpisBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    let project = repo::get_project_by_id(&pool, &b.project_id).map_err(err)?;
    let res = launch_kpi_scan(s.app.clone(), &pool, &project, b.context_id.as_deref()).map_err(err)?;
    Ok(Json(res))
}

async fn kpi_scan_status(State(_s): State<DevToolsHttp>, Path(scan_id): Path<String>) -> Json<Value> {
    Json(kpi_scan_status_json(&scan_id))
}

/// Returns the KPI-scan prompt as plain text so it can be run by hand.
async fn kpi_scan_prompt_route(
    State(s): State<DevToolsHttp>,
    Path(project_id): Path<String>,
) -> Result<String, (StatusCode, String)> {
    kpi_scan_prompt(&db(&s), &project_id).map_err(err)
}

#[derive(Deserialize)]
struct ScanUseCasesBody {
    project_id: String,
}

/// Start a feature (use-case) proposal scan. Rejects with 500 + the launcher's
/// own message when the project has no context map yet — features are slices
/// through the map, so the caller must scan the codebase first.
async fn scan_use_cases(
    State(s): State<DevToolsHttp>,
    Json(b): Json<ScanUseCasesBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    let project = repo::get_project_by_id(&pool, &b.project_id).map_err(err)?;
    let res = launch_use_case_scan(s.app.clone(), &pool, &project).map_err(err)?;
    Ok(Json(res))
}

async fn use_case_scan_status(
    State(_s): State<DevToolsHttp>,
    Path(scan_id): Path<String>,
) -> Json<Value> {
    Json(use_case_scan_status_json(&scan_id))
}

#[derive(Deserialize)]
struct KpiListQuery {
    /// `active` · `proposed` · `paused` · `archived`. Omit for every status.
    #[serde(default)]
    status: Option<String>,
}

/// 404 when `project_id` matches no registered project.
///
/// Every list route below goes through this first. Without it a mistyped or
/// mis-resolved id returns `200 []`, which reads as "this project has no data"
/// — and a caller acting on that would populate the wrong project, or report an
/// empty project as scanned. An empty collection must mean empty, not absent.
fn require_project(s: &DevToolsHttp, project_id: &str) -> Result<DevProject, (StatusCode, String)> {
    repo::get_project_by_id(&db(s), project_id).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            format!("No project registered with id {project_id}"),
        )
    })
}

async fn list_kpis(
    State(s): State<DevToolsHttp>,
    Path(project_id): Path<String>,
    Query(q): Query<KpiListQuery>,
) -> Result<Json<Vec<DevKpi>>, (StatusCode, String)> {
    require_project(&s, &project_id)?;
    repo::list_kpis(&db(&s), &project_id, q.status.as_deref())
        .map(Json)
        .map_err(err)
}

/// The context map's groups — the Phase-1 freshness gate reads `updated_at`
/// from these. Without this route a standalone run cannot tell a never-scanned
/// project from a current one, and `context-map.json`'s mtime is no substitute
/// (any git checkout or merge rewrites it).
async fn list_context_groups(
    State(s): State<DevToolsHttp>,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<DevContextGroup>>, (StatusCode, String)> {
    require_project(&s, &project_id)?;
    repo::list_context_groups(&db(&s), &project_id)
        .map(Json)
        .map_err(err)
}

/// Every context in the project — the sweep walks this list, one context scan
/// at a time, and needs `file_paths` to rank which ones are worth covering
/// first.
async fn list_contexts(
    State(s): State<DevToolsHttp>,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<DevContext>>, (StatusCode, String)> {
    require_project(&s, &project_id)?;
    repo::list_contexts_by_project(&db(&s), &project_id, None)
        .map(Json)
        .map_err(err)
}

#[derive(Deserialize)]
struct UseCaseListQuery {
    #[serde(default)]
    status: Option<String>,
}

/// The feature inventory — the Phase-2 freshness gate, and the way a caller
/// sees how many proposals already await review before starting another scan.
async fn list_use_cases(
    State(s): State<DevToolsHttp>,
    Path(project_id): Path<String>,
    Query(q): Query<UseCaseListQuery>,
) -> Result<Json<Vec<DevUseCase>>, (StatusCode, String)> {
    require_project(&s, &project_id)?;
    repo::list_use_cases(&db(&s), &project_id, q.status.as_deref())
        .map(Json)
        .map_err(err)
}

#[derive(Deserialize)]
struct KpiSimBody {
    project_id: String,
    /// Ingest only — defaults to the newest un-ingested run.
    #[serde(default)]
    run_dir: Option<String>,
}

/// Write `<repo>/kpi-sim/snapshot.json`. The simulation skill refuses to run
/// without it and only the app may produce it, so a dispatched session needs
/// this route to open its own simulation phase.
async fn kpi_sim_prepare(
    State(s): State<DevToolsHttp>,
    Json(b): Json<KpiSimBody>,
) -> Result<Json<KpiSimPrepared>, (StatusCode, String)> {
    prepare_kpi_sim(&db(&s), &b.project_id).map(Json).map_err(err)
}

/// Ingest a finished simulation run. Same validation and idempotency as the IPC
/// command — a run dir is marked once ingested and refused on a second attempt.
async fn kpi_sim_ingest(
    State(s): State<DevToolsHttp>,
    Json(b): Json<KpiSimBody>,
) -> Result<Json<KpiSimIngestSummary>, (StatusCode, String)> {
    ingest_kpi_sim(&db(&s), &b.project_id, b.run_dir)
        .map(Json)
        .map_err(err)
}

#[derive(Deserialize)]
struct KpiDecisionBody {
    kpi_id: String,
    /// `active` adopts the proposal, `archived` rejects it, `paused` defers it.
    status: String,
    /// Optional operator-adjusted target, applied in the same write as the
    /// status so an "adopt with a different number" decision is one row change.
    #[serde(default)]
    target_value: Option<f64>,
}

/// Record one triage decision on a KPI. The skill calls this once per proposal
/// as the operator answers, rather than batching, so an interrupted run leaves
/// every already-answered proposal correctly filed.
async fn kpi_decision(
    State(s): State<DevToolsHttp>,
    Json(b): Json<KpiDecisionBody>,
) -> Result<Json<DevKpi>, (StatusCode, String)> {
    const ALLOWED: [&str; 4] = ["active", "proposed", "paused", "archived"];
    if !ALLOWED.contains(&b.status.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("status must be one of {ALLOWED:?}, got {:?}", b.status),
        ));
    }
    repo::update_kpi(
        &db(&s),
        &b.kpi_id,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        b.target_value.map(Some),
        None,
        None,
        Some(&b.status),
        None,
        None,
        None,
        None,
    )
    .map(Json)
    .map_err(err)
}
