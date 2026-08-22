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

use crate::db::models::WorkspaceHarvestCoverage;
use crate::db::repos::dev_tools as dev_repo;
use crate::db::repos::dev_workspaces as repo;
use crate::db::repos::dev_workspaces::KnowledgeCandidate;
use crate::db::repos::workspace_taxonomy as taxonomy;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;
use personas_core::harvest_scopes as scopes;

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
    /// Self-reported read depth. Optional — an agent that will not estimate
    /// must leave it absent rather than have the app invent a number.
    #[serde(default)]
    coverage: Option<HarvestCoverageReport>,
}

/// What the session says it actually read. The 2026-07-27 scan proved agents
/// volunteer this accurately and unprompted ("~11% of 404 files", plus the
/// named pockets they never opened); the first ledger threw it away.
#[derive(Debug, Default, Deserialize)]
struct HarvestCoverageReport {
    #[serde(default)]
    files_read: Option<i64>,
    #[serde(default)]
    files_total: Option<i64>,
    #[serde(default)]
    estimated_pct: Option<i64>,
    /// Paths this run did NOT open — fed back into the next dispatch.
    #[serde(default)]
    unread_pockets: Vec<String>,
    #[serde(default)]
    note: Option<String>,
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
    /// Pattern id this item REFINES (fabric F4 contribution loop) — becomes a
    /// child->parent `extends` edge at ingest; the item still lands observed.
    #[serde(default)]
    extends: Option<String>,
    /// Three-layer model (pattern-fabric v2): 'principle' | 'manifestation'.
    /// Optional — omitted lands NULL (unclassified), validated at the door.
    #[serde(default)]
    layer: Option<String>,
    /// Structured proof rows (pattern-fabric v2): `[{"refs": ["path:line"],
    /// "quote": "..."}]` — become workspace_knowledge_evidence rows with
    /// source='harvest' and the run's own project id.
    #[serde(default)]
    evidence: Vec<repo::EvidenceCandidate>,
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
    prepare_harvest_core(&state, &workspace_id, &project_id).map(|c| c.prepared)
}

/// One harvestable scope joined with its coverage:
/// `(scope_id, label, file_count, last_harvested_at, estimated_pct)`.
pub(crate) type HarvestScopeRow = (String, String, i64, Option<String>, Option<i64>);

/// What the companion's `run_pattern_harvest` executor needs beyond the
/// frontend's `HarvestPrepared`: the names for prompt-building and the
/// territory list (with coverage) for depth-first scope selection.
pub(crate) struct PreparedHarvestCore {
    pub prepared: HarvestPrepared,
    pub workspace_name: String,
    pub project_name: String,
    /// `(scope_id, label, file_count, last_harvested_at, estimated_pct)` —
    /// coverage-joined. `estimated_pct = None` on a harvested scope means the
    /// run predates depth reporting — treat as UNKNOWN depth, i.e. owing.
    pub scopes: Vec<HarvestScopeRow>,
}

/// A territory counts as READ once its self-reported depth reaches this.
/// Below (or unmeasured), it still owes a pass — the deep-re-scan campaign's
/// whole premise is that a 1-pass, depth-unknown harvest is not coverage.
pub(crate) const HARVEST_DEPTH_TARGET_PCT: i64 = 70;

/// Auth-free core of [`dev_tools_workspace_harvest_prepare`], shared with the
/// companion executor so both dispatch surfaces ground sessions through ONE
/// snapshot writer.
pub(crate) fn prepare_harvest_core(
    state: &AppState,
    workspace_id: &str,
    project_id: &str,
) -> Result<PreparedHarvestCore, AppError> {
    let ws = repo::get_workspace_by_id(&state.db, workspace_id)?;
    let project = dev_repo::get_project_by_id(&state.db, project_id)?;
    if project.workspace_id.as_deref() != Some(workspace_id) {
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
    let members = repo::list_workspace_projects(&state.db, workspace_id)?;
    let siblings: Vec<serde_json::Value> = members
        .iter()
        .filter(|p| p.id != project_id)
        .map(|p| json!({ "name": p.name, "tech_stack": p.tech_stack }))
        .collect();

    // Existing practice titles (any live status) — do not re-propose these.
    let existing = repo::list_knowledge(&state.db, workspace_id, None)?;
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
        project_id,
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
    let coverage = repo::list_harvest_coverage(&state.db, project_id)?;
    let covered_at: std::collections::HashMap<&str, &WorkspaceHarvestCoverage> =
        coverage.iter().map(|c| (c.scope_id.as_str(), c)).collect();
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
                "last_estimated_pct": cov.and_then(|c| c.estimated_pct),
                // What the PREVIOUS pass over this scope said it never opened.
                // This is what makes a second wave a second pass instead of a
                // re-read of the same ground.
                "unread_pockets": cov
                    .and_then(|c| c.unread_pockets.as_deref())
                    .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
                    .unwrap_or_default(),
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
        // The SHAPE axis, closed for the same reason the topic areas are: left
        // as a prompt comment it produced 90 distinct values across 330 items.
        "ftypes": {
            "rule": "ftype = exactly one value from this closed list. It answers what SHAPE the practice is; `topic` answers where it lives. Never coin a new ftype — an unrecognized value is filed on an `unsorted` shelf.",
            "values": taxonomy::FTYPE_HINTS
                .iter()
                .map(|(t, hint)| json!({ "ftype": t, "covers": hint }))
                .collect::<Vec<_>>(),
        },
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

    Ok(PreparedHarvestCore {
        prepared: HarvestPrepared {
            snapshot_path: snapshot_path.to_string_lossy().into_owned(),
            root_path: project.root_path.clone(),
        },
        workspace_name: ws.name.clone(),
        project_name: project.name.clone(),
        scopes: scopes
            .iter()
            .map(|s| {
                let cov = covered_at.get(s.id.as_str());
                (
                    s.id.clone(),
                    s.label.clone(),
                    s.file_count as i64,
                    cov.and_then(|c| c.last_harvested_at.clone()),
                    cov.and_then(|c| c.estimated_pct),
                )
            })
            .collect(),
    })
}

// ── ingest ─────────────────────────────────────────────────────────────────

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
    ingest_harvest_runs_core(&state, &workspace_id, &project_id, run_dir)
}

/// Auth-free core of [`dev_tools_workspace_knowledge_ingest`], shared with
/// the companion's harvest watcher (`sweep_pending_harvest_ingests`) so a
/// harvest Athena dispatched lands in the library without the Workspaces UI
/// being open. Same door, same caps, same idempotency.
pub(crate) fn ingest_harvest_runs_core(
    state: &AppState,
    workspace_id: &str,
    project_id: &str,
    run_dir: Option<String>,
) -> Result<repo::IngestSummary, AppError> {
    let project = dev_repo::get_project_by_id(&state.db, project_id)?;
    if project.workspace_id.as_deref() != Some(workspace_id) {
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
            let found = crate::commands::infrastructure::skill_runs::ingestable_runs_oldest_first(
                &root.join("practice-harvest").join("runs"),
            );
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
        match ingest_one_run(state, workspace_id, project_id, &dir) {
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

    // Derive doctrine links across the whole workspace once the batch is in.
    // A harvest session only ever sees its own territory, so it cannot know
    // what a topic already holds — this is the one place the full topic is
    // visible. Never fatal: the practices are already stored.
    if total.inserted > 0 {
        if let Err(e) = repo::roll_up_topic_doctrine(&state.db, workspace_id) {
            tracing::warn!(error = %e, "could not roll up topic doctrine after ingest");
        }
    }
    Ok(total)
}

/// Ingest exactly one run directory. Split out of the command so a fan-out
/// batch can survive a single malformed run.
fn ingest_one_run(
    state: &AppState,
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
                harvest_scope: Some(scope_id.clone()),
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
                extends: it.extends,
                layer: it.layer,
                evidence: it.evidence,
            }
        })
        .collect();

    let summary = repo::ingest_candidates(&state.db, workspace_id, &candidates, "agent", None)?;

    // Coverage is stamped on WHAT WAS READ, not on what survived dedup: a
    // territory that was harvested and yielded only duplicates has still been
    // read, and re-dispatching it ahead of never-read territory is exactly the
    // decay this ledger exists to stop.
    let cov = result.coverage.unwrap_or_default();
    let depth = repo::HarvestDepth {
        files_read: cov.files_read,
        files_total: cov.files_total,
        // Derive the percentage when the agent gave counts but no percentage;
        // never invent one from nothing.
        estimated_pct: cov
            .estimated_pct
            .or_else(|| match (cov.files_read, cov.files_total) {
                (Some(r), Some(t)) if t > 0 => Some(((r as f64 / t as f64) * 100.0).round() as i64),
                _ => None,
            }),
        unread_pockets: if cov.unread_pockets.is_empty() {
            None
        } else {
            serde_json::to_string(&cov.unread_pockets).ok()
        },
        note: cov.note,
    };
    if let Err(e) = repo::stamp_harvest_scope(
        &state.db,
        project_id,
        &scope_id,
        &dir.to_string_lossy(),
        item_count,
        &depth,
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

// ── companion dispatch (run_pattern_harvest) ────────────────────────────────
//
// The Athena-side twin of the frontend dispatcher (ExtractionMenu.tsx +
// practiceHarvestPrompt.ts). TWO RENDERERS, ONE CONTRACT: the prompt below is
// a Rust port of `buildHarvestPrompt` in
// src/features/overview/sub_patterns/practiceHarvestPrompt.ts — each side is
// pinned to the SAME deserializer (`HarvestResult`/`HarvestItem` above) by its
// own test, so drift breaks a build instead of a harvest. If you change the
// contract, change BOTH builders and the deserializer in one commit.

/// Fleet dedup key for a per-scope harvest session — byte-identical to the TS
/// `harvestDispatchKey`, because both the frontend auto-ingest hook and the
/// backend watcher below find harvest sessions by this substring in the
/// session name.
pub(crate) fn harvest_dispatch_key(workspace_id: &str, project_id: &str, scope_id: &str) -> String {
    format!("workspace-harvest:{workspace_id}:{project_id}:{scope_id}")
}

/// Rust port of `buildHarvestPrompt` (see the module comment above for the
/// parity rules). `scope` is `(id, label, file_count)`.
pub(crate) fn build_harvest_prompt(
    workspace_name: &str,
    project_name: &str,
    scope: (&str, &str, i64),
) -> String {
    let (scope_id, scope_label, file_count) = scope;
    let size = if file_count > 0 {
        format!("\n  size:        ~{file_count} files")
    } else {
        String::new()
    };
    format!(
        r#"You are harvesting reusable best practices from the "{project_name}" repository for the "{workspace_name}" workspace's shared knowledge library.

GROUND TRUTH — read `practice-harvest/snapshot.json` at the repo root FIRST. It carries the workspace name, this project's stack + standards, the sibling projects (name + stack), `scopes` (every territory in this repo, with its paths, contexts and when each was last harvested), the titles of practices already in the library (do NOT re-propose these), and rejected dedup keys (do NOT re-propose these either). Everything you output must be grounded in THIS repository's real files.

YOUR SCOPE — you are harvesting exactly ONE territory of this repo:

  scope id:    {scope_id}
  scope label: {scope_label}{size}

Find this id in `scopes` in snapshot.json. It lists the `paths` you own and (when the repo has a context map) the named `contexts` inside them — that is your index into your own territory.

- **Read inside your scope, broadly.** Open a real sample of its files across its different paths, not one file per path. You are the only session assigned to this territory; whatever you do not read, nobody reads.
- **Do not harvest outside it.** Root configs, lint setup, CI, hooks and scripts belong to the `repo-global` scope and are another session's job. Unless your scope IS `repo-global`, an item sourced from them is out of bounds — this is the single most common way a harvest fakes coverage, because those files are the cheapest place to find something that looks like a "convention".
- If your scope turns out to be genuinely thin, say so in report.md and return few items. Reporting an empty territory honestly is worth more than padding it.

WHAT TO HARVEST — durable, reusable engineering practices worth sharing across the workspace, in these layers: design, code-quality, ui, performance, process. Inside your scope, mine what the code actually does: module and data boundaries, error and result handling, state and data-flow patterns, concurrency/cancellation/retry handling, API and IPC seams, persistence and migration patterns, test setup and fixtures, performance techniques, and the pitfalls the code visibly defends against (a guard, a workaround, or a comment explaining a past failure is prime material — those are the practices a sibling project would otherwise learn the hard way). A practice is worth harvesting only if a sibling project could plausibly adopt it.
kind ∈ pattern | pitfall | decision | howto | fact.

TOPIC — the library uses a CLOSED, precedence-ordered vocabulary, shipped to you as `taxonomy` in snapshot.json. Read it before you write any item.
- A topic is EXACTLY two segments: `area/cluster`. Never one, never three.
- `topic` answers WHERE the practice lives (which concern or subsystem it governs). `ftype` separately answers what SHAPE it is — do not encode shape in the topic.
- Areas are PRECEDENCE-ORDERED. Walk the area list in the order given and take the FIRST that genuinely governs. `architecture` is near the end on purpose — use it only when no subsystem area applies.
- Prefer a listed cluster. If none genuinely fits you MAY name a new one, but only under a listed area — never invent an area.
- Your scope does NOT dictate your topic. Classify each item on its own merits.

OUTPUT CONTRACT — write `practice-harvest/runs/<YYYY-MM-DD-HHmm>-<scope-id>/result.json` (and a short `report.md`). Put the scope id in the directory name so concurrent scope sessions never collide — replacing `:` with `-`, since a colon is not a legal path character on Windows. The `scope` FIELD below keeps the id verbatim; that is what stamps coverage. The app ingests result.json; you NEVER write any database. Exact shape:
{{
  "scope": "<your scope id, exactly as given above>",   // REQUIRED: stamps coverage
  "items": [
    {{
      "kind": "pattern",                         // pattern|pitfall|decision|howto|fact
      "title": "Short imperative claim",          // required
      "statement": "The distilled practice a session should act on.", // required
      "detail_md": "Evidence: real code/config from THIS repo (markdown). Optional but strongly preferred.",
      "topic": "errors/degradation",               // REQUIRED: area/cluster from snapshot.json's taxonomy
      "abstraction": "meso",                       // macro | meso | micro — prefer meso/macro design patterns over micro lint
      "ftype": "error-strategy",                   // REQUIRED: one value from `ftypes` in snapshot.json — a CLOSED list. Never coin one.
      "evidence_count": 4,                         // optional prevalence (how many sites)
      "applicability": {{ "layers": ["code-quality"], "languages": ["TypeScript"], "frameworks": ["React"] }}, // optional object
      "dedup_key": "harvest:<stable-slug>",        // optional; the app derives one from the title if omitted
      "confidence": 0.7,                           // optional 0..1
      "extends": "<pattern-id>",                   // optional: the EXISTING pattern this item refines (id from existing_practices in snapshot.json)
      "layer": "manifestation",                    // optional: principle | manifestation. A PRINCIPLE is universal and language-free; a MANIFESTATION applies one to this stack/seam. Omit when unsure — never guess.
      "evidence": [ {{ "refs": ["src/path/file.rs:120"], "quote": "the guard comment or excerpt" }} ]  // structured proof rows — PREFERRED over prose citations inside detail_md
    }}
  ],
  "coverage": {{                                    // REQUIRED
    "files_read": 45,
    "files_total": 359,
    "estimated_pct": 13,
    "unread_pockets": ["src/features/teams/sub_goals"],
    "note": "Schedules and triggers read near-exhaustively; teams/ is the real gap."
  }}
}}

FTYPE — `ftype` is a CLOSED vocabulary shipped as `ftypes` in snapshot.json. Pick the one that fits and never invent a value. If your instinct is "guard" / "guardrail" / "trap" / "anti-pattern", the answer is `error-strategy`. Do NOT send `durability` — it is not an author's call.

HOW MANY ITEMS — there is no cap. Report every practice your territory genuinely supports; for a scope of a few hundred files that is usually somewhere between 5 and 25. Do not stop early because you have "enough", and do not pad with generic advice this repo does not actually practise.

COVERAGE — result.json MUST carry a `coverage` block (shape above). `estimated_pct` decides whether this territory still owes a pass, and `unread_pockets` is handed to the NEXT session assigned here so it starts where you stopped. Estimate honestly — under-reporting costs nothing, over-reporting silently retires a territory nobody finished. If you genuinely cannot estimate, omit the field rather than guessing.

REPORT — `report.md` is a REQUIRED deliverable: state honestly which paths inside your scope you actually read, which you did NOT get to, and anything you deliberately skipped and why.

HARD RULES:
- Only write files under `practice-harvest/runs/<id>/`. Touch nothing else in the repo.
- Ground every item in real evidence from this repo — no generic advice that isn't actually practised here.
- Stay inside your scope (see YOUR SCOPE above).
- Skip anything whose title matches an existing_practice_title or whose dedup_key is in rejected_dedup_keys (from the snapshot).
- Items land as "observed" for human review — you are proposing, not adopting.

Check `.claude/skills/` for a `practice-harvest` skill and follow it if present; otherwise use the embedded procedure above — do NOT install anything."#
    )
}

// ── pending-ingest watcher ──────────────────────────────────────────────────
//
// The frontend's `useHarvestAutoIngest` only runs while the Workspaces UI is
// mounted; a harvest Athena dispatched must land WITHOUT the UI open. The
// `run_pattern_harvest` executor registers its (workspace, project) here, and
// the fleet stale ticker (30s) calls the sweep: once no session named with
// that project's `workspace-harvest:` key is still working, every un-ingested
// run is imported through the same idempotent door the UI uses — double
// ingest with the frontend hook is safe by construction (the `ingested.json`
// marker). In-memory by design: an app restart drops the watch, and the runs
// are then picked up by the next harvest or the next UI visit, never lost.

fn pending_harvest_ingests() -> &'static std::sync::Mutex<Vec<(String, String)>> {
    static P: std::sync::OnceLock<std::sync::Mutex<Vec<(String, String)>>> =
        std::sync::OnceLock::new();
    P.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

/// Register a dispatched harvest for post-completion ingest.
pub(crate) fn note_pending_harvest(workspace_id: &str, project_id: &str) {
    let mut p = pending_harvest_ingests().lock().unwrap();
    let key = (workspace_id.to_string(), project_id.to_string());
    if !p.contains(&key) {
        p.push(key);
    }
}

/// Fleet states that mean a harvest session is still doing work — mirror of
/// the frontend hook's ACTIVE set. Idle is FINISHED for an interactive CLI:
/// a done session sits at the prompt forever; it does not exit.
fn harvest_session_is_active(state: crate::commands::fleet::types::FleetSessionState) -> bool {
    use crate::commands::fleet::types::FleetSessionState as S;
    matches!(state, S::Spawning | S::Running | S::AwaitingInput)
}

/// Called from the fleet stale ticker. For each registered harvest whose
/// sessions have all settled, ingest every un-ingested run and deregister.
pub fn sweep_pending_harvest_ingests(app: &tauri::AppHandle) {
    use tauri::Manager;
    let snapshot: Vec<(String, String)> = {
        let p = pending_harvest_ingests().lock().unwrap();
        p.clone()
    };
    if snapshot.is_empty() {
        return;
    }
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    let sessions = crate::commands::fleet::registry::registry().list_dto();
    for (ws_id, project_id) in snapshot {
        let key_prefix = format!("workspace-harvest:{ws_id}:{project_id}:");
        let still_working = sessions.iter().any(|s| {
            s.name.as_deref().is_some_and(|n| n.contains(&key_prefix))
                && harvest_session_is_active(s.state)
        });
        if still_working {
            continue;
        }
        match ingest_harvest_runs_core(&state, &ws_id, &project_id, None) {
            Ok(summary) => {
                tracing::info!(
                    workspace = %ws_id,
                    project = %project_id,
                    inserted = summary.inserted,
                    skipped = summary.skipped.len(),
                    "harvest watcher: ingested dispatched harvest runs"
                );
                {
                    let mut p = pending_harvest_ingests().lock().unwrap();
                    p.retain(|(w, pr)| !(w == &ws_id && pr == &project_id));
                }
                // Deep-re-scan chaining (docs/concepts/pattern-campaign.md
                // Phase 0): a wave landed — wake Athena with the yield and
                // the honest coverage debt so her next turn proposes the
                // next wave (auto-fires under autonomous mode) or declares
                // the extraction done. Mirrors the verify ladder's wake.
                wake_athena_after_harvest(app, &state, &ws_id, &project_id, summary.inserted);
            }
            Err(e) => {
                let msg = e.to_string();
                // "No un-ingested run found" while nothing is working any
                // more: either the frontend hook beat us to it (fine, the
                // door is idempotent) or the sessions never produced a run.
                // Deregister only when no session with the key EXISTS at all
                // — while one still sits idle it may yet write its run on a
                // later turn.
                let any_session_left = sessions
                    .iter()
                    .any(|s| s.name.as_deref().is_some_and(|n| n.contains(&key_prefix)));
                if msg.contains("No un-ingested harvest run") && !any_session_left {
                    let mut p = pending_harvest_ingests().lock().unwrap();
                    p.retain(|(w, pr)| !(w == &ws_id && pr == &project_id));
                } else {
                    tracing::debug!(
                        workspace = %ws_id,
                        project = %project_id,
                        error = %msg,
                        "harvest watcher: ingest not ready yet"
                    );
                }
            }
        }
    }
}

/// The harvest ladder's wake — after a dispatched wave ingests, hand Athena
/// the yield + the remaining coverage debt (never-harvested or below
/// [`HARVEST_DEPTH_TARGET_PCT`] / depth-unknown territories) so she chains
/// the next `run_pattern_harvest` or stops honestly. Best-effort: a failed
/// lookup just means no wake, never a failed ingest.
fn wake_athena_after_harvest(
    app: &tauri::AppHandle,
    state: &Arc<AppState>,
    workspace_id: &str,
    project_id: &str,
    inserted: u32,
) {
    let Ok(conn) = state.db.get() else { return };
    let project_name: String = conn
        .query_row(
            "SELECT name FROM dev_projects WHERE id = ?1",
            [project_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| project_id.to_string());
    // Coverage debt straight from the ledger the ingest just stamped.
    let coverage = repo::list_harvest_coverage(&state.db, project_id).unwrap_or_default();
    let owing: Vec<String> = coverage
        .iter()
        .filter(|c| {
            c.last_harvested_at.is_none()
                || c.estimated_pct.is_none()
                || c.estimated_pct
                    .is_some_and(|p| p < HARVEST_DEPTH_TARGET_PCT)
        })
        .map(|c| {
            format!(
                "{} ({})",
                c.scope_label,
                match c.estimated_pct {
                    _ if c.last_harvested_at.is_none() => "never".to_string(),
                    None => "depth unknown".to_string(),
                    Some(p) => format!("{p}%"),
                }
            )
        })
        .collect();
    let pending_review: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workspace_knowledge
             WHERE workspace_id = ?1 AND status IN ('observed', 'proposed')",
            [workspace_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let directive = format!(
        "The harvest wave you dispatched on `{project_name}` finished and ingested:          {inserted} new observed item(s); {pending_review} now await Michal's review in the          knowledge queue.
         Territories still owing coverage (never harvested, depth unknown, or below          {HARVEST_DEPTH_TARGET_PCT}%): {owing_txt}.
         If territories still owe coverage and the deep re-scan should continue, propose the          next `run_pattern_harvest` for the same project now (it picks the neediest          territories itself). If none owe, the extraction phase is DONE — tell Michal the          review queue is ready for adjudication, and do NOT propose apply work until the new          items are adopted and the verify ladder has measured them.",
        owing_txt = if owing.is_empty() { "none".to_string() } else { owing.join(", ") },
    );
    crate::companion::session::spawn_proactive_turn_in(
        app.clone(),
        std::sync::Arc::new(state.user_db.clone()),
        std::sync::Arc::new(state.db.clone()),
        #[cfg(feature = "ml")]
        state.embedding_manager.clone(),
        "harvest_wave_done".to_string(),
        Some(project_id.to_string()),
        directive,
        crate::companion::session::DEFAULT_SESSION_ID.to_string(),
    );
}

#[cfg(test)]
mod harvest_prompt_tests {
    use super::*;

    /// The Rust prompt's OUTPUT CONTRACT must name every field the
    /// `HarvestItem`/`HarvestResult` deserializer reads — this is the pin
    /// that keeps the two renderers (this one and practiceHarvestPrompt.ts)
    /// from drifting away from the one contract.
    #[test]
    fn prompt_contract_names_every_deserializer_field() {
        let p = build_harvest_prompt("ws", "proj", ("group:x", "Feature X", 120));
        for field in [
            "\"scope\"",
            "\"items\"",
            "\"kind\"",
            "\"title\"",
            "\"statement\"",
            "\"detail_md\"",
            "\"topic\"",
            "\"abstraction\"",
            "\"ftype\"",
            "\"evidence_count\"",
            "\"applicability\"",
            "\"dedup_key\"",
            "\"confidence\"",
            "\"extends\"",
            "\"layer\"",
            "\"evidence\"",
            "\"refs\"",
            "\"quote\"",
            "\"coverage\"",
            "\"files_read\"",
            "\"files_total\"",
            "\"estimated_pct\"",
            "\"unread_pockets\"",
        ] {
            assert!(p.contains(field), "prompt lost contract field {field}");
        }
        assert!(p.contains("result.json"), "output filename gone");
        assert!(p.contains("practice-harvest/runs/"), "run dir gone");
        assert!(p.contains("scope id:    group:x"), "scope id not injected");
        assert!(p.contains("~120 files"), "file count not injected");
        // The proposing-not-adopting doctrine must survive any rewrite.
        assert!(
            p.contains("proposing, not adopting"),
            "consent doctrine gone"
        );
    }

    #[test]
    fn dispatch_key_matches_the_ts_shape() {
        assert_eq!(
            harvest_dispatch_key("ws1", "p1", "group:exec"),
            "workspace-harvest:ws1:p1:group:exec"
        );
    }
}
