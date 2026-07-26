//! Practice harvesting — dispatch preparation + result ingestion
//! (docs/plans/workspace-knowledge-center.md §7, Arc 2).
//!
//! The harvest itself runs as a Dev-runner session (a Fleet Claude Code session
//! in a workspace MEMBER repo, spawned by the frontend with the
//! `workspace-harvest:<workspace>:<project>` key). Like kpi-sim, this module
//! owns the two app-side ends:
//!
//! - `dev_tools_workspace_harvest_prepare` — writes
//!   `<repo>/practice-harvest/snapshot.json` (the workspace roster + stacks,
//!   this project's stack/standards, existing practice titles to avoid
//!   re-proposing, and rejected dedup keys) so the session grounds without
//!   prompt-size limits or DB access.
//! - `dev_tools_workspace_knowledge_ingest` — parses
//!   `<repo>/practice-harvest/runs/<id>/result.json` into `observed`
//!   knowledge candidates and routes them through the ONE governed door
//!   (`repo::ingest_candidates`, agent provenance, dedup-gated incl. the
//!   90-day rejected window). The CLI session NEVER writes personas.db.
//!
//! The result lands into WORKSPACE-scoped `workspace_knowledge`, stamped with
//! `origin_project_id = <this member>` by the app (not trusted from the skill).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::State;
use ts_rs::TS;

use crate::db::repos::dev_tools as dev_repo;
use crate::db::repos::dev_workspaces as repo;
use crate::db::repos::dev_workspaces::KnowledgeCandidate;
use crate::db::repos::workspace_taxonomy as taxonomy;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

const MAX_RESULT_BYTES: u64 = 1_048_576;

/// Return of `prepare` — the snapshot path + repo root so the frontend can
/// point the Fleet session's cwd and reference the grounding file.
#[derive(Debug, serde::Serialize, TS)]
#[ts(export)]
pub struct HarvestPrepared {
    pub snapshot_path: String,
    pub root_path: String,
}

// ── result.json shape (lenient: unknown fields ignored, bad rows skipped) ──

#[derive(Debug, Deserialize)]
struct HarvestResult {
    #[serde(default)]
    items: Vec<HarvestItem>,
}

#[derive(Debug, Deserialize)]
struct HarvestItem {
    kind: String,
    title: String,
    statement: String,
    detail_md: Option<String>,
    topic: Option<String>,
    /// Categorization axes (optional; harvest agents may supply them).
    abstraction: Option<String>,
    ftype: Option<String>,
    durability: Option<String>,
    evidence_count: Option<i64>,
    /// Applicability envelope as a JSON object (re-serialized on the way in).
    applicability: Option<serde_json::Value>,
    dedup_key: Option<String>,
    confidence: Option<f64>,
}

// ── prepare ─────────────────────────────────────────────────────────────────

/// Assert the project belongs to the workspace, then materialize the grounding
/// snapshot in the member repo. Returns the snapshot path + root for dispatch.
#[tauri::command]
pub async fn dev_tools_workspace_harvest_prepare(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    project_id: String,
) -> Result<HarvestPrepared, AppError> {
    require_auth(&state).await?;
    let ws = repo::get_workspace_by_id(&state.db, &workspace_id)?;
    let project = dev_repo::get_project_by_id(&state.db, &project_id)?;
    if project.workspace_id.as_deref() != Some(workspace_id.as_str()) {
        return Err(AppError::Validation(
            "Project is not a member of this workspace".into(),
        ));
    }
    let root = PathBuf::from(&project.root_path);
    if !root.is_dir() {
        return Err(AppError::Validation(format!(
            "Project root path is not a directory: {}",
            project.root_path
        )));
    }

    // Siblings (other members) with their stacks — the "portfolio" context.
    let members = repo::list_workspace_projects(&state.db, &workspace_id)?;
    let siblings: Vec<serde_json::Value> = members
        .iter()
        .filter(|p| p.id != project_id)
        .map(|p| json!({ "name": p.name, "tech_stack": p.tech_stack }))
        .collect();

    // Existing practice titles (any live status) — do not re-propose these.
    let existing = repo::list_knowledge(&state.db, &workspace_id, None)?;
    let existing_titles: Vec<String> = existing
        .iter()
        .filter(|k| k.status != "rejected")
        .map(|k| k.title.clone())
        .collect();
    // Rejected dedup keys still inside the retention window — off-limits.
    let rejected_keys: Vec<String> = existing
        .iter()
        .filter(|k| k.status == "rejected")
        .filter_map(|k| k.dedup_key.clone())
        .collect();

    let snapshot = json!({
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "workspace": { "id": ws.id, "name": ws.name },
        "project": {
            "id": project.id,
            "name": project.name,
            "root_path": project.root_path,
            "tech_stack": project.tech_stack,
            "standards_config": project.standards_config
                .as_deref()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()),
        },
        "siblings": siblings,
        "existing_practice_titles": existing_titles,
        "rejected_dedup_keys": rejected_keys,
        "kinds": repo::KNOWLEDGE_KINDS,
        // The closed topic vocabulary travels with the snapshot the agent is
        // already reading, so there is no second copy of it to drift. Areas
        // are precedence-ordered and closed; clusters are a starter set the
        // agent may extend (see `db::repos::workspace_taxonomy`).
        "taxonomy": {
            "rule": "topic = exactly two segments, area/cluster. `topic` answers WHERE the practice lives (which concern or subsystem it governs); `ftype` answers what shape it is. Walk the areas in the order listed and take the FIRST that genuinely governs — if the practice would be meaningless without that concern, it governs. `architecture` is the codebase's own skeleton and is near-last on purpose: use it only when no subsystem area applies.",
            "growth": "You may use a cluster that is not listed IF none of the listed ones fit, but only under one of the listed areas. Never invent an area.",
            "areas": taxonomy::TAXONOMY
                .iter()
                .map(|(area, clusters)| {
                    json!({
                        "area": area,
                        "covers": taxonomy::AREA_HINTS
                            .iter()
                            .find(|(a, _)| a == area)
                            .map(|(_, h)| *h)
                            .unwrap_or(""),
                        "clusters": clusters,
                    })
                })
                .collect::<Vec<_>>(),
        },
    });

    let dir = root.join("practice-harvest");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Validation(format!("Could not create practice-harvest dir: {e}")))?;
    let snapshot_path = dir.join("snapshot.json");
    let snapshot_str = serde_json::to_string_pretty(&snapshot)
        .map_err(|e| AppError::Internal(format!("Could not serialize harvest snapshot: {e}")))?;
    std::fs::write(&snapshot_path, snapshot_str)
        .map_err(|e| AppError::Validation(format!("Could not write snapshot: {e}")))?;

    Ok(HarvestPrepared {
        snapshot_path: snapshot_path.to_string_lossy().into_owned(),
        root_path: project.root_path.clone(),
    })
}

// ── ingest ─────────────────────────────────────────────────────────────────

fn find_ingestable_run(root: &Path) -> Option<PathBuf> {
    let runs = root.join("practice-harvest").join("runs");
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(&runs)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.is_dir() || !p.join("result.json").is_file() || p.join("ingested.json").is_file() {
                return None;
            }
            let t = e.metadata().and_then(|m| m.modified()).ok()?;
            Some((t, p))
        })
        .collect();
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.into_iter().map(|(_, p)| p).next()
}

/// Ingest a finished harvest run into the workspace library. `run_dir` optional
/// — defaults to the newest un-ingested run. Path-confined, size-capped,
/// idempotent (a run dir is marked after ingest and refused twice). Items land
/// `observed` with agent provenance and `origin_project_id = <this member>`.
#[tauri::command]
pub async fn dev_tools_workspace_knowledge_ingest(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    project_id: String,
    run_dir: Option<String>,
) -> Result<repo::IngestSummary, AppError> {
    require_auth(&state).await?;
    let project = dev_repo::get_project_by_id(&state.db, &project_id)?;
    if project.workspace_id.as_deref() != Some(workspace_id.as_str()) {
        return Err(AppError::Validation(
            "Project is not a member of this workspace".into(),
        ));
    }
    let root = PathBuf::from(&project.root_path);

    let dir = match run_dir {
        Some(d) => {
            let p = PathBuf::from(&d);
            let runs_root = root.join("practice-harvest").join("runs");
            let canon = p
                .canonicalize()
                .map_err(|e| AppError::Validation(format!("Run dir not readable: {e}")))?;
            let canon_root = runs_root.canonicalize().map_err(|_| {
                AppError::Validation("No practice-harvest/runs directory in this repo yet".into())
            })?;
            if !canon.starts_with(&canon_root) {
                return Err(AppError::Validation(
                    "Run dir must be inside the project's practice-harvest/runs/".into(),
                ));
            }
            canon
        }
        None => find_ingestable_run(&root).ok_or_else(|| {
            AppError::Validation(
                "No un-ingested harvest run found under practice-harvest/runs/ — run the harvest first"
                    .into(),
            )
        })?,
    };
    if dir.join("ingested.json").is_file() {
        return Err(AppError::Validation(format!(
            "Run {} was already ingested",
            dir.display()
        )));
    }

    let result_path = dir.join("result.json");
    let meta = std::fs::metadata(&result_path)
        .map_err(|e| AppError::Validation(format!("result.json not readable: {e}")))?;
    if meta.len() > MAX_RESULT_BYTES {
        return Err(AppError::Validation(format!(
            "result.json is {} bytes (cap {MAX_RESULT_BYTES}) — refusing to ingest",
            meta.len()
        )));
    }
    let raw = std::fs::read_to_string(&result_path)
        .map_err(|e| AppError::Validation(format!("result.json not readable: {e}")))?;
    let result: HarvestResult = serde_json::from_str(&raw)
        .map_err(|e| AppError::Validation(format!("result.json is not valid: {e}")))?;

    // Map to candidates — stamp origin_project_id (app-owned, not trusted from
    // the skill) and derive a stable dedup_key when the skill omits one.
    let candidates: Vec<KnowledgeCandidate> = result
        .items
        .into_iter()
        .map(|it| {
            let dedup_key = it.dedup_key.filter(|k| !k.trim().is_empty()).or_else(|| {
                Some(format!(
                    "harvest:{project_id}:{}",
                    dev_repo::normalize_idea_title(&it.title)
                ))
            });
            KnowledgeCandidate {
                kind: it.kind,
                title: it.title,
                statement: it.statement,
                detail_md: it.detail_md,
                topic: it.topic,
                abstraction: it.abstraction,
                ftype: it.ftype,
                durability: it.durability,
                governing_id: None,
                evidence_count: it.evidence_count,
                applicability: it.applicability.map(|v| v.to_string()),
                origin_project_id: Some(project_id.clone()),
                dedup_key,
                confidence: it.confidence,
            }
        })
        .collect();

    let summary = repo::ingest_candidates(&state.db, &workspace_id, &candidates, "agent", None)?;

    // Idempotency marker.
    let _ = std::fs::write(
        dir.join("ingested.json"),
        serde_json::to_string_pretty(&json!({
            "ingested_at": chrono::Utc::now().to_rfc3339(),
            "inserted": summary.inserted,
            "skipped": summary.skipped.len(),
        }))
        .unwrap_or_default(),
    );

    Ok(summary)
}
