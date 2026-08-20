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
//!   POST /consolidate-contexts              → merge micro-contexts into the 10-30 band, re-pointing every anchored artifact { project_id, dry_run }
//!   POST /repair-cross-refs                 → re-point cross_refs orphaned by past consolidations { project_id, apply } — DRY RUN unless `apply`
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
use crate::commands::infrastructure::kpi_scan::{
    kpi_scan_prompt, kpi_scan_status_json, launch_kpi_scan,
};
use crate::commands::infrastructure::kpi_sim::{
    ingest_kpi_sim, prepare_kpi_sim, KpiSimIngestSummary, KpiSimPrepared,
};
use crate::commands::infrastructure::use_case_scan::{
    launch_use_case_scan, use_case_scan_status_json,
};
use crate::db::models::{DevContext, DevContextGroup, DevKpi, DevProject, DevUseCase};
use crate::db::repos::dev_tools as repo;
use crate::db::repos::dev_workspaces as ws_repo;
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
        .route("/export-skill-registry", post(export_skill_registry))
        .route("/consolidate-contexts", post(consolidate_contexts_route))
        .route("/repair-cross-refs", post(repair_cross_refs_route))
        .route("/use-cases/{project_id}", get(list_use_cases))
        .route("/use-case-decision", post(use_case_decision))
        .route("/kpi-sim/prepare", post(kpi_sim_prepare))
        .route("/kpi-sim/ingest", post(kpi_sim_ingest))
        .route("/patterns/index", get(patterns_index))
        .route("/patterns/consult", get(patterns_consult))
        .route("/patterns/propose", post(patterns_propose))
        .route("/patterns/{id}", get(pattern_get))
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

// ============================================================================
// Pattern fabric — the CLI consult layer (pattern-fabric F2)
// ============================================================================
//
// The library's live read surface for terminal sessions: a compact index, an
// intent-matched consult (playbook briefs annotated with the calling repo's
// own adherence, so "reuse your own exemplars first" is answerable), a full
// pattern card, and a propose door that reuses the harvest ingest — sessions
// propose, humans adopt, and the fabric adds NO second write path.

#[derive(Deserialize)]
struct PatternsScope {
    workspace_id: Option<String>,
    project_id: Option<String>,
    intent: Option<String>,
}

/// Resolve the workspace (and optionally the project) a patterns call is
/// about. `project_id` alone is enough — the repo a CLI session sits in knows
/// its project id long before it knows the workspace's.
fn resolve_scope(
    pool: &DbPool,
    q: &PatternsScope,
) -> Result<(String, Option<DevProject>), AppError> {
    if let Some(pid) = q.project_id.as_deref() {
        let project = repo::get_project_by_id(pool, pid)?;
        let ws = project.workspace_id.clone().ok_or_else(|| {
            AppError::Validation(format!(
                "Project {} is not assigned to a workspace",
                project.name
            ))
        })?;
        return Ok((ws, Some(project)));
    }
    if let Some(ws) = q.workspace_id.as_deref() {
        return Ok((ws.to_string(), None));
    }
    Err(AppError::Validation(
        "Pass workspace_id or project_id".into(),
    ))
}

/// Match an intent against a playbook's trigger phrases + title. A phrase
/// scores when ALL its meaningful words appear in the intent (or the phrase
/// appears verbatim); the title contributes single-word hits. Dumb on
/// purpose — deterministic and explainable beats clever here; embedding
/// re-ranking is a fabric-doc extension, never the spine.
fn match_score(intent: &str, triggers_json: &str, title: &str) -> u32 {
    let intent_lc = intent.to_lowercase();
    let intent_words: std::collections::HashSet<&str> = intent_lc
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 2)
        .collect();
    let triggers: Vec<String> = serde_json::from_str(triggers_json).unwrap_or_default();
    let mut score = 0u32;
    for phrase in &triggers {
        let p = phrase.to_lowercase();
        if intent_lc.contains(&p) {
            score += 3;
            continue;
        }
        let words: Vec<&str> = p
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| w.len() > 2)
            .collect();
        if !words.is_empty() && words.iter().all(|w| intent_words.contains(w)) {
            score += 2;
        }
    }
    let title_lc = title.to_lowercase();
    score
        + title_lc
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| w.len() > 2 && intent_words.contains(w))
            .count() as u32
}

async fn patterns_index(
    State(s): State<DevToolsHttp>,
    Query(q): Query<PatternsScope>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    let (ws, project) = resolve_scope(&pool, &q).map_err(err)?;
    let playbooks = ws_repo::list_playbooks(&pool, &ws).map_err(err)?;
    let members = ws_repo::list_playbook_patterns(&pool, &ws).map_err(err)?;
    let adopted = ws_repo::list_knowledge(&pool, &ws, Some("adopted")).map_err(err)?;
    let mut topics: std::collections::BTreeMap<String, u32> = Default::default();
    for k in &adopted {
        if let Some(t) = k.topic.as_deref() {
            *topics.entry(t.to_string()).or_default() += 1;
        }
    }
    Ok(Json(serde_json::json!({
        "workspace_id": ws,
        "project_id": project.map(|p| p.id),
        "playbooks": playbooks.iter().map(|p| serde_json::json!({
            "slug": p.slug, "title": p.title, "status": p.status,
            "triggers": serde_json::from_str::<Value>(&p.triggers).unwrap_or(Value::Null),
            "members": members.iter().filter(|m| m.playbook_id == p.id).count(),
        })).collect::<Vec<_>>(),
        "patterns": adopted.iter().map(|k| serde_json::json!({
            "id": k.id, "title": k.title, "topic": k.topic,
        })).collect::<Vec<_>>(),
        "topics": topics,
    })))
}

async fn patterns_consult(
    State(s): State<DevToolsHttp>,
    Query(q): Query<PatternsScope>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    let (ws, project) = resolve_scope(&pool, &q).map_err(err)?;
    let intent = q
        .intent
        .clone()
        .filter(|i| !i.trim().is_empty())
        .ok_or_else(|| {
            err(AppError::Validation(
                "Pass intent=<what you are about to do>".into(),
            ))
        })?;

    let playbooks = ws_repo::list_playbooks(&pool, &ws).map_err(err)?;
    let members = ws_repo::list_playbook_patterns(&pool, &ws).map_err(err)?;
    let adopted = ws_repo::list_knowledge(&pool, &ws, Some("adopted")).map_err(err)?;
    let by_id: std::collections::HashMap<&str, &crate::db::models::WorkspaceKnowledge> =
        adopted.iter().map(|k| (k.id.as_str(), k)).collect();

    // Per-pattern adherence for the calling repo (context grain, P0 rollup) +
    // its adoption-matrix state — the two axes the brief annotates.
    let project_id = project.as_ref().map(|p| p.id.clone());
    let rollup: std::collections::HashMap<String, Value> = if project_id.is_some() {
        ws_repo::seed_practice_context_cells(&pool, &ws).map_err(err)?;
        ws_repo::practice_context_rollup(&pool, &ws, project_id.as_deref())
            .map_err(err)?
            .into_iter()
            .map(|r| {
                (
                    r.practice_id.clone(),
                    serde_json::json!({
                        "adopted": r.adopted, "violating": r.violating,
                        "unverified": r.unverified, "applicable": r.applicable,
                    }),
                )
            })
            .collect()
    } else {
        Default::default()
    };
    let adoption = ws_repo::list_adoption(&pool, &ws).map_err(err)?;
    let state_of = |practice_id: &str| -> Option<String> {
        let pid = project_id.as_deref()?;
        adoption
            .iter()
            .find(|a| a.practice_id == practice_id && a.project_id == pid)
            .map(|a| a.state.clone())
    };

    // Active playbooks only; drafts are not consultable — activation in the
    // rail is the curation gate. Near-miss drafts are reported so the caller
    // can tell "no coverage" from "coverage awaiting activation".
    let mut scored: Vec<(u32, &crate::db::models::WorkspacePlaybook)> = playbooks
        .iter()
        .filter(|p| p.status == "active")
        .map(|p| (match_score(&intent, &p.triggers, &p.title), p))
        .filter(|(score, _)| *score > 0)
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    let draft_hits: Vec<Value> = playbooks
        .iter()
        .filter(|p| p.status == "draft" && match_score(&intent, &p.triggers, &p.title) > 0)
        .map(|p| serde_json::json!({ "slug": p.slug, "title": p.title }))
        .collect();

    let matched: Vec<Value> = scored
        .iter()
        .take(3)
        .map(|(score, pb)| {
            let phase = |ph: &str| -> Vec<Value> {
                let mut mine: Vec<_> = members
                    .iter()
                    .filter(|m| m.playbook_id == pb.id && m.phase == ph)
                    .collect();
                mine.sort_by_key(|m| m.ordinal);
                mine.iter()
                    .filter_map(|m| by_id.get(m.practice_id.as_str()).map(|k| (m, k)))
                    .map(|(m, k)| {
                        serde_json::json!({
                            "id": k.id, "title": k.title, "statement": k.statement,
                            "topic": k.topic, "note": m.note,
                            "state_here": state_of(&k.id),
                            "adherence": rollup.get(&k.id),
                        })
                    })
                    .collect()
            };
            serde_json::json!({
                "slug": pb.slug, "title": pb.title, "summary": pb.summary,
                "score": score,
                "before": phase("before"), "during": phase("during"), "verify": phase("verify"),
            })
        })
        .collect();

    // Consult telemetry. Logged AFTER matching so the row carries what was
    // actually served — and an empty `matched` is the row most worth having:
    // it is a situation a session arrived with that the library has no
    // playbook for. Best-effort by construction: the answer above is already
    // computed and a session mid-task must never fail on a telemetry write.
    let served: Vec<String> = matched
        .iter()
        .filter_map(|m| m.get("slug").and_then(Value::as_str).map(str::to_string))
        .collect();
    if let Err(e) = ws_repo::insert_consult_log(&pool, &ws, project_id.as_deref(), &intent, &served)
    {
        tracing::warn!(error = %e, "patterns/consult: telemetry write failed");
    }

    Ok(Json(serde_json::json!({
        "workspace_id": ws,
        "project_id": project_id,
        "intent": intent,
        "matched": matched,
        "draft_matches_awaiting_activation": draft_hits,
    })))
}

async fn pattern_get(
    State(s): State<DevToolsHttp>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    let k = ws_repo::get_knowledge_by_id(&pool, &id).map_err(|e| match e {
        AppError::NotFound(m) => (StatusCode::NOT_FOUND, m),
        other => err(other),
    })?;
    let edges = ws_repo::list_pattern_edges(&pool, &k.workspace_id).map_err(err)?;
    let mine: Vec<Value> = edges
        .iter()
        .filter(|e| e.from_id == k.id || e.to_id == k.id)
        .map(|e| {
            serde_json::json!({
                "from_id": e.from_id, "to_id": e.to_id, "rel": e.rel, "note": e.note,
            })
        })
        .collect();
    Ok(Json(serde_json::json!({ "pattern": k, "edges": mine })))
}

#[derive(Deserialize)]
struct ProposeBody {
    workspace_id: Option<String>,
    project_id: Option<String>,
    title: String,
    statement: String,
    kind: Option<String>,
    topic: Option<String>,
    ftype: Option<String>,
    detail_md: Option<String>,
    /// Pattern id this proposal refines — creates an `extends` edge once the
    /// candidate lands (still `observed`; adoption stays human).
    extends: Option<String>,
}

async fn patterns_propose(
    State(s): State<DevToolsHttp>,
    Json(b): Json<ProposeBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let pool = db(&s);
    let scope = PatternsScope {
        workspace_id: b.workspace_id.clone(),
        project_id: b.project_id.clone(),
        intent: None,
    };
    let (ws, _project) = resolve_scope(&pool, &scope).map_err(err)?;
    // A caller-stable dedup key lets us find the row we just made without the
    // ingest door having to leak internals.
    let dedup_key = format!("consult-propose:{}", uuid::Uuid::new_v4());
    let candidate = ws_repo::KnowledgeCandidate {
        harvest_scope: None,
        kind: b.kind.clone().unwrap_or_else(|| "pattern".into()),
        title: b.title.clone(),
        statement: b.statement.clone(),
        detail_md: b.detail_md.clone(),
        topic: b.topic.clone(),
        abstraction: None,
        ftype: b.ftype.clone(),
        durability: None,
        governing_id: None,
        evidence_count: None,
        applicability: None,
        dedup_key: Some(dedup_key.clone()),
        confidence: None,
        // Build-unblock 2026-08-10: the struct gained this field mid-refactor
        // in a parallel session; this initializer was the one call site left
        // behind. The propose door's project scope IS the origin (same rule as
        // workspace_harvest / skill_lessons; cross-project code passes None).
        origin_project_id: b.project_id.clone(),
        extends: b.extends.clone(),
        layer: None,
        evidence: Vec::new(),
    };
    let summary =
        ws_repo::ingest_candidates(&pool, &ws, &[candidate], "cli-consult", None).map_err(err)?;
    // Resolve the created row (skipped = dedup/validation refusal, surfaced).
    let created = if summary.inserted > 0 {
        let conn = pool.get().map_err(|e| err(AppError::from(e)))?;
        conn.query_row(
            "SELECT id FROM workspace_knowledge WHERE workspace_id = ?1 AND dedup_key = ?2",
            rusqlite::params![ws, dedup_key],
            |r| r.get::<_, String>(0),
        )
        .ok()
    } else {
        None
    };
    if let (Some(new_id), Some(parent)) = (created.as_deref(), b.extends.as_deref()) {
        // Direction: the PROPOSAL extends the established pattern (child ->
        // parent), matching the harvest door and the modal's edge labels —
        // the child renders "extends <parent>", the parent "extended by".
        // (F2 had this reversed; fixed in F4 before any real data existed.)
        ws_repo::set_pattern_edge(
            &pool,
            new_id,
            parent,
            "extends",
            Some("proposed via consult"),
        )
        .map_err(err)?;
    }
    Ok(Json(serde_json::json!({
        "inserted": summary.inserted,
        "skipped": summary.skipped,
        "id": created,
        "status": "observed",
    })))
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
        let exported =
            write_context_map_artifacts(&pool, &b.project_id, &project.root_path).map_err(err)?;
        let _ = crate::commands::infrastructure::context_map_export::write_backlog_digest(
            &pool,
            &b.project_id,
            &project.root_path,
        );
        out["exportedContexts"] = serde_json::json!(exported);
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
        let exported =
            write_context_map_artifacts(&pool, &b.project_id, &project.root_path).map_err(err)?;
        out["exportedContexts"] = serde_json::json!(exported);
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
