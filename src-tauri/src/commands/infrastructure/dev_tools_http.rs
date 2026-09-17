//! Headless HTTP bridge for dev-tools context scans, mounted on the in-app
//! `local_http` server under `/dev-tools`. Lets a terminal trigger a
//! context-map scan (and register / list projects) WITHOUT the UI — the
//! original ask was a route to scan a project's context map directly.
//!
//! Authentication: every route here sits behind `local_http`'s admission layer
//! (`local_http::auth`) — a `Host` allowlist that defeats DNS rebinding, plus
//! a shared secret published to same-user consumers at
//! `~/.personas/local-http.json`. Terminal callers (`project-populate`,
//! `kpi-sim`) read the port AND the token from that file; see
//! `.claude/skills/project-populate/references/bridge.md`.
//!
//! The header here previously justified having no auth at all with "loopback
//! only … this exposes nothing the running app's frontend can't already do".
//! That inherited a Public-IPC classification nobody had made for this
//! transport, and it was wrong on reachability: a DNS-rebound page becomes
//! same-origin with `127.0.0.1:<port>` and can read responses, and `127.0.0.1`
//! is machine-scoped rather than user-scoped. `POST /projects` +
//! `POST /scan-codebase` was a chain to `spawn_headless_claude` with an
//! attacker-chosen `current_dir` under `--dangerously-skip-permissions`.
//!
//! Endpoints (mounted under `/dev-tools`):
//!   GET  /projects                          → list dev projects (find the project_id)
//!   POST /projects                          → register a project { name, root_path, tech_stack? }
//!   POST /projects/create                   → git init + scaffold + register + assign
//!                                             { workspace, name, description?, techStack?,
//!                                               template?, root? }
//!   GET  /workspaces                        → { id, name, protected, projectCount }[]
//!   POST /workspaces/{id}/protect           → { lastWorkingVersion } → the workspace row
//!   POST /scan-codebase                     → start a scan { project_id, root_path?, delta_mode?, subtree? } → { scan_id }
//!   GET  /scan-status/{scan_id}             → { status, error, lines }
//!   GET  /scans/{project_id}                → every known context scan + its subtree (don't relaunch a running scope)
//!   POST /scan-kpis                         → start a KPI scan { project_id, context_id? } → { scan_id }
//!   GET  /kpi-scan-status/{scan_id}         → { status, error, lines }
//!   GET  /kpi-scan-prompt/{project_id}      → the KPI-scan prompt as plain text
//!   POST /scan-use-cases                    → start a feature scan { project_id } → { scan_id }
//!   GET  /use-case-scan-status/{scan_id}    → { status, error, lines }
//!   GET  /kpis/{project_id}?status=proposed → the project's KPIs (triage source)
//!   GET  /contexts/{project_id}             → every context + its `source` provenance
//!                                             (`declared` = from the project's own map; absent = derived by the scan)
//!   POST /contexts/{project_id}/declare     → DECLARE the context map, same JSON as a declared
//!                                             `context-map.json` { groups?: [...], contexts: [...] }.
//!                                             Upserts groups/contexts stamped `source: declared`;
//!                                             a malformed body is a 400 naming the field. `contexts: []`
//!                                             is a valid declaration of emptiness. The body needs no
//!                                             `"declared": true` marker (calling this IS the claim) — but
//!                                             a persona persisting the same map to disk MUST write that
//!                                             marker at the top level and commit it, or the scan reads
//!                                             the file as a plain export artifact and ignores it.
//!   POST /retire-contexts                   → delete contexts by explicit id { project_id, context_ids }
//!   POST /kpi-decision                      → adopt/adjust/reject one KPI → the updated row
//!   POST /kpi-update                        → fix a KPI's definition (description, measure_config, …)
//!   POST /kpi-rebind                        → re-point a KPI at a context { kpi_id, context_id }
//!   POST /export-context-map                → re-write context-map.json + CLAUDE.md from the DB (after repairs).
//!                                             REFUSES (400) only when `context-map.json` is git-tracked AND
//!                                             carries `"declared": true` — that file is the project's
//!                                             declaration, not an export target. A tracked file without the
//!                                             marker is an ordinary export artifact and is overwritten.
//!   POST /consolidate-contexts              → merge micro-contexts into the 10-30 band, re-pointing every anchored artifact { project_id, dry_run }
//!   POST /repair-cross-refs                 → re-point cross_refs orphaned by past consolidations { project_id, apply } — DRY RUN unless `apply`
//!   POST /app-master/adopt                  → adopt an App Master for a project { project, recipes[], model?, maxConcurrent?, scopeRung?, enabled?, name? }
//!   GET  /app-master/{project_id}           → the project's current App Master adoption, or `null`
//!   POST /architect/adopt                   → adopt an Architect for a WORKSPACE { workspace, recipes[], model?, maxConcurrent?, scopeRung?, enabled?, name? }
//!   GET  /architect/{workspace}             → the workspace's current Architect adoption, or `null`
//!   POST /hire                              → ask kp to compose a role from a need and dispatch
//!                                             it back as a persona { personaId, projectId, need,
//!                                             budgetUsd?, dryRun? }
//!
//! Write-back routes for workers — the door a dispatched App Master run reports
//! through (`app_master_writeback`). Without them a headless run's only output
//! was a git commit, and the loop re-offered work it had already done:
//!   POST /ideas/{idea_id}/outcome           → { outcome: delivered|declined|blocked|already_delivered, note?, branch?, commit?, pr_url? }
//!                                             `already_delivered` closes an item the default branch already
//!                                             satisfies (commit REQUIRED) — a delivery, not a refusal, so it
//!                                             writes no rejection constraint.
//!   POST /ideas                             → file a deduped backlog item { project_id, title, description?, effort, impact, risk (each REQUIRED, 1-5), goal?, … }
//!                                             A first filing short of a scale is a 400 naming what is missing:
//!                                             an unrated idea is never accepted automatically. 1 documentation or a reversible local change ·
//!                                             2 code behind a test · 3 touches a route, a contract or a schema ·
//!                                             4 touches ledger, settlement or security semantics ·
//!                                             5 irreversible or external. Risk 1-2 is accepted by the project's
//!                                             mechanical triage rule without a human. Re-filing an idea that was
//!                                             filed unrated fills its scales in and answers `outcome: "rated"`.
//!   POST /kpis                              → declare a KPI { project_id, name, measure_kind?, … }
//!   POST /kpis/{kpi_id}/measure             → record a reading { value, source?, env?, evidence?, note? }
//!   POST /ideas/{idea_id}/goal              → say which goal an idea's work served { goal } — binds an unbound
//!                                             idea and attributes its tasks that serve no goal; never moves work
//!   GET  /goals/{project_id}                → the project's goals with checklist items and attached work counts
//!   POST /goals/{goal_id}/amend             → { title?, description?, status? } — `done` is refused (acceptance
//!                                             is the operator's); creating a goal stays in the decide lane
//!   POST /goals/{goal_id}/items/{item_id}   → { done } — tick a checklist item and recompute progress; a
//!                                             verification gate is refused (its test closes it)
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

use crate::commands::infrastructure::app_master_adopt;
use crate::commands::infrastructure::app_master_writeback;
use crate::commands::infrastructure::architect_adopt;
use crate::commands::infrastructure::context_declaration;
use crate::commands::infrastructure::context_generation::{
    confine_to_project_root, launch_context_scan, list_scans_json, scan_status_json,
};
use crate::commands::infrastructure::context_map_export::write_context_map_artifacts;
use crate::commands::infrastructure::kpi_scan::{
    kpi_scan_prompt, kpi_scan_status_json, launch_kpi_scan,
};
use crate::commands::infrastructure::kpi_sim::{
    ingest_kpi_sim, prepare_kpi_sim, KpiSimIngestSummary, KpiSimPrepared,
};
use crate::commands::infrastructure::project_scaffold;
use crate::commands::infrastructure::use_case_scan::{
    launch_use_case_scan, use_case_scan_status_json,
};
use crate::db::models::{DevContextGroup, DevKpi, DevProject, DevUseCase};
use crate::db::repos::dev_tools as repo;
use crate::db::repos::dev_workspaces as ws_repo;
use crate::db::DbPool;
use crate::engine::kp_hire_request;
use crate::error::AppError;
use crate::AppState;

#[derive(Clone)]
pub struct DevToolsHttp {
    pub app: AppHandle,
}

pub fn router(app: AppHandle) -> Router {
    Router::new()
        .route("/projects", get(list_projects).post(create_project))
        .route("/projects/create", post(create_project_repository_route))
        .route("/workspaces", get(list_workspaces_route))
        .route("/workspaces/{id}/protect", post(protect_workspace_route))
        .route("/scan-codebase", post(scan_codebase))
        .route("/scan-status/{scan_id}", get(scan_status))
        .route("/scans/{project_id}", get(list_scans))
        .route("/scan-kpis", post(scan_kpis))
        .route("/kpi-scan-status/{scan_id}", get(kpi_scan_status))
        .route("/kpi-scan-prompt/{project_id}", get(kpi_scan_prompt_route))
        .route("/scan-use-cases", post(scan_use_cases))
        .route("/use-case-scan-status/{scan_id}", get(use_case_scan_status))
        .route("/kpis/{project_id}", get(list_kpis))
        .route("/kpi-decision", post(kpi_decision))
        .route("/kpi-update", post(kpi_update))
        .route("/kpi-rebind", post(kpi_rebind))
        .route("/context-groups/{project_id}", get(list_context_groups))
        .route("/contexts/{project_id}", get(list_contexts))
        .route("/contexts/{project_id}/declare", post(declare_contexts))
        .route("/dedupe-context-groups", post(dedupe_context_groups))
        .route("/dedupe-contexts", post(dedupe_contexts))
        .route("/retire-contexts", post(retire_contexts))
        .route("/prune-nonsource-contexts", post(prune_nonsource_contexts))
        .route("/merge-context-groups", post(merge_context_groups))
        .route("/export-context-map", post(export_context_map))
        .route("/export-skill-registry", post(export_skill_registry))
        .route("/consolidate-contexts", post(consolidate_contexts_route))
        .route("/repair-cross-refs", post(repair_cross_refs_route))
        .route("/use-cases/{project_id}", get(list_use_cases))
        .route("/use-case-decision", post(use_case_decision))
        .route("/kpi-sim/prepare", post(kpi_sim_prepare))
        .route("/kpi-sim/ingest", post(kpi_sim_ingest))
        .route("/app-master/adopt", post(app_master_adopt_route))
        .route("/app-master/{project_id}", get(app_master_state))
        .route("/architect/adopt", post(architect_adopt_route))
        .route("/architect/{workspace}", get(architect_state))
        .route("/hire", post(hire_route))
        // Worker write-back (see the module header).
        .route("/ideas", post(file_idea_route))
        .route("/ideas/{idea_id}/outcome", post(idea_outcome_route))
        .route("/kpis", post(create_kpi_route))
        .route("/kpis/{kpi_id}/measure", post(measure_kpi_route))
        .route("/ideas/{idea_id}/goal", post(idea_goal_route))
        .route("/goals/{project_id}", get(list_goals_route))
        .route("/goals/{goal_id}/amend", post(amend_goal_route))
        .route("/goals/{goal_id}/items/{item_id}", post(goal_item_route))
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

/// A refused path is the caller's mistake, not ours — 400, with the reason.
fn bad_request(e: AppError) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, e.to_string())
}

/// Map an `AppError` to the status its CAUSE deserves rather than collapsing
/// everything to 500: a caller who named a project that does not exist has
/// made a 400, and a caller who named a recipe slug nobody seeded has made a
/// 404. Both are actionable; a 500 is not.
fn status_for(e: AppError) -> (StatusCode, String) {
    let code = match e {
        AppError::Validation(_) => StatusCode::BAD_REQUEST,
        AppError::NotFound(_) => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (code, e.to_string())
}

/// Canonicalise a project root, refusing anything that is not an existing
/// directory. The Windows verbatim prefix `canonicalize` prepends is stripped:
/// it round-trips through `Path` fine but leaks into `context-map.json`,
/// `CLAUDE.md` and every UI surface that shows a project path.
fn canonical_project_root(raw: &str) -> Result<String, AppError> {
    personas_core::validation::require_non_empty("root_path", raw)?;
    let trimmed = raw.trim();
    let p = std::path::Path::new(trimmed).canonicalize().map_err(|e| {
        AppError::Validation(format!("root_path is not a directory: {trimmed} ({e})"))
    })?;
    if !p.is_dir() {
        return Err(AppError::Validation(format!(
            "root_path is not a directory: {trimmed}"
        )));
    }
    let s = p.to_string_lossy().to_string();
    const VERBATIM: &str = "\\\\?\\";
    Ok(s.strip_prefix(VERBATIM).map(str::to_string).unwrap_or(s))
}

async fn list_projects(
    State(s): State<DevToolsHttp>,
) -> Result<Json<Vec<DevProject>>, (StatusCode, String)> {
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
    // `root_path` had NO validation at all, and it is the value every later
    // scan of this project confines itself to — so it is the head of the
    // chain, not an incidental field. Require a directory that exists now and
    // store its canonical form, so the confinement check downstream compares
    // against a real path rather than a string the caller invented.
    let root_path = canonical_project_root(&b.root_path).map_err(bad_request)?;
    // Same identity door as the Tauri command: idempotent re-register,
    // marker-proven relocation, clone collision refused.
    let p = crate::db::project_identity::register_project(
        &db(&s),
        &b.name,
        &root_path,
        b.description.as_deref(),
        None,
        b.tech_stack.as_deref(),
        None,
        None,
    )
    .map_err(err)?;
    Ok(Json(p))
}

// ============================================================================
// One-step repository + project creation, and the never-delete tag
// ============================================================================
//
// `POST /projects` registers a directory that already exists. These three are
// the Grand Simulation's opening move (`docs/architecture/grand-simulation.md`
// §3 G6 and rule 10): create the repository AND the project in one call, tag
// the workspace whose data must never be deleted, and list workspaces so a
// script can find the one it tagged.

/// `git init` a new repository under the simulation root, scaffold it, and
/// register it into a workspace. The whole operation lives in
/// `project_scaffold`; this is the adapter.
async fn create_project_repository_route(
    State(s): State<DevToolsHttp>,
    Json(b): Json<project_scaffold::CreateProjectRepositoryInput>,
) -> Result<Json<project_scaffold::CreatedProjectRepository>, (StatusCode, String)> {
    let pool = db(&s);
    project_scaffold::create_project_repository_inner(s.app.clone(), pool, b)
        .await
        .map(Json)
        .map_err(status_for)
}

/// One workspace as the listing reports it. `protected` is the
/// `last_working_version` tag; `project_count` is what a script checks before
/// deciding a workspace is the one it built.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSummary {
    id: String,
    name: String,
    protected: bool,
    project_count: usize,
}

/// Blocking, and separated from the handler so the listing's shape is pinned
/// by a test rather than by driving axum.
fn workspace_summaries(pool: &DbPool) -> Result<Vec<WorkspaceSummary>, AppError> {
    ws_repo::list_workspaces(pool)?
        .into_iter()
        .map(|w| {
            let count = ws_repo::list_workspace_projects(pool, &w.id)?.len();
            Ok(WorkspaceSummary {
                id: w.id,
                name: w.name,
                protected: w.last_working_version,
                project_count: count,
            })
        })
        .collect()
}

async fn list_workspaces_route(
    State(s): State<DevToolsHttp>,
) -> Result<Json<Vec<WorkspaceSummary>>, (StatusCode, String)> {
    let pool = db(&s);
    let handle = tokio::task::spawn_blocking(move || workspace_summaries(&pool));
    handle
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("list workspaces: task failed: {e}"),
            )
        })?
        .map(Json)
        .map_err(status_for)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtectWorkspaceBody {
    /// Set the never-delete tag, or clear it.
    last_working_version: bool,
}

async fn protect_workspace_route(
    State(s): State<DevToolsHttp>,
    Path(id): Path<String>,
    Json(b): Json<ProtectWorkspaceBody>,
) -> Result<Json<crate::db::models::DevWorkspace>, (StatusCode, String)> {
    let pool = db(&s);
    let handle = tokio::task::spawn_blocking(move || {
        crate::db::repos::workspaces::protection::set_workspace_protection(
            &pool,
            &id,
            b.last_working_version,
        )
    });
    handle
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("protect workspace: task failed: {e}"),
            )
        })?
        .map(Json)
        .map_err(status_for)
}

#[derive(Deserialize)]
struct ScanBody {
    project_id: String,
    #[serde(default)]
    root_path: Option<String>,
    #[serde(default)]
    delta_mode: Option<bool>,
    /// Scope the scan to ONE directory (repo-relative, e.g. `src/features/agents`).
    /// Subtree scans run CONCURRENTLY with each other and each emits only its own
    /// contexts — the mode that makes a large codebase mappable, since one session
    /// cannot emit a whole map and stops early without saying so.
    #[serde(default)]
    subtree: Option<String>,
}

async fn scan_codebase(
    State(s): State<DevToolsHttp>,
    Json(b): Json<ScanBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    let project = repo::get_project_by_id(&pool, &b.project_id).map_err(err)?;
    let root = b.root_path.as_deref().unwrap_or("");
    let res = launch_context_scan(
        s.app.clone(),
        &pool,
        &project,
        root,
        b.delta_mode.unwrap_or(false),
        b.subtree.as_deref(),
    )
    .map_err(err)?;
    Ok(Json(res))
}

async fn scan_status(State(_s): State<DevToolsHttp>, Path(scan_id): Path<String>) -> Json<Value> {
    Json(scan_status_json(&scan_id))
}

/// Every context scan this process knows about for a project, with its scope.
///
/// Exists because a scan_id was previously the ONLY handle on a scan: lose it and
/// the scan becomes unobservable, so a client's safest move was to relaunch —
/// scanning the same subtree twice, at full token cost, producing two maps of one
/// tree. A sweep driven from a shell is exactly where ids get lost (a `curl`
/// inside a `while read` loop consumes the loop's stdin and its output vanishes).
/// With this, "did that POST actually start?" is answerable.
///
/// Returns per-scan `subtree` (null = whole tree) so a caller can match the scope
/// it is about to launch against what is already running, and a `running` count so
/// the common check is a single field. Only the in-memory registry is consulted —
/// context scans are not persisted, and entries evict 30 minutes after finishing.
async fn list_scans(
    State(s): State<DevToolsHttp>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    require_project(&s, &project_id)?;
    Ok(Json(list_scans_json(&project_id)))
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
    let res =
        launch_kpi_scan(s.app.clone(), &pool, &project, b.context_id.as_deref()).map_err(err)?;
    Ok(Json(res))
}

async fn kpi_scan_status(
    State(_s): State<DevToolsHttp>,
    Path(scan_id): Path<String>,
) -> Json<Value> {
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
///
/// Each row carries a `source`: `"declared"` when it came from the project's own
/// context map (a committed `context-map.json`, or `POST …/declare`), and
/// `"derived"` when the code scan inferred it. A caller that cannot tell those
/// apart cannot tell a project's statement about itself from Personas' last
/// guess — which is the whole reason the declaration door exists.
async fn list_contexts(
    State(s): State<DevToolsHttp>,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<Value>>, (StatusCode, String)> {
    require_project(&s, &project_id)?;
    let pool = db(&s);
    let contexts = repo::list_contexts_by_project(&pool, &project_id, None).map_err(err)?;
    // "Found nothing" and "the last look was refused" are different answers,
    // and only one of them is an empty list. A project whose latest context
    // scan failed — a committed map with a category outside the taxonomy, a
    // root that is not a directory — answers 409 with the reason, so the
    // worker reading this door reports the refusal instead of "0 contexts"
    // (bank-invest, 2026-09-10, one day and one ask lost to that reading).
    if contexts.is_empty() {
        let scans = crate::db::repos::dev::scans::list_scans(&pool, Some(&project_id), Some(20))
            .map_err(err)?;
        if let Some((scan_id, reason)) = refused_context_map(&scans) {
            return Err((
                StatusCode::CONFLICT,
                serde_json::json!({
                    "error": format!("the last context scan was refused: {reason}"),
                    "scan_id": scan_id,
                    "contexts": 0,
                    "hint": "fix the cause named in `error` and POST /dev-tools/scan-codebase again; \
                             GET /dev-tools/scans/{project_id} lists the attempts",
                })
                .to_string(),
            ));
        }
    }
    let sources = repo::get_context_sources(&pool, &project_id).map_err(err)?;
    Ok(Json(
        contexts
            .into_iter()
            .map(|c| {
                let source = sources
                    .get(&c.id)
                    .cloned()
                    .unwrap_or_else(|| "derived".to_string());
                let mut v = serde_json::to_value(&c).unwrap_or_else(|_| serde_json::json!({}));
                if let Some(obj) = v.as_object_mut() {
                    obj.insert("source".to_string(), Value::String(source));
                }
                v
            })
            .collect(),
    ))
}

/// DECLARE this project's context map, without committing a file first.
///
/// Same JSON body as a declared `context-map.json`, same validation, same
/// `source: declared` provenance — so an App Master that has just worked out
/// how its project is organised can say so from inside its run, and the next
/// scan reads a declaration instead of re-deriving zero contexts from a tree of
/// documents. `contexts: []` declares emptiness and is accepted.
///
/// The body does not need the `"declared": true` marker: POSTing here IS the
/// claim of authority. The marker exists for the FILE path, where the same
/// bytes would otherwise be indistinguishable from the export's own output. A
/// persona that also writes the map to `context-map.json` must add the marker
/// and commit the file, or the next scan will ignore it.
async fn declare_contexts(
    State(s): State<DevToolsHttp>,
    Path(project_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, String)> {
    require_project(&s, &project_id)?;
    let map = context_declaration::parse_declared_map(&body.to_string()).map_err(bad_request)?;
    let summary =
        context_declaration::apply_declared_map(&db(&s), &project_id, &map).map_err(err)?;
    Ok(Json(serde_json::json!({
        "project_id": project_id,
        "source": "declared",
        "groups_upserted": summary.groups_upserted,
        "contexts_upserted": summary.contexts_upserted,
        "contexts_pruned": summary.contexts_pruned,
        "files_declared": summary.files_declared,
    })))
}

#[derive(Deserialize)]
struct ExportContextMapBody {
    project_id: String,
    /// Defaults to the project's registered `root_path`, like `/scan-codebase`.
    #[serde(default)]
    root_path: Option<String>,
}

/// Re-write `context-map.json` + the CLAUDE.md marked block from CURRENT database
/// state, without running a scan.
///
/// The export used to happen only at the end of a scan, while every repair route
/// on this bridge — dedupe-contexts, dedupe-context-groups, retire-contexts,
/// prune-nonsource-contexts, merge-context-groups — mutates the map and returns
/// without touching the file. So the documented good practice (sweep, then
/// consolidate group sprawl) is exactly what leaves the exported artifacts stale:
/// after a real sweep the file described 236 contexts across 34 groups while the
/// database held 233 across 25, including groups that had been merged away.
///
/// That gap matters more than a stale build artifact normally would, because the
/// generated CLAUDE.md block instructs every agent working in that repo to read
/// `context-map.json` and scope its edits to the matching context — so the drift
/// is read as ground truth by the next agent, and it points at groups that no
/// longer exist. Repair, then export.
async fn export_context_map(
    State(s): State<DevToolsHttp>,
    Json(b): Json<ExportContextMapBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let project = require_project(&s, &b.project_id)?;
    // This route WRITES: `context-map.json` plus a replaced block inside the
    // target's `CLAUDE.md`. An unconstrained `root_path` therefore let a
    // caller author agent instructions anywhere on disk. Confine it to the
    // project's registered root, same rule as a scan.
    let root = confine_to_project_root(&project.root_path, b.root_path.as_deref().unwrap_or(""))
        .map_err(bad_request)?;
    // A tracked `context-map.json` makes this a refusal, not a failure: the
    // caller asked to overwrite the project's own declaration. That is a 400
    // with the reason, not a 500.
    let contexts =
        write_context_map_artifacts(&db(&s), &b.project_id, &root).map_err(status_for)?;
    Ok(Json(
        serde_json::json!({ "project_id": b.project_id, "root_path": root, "contexts": contexts }),
    ))
}

/// Write `.personas/skill-registry.json` from the CURRENT database and
/// filesystem state, without running a scan.
///
/// The registry was only ever produced as a side effect of a context scan
/// (`write_harness_docs`) or a skill install, so a project that simply wanted
/// the offline sync surface had to pay for a full rescan to get it — and a full
/// rescan rebuilds the whole context map, which is both expensive and, until
/// the coverage guard landed, capable of replacing a good map with a worse one.
/// Nothing about the registry needs a scan: it reads skill directories off disk
/// and usage counts from the DB. This exposes the existing on-demand exporter
/// (`dev_tools_export_skill_registry`) to the headless bridge so a terminal can
/// refresh it directly.
async fn export_skill_registry(
    State(s): State<DevToolsHttp>,
    Json(b): Json<ExportSkillRegistryBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let project = require_project(&s, &b.project_id)?;
    let count = crate::commands::infrastructure::skill_registry_export::write_skill_registry(
        &db(&s),
        &b.project_id,
        &project.root_path,
        // No library override on the headless bridge: it has no workspace in
        // scope, so it compares against the home library exactly as it did
        // before registries existed. A terminal refresh must not silently claim
        // a different library than the one it read.
        None,
    )
    .map_err(err)?;
    Ok(Json(serde_json::json!({
        "project_id": b.project_id,
        "root_path": project.root_path,
        "skills": count,
    })))
}

#[derive(Deserialize)]
struct ExportSkillRegistryBody {
    project_id: String,
}

#[derive(Deserialize)]
struct ConsolidateContextsBody {
    project_id: String,
    /// Compute + return the merge plan without touching the database.
    #[serde(default)]
    dry_run: bool,
}

/// Merge micro-contexts into the 10-30-file band without a rescan, keeping
/// every anchored artifact (KPIs, use-case slices, ideas, goals, memory
/// nodes, cross_refs) attached via re-pointing. See context_consolidate.rs.
/// Repair, then export: a non-dry run rewrites context-map.json + the backlog
/// digest.
///
/// The audit runs on the way out — on the dry run over the CURRENT map (so the
/// caller sees what is already broken before deciding), and on the real run
/// over the merged map (so a merge that damaged something says so in the same
/// response instead of being discovered two days later). It is advisory: an
/// audit failure never fails the consolidation.
async fn consolidate_contexts_route(
    State(s): State<DevToolsHttp>,
    Json(b): Json<ConsolidateContextsBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let project = require_project(&s, &b.project_id)?;
    let pool = db(&s);
    let mut out = crate::commands::infrastructure::context_consolidate::consolidate_contexts(
        &pool,
        &b.project_id,
        b.dry_run,
    )
    .map_err(err)?;
    if !b.dry_run {
        // The merge has already landed in the database. A refused export (the
        // project's `context-map.json` is committed, so it is a declaration and
        // not ours to overwrite) is reported in the response rather than raised
        // as a failure, which would report the whole consolidation as not having
        // happened when it did.
        match write_context_map_artifacts(&pool, &b.project_id, &project.root_path) {
            Ok(exported) => out["exportedContexts"] = serde_json::json!(exported),
            Err(e) => out["exportSkipped"] = serde_json::json!(e.to_string()),
        }
        let _ = crate::commands::infrastructure::context_map_export::write_backlog_digest(
            &pool,
            &b.project_id,
            &project.root_path,
        );
    }
    out["audit"] = attach_audit(&pool, &b.project_id);
    Ok(Json(out))
}

/// Run the context audit and shape it for a bridge response. Advisory by
/// contract, so an error becomes a reported reason, never a failed request.
fn attach_audit(pool: &DbPool, project_id: &str) -> Value {
    use crate::commands::infrastructure::context_audit;
    match context_audit::audit_from_db(pool, project_id) {
        Ok(report) => {
            let line = context_audit::summarize(&report);
            tracing::info!(project_id, audit = %line, "context audit");
            serde_json::json!({
                "summary": line,
                "balanced": report.balanced,
                "totals": report.totals,
                "findings": report.findings,
            })
        }
        Err(e) => serde_json::json!({ "error": e.to_string() }),
    }
}

#[derive(Deserialize)]
struct RepairCrossRefsBody {
    project_id: String,
    /// DRY RUN BY DEFAULT. `dev_contexts` has no version column, no soft-delete
    /// and no `absorbed_from`, and context scans are never recorded in
    /// `dev_scans` — a bad repair cannot be rolled back from inside the app, so
    /// writing is an explicit second act.
    #[serde(default)]
    apply: bool,
}

/// Repair `cross_refs` orphaned by consolidations that ran before the merge
/// rewrote them, resolving ghosts through the `[Consolidated …: absorbed …]`
/// markers those merges stamped into each survivor's description. Reports what
/// it cannot resolve rather than deleting it. Never wired into a scan hook.
async fn repair_cross_refs_route(
    State(s): State<DevToolsHttp>,
    Json(b): Json<RepairCrossRefsBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let project = require_project(&s, &b.project_id)?;
    let pool = db(&s);
    let plan = crate::commands::infrastructure::context_consolidate::repair_cross_refs(
        &pool,
        &b.project_id,
        b.apply,
    )
    .map_err(err)?;
    let mut out = serde_json::to_value(&plan).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("serialize repair plan: {e}"),
        )
    })?;
    if b.apply && plan.contexts_written > 0 {
        // Repair, then export — the same discipline the consolidate route
        // follows, so context-map.json can't keep publishing the dead pointers.
        // A declared (git-tracked) map refuses the export; the repair still
        // happened, so say so rather than failing the whole call.
        match write_context_map_artifacts(&pool, &b.project_id, &project.root_path) {
            Ok(exported) => out["exportedContexts"] = serde_json::json!(exported),
            Err(e) => out["exportSkipped"] = serde_json::json!(e.to_string()),
        }
    }
    out["audit"] = attach_audit(&pool, &b.project_id);
    Ok(Json(out))
}

#[derive(Deserialize)]
struct MergeGroupsBody {
    project_id: String,
    /// Explicit `from -> into` group-name pairs. Deliberately NOT inferred:
    /// the overlaps this repairs are semantic ("Execution & Quality Data" into
    /// "Execution Engine"), and no string rule distinguishes those from two
    /// groups that genuinely differ. A human picks; this just applies it.
    merges: Vec<GroupMerge>,
    /// Also delete groups left holding no contexts after the merges.
    #[serde(default)]
    delete_empty: bool,
}

#[derive(Deserialize)]
struct GroupMerge {
    from: String,
    into: String,
}

/// Reassign every context from one group to another, then delete the emptied
/// source group. Unknown names are reported rather than silently ignored, so a
/// typo in a merge plan cannot look like a successful no-op.
async fn merge_context_groups(
    State(s): State<DevToolsHttp>,
    Json(b): Json<MergeGroupsBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    require_project(&s, &b.project_id)?;

    let groups = repo::list_context_groups(&pool, &b.project_id).map_err(err)?;
    let by_name: std::collections::HashMap<&str, &str> = groups
        .iter()
        .map(|g| (g.name.as_str(), g.id.as_str()))
        .collect();

    let contexts = repo::list_contexts_by_project(&pool, &b.project_id, None).map_err(err)?;
    let (mut moved, mut deleted) = (0usize, 0usize);
    let mut unknown: Vec<String> = Vec::new();

    for m in &b.merges {
        let (Some(from_id), Some(into_id)) =
            (by_name.get(m.from.as_str()), by_name.get(m.into.as_str()))
        else {
            unknown.push(format!("{} -> {}", m.from, m.into));
            continue;
        };
        if from_id == into_id {
            continue;
        }
        for c in contexts
            .iter()
            .filter(|c| c.group_id.as_deref() == Some(*from_id))
        {
            if repo::move_context_to_group(&pool, &c.id, Some(into_id)).is_ok() {
                moved += 1;
            }
        }
        if repo::delete_context_group(&pool, from_id).unwrap_or(false) {
            deleted += 1;
        }
    }

    if b.delete_empty {
        let after = repo::list_contexts_by_project(&pool, &b.project_id, None).map_err(err)?;
        let occupied: std::collections::HashSet<&str> =
            after.iter().filter_map(|c| c.group_id.as_deref()).collect();
        for g in repo::list_context_groups(&pool, &b.project_id).map_err(err)? {
            if !occupied.contains(g.id.as_str())
                && repo::delete_context_group(&pool, &g.id).unwrap_or(false)
            {
                deleted += 1;
            }
        }
    }

    Ok(Json(serde_json::json!({
        "contexts_moved": moved,
        "groups_deleted": deleted,
        "unknown_pairs": unknown,
    })))
}

/// Strip generated / non-source paths from existing contexts, deleting any
/// context left holding nothing.
///
/// Repairs maps written before the write-path filter landed. An i18n subtree
/// scan mapped 807 locale JSON files into 15 contexts (`section-locales-ar`,
/// `-bn`, …) because the coverage counter excluded those trees but nothing
/// stopped the scan from claiming them. Contexts that merely *include* a few
/// non-source paths are trimmed and kept; only the ones that were entirely
/// non-source disappear. Idempotent.
async fn prune_nonsource_contexts(
    State(s): State<DevToolsHttp>,
    Json(b): Json<DedupeGroupsBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    use crate::commands::infrastructure::context_generation::is_mappable_path;
    let pool = db(&s);
    require_project(&s, &b.project_id)?;

    let contexts = repo::list_contexts_by_project(&pool, &b.project_id, None).map_err(err)?;
    let (mut trimmed, mut deleted, mut paths_removed) = (0usize, 0usize, 0usize);

    for c in contexts {
        let paths: Vec<String> = serde_json::from_str(&c.file_paths).unwrap_or_default();
        if paths.is_empty() {
            continue;
        }
        let kept: Vec<String> = paths
            .iter()
            .filter(|p| is_mappable_path(p))
            .cloned()
            .collect();
        if kept.len() == paths.len() {
            continue;
        }
        paths_removed += paths.len() - kept.len();
        if kept.is_empty() {
            if repo::delete_context(&pool, &c.id).unwrap_or(false) {
                deleted += 1;
            }
        } else {
            let json = serde_json::to_string(&kept).unwrap_or_else(|_| "[]".into());
            if repo::update_context(
                &pool,
                &c.id,
                None,
                None,
                Some(&json),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .is_ok()
            {
                trimmed += 1;
            }
        }
    }

    Ok(Json(serde_json::json!({
        "contexts_deleted": deleted,
        "contexts_trimmed": trimmed,
        "paths_removed": paths_removed,
    })))
}

/// Remove context rows duplicated by the double-delivered protocol stream.
///
/// The CLI runs with `--verbose`, which emits each assistant turn as BOTH a
/// JSON event and a plain-text line, so every `context_map_context` was parsed
/// and inserted twice (250 duplicate names on this repo before the scan-side
/// dedupe landed). This repairs maps written before that fix.
///
/// Keeps the OLDEST row of each name — the one any `context_id` reference in
/// dev_goals / dev_kpis / milestones already points at. A PINNED duplicate wins
/// over an unpinned one regardless of age, because pinning is a human decision
/// and the pinned row is the curated copy. Idempotent.
async fn dedupe_contexts(
    State(s): State<DevToolsHttp>,
    Json(b): Json<DedupeGroupsBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    require_project(&s, &b.project_id)?;

    let mut contexts = repo::list_contexts_by_project(&pool, &b.project_id, None).map_err(err)?;
    contexts.sort_by(|a, c| a.created_at.cmp(&c.created_at));

    let mut keeper: std::collections::HashMap<String, (String, bool)> =
        std::collections::HashMap::new();
    let mut to_delete: Vec<String> = Vec::new();
    for c in &contexts {
        match keeper.get(&c.name) {
            None => {
                keeper.insert(c.name.clone(), (c.id.clone(), c.pinned));
            }
            Some((keep_id, keep_pinned)) => {
                if c.pinned && !keep_pinned {
                    // The pinned copy is the curated one — keep it instead.
                    to_delete.push(keep_id.clone());
                    keeper.insert(c.name.clone(), (c.id.clone(), true));
                } else {
                    to_delete.push(c.id.clone());
                }
            }
        }
    }

    let mut deleted = 0usize;
    for id in &to_delete {
        if repo::delete_context(&pool, id).unwrap_or(false) {
            deleted += 1;
        }
    }

    Ok(Json(serde_json::json!({
        "contexts_before": contexts.len(),
        "contexts_after": contexts.len() - deleted,
        "duplicates_deleted": deleted,
        "distinct_names": keeper.len(),
    })))
}

#[derive(Deserialize)]
struct DedupeGroupsBody {
    project_id: String,
}

#[derive(Deserialize)]
struct RetireContextsBody {
    project_id: String,
    context_ids: Vec<String>,
}

/// Delete contexts by EXPLICIT id — the surgical counterpart to the pattern
/// repairs above. Exists for retiring superseded rows a heuristic can't safely
/// pick (e.g. the original coarse map's straddler husks after a subtree sweep
/// claimed their files). Every id must belong to `project_id`; ids that don't
/// (or don't exist) are reported back rather than silently skipped, so a caller
/// working from a stale context list finds out. Never infers — no name
/// matching, no emptiness heuristics, just the ids it was handed.
async fn retire_contexts(
    State(s): State<DevToolsHttp>,
    Json(b): Json<RetireContextsBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    require_project(&s, &b.project_id)?;
    if b.context_ids.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "context_ids is empty".into()));
    }

    let owned: std::collections::HashMap<String, String> =
        repo::list_contexts_by_project(&pool, &b.project_id, None)
            .map_err(err)?
            .into_iter()
            .map(|c| (c.id, c.name))
            .collect();

    let mut deleted: Vec<Value> = Vec::new();
    let mut rejected: Vec<String> = Vec::new();
    for id in &b.context_ids {
        match owned.get(id) {
            Some(name) if repo::delete_context(&pool, id).unwrap_or(false) => {
                deleted.push(serde_json::json!({ "id": id, "name": name }));
            }
            _ => rejected.push(id.clone()),
        }
    }

    Ok(Json(serde_json::json!({
        "deleted": deleted,
        "deleted_count": deleted.len(),
        "rejected_ids": rejected,
    })))
}

/// Merge context groups that share a name into the oldest one, then delete the
/// emptied duplicates.
///
/// Concurrent subtree scans could each create a group with the same name before
/// the reuse-by-name fix landed (observed: seven "Automation & Pipelines" rows).
/// The scan no longer produces this, but existing maps still carry it, and any
/// future path that creates groups without checking could reintroduce it.
///
/// Keeps the OLDEST row of each name because that is the one existing
/// `context_group_id` references and any hand-curated colour/domain live on.
/// Idempotent: running it on a clean map moves nothing and deletes nothing.
async fn dedupe_context_groups(
    State(s): State<DevToolsHttp>,
    Json(b): Json<DedupeGroupsBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    repo::get_project_by_id(&pool, &b.project_id).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            format!("No project registered with id {}", b.project_id),
        )
    })?;

    let mut groups = repo::list_context_groups(&pool, &b.project_id).map_err(err)?;
    // Oldest first, so the first occurrence of each name is the keeper.
    groups.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    let contexts = repo::list_contexts_by_project(&pool, &b.project_id, None).map_err(err)?;
    let mut keeper: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut merged_away: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for g in &groups {
        match keeper.get(&g.name) {
            None => {
                keeper.insert(g.name.clone(), g.id.clone());
            }
            Some(keep_id) => {
                merged_away.insert(g.id.clone(), keep_id.clone());
            }
        }
    }

    let mut contexts_moved = 0usize;
    for c in contexts {
        let Some(gid) = c.group_id.as_deref() else {
            continue;
        };
        if let Some(keep_id) = merged_away.get(gid) {
            if repo::move_context_to_group(&pool, &c.id, Some(keep_id)).is_ok() {
                contexts_moved += 1;
            }
        }
    }

    // Delete only after every context has been reassigned — a group deleted
    // while it still owns contexts would orphan them.
    let mut groups_deleted = 0usize;
    for dup_id in merged_away.keys() {
        if repo::delete_context_group(&pool, dup_id).unwrap_or(false) {
            groups_deleted += 1;
        }
    }

    Ok(Json(serde_json::json!({
        "groups_before": groups.len(),
        "groups_after": groups.len() - groups_deleted,
        "groups_deleted": groups_deleted,
        "contexts_moved": contexts_moved,
    })))
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
struct UseCaseDecisionBody {
    use_case_id: String,
    /// `active` accepts the proposal, `archived` rejects it (and stops it being
    /// re-proposed), `proposed` returns it to the queue.
    status: String,
}

/// Accept or reject one use-case proposal. The sibling of `/kpi-decision`, and
/// it exists for the same reason: the feature inventory is the layer KPIs
/// attach to, so a terminal session that cannot triage it can only ever produce
/// project-level metrics.
async fn use_case_decision(
    State(s): State<DevToolsHttp>,
    Json(b): Json<UseCaseDecisionBody>,
) -> Result<Json<DevUseCase>, (StatusCode, String)> {
    const ALLOWED: [&str; 3] = ["proposed", "active", "archived"];
    if !ALLOWED.contains(&b.status.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("status must be one of {ALLOWED:?}, got {:?}", b.status),
        ));
    }
    repo::update_use_case(
        &db(&s),
        &b.use_case_id,
        None,
        None,
        None,
        None,
        Some(&b.status),
        None,
        None,
    )
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
    prepare_kpi_sim(&db(&s), &b.project_id)
        .map(Json)
        .map_err(err)
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

/// Correct a KPI's DEFINITION. Every field is optional; omitted fields are left
/// untouched, so a caller fixing one wrong sentence cannot blank the rest.
#[derive(Deserialize, Default)]
struct KpiUpdateBody {
    kpi_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    /// `technical` | `traffic` | `value` | `quality`
    #[serde(default)]
    category: Option<String>,
    /// `codebase` | `connector` | `manual` | `derived`
    #[serde(default)]
    measure_kind: Option<String>,
    /// The how-to-measure payload. Free-form JSON, but it must BE valid JSON —
    /// the column has a `'{}'` default and every reader parses it.
    #[serde(default)]
    measure_config: Option<Value>,
    #[serde(default)]
    unit: Option<String>,
    /// `up` | `down`
    #[serde(default)]
    direction: Option<String>,
    /// `manual` | `daily` | `weekly`
    #[serde(default)]
    cadence: Option<String>,
    /// `north_star` | `primary` | `supporting`
    #[serde(default)]
    tier: Option<String>,
    #[serde(default)]
    baseline_value: Option<f64>,
    #[serde(default)]
    needed_connector: Option<String>,
    // NOTE: `rationale` is intentionally absent — `repo::update_kpi` has no
    // parameter for it, and widening that signature would touch every UI caller.
    // Corrected measurement instructions belong in `measure_config` anyway.
}

/// Fix a KPI's definition — name, description, how it is measured, its baseline.
///
/// `/kpi-decision` deliberately accepts only a status and a target, on the
/// reasoning that redefining a KPI belongs in the app's editor where the operator
/// can see what else references it. That holds for a human at the UI, but it left
/// a terminal session unable to repair its OWN scan output: a KPI-scan pass
/// routinely proposes a sound metric with a WRONG measurement — naming a column
/// that does not exist, or a `connector` pointing at a service the project has
/// never integrated. The operator adopts the metric (correctly — the pillar is
/// right), and the false instructions then sit in the row as the only record of
/// how to measure it. Better to let the session that just verified the real
/// measurement write it down.
///
/// Enum-valued fields are validated here rather than left to SQLite's CHECK
/// constraints, which would surface as an opaque 500.
async fn kpi_update(
    State(s): State<DevToolsHttp>,
    Json(b): Json<KpiUpdateBody>,
) -> Result<Json<DevKpi>, (StatusCode, String)> {
    fn check(
        field: &str,
        value: Option<&String>,
        allowed: &[&str],
    ) -> Result<(), (StatusCode, String)> {
        match value {
            Some(v) if !allowed.contains(&v.as_str()) => Err((
                StatusCode::BAD_REQUEST,
                format!("{field} must be one of {allowed:?}, got {v:?}"),
            )),
            _ => Ok(()),
        }
    }
    check(
        "category",
        b.category.as_ref(),
        &["technical", "traffic", "value", "quality"],
    )?;
    check(
        "measure_kind",
        b.measure_kind.as_ref(),
        &["codebase", "connector", "manual", "derived"],
    )?;
    check("direction", b.direction.as_ref(), &["up", "down"])?;
    check(
        "cadence",
        b.cadence.as_ref(),
        &["manual", "daily", "weekly"],
    )?;
    check(
        "tier",
        b.tier.as_ref(),
        &["north_star", "primary", "supporting"],
    )?;

    // Reject a no-op explicitly. Silently returning the unchanged row would read
    // as "your correction was saved" to a caller that mistyped a field name.
    let measure_config = b.measure_config.as_ref().map(|v| v.to_string());
    if b.name.is_none()
        && b.description.is_none()
        && b.category.is_none()
        && b.measure_kind.is_none()
        && measure_config.is_none()
        && b.unit.is_none()
        && b.direction.is_none()
        && b.cadence.is_none()
        && b.tier.is_none()
        && b.baseline_value.is_none()
        && b.needed_connector.is_none()
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "no updatable field supplied — send at least one of name, description, category, \
             measure_kind, measure_config, unit, direction, cadence, tier, baseline_value, \
             needed_connector"
                .into(),
        ));
    }

    repo::update_kpi(
        &db(&s),
        &b.kpi_id,
        b.name.as_deref(),
        b.description.as_deref().map(Some),
        None,
        None,
        b.category.as_deref(),
        b.measure_kind.as_deref(),
        measure_config.as_deref(),
        b.unit.as_deref(),
        b.direction.as_deref(),
        b.baseline_value.map(Some),
        None,
        None,
        b.cadence.as_deref(),
        None,
        b.needed_connector.as_deref().map(Some),
        None,
        b.tier.as_deref(),
        None,
    )
    .map(Json)
    .map_err(|e| match e {
        AppError::NotFound(m) => (StatusCode::NOT_FOUND, m),
        other => err(other),
    })
}

#[derive(Deserialize)]
struct KpiRebindBody {
    kpi_id: String,
    /// The context this KPI should measure. Must belong to the KPI's own
    /// project — a KPI silently bound across projects would corrupt every
    /// context-scoped surface that joins through it.
    context_id: String,
}

/// Re-point a KPI at a different context. Needed when map maintenance retires a
/// context that adopted KPIs still reference (`dev_kpis.context_id` is
/// ON DELETE SET NULL, so retiring first would strand them as project-level
/// rows). Only the binding moves; status, targets and measurements stay put.
async fn kpi_rebind(
    State(s): State<DevToolsHttp>,
    Json(b): Json<KpiRebindBody>,
) -> Result<Json<DevKpi>, (StatusCode, String)> {
    let pool = db(&s);
    let kpi =
        repo::get_kpi(&pool, &b.kpi_id).map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
    let ctx = repo::get_context_by_id(&pool, &b.context_id)
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
    if ctx.project_id != kpi.project_id {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "context {} belongs to project {}, but KPI {} belongs to project {}",
                ctx.id, ctx.project_id, kpi.id, kpi.project_id
            ),
        ));
    }
    repo::update_kpi(
        &pool,
        &b.kpi_id,
        None,
        None,
        // Keep group coherent with the new context rather than leaving the old
        // group dangling next to the new binding.
        Some(ctx.group_id.as_deref()),
        Some(Some(&b.context_id)),
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
        None,
        None,
        None,
        None,
    )
    .map(Json)
    .map_err(err)
}

// ============================================================================
// App Master adoption — the headless door onto a project's accountable owner
// ============================================================================
//
// The operation itself lives in `app_master_adopt`; these two are adapters. It
// is a BLOCKING function (rusqlite + the manifest file), so it runs on the
// blocking pool rather than on an axum worker.

async fn app_master_adopt_route(
    State(s): State<DevToolsHttp>,
    Json(b): Json<app_master_adopt::AdoptAppMasterInput>,
) -> Result<Json<app_master_adopt::AppMasterAdoption>, (StatusCode, String)> {
    let pool = db(&s);
    // Bound, then awaited: a panic in the blocking task comes back as a
    // `JoinError` and becomes a 500 that says so, rather than a request that
    // never answers.
    let handle = tokio::task::spawn_blocking(move || app_master_adopt::adopt(&pool, &b));
    handle
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("app-master adopt: task failed: {e}"),
            )
        })?
        .map(Json)
        .map_err(status_for)
}

async fn app_master_state(
    State(s): State<DevToolsHttp>,
    Path(project_id): Path<String>,
) -> Result<Json<Option<app_master_adopt::AppMasterAdoption>>, (StatusCode, String)> {
    let pool = db(&s);
    let handle = tokio::task::spawn_blocking(move || app_master_adopt::current(&pool, &project_id));
    handle
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("app-master state: task failed: {e}"),
            )
        })?
        .map(Json)
        .map_err(status_for)
}

// ============================================================================
// Architect adoption — the same door, one scope up (a workspace, not a project)
// ============================================================================
//
// Two more adapters over `architect_adopt`, which shares its whole body with
// `app_master_adopt`. Blocking for the same reasons (rusqlite + the manifest
// file), so both run on the blocking pool.

async fn architect_adopt_route(
    State(s): State<DevToolsHttp>,
    Json(b): Json<architect_adopt::AdoptArchitectInput>,
) -> Result<Json<architect_adopt::ArchitectAdoption>, (StatusCode, String)> {
    let pool = db(&s);
    let handle = tokio::task::spawn_blocking(move || architect_adopt::adopt(&pool, &b));
    handle
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("architect adopt: task failed: {e}"),
            )
        })?
        .map(Json)
        .map_err(status_for)
}

async fn architect_state(
    State(s): State<DevToolsHttp>,
    Path(workspace): Path<String>,
) -> Result<Json<Option<architect_adopt::ArchitectAdoption>>, (StatusCode, String)> {
    let pool = db(&s);
    let handle = tokio::task::spawn_blocking(move || architect_adopt::current(&pool, &workspace));
    handle
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("architect state: task failed: {e}"),
            )
        })?
        .map(Json)
        .map_err(status_for)
}

// ============================================================================
//
// The OUTBOUND hire. Personas' only other outbound call to kp is the report
// push (`engine::kp_reporter`); this is the direction that asks for something.
//
// Not `spawn_blocking`: `request_hire` is already a future whose long pole is an
// HTTP call to kp, and wrapping a future in the blocking pool would occupy a
// blocking thread for minutes doing nothing but waiting.

async fn hire_route(
    State(s): State<DevToolsHttp>,
    Json(b): Json<kp_hire_request::HireRequestInput>,
) -> Result<Json<kp_hire_request::HireRequestOutcome>, (StatusCode, String)> {
    let pool = db(&s);
    kp_hire_request::request_hire(&pool, b.into())
        .await
        .map(Json)
        .map_err(status_for)
}

// ============================================================================
// Worker write-back — the four routes a dispatched App Master run reports on
// ============================================================================
//
// Same shape as the two adapters above: the operation lives in
// `app_master_writeback`, it is BLOCKING (rusqlite end to end), so it runs on
// the blocking pool and a panic there becomes a 500 that says so rather than a
// request that never answers. `status_for` maps a refused token to 400 and an
// unknown id to 404 — a worker that mis-spells a status must be told which of
// the two it got wrong.

/// Run one blocking write-back operation and map both failure shapes.
async fn writeback<T, F>(op_name: &'static str, f: F) -> Result<Json<T>, (StatusCode, String)>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("{op_name}: task failed: {e}"),
            )
        })?
        .map(Json)
        .map_err(status_for)
}

async fn idea_outcome_route(
    State(s): State<DevToolsHttp>,
    Path(idea_id): Path<String>,
    Json(b): Json<app_master_writeback::IdeaOutcomeInput>,
) -> Result<Json<app_master_writeback::IdeaOutcomeResult>, (StatusCode, String)> {
    let pool = db(&s);
    writeback("idea outcome", move || {
        app_master_writeback::record_idea_outcome(&pool, &idea_id, &b)
    })
    .await
}

async fn file_idea_route(
    State(s): State<DevToolsHttp>,
    Json(b): Json<app_master_writeback::FileIdeaInput>,
) -> Result<Json<app_master_writeback::FileIdeaResult>, (StatusCode, String)> {
    let pool = db(&s);
    writeback("file idea", move || {
        app_master_writeback::file_rated_backlog_idea(&pool, &b)
    })
    .await
}

async fn idea_goal_route(
    State(s): State<DevToolsHttp>,
    Path(idea_id): Path<String>,
    Json(b): Json<app_master_writeback::IdeaGoalInput>,
) -> Result<Json<app_master_writeback::IdeaGoalResult>, (StatusCode, String)> {
    let pool = db(&s);
    writeback("attribute idea to goal", move || {
        app_master_writeback::attribute_idea_to_goal(&pool, &idea_id, &b)
    })
    .await
}

async fn list_goals_route(
    State(s): State<DevToolsHttp>,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<app_master_writeback::ProjectGoal>>, (StatusCode, String)> {
    let pool = db(&s);
    writeback("list goals", move || {
        app_master_writeback::list_project_goals(&pool, &project_id)
    })
    .await
}

async fn amend_goal_route(
    State(s): State<DevToolsHttp>,
    Path(goal_id): Path<String>,
    Json(b): Json<app_master_writeback::AmendGoalInput>,
) -> Result<Json<crate::db::models::DevGoal>, (StatusCode, String)> {
    let pool = db(&s);
    writeback("amend goal", move || {
        app_master_writeback::amend_project_goal(&pool, &goal_id, &b)
    })
    .await
}

async fn goal_item_route(
    State(s): State<DevToolsHttp>,
    Path((goal_id, item_id)): Path<(String, String)>,
    Json(b): Json<app_master_writeback::GoalItemInput>,
) -> Result<Json<app_master_writeback::GoalItemResult>, (StatusCode, String)> {
    let pool = db(&s);
    writeback("goal item", move || {
        app_master_writeback::set_goal_item_done(&pool, &goal_id, &item_id, &b)
    })
    .await
}

async fn create_kpi_route(
    State(s): State<DevToolsHttp>,
    Json(b): Json<app_master_writeback::CreateKpiInput>,
) -> Result<Json<DevKpi>, (StatusCode, String)> {
    let pool = db(&s);
    writeback("create kpi", move || {
        app_master_writeback::create_project_kpi(&pool, &b)
    })
    .await
}

async fn measure_kpi_route(
    State(s): State<DevToolsHttp>,
    Path(kpi_id): Path<String>,
    Json(b): Json<app_master_writeback::MeasureKpiInput>,
) -> Result<Json<crate::db::models::DevKpiMeasurement>, (StatusCode, String)> {
    let pool = db(&s);
    writeback("measure kpi", move || {
        app_master_writeback::record_kpi_reading(&pool, &kpi_id, &b)
    })
    .await
}

/// `Some((scan_id, reason))` when the project's most recent **context** scan
/// ended `failed` — the one case in which an empty context list is a refusal
/// and not an answer. Rows of other scan types (KPI, ideas) are skipped, not
/// counted, and a later successful context scan clears the verdict. Pure.
fn refused_context_map(
    scans_newest_first: &[crate::db::models::DevScan],
) -> Option<(String, String)> {
    use crate::commands::infrastructure::context_generation::CONTEXT_SCAN_TYPE;
    let last = scans_newest_first
        .iter()
        .find(|s| s.scan_type == CONTEXT_SCAN_TYPE)?;
    if last.status != "failed" {
        return None;
    }
    let reason = last
        .error
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .unwrap_or("no reason recorded")
        .to_string();
    Some((last.id.clone(), reason))
}

#[cfg(test)]
mod refused_map_tests {
    use super::refused_context_map;
    use crate::commands::infrastructure::context_generation::CONTEXT_SCAN_TYPE;
    use crate::db::models::DevScan;

    fn scan(id: &str, scan_type: &str, status: &str, error: Option<&str>) -> DevScan {
        DevScan {
            id: id.into(),
            project_id: Some("p".into()),
            scan_type: scan_type.into(),
            status: status.into(),
            idea_count: 0,
            input_tokens: None,
            output_tokens: None,
            duration_ms: None,
            error: error.map(str::to_string),
            created_at: "2026-09-10T07:20:00Z".into(),
        }
    }

    /// The bank-invest shape: a committed map with a category outside the
    /// taxonomy, refused whole. The door must say so, with the scan id.
    #[test]
    fn a_failed_latest_context_scan_is_a_refusal_with_its_reason() {
        let rows = vec![
            scan("kpi-newer", "kpi-scan", "complete", None),
            scan(
                "ctx-1",
                CONTEXT_SCAN_TYPE,
                "failed",
                Some("Validation error: context-map.json: contexts[22].category \"policy\" is not one of ui|api|lib|data|test|config"),
            ),
            scan("ctx-0", CONTEXT_SCAN_TYPE, "completed", None),
        ];
        let (id, reason) = refused_context_map(&rows).expect("refused");
        assert_eq!(id, "ctx-1");
        assert!(reason.contains("category \"policy\""), "{reason}");
    }

    #[test]
    fn a_later_successful_context_scan_clears_the_verdict() {
        let rows = vec![
            scan("ctx-2", CONTEXT_SCAN_TYPE, "completed", None),
            scan("ctx-1", CONTEXT_SCAN_TYPE, "failed", Some("boom")),
        ];
        assert!(refused_context_map(&rows).is_none());
    }

    #[test]
    fn other_scan_types_and_no_history_are_not_refusals() {
        assert!(refused_context_map(&[]).is_none());
        let rows = vec![scan("k", "kpi-scan", "error", Some("kpi fell over"))];
        assert!(
            refused_context_map(&rows).is_none(),
            "a KPI failure says nothing about the map"
        );
    }

    #[test]
    fn a_failure_without_text_still_names_itself() {
        let rows = vec![scan("ctx-1", CONTEXT_SCAN_TYPE, "failed", Some("  "))];
        let (_, reason) = refused_context_map(&rows).expect("refused");
        assert_eq!(reason, "no reason recorded");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::workspaces::protection;
    use personas_db::init_test_db;

    /// `GET /dev-tools/workspaces` is how a script finds the simulation
    /// workspace it built, so it must report the tag and the member count —
    /// the two facts that distinguish "the one I made" from "an empty
    /// leftover".
    #[test]
    fn the_workspace_listing_reports_the_tag_and_the_member_count() {
        let pool = init_test_db().unwrap();
        assert!(
            workspace_summaries(&pool).unwrap().is_empty(),
            "an empty app lists no workspaces"
        );

        let bank = ws_repo::create_workspace(&pool, "Bank", None, None, false).unwrap();
        let other = ws_repo::create_workspace(&pool, "Aside", None, None, false).unwrap();
        let project = crate::db::repos::dev::projects::create_project(
            &pool,
            "bank-core",
            &std::env::temp_dir()
                .join(format!("personas_ws_listing_{}", uuid::Uuid::new_v4()))
                .to_string_lossy(),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        ws_repo::assign_project(&pool, &project.id, Some(&bank.id)).unwrap();
        protection::set_workspace_protection(&pool, &bank.id, true).unwrap();

        let rows = workspace_summaries(&pool).unwrap();
        assert_eq!(rows.len(), 2, "{rows:?}");
        let b = rows.iter().find(|r| r.id == bank.id).expect("Bank listed");
        assert!(b.protected, "the tag reaches the listing");
        assert_eq!(b.project_count, 1);
        let a = rows
            .iter()
            .find(|r| r.id == other.id)
            .expect("Aside listed");
        assert!(!a.protected);
        assert_eq!(a.project_count, 0);
    }
}
