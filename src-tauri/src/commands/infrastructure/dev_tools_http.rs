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
//!   GET  /projects                 → list dev projects (find the project_id)
//!   POST /projects                 → register a project { name, root_path, tech_stack? }
//!   POST /scan-codebase            → start a scan { project_id, root_path?, delta_mode? } → { scan_id }
//!   GET  /scan-status/{scan_id}    → { status, error, lines }

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::commands::infrastructure::context_generation::{launch_context_scan, scan_status_json};
use crate::commands::infrastructure::kpi_scan::{kpi_scan_prompt, kpi_scan_status_json, launch_kpi_scan};
use crate::db::models::DevProject;
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
        .with_state(DevToolsHttp { app })
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
}

async fn scan_kpis(
    State(s): State<DevToolsHttp>,
    Json(b): Json<ScanKpisBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    let project = repo::get_project_by_id(&pool, &b.project_id).map_err(err)?;
    let res = launch_kpi_scan(s.app.clone(), &pool, &project).map_err(err)?;
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
