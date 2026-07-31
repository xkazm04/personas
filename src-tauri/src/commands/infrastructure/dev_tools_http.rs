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
//!   POST /scan-codebase                     → start a scan { project_id, root_path?, delta_mode?, subtree? } → { scan_id }
//!   GET  /scan-status/{scan_id}             → { status, error, lines }
//!   GET  /scans/{project_id}                → every known context scan + its subtree (don't relaunch a running scope)
//!   POST /scan-kpis                         → start a KPI scan { project_id, context_id? } → { scan_id }
//!   GET  /kpi-scan-status/{scan_id}         → { status, error, lines }
//!   GET  /kpi-scan-prompt/{project_id}      → the KPI-scan prompt as plain text
//!   POST /scan-use-cases                    → start a feature scan { project_id } → { scan_id }
//!   GET  /use-case-scan-status/{scan_id}    → { status, error, lines }
//!   GET  /kpis/{project_id}?status=proposed → the project's KPIs (triage source)
//!   GET  /contexts/{project_id}             → every context (the per-context sweep walks these)
//!   POST /retire-contexts                   → delete contexts by explicit id { project_id, context_ids }
//!   POST /kpi-decision                      → adopt/adjust/reject one KPI → the updated row
//!   POST /kpi-update                        → fix a KPI's definition (description, measure_config, …)
//!   POST /kpi-rebind                        → re-point a KPI at a context { kpi_id, context_id }
//!   POST /export-context-map                → re-write context-map.json + CLAUDE.md from the DB (after repairs)
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

use crate::commands::infrastructure::context_generation::{
    launch_context_scan, list_scans_json, scan_status_json,
};
use crate::commands::infrastructure::context_map_export::write_context_map_artifacts;
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
        .route("/dedupe-context-groups", post(dedupe_context_groups))
        .route("/dedupe-contexts", post(dedupe_contexts))
        .route("/retire-contexts", post(retire_contexts))
        .route("/prune-nonsource-contexts", post(prune_nonsource_contexts))
        .route("/merge-context-groups", post(merge_context_groups))
        .route("/export-context-map", post(export_context_map))
        .route("/use-cases/{project_id}", get(list_use_cases))
        .route("/use-case-decision", post(use_case_decision))
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
    let res = launch_context_scan(s.app.clone(), &pool, &project, root, b.delta_mode.unwrap_or(false), b.subtree.as_deref()).map_err(err)?;
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
    let root = match b.root_path.as_deref() {
        Some(r) if r != "." && !r.is_empty() => r.to_string(),
        _ => project.root_path.clone(),
    };
    let contexts = write_context_map_artifacts(&db(&s), &b.project_id, &root).map_err(err)?;
    Ok(Json(
        serde_json::json!({ "project_id": b.project_id, "root_path": root, "contexts": contexts }),
    ))
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
    let by_name: std::collections::HashMap<&str, &str> =
        groups.iter().map(|g| (g.name.as_str(), g.id.as_str())).collect();

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
        for c in contexts.iter().filter(|c| c.group_id.as_deref() == Some(*from_id)) {
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
        let kept: Vec<String> = paths.iter().filter(|p| is_mappable_path(p)).cloned().collect();
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
                &pool, &c.id, None, None, Some(&json),
                None, None, None, None, None, None, None, None,
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
    let mut merged_away: std::collections::HashMap<String, String> = std::collections::HashMap::new();
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
        let Some(gid) = c.group_id.as_deref() else { continue };
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
    fn check(field: &str, value: Option<&String>, allowed: &[&str]) -> Result<(), (StatusCode, String)> {
        match value {
            Some(v) if !allowed.contains(&v.as_str()) => Err((
                StatusCode::BAD_REQUEST,
                format!("{field} must be one of {allowed:?}, got {v:?}"),
            )),
            _ => Ok(()),
        }
    }
    check("category", b.category.as_ref(), &["technical", "traffic", "value", "quality"])?;
    check(
        "measure_kind",
        b.measure_kind.as_ref(),
        &["codebase", "connector", "manual", "derived"],
    )?;
    check("direction", b.direction.as_ref(), &["up", "down"])?;
    check("cadence", b.cadence.as_ref(), &["manual", "daily", "weekly"])?;
    check("tier", b.tier.as_ref(), &["north_star", "primary", "supporting"])?;

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
    let kpi = repo::get_kpi(&pool, &b.kpi_id)
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
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
