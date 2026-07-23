//! KPI simulation — dispatch preparation + result ingestion
//! (docs/plans/kpi-simulation-skill.md P1/P2).
//!
//! The simulation itself runs as a LONG Dev-runner session (a Fleet Claude
//! Code session in the managed repo, spawned by the frontend with the
//! `kpi-sim:<project>` key). This module owns the two app-side ends:
//!
//! - `dev_tools_kpi_sim_prepare` — writes `<repo>/kpi-sim/snapshot.json`
//!   (project + managed KPIs + env vocabulary) so the session grounds in the
//!   real KPI state without prompt-size limits or DB access.
//! - `dev_tools_kpi_sim_ingest` — parses `<repo>/kpi-sim/runs/<id>/result.json`
//!   back into the app: class-2 simulated measurements (env `local`/`test`
//!   ONLY, never roll `current_value` forward), class-1/-3 outcomes as
//!   new-KPI proposals (existing review queue) or `kpi_sim` findings (triage
//!   spine). The CLI session NEVER writes personas.db — this command is the
//!   only door, and it validates everything it lets through.
//!
//! Epistemic guardrails enforced here (not just in the prompt): simulated
//! values cannot claim `production`; every measurement needs evidence; caps
//! mirror the KPI scan's; an ingested run dir is marked and refused twice.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::State;
use ts_rs::TS;

use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Mirror of the KPI scan's review-queue caps — the sim run feeds the same queue.
const MAX_PENDING_PROPOSALS: i64 = 10;
const MAX_PROPOSALS_PER_RUN: usize = 8;
/// Measurement rows accepted from one run — a sim emits per-KPI aggregates,
/// not raw sample streams; anything bigger is a malformed result.
const MAX_MEASUREMENTS_PER_RUN: usize = 50;
const MAX_RESULT_BYTES: u64 = 1_048_576;

// ── result.json shape (lenient: unknown fields ignored, bad rows skipped) ──

#[derive(Debug, Deserialize)]
struct SimResult {
    #[serde(default)]
    sim_run_id: Option<String>,
    #[serde(default)]
    measurements: Vec<SimMeasurement>,
    #[serde(default)]
    proposals: Vec<SimProposal>,
    #[serde(default)]
    findings: Vec<SimFinding>,
}

#[derive(Debug, Deserialize)]
struct SimMeasurement {
    kpi_id: String,
    value: f64,
    /// 'local' | 'test' — production is rejected by the repo layer too.
    env: String,
    #[serde(default)]
    confidence: Option<f64>,
    /// Free-shape evidence object; stored verbatim (plus the run id) so the
    /// drawer's provenance line can trace the value.
    #[serde(default)]
    evidence: Option<serde_json::Value>,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SimProposal {
    /// 'new_kpi' → proposed dev_kpis row; 'adopt_measure_config' |
    /// 'adjust_target' | 'retire' → a `kpi_sim` finding in the triage spine.
    kind: String,
    #[serde(default)]
    kpi_id: Option<String>,
    #[serde(default)]
    payload: Option<serde_json::Value>,
    #[serde(default)]
    rationale: Option<String>,
    #[serde(default)]
    citations: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SimFinding {
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    kpi_id: Option<String>,
    #[serde(default)]
    evidence: Option<serde_json::Value>,
}

/// New-KPI proposal payload (inside `SimProposal.payload` for kind='new_kpi').
#[derive(Debug, Deserialize)]
struct NewKpiPayload {
    name: String,
    #[serde(default)]
    description: Option<String>,
    category: String,
    measure_kind: String,
    #[serde(default)]
    measure_config: Option<serde_json::Value>,
    #[serde(default)]
    unit: Option<String>,
    #[serde(default = "default_direction")]
    direction: String,
    #[serde(default)]
    baseline_value: Option<f64>,
    #[serde(default)]
    target_value: Option<f64>,
    #[serde(default)]
    target_date: Option<String>,
    #[serde(default = "default_cadence")]
    cadence: String,
    #[serde(default)]
    needed_connector: Option<String>,
}
fn default_direction() -> String {
    "up".into()
}
fn default_cadence() -> String {
    "weekly".into()
}

// ── outputs ────────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, TS)]
#[ts(export)]
pub struct KpiSimPrepared {
    pub snapshot_path: String,
    pub root_path: String,
    pub kpi_count: u32,
}

#[derive(Debug, Default, serde::Serialize, TS)]
#[ts(export)]
pub struct KpiSimIngestSummary {
    pub run_dir: String,
    pub measurements_recorded: u32,
    pub proposals_created: u32,
    pub findings_created: u32,
    /// Per-row reasons for anything the validator refused — surfaced in the
    /// UI so a lossy ingest is never silent.
    pub skipped: Vec<String>,
}

// ── prepare ────────────────────────────────────────────────────────────────

/// Write the KPI snapshot the sim session grounds in. Returns its path so the
/// frontend can reference it in the dispatch prompt.
#[tauri::command]
pub async fn dev_tools_kpi_sim_prepare(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<KpiSimPrepared, AppError> {
    require_auth(&state).await?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let root = PathBuf::from(&project.root_path);
    if !root.is_dir() {
        return Err(AppError::Validation(format!(
            "Project root does not exist: {}",
            project.root_path
        )));
    }

    let kpis = repo::list_kpis(&state.db, &project_id, None)?;
    // Proposed KPIs ride along (status distinguishes them) so a repeat run
    // KNOWS what already awaits review and never re-proposes it — the first
    // L1→L2 comparison produced duplicate new-KPI proposals without this.
    let managed: Vec<_> = kpis
        .iter()
        .filter(|k| k.status == "active" || k.status == "paused" || k.status == "proposed")
        .collect();
    let snapshot = json!({
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "project": { "id": project.id, "name": project.name, "root_path": project.root_path },
        "envs": ["local", "test", "production"],
        "kpis": managed.iter().map(|k| json!({
            "id": k.id,
            "name": k.name,
            "description": k.description,
            "category": k.category,
            "measure_kind": k.measure_kind,
            "measure_config": k.measure_config,
            "unit": k.unit,
            "direction": k.direction,
            "baseline_value": k.baseline_value,
            "target_value": k.target_value,
            "target_date": k.target_date,
            "current_value": k.current_value,
            "last_measured_at": k.last_measured_at,
            "cadence": k.cadence,
            "tier": k.tier,
            "status": k.status,
            "rationale": k.rationale,
        })).collect::<Vec<_>>(),
    });

    let dir = root.join("kpi-sim");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Internal(format!("Cannot create kpi-sim/: {e}")))?;
    let path = dir.join("snapshot.json");
    std::fs::write(&path, serde_json::to_vec_pretty(&snapshot).unwrap_or_default())
        .map_err(|e| AppError::Internal(format!("Cannot write snapshot: {e}")))?;

    Ok(KpiSimPrepared {
        snapshot_path: path.to_string_lossy().into_owned(),
        root_path: project.root_path.clone(),
        kpi_count: managed.len() as u32,
    })
}

// ── ingest ─────────────────────────────────────────────────────────────────

/// Newest run dir under `<root>/kpi-sim/runs/` that has a result.json and no
/// ingested marker.
fn find_ingestable_run(root: &Path) -> Option<PathBuf> {
    let runs = root.join("kpi-sim").join("runs");
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(&runs)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.is_dir() || !p.join("result.json").is_file() || p.join("ingested.json").is_file()
            {
                return None;
            }
            let t = e.metadata().and_then(|m| m.modified()).ok()?;
            Some((t, p))
        })
        .collect();
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.into_iter().map(|(_, p)| p).next()
}

/// Ingest a finished simulation run. `run_dir` optional — defaults to the
/// newest un-ingested run. Idempotent: a run dir is marked after ingest and
/// refused on a second attempt.
#[tauri::command]
pub async fn dev_tools_kpi_sim_ingest(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    run_dir: Option<String>,
) -> Result<KpiSimIngestSummary, AppError> {
    require_auth(&state).await?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let root = PathBuf::from(&project.root_path);

    let dir = match run_dir {
        Some(d) => {
            let p = PathBuf::from(&d);
            // The run dir must live under THIS project's kpi-sim/runs — an
            // arbitrary path would let a crafted call ingest foreign files.
            let runs_root = root.join("kpi-sim").join("runs");
            let canon = p.canonicalize().map_err(|e| {
                AppError::Validation(format!("Run dir not readable: {e}"))
            })?;
            let canon_root = runs_root
                .canonicalize()
                .map_err(|_| AppError::Validation("No kpi-sim/runs directory in this repo yet".into()))?;
            if !canon.starts_with(&canon_root) {
                return Err(AppError::Validation(
                    "Run dir must be inside the project's kpi-sim/runs/".into(),
                ));
            }
            canon
        }
        None => find_ingestable_run(&root).ok_or_else(|| {
            AppError::Validation(
                "No un-ingested simulation run found under kpi-sim/runs/ — run the simulation first"
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
    let result: SimResult = serde_json::from_str(&raw)
        .map_err(|e| AppError::Validation(format!("result.json is not valid: {e}")))?;
    let sim_run_id = result
        .sim_run_id
        .clone()
        .unwrap_or_else(|| dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());

    let mut summary = KpiSimIngestSummary {
        run_dir: dir.to_string_lossy().into_owned(),
        ..Default::default()
    };

    // Project KPI ids — every kpi_id in the result must belong to THIS project.
    let kpis = repo::list_kpis(&state.db, &project_id, None)?;
    let kpi_name = |id: &str| kpis.iter().find(|k| k.id == id).map(|k| k.name.clone());

    // ── measurements (class 2) ──
    for (i, m) in result.measurements.iter().enumerate() {
        if summary.measurements_recorded as usize >= MAX_MEASUREMENTS_PER_RUN {
            summary.skipped.push(format!(
                "measurement cap {MAX_MEASUREMENTS_PER_RUN} reached — rest dropped"
            ));
            break;
        }
        let Some(name) = kpi_name(&m.kpi_id) else {
            summary
                .skipped
                .push(format!("measurement[{i}]: kpi {} not in this project", m.kpi_id));
            continue;
        };
        if !m.value.is_finite() {
            summary.skipped.push(format!("measurement[{i}] ({name}): non-finite value"));
            continue;
        }
        if m.evidence.is_none() {
            summary.skipped.push(format!(
                "measurement[{i}] ({name}): no evidence — simulated values without provenance are refused"
            ));
            continue;
        }
        let mut ev = m.evidence.clone().unwrap_or_else(|| json!({}));
        if let Some(obj) = ev.as_object_mut() {
            obj.insert("sim_run_id".into(), json!(sim_run_id));
            if let Some(c) = m.confidence {
                obj.insert("confidence".into(), json!(c));
            }
        }
        match repo::record_kpi_simulation_measurement(
            &state.db,
            &m.kpi_id,
            m.value,
            &m.env,
            Some(&ev.to_string()),
            m.note.as_deref(),
        ) {
            Ok(_) => summary.measurements_recorded += 1,
            Err(e) => summary.skipped.push(format!("measurement[{i}] ({name}): {e}")),
        }
    }

    // ── proposals ──
    let pending: i64 = {
        let conn = state.db.get()?;
        conn.query_row(
            "SELECT COUNT(*) FROM dev_kpis WHERE project_id = ?1 AND status = 'proposed'",
            rusqlite::params![project_id],
            |r| r.get(0),
        )
        .unwrap_or(0)
    };
    let mut new_kpi_budget = (MAX_PROPOSALS_PER_RUN as i64)
        .min((MAX_PENDING_PROPOSALS - pending).max(0)) as usize;

    for (i, p) in result.proposals.iter().enumerate() {
        match p.kind.as_str() {
            "new_kpi" => {
                if new_kpi_budget == 0 {
                    summary
                        .skipped
                        .push(format!("proposal[{i}]: new-KPI budget exhausted (queue cap)"));
                    continue;
                }
                let Some(payload) = p.payload.clone() else {
                    summary.skipped.push(format!("proposal[{i}]: new_kpi without payload"));
                    continue;
                };
                let np: NewKpiPayload = match serde_json::from_value(payload) {
                    Ok(v) => v,
                    Err(e) => {
                        summary.skipped.push(format!("proposal[{i}]: bad new_kpi payload: {e}"));
                        continue;
                    }
                };
                // Name-level dedup across runs — the queue must never collect
                // the same proposal twice (any status counts: a proposed twin
                // is pending, an archived twin was rejected).
                if kpis.iter().any(|k| k.name.trim().eq_ignore_ascii_case(np.name.trim())) {
                    summary.skipped.push(format!(
                        "proposal[{i}]: a KPI named '{}' already exists in this project",
                        np.name.trim()
                    ));
                    continue;
                }
                let rationale = format!(
                    "[simulation {sim_run_id}] {}{}",
                    p.rationale.clone().unwrap_or_default(),
                    if p.citations.is_empty() {
                        String::new()
                    } else {
                        format!(" — sources: {}", p.citations.join(" · "))
                    }
                );
                match repo::create_kpi(
                    &state.db,
                    &project_id,
                    &np.name,
                    np.description.as_deref(),
                    None,
                    &np.category,
                    &np.measure_kind,
                    &np.measure_config.map(|v| v.to_string()).unwrap_or_else(|| "{}".into()),
                    np.unit.as_deref().unwrap_or(""),
                    &np.direction,
                    np.baseline_value,
                    np.target_value,
                    np.target_date.as_deref(),
                    &np.cadence,
                    Some("proposed"),
                    "scan",
                    Some(&rationale),
                    np.needed_connector.as_deref(),
                    None,
                    None,
                    None,
                ) {
                    Ok(_) => {
                        summary.proposals_created += 1;
                        new_kpi_budget -= 1;
                    }
                    Err(e) => summary.skipped.push(format!("proposal[{i}]: {e}")),
                }
            }
            kind @ ("adopt_measure_config" | "adjust_target" | "retire") => {
                // Mutations of EXISTING KPIs are never applied directly — they
                // land as findings in the triage spine, evidence carrying the
                // exact suggested payload.
                let Some(kpi_id) = p.kpi_id.as_deref() else {
                    summary.skipped.push(format!("proposal[{i}]: {kind} without kpi_id"));
                    continue;
                };
                let Some(name) = kpi_name(kpi_id) else {
                    summary
                        .skipped
                        .push(format!("proposal[{i}]: kpi {kpi_id} not in this project"));
                    continue;
                };
                let title = match kind {
                    "adopt_measure_config" => format!("Adopt local measurement for KPI \"{name}\""),
                    "adjust_target" => format!("Adjust target for KPI \"{name}\""),
                    _ => format!("Retire KPI \"{name}\""),
                };
                let evidence = json!({
                    "sim_run_id": sim_run_id,
                    "kind": kind,
                    "kpi_id": kpi_id,
                    "payload": p.payload,
                    "citations": p.citations,
                })
                .to_string();
                match repo::create_finding(
                    &state.db,
                    &project_id,
                    "kpi_sim",
                    &title,
                    p.rationale.as_deref(),
                    None,
                    None,
                    None,
                    Some(&evidence),
                    &format!("kpi_sim:{kind}:{kpi_id}"),
                    Some(2),
                    None,
                    None,
                ) {
                    Ok(Some(_)) => summary.findings_created += 1,
                    Ok(None) => summary
                        .skipped
                        .push(format!("proposal[{i}]: duplicate ({kind} for {name} already raised)")),
                    Err(e) => summary.skipped.push(format!("proposal[{i}]: {e}")),
                }
            }
            other => summary
                .skipped
                .push(format!("proposal[{i}]: unknown kind '{other}'")),
        }
    }

    // ── findings ──
    for (i, f) in result.findings.iter().enumerate() {
        let evidence = f.evidence.as_ref().map(|v| {
            json!({ "sim_run_id": sim_run_id, "detail": v }).to_string()
        });
        let slug: String = f
            .title
            .to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '-' })
            .collect::<String>()
            .chars()
            .take(60)
            .collect();
        match repo::create_finding(
            &state.db,
            &project_id,
            "kpi_sim",
            &f.title,
            f.description.as_deref(),
            None,
            None,
            None,
            evidence.as_deref(),
            &format!("kpi_sim:finding:{}:{slug}", f.kpi_id.clone().unwrap_or_default()),
            Some(2),
            None,
            None,
        ) {
            Ok(Some(_)) => summary.findings_created += 1,
            Ok(None) => summary.skipped.push(format!("finding[{i}]: duplicate")),
            Err(e) => summary.skipped.push(format!("finding[{i}]: {e}")),
        }
    }

    // Mark ingested (idempotency) — best-effort; failure to mark is surfaced.
    let marker = json!({
        "ingested_at": chrono::Utc::now().to_rfc3339(),
        "measurements_recorded": summary.measurements_recorded,
        "proposals_created": summary.proposals_created,
        "findings_created": summary.findings_created,
    });
    if let Err(e) = std::fs::write(
        dir.join("ingested.json"),
        serde_json::to_vec_pretty(&marker).unwrap_or_default(),
    ) {
        summary
            .skipped
            .push(format!("could not write ingested marker (re-ingest will duplicate findings-safe rows): {e}"));
    }

    Ok(summary)
}
