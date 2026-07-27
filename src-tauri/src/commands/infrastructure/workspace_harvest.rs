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
use personas_core::harvest_scopes as scopes;
use crate::db::models::WorkspaceHarvestCoverage;
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
    /// Which territory this run covered (`group:execution-orchestration`,
    /// `repo-global`, …). Optional for back-compat with pre-scope runs, which
    /// are stamped against `repo-global` — that is honestly what they read.
    #[serde(default)]
    scope: Option<String>,
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

    // Territory. Derived from the repo itself (context map when present), then
    // reconciled into the coverage ledger so "never harvested" is a fact the
    // dispatcher can read rather than something nobody tracks. See
    // personas_core::harvest_scopes for why one-agent-per-repo failed.
    let scopes = scopes::derive_scopes(&root);
    repo::sync_harvest_scopes(
        &state.db,
        &project_id,
        &scopes
            .iter()
            .map(|s| repo::HarvestScopeInput {
                id: s.id.clone(),
                label: s.label.clone(),
                kind: s.kind.to_string(),
                file_count: s.file_count as i64,
            })
            .collect::<Vec<_>>(),
    )?;
    let coverage = repo::list_harvest_coverage(&state.db, &project_id)?;
    let covered_at: std::collections::HashMap<&str, &WorkspaceHarvestCoverage> = coverage
        .iter()
        .map(|c| (c.scope_id.as_str(), c))
        .collect();
    let scopes_json: Vec<serde_json::Value> = scopes
        .iter()
        .map(|s| {
            let cov = covered_at.get(s.id.as_str());
            json!({
                "id": s.id,
                "label": s.label,
                "kind": s.kind,
                "paths": s.paths,
                "file_count": s.file_count,
                "contexts": s.contexts,
                "last_harvested_at": cov.and_then(|c| c.last_harvested_at.clone()),
                "items_found_last_run": cov.map(|c| c.items_found).unwrap_or(0),
                "run_count": cov.map(|c| c.run_count).unwrap_or(0),
            })
        })
        .collect();

    let snapshot = json!({
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "workspace": { "id": ws.id, "name": ws.name },
        // The map the agent was previously missing entirely.
        "scopes": scopes_json,
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

/// EVERY un-ingested run, oldest first.
///
/// A scope fan-out puts several sessions in the same repo at once, so several
/// run dirs land within seconds of each other. The previous "newest only"
/// behaviour would import one and strand the rest until some later poll
/// happened to pick them up — the fan-out's whole yield hanging on ingest
/// order. Oldest-first so a partially-failing batch still advances.
fn find_ingestable_runs(root: &Path) -> Vec<PathBuf> {
    let runs = root.join("practice-harvest").join("runs");
    let Ok(entries) = std::fs::read_dir(&runs) else {
        return Vec::new();
    };
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = entries
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
    candidates.sort_by(|a, b| a.0.cmp(&b.0));
    candidates.into_iter().map(|(_, p)| p).collect()
}

/// Ingest finished harvest run(s) into the workspace library.
///
/// `run_dir` optional — when omitted EVERY un-ingested run is imported, not
/// just the newest, because a scope fan-out produces one run per territory.
/// Path-confined, size-capped, idempotent (a run dir is marked after ingest and
/// refused twice). Items land `observed` with agent provenance and
/// `origin_project_id = <this member>`; each run also stamps its scope in the
/// coverage ledger.
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

    let dirs: Vec<PathBuf> = match run_dir {
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
            vec![canon]
        }
        None => {
            let found = find_ingestable_runs(&root);
            if found.is_empty() {
                return Err(AppError::Validation(
                    "No un-ingested harvest run found under practice-harvest/runs/ — run the harvest first"
                        .into(),
                ));
            }
            found
        }
    };

    // One bad run must not sink the batch: a fan-out of 4 sessions where one
    // wrote malformed JSON should still import the other 3 and say so.
    let mut total = repo::IngestSummary {
        inserted: 0,
        skipped: Vec::new(),
    };
    let mut failures: Vec<String> = Vec::new();
    let single = dirs.len() == 1;
    for dir in dirs {
        match ingest_one_run(&state, &workspace_id, &project_id, &dir) {
            Ok(summary) => {
                total.inserted += summary.inserted;
                total.skipped.extend(summary.skipped);
            }
            Err(e) => {
                // A lone explicitly-named run keeps the old loud behaviour.
                if single {
                    return Err(e);
                }
                let name = dir
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                tracing::warn!(run = %name, error = %e, "harvest run failed to ingest");
                failures.push(format!("{name}: {e}"));
            }
        }
    }
    total.skipped.extend(failures);
    Ok(total)
}

/// Ingest exactly one run directory. Split out of the command so a fan-out
/// batch can survive a single malformed run.
fn ingest_one_run(
    state: &State<'_, Arc<AppState>>,
    workspace_id: &str,
    project_id: &str,
    dir: &Path,
) -> Result<repo::IngestSummary, AppError> {
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
    // A run that predates scopes (or an agent that dropped the field) read the
    // repo the old way — root-first. Stamping it `repo-global` is the honest
    // reading and keeps every real territory correctly marked unread.
    let scope_id = result
        .scope
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("repo-global")
        .to_string();
    let item_count = result.items.len() as i64;

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
                origin_project_id: Some(project_id.to_string()),
                dedup_key,
                confidence: it.confidence,
            }
        })
        .collect();

    let summary = repo::ingest_candidates(&state.db, &workspace_id, &candidates, "agent", None)?;

    // Coverage is stamped on WHAT WAS READ, not on what survived dedup: a
    // territory that was harvested and yielded only duplicates has still been
    // read, and re-dispatching it ahead of never-read territory is exactly the
    // decay this ledger exists to stop.
    if let Err(e) = repo::stamp_harvest_scope(
        &state.db,
        project_id,
        &scope_id,
        &dir.to_string_lossy(),
        item_count,
    ) {
        // Never fail an ingest over bookkeeping — the practices are already in.
        tracing::warn!(scope = %scope_id, error = %e, "could not stamp harvest coverage");
    }

    // Idempotency marker.
    let _ = std::fs::write(
        dir.join("ingested.json"),
        serde_json::to_string_pretty(&json!({
            "ingested_at": chrono::Utc::now().to_rfc3339(),
            "scope": scope_id,
            "inserted": summary.inserted,
            "skipped": summary.skipped.len(),
        }))
        .unwrap_or_default(),
    );

    Ok(summary)
}

// ── coverage ────────────────────────────────────────────────────────────────

/// Per-scope harvest coverage for a member repo — what the dispatcher reads to
/// pick the next wave, and what the UI shows so an unread codebase can never
/// look like a complete one.
#[tauri::command]
pub async fn dev_tools_workspace_harvest_coverage(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<WorkspaceHarvestCoverage>, AppError> {
    require_auth(&state).await?;
    repo::list_harvest_coverage(&state.db, &project_id)
}
