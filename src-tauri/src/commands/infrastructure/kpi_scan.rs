//! KPI proposal scan (docs/plans/kpi-driven-orchestration.md P1).
//!
//! A headless Claude pass that PROPOSES KPIs for a project: it consumes the
//! finished context map (groups + contexts), the project's existing KPIs
//! (active = don't duplicate; archived = the user rejected these, don't
//! re-propose), and the vault's connector roster (only propose what is — or
//! could be — measurable), then explores the repo itself (cwd = project root,
//! same as idea scans) to ground baselines (is there a test runner? coverage
//! tooling? a build budget?).
//!
//! Proposals land as `dev_kpis` rows with `status='proposed'`,
//! `created_by='scan'` — the review queue the sub_kpis UI drains via
//! accept / adjust ("volume") / reject. A proposal whose measurement needs a
//! connector that is NOT yet in the vault carries `needed_connector`, which
//! drives the "Connect <service>" catalog CTA on the parked KPI card.
//!
//! Pipeline shape cloned from `idea_scanner.rs` (the well-trodden scan
//! pattern): dev_scans record + BackgroundJobManager (cancel/status/lines) +
//! line-streamed protocol parse.

use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::background_job::BackgroundJobManager;
use crate::commands::design::analysis::extract_display_text;
use crate::db::repos::dev_tools as repo;
use crate::engine::event_registry::event_name;
use crate::engine::prompt;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

#[derive(Clone, Default)]
struct KpiScanExtra;

static KPI_SCAN_JOBS: BackgroundJobManager<KpiScanExtra> = BackgroundJobManager::new(
    "kpi-scanner lock poisoned",
    event_name::KPI_SCAN_STATUS,
    event_name::KPI_SCAN_OUTPUT,
);

/// Review-queue backpressure: a scan is refused while this many proposals are
/// already awaiting the user — proposing into an undrained queue just buries it.
const MAX_PENDING_PROPOSALS: i64 = 10;
/// Hard cap on proposals applied from one scan (the prompt also states it).
const MAX_PROPOSALS_PER_SCAN: usize = 8;

// =============================================================================
// Protocol
// =============================================================================

/// One `{"kpi_proposal": {...}}` line from the scan.
#[derive(Debug, Deserialize)]
struct KpiProposalEnvelope {
    kpi_proposal: KpiProposal,
}

#[derive(Debug, Deserialize)]
struct KpiProposal {
    /// Context group this KPI belongs to; unknown/empty → project-level.
    #[serde(default)]
    group_name: String,
    name: String,
    #[serde(default)]
    description: String,
    /// technical | traffic | value | quality
    category: String,
    /// codebase | connector | manual | derived
    measure_kind: String,
    /// JSON measurement procedure (shape per kind).
    #[serde(default)]
    measure_config: serde_json::Value,
    #[serde(default)]
    unit: String,
    /// up | down
    #[serde(default)]
    direction: String,
    #[serde(default)]
    baseline_hint: Option<f64>,
    #[serde(default)]
    suggested_target: Option<f64>,
    #[serde(default)]
    target_date: Option<String>,
    /// manual | daily | weekly
    #[serde(default)]
    cadence: String,
    #[serde(default)]
    rationale: String,
    /// Connector required to measure this (empty when none / already present).
    #[serde(default)]
    needed_connector: String,
    /// Semantic metric type for connector/parked KPIs (P6 type binding).
    #[serde(default)]
    metric_type: String,
    /// Single context (subsystem) this KPI is scoped to within its group;
    /// empty = group-level or project-level.
    #[serde(default)]
    context_name: String,
}

fn parse_kpi_proposal(line: &str) -> Option<KpiProposal> {
    let trimmed = line.trim();
    if !trimmed.contains("\"kpi_proposal\"") {
        return None;
    }
    let start = trimmed.find('{')?;
    serde_json::from_str::<KpiProposalEnvelope>(&trimmed[start..])
        .ok()
        .map(|e| e.kpi_proposal)
}

// =============================================================================
// Prompt
// =============================================================================

fn build_kpi_scan_prompt(
    project_name: &str,
    groups_block: &str,
    active_kpis: &str,
    archived_kpis: &str,
    connectors: &str,
) -> String {
    format!(
        r#"You are a pragmatic engineering-metrics analyst. Propose Key Performance Indicators (KPIs) for the project "{project_name}" so an autonomous dev team can be steered by OUTCOMES instead of activity.

## Context map (feature groups → what the code does)
{groups_block}

## Existing KPIs — do NOT propose duplicates or near-duplicates
{active_kpis}

## Previously REJECTED KPIs — the user does not want these; do not re-propose
{archived_kpis}

## Connectors available in the vault (credential service types)
{connectors}

## Your job
Explore the repository (you are in its root) to ground your proposals: which test runner / coverage tooling / lint / build exists, what the README claims the product does, what is plausibly measurable TODAY vs needs a connector. Then propose AT MOST {max} KPIs, prioritizing the few that would genuinely change what the team works on.

Rules:
1. Per-group KPIs use the EXACT group name from the context map; cross-cutting KPIs use an empty group_name (project-level).
1b. To scope a KPI to a SINGLE context (one subsystem) within a group, set `context_name` to the EXACT context name from the map AND set its `group_name`. Use this only when one specific context clearly owns the outcome (e.g. p95 latency for a `checkout-api` context). Leave `context_name` empty for group-level or project-level KPIs.
2. `category`: technical (coverage, lint debt, build time, bundle size), quality (defect/bounce/incident rates), traffic (users, requests — connector-gated), value (conversion, revenue, retention — connector-gated).
3. `measure_kind` + `measure_config` must be a REAL, executable procedure:
   - codebase: {{"cmd": "<command runnable in repo root>", "parse": "coverage_pct" | "count_lines" | "regex:<pattern with one capture group>" | "json_path:<dot.path>"}}
   - derived: {{"metric": "<one of: qa_bounce_rate | exec_failure_rate | incident_rate | parked_review_age_days>"}} (measured from the orchestrator's own DB)
   - connector: {{"connector": "<service>", "instruction": "<what to fetch and how to reduce it to ONE number>"}}
   - manual: {{"instruction": "<what the human should check/enter>"}}
4. If a traffic/value KPI needs a connector that is NOT in the vault list above, still propose it with `measure_kind: "manual"` and set `needed_connector` to the missing service name (e.g. "google_analytics", "stripe", "posthog") — the UI offers one-click onboarding for it.
4b. Every connector-shaped KPI (current or future) MUST set `metric_type` to one of: unique_visitors, api_requests, llm_tokens, llm_cost, revenue, open_errors. The KPI is bound to the TYPE; the concrete tool is wired later and swappable. Leave metric_type empty for codebase/derived KPIs.
5. `baseline_hint`: your measured/estimated CURRENT value when you can ground it from the repo (run the codebase command if cheap); otherwise null. `suggested_target`: ambitious but reachable in ~4-6 weeks. `direction`: "up" if higher is better, else "down".
6. `cadence`: "weekly" for codebase KPIs, "daily" only for cheap derived ones, "manual" for connector-parked ones.
7. `rationale`: ONE sentence the user reads in the review queue — why THIS metric steers value.

For each proposal emit EXACTLY ONE line that is this JSON object and nothing else on that line:
{{"kpi_proposal": {{"group_name": "...", "name": "...", "description": "...", "category": "technical", "measure_kind": "codebase", "measure_config": {{}}, "unit": "%", "direction": "up", "baseline_hint": null, "suggested_target": 70, "target_date": null, "cadence": "weekly", "rationale": "...", "needed_connector": "", "metric_type": "", "context_name": ""}}}}

Finish with one line: {{"kpi_scan_summary": {{"proposals": <count>}}}}
"#,
        project_name = project_name,
        groups_block = groups_block,
        active_kpis = active_kpis,
        archived_kpis = archived_kpis,
        connectors = connectors,
        max = MAX_PROPOSALS_PER_SCAN,
    )
}

/// Markdown digest of the context map for the prompt.
fn context_map_block(pool: &crate::db::DbPool, project_id: &str) -> String {
    let groups = repo::list_context_groups(pool, project_id).unwrap_or_default();
    let contexts = repo::list_contexts_by_project(pool, project_id, None).unwrap_or_default();
    if groups.is_empty() && contexts.is_empty() {
        return "(no context map yet — propose project-level KPIs only)".into();
    }
    let mut out = String::new();
    for g in &groups {
        out.push_str(&format!("### {}\n", g.name));
        for c in contexts.iter().filter(|c| c.group_id.as_deref() == Some(g.id.as_str())) {
            let files = serde_json::from_str::<Vec<String>>(&c.file_paths)
                .map(|v| v.len())
                .unwrap_or(0);
            out.push_str(&format!(
                "- {} ({} files): {}\n",
                c.name,
                files,
                c.description.as_deref().unwrap_or("").chars().take(160).collect::<String>()
            ));
        }
    }
    let ungrouped = contexts.iter().filter(|c| c.group_id.is_none()).count();
    if ungrouped > 0 {
        out.push_str(&format!("### (ungrouped)\n- {ungrouped} contexts\n"));
    }
    out
}

fn kpi_list_block(pool: &crate::db::DbPool, project_id: &str, archived: bool) -> String {
    let kpis = repo::list_kpis(pool, project_id, None).unwrap_or_default();
    let filtered: Vec<String> = kpis
        .iter()
        .filter(|k| (k.status == "archived") == archived)
        .map(|k| format!("- {} [{}] ({})", k.name, k.category, k.status))
        .collect();
    if filtered.is_empty() {
        "(none)".into()
    } else {
        filtered.join("\n")
    }
}

fn connectors_block(pool: &crate::db::DbPool) -> String {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return "(unknown)".into(),
    };
    let names: Vec<String> = conn
        .prepare("SELECT DISTINCT service_type FROM persona_credentials ORDER BY service_type")
        .ok()
        .and_then(|mut stmt| {
            stmt.query_map([], |r| r.get::<_, String>(0))
                .ok()
                .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .unwrap_or_default();
    if names.is_empty() {
        "(none connected yet)".into()
    } else {
        names.join(", ")
    }
}

// =============================================================================
// Commands
// =============================================================================

/// Start a KPI proposal scan for a project. Returns `{scan_id}` immediately;
/// progress streams via KPI_SCAN_STATUS / KPI_SCAN_OUTPUT events and the
/// status-poll command below.
#[tauri::command]
pub async fn dev_tools_scan_kpis(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    project_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    launch_kpi_scan(app, &state.db, &project)
}

/// Launch a KPI proposal scan as a background task. Shared by the
/// `dev_tools_scan_kpis` command and the headless `/dev-tools/scan-kpis` route.
/// Returns immediately with `{scan_id}`; the scan runs in a spawned task.
pub(crate) fn launch_kpi_scan(
    app: tauri::AppHandle,
    pool: &crate::db::DbPool,
    project: &crate::db::models::DevProject,
) -> Result<serde_json::Value, AppError> {
    let project_id = project.id.clone();

    // Review-queue backpressure — same doctrine as the idea-backlog cap.
    let pending: i64 = pool
        .get()?
        .query_row(
            "SELECT COUNT(*) FROM dev_kpis WHERE project_id = ?1 AND status = 'proposed'",
            rusqlite::params![project_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if pending >= MAX_PENDING_PROPOSALS {
        return Err(AppError::Validation(format!(
            "KPI scan skipped: {pending} proposals already await review (cap {MAX_PENDING_PROPOSALS}). \
             Accept or reject the existing queue first."
        )));
    }

    let prompt_text = build_kpi_scan_prompt(
        &project.name,
        &context_map_block(pool, &project_id),
        &kpi_list_block(pool, &project_id, false),
        &kpi_list_block(pool, &project_id, true),
        &connectors_block(pool),
    );

    let scan = repo::create_scan(pool, Some(&project_id), "kpi-scan", Some("running"))?;
    let scan_id = scan.id.clone();
    let cancel_token = CancellationToken::new();
    KPI_SCAN_JOBS.insert_running(scan_id.clone(), cancel_token.clone(), KpiScanExtra)?;
    KPI_SCAN_JOBS.set_status(&app, &scan_id, "running", None);

    let app_handle = app.clone();
    let scan_id_for_task = scan_id.clone();
    let pool_task = pool.clone();
    let root_path = project.root_path.clone();
    let project_name = project.name.clone();
    tokio::spawn(async move {
        let result = tokio::select! {
            _ = cancel_token.cancelled() => {
                Err(AppError::Internal("KPI scan cancelled".into()))
            }
            res = run_kpi_scan(
                &app_handle,
                &scan_id_for_task,
                &pool_task,
                &project_id,
                &root_path,
                prompt_text,
            ) => res
        };
        match result {
            Ok(created) => {
                let _ = repo::update_scan(
                    &pool_task, &scan_id_for_task, Some("complete"), Some(created),
                    None, None, None, None,
                );
                KPI_SCAN_JOBS.set_status(&app_handle, &scan_id_for_task, "completed", None);
                let _ = app_handle.emit(
                    event_name::KPI_SCAN_COMPLETE,
                    json!({ "scan_id": scan_id_for_task, "proposals": created }),
                );
                crate::notifications::send(
                    &app_handle,
                    "KPI scan complete",
                    &format!("{project_name}: {created} KPI proposal(s) await your review."),
                );
            }
            Err(e) => {
                let msg = format!("{e}");
                let _ = repo::update_scan(
                    &pool_task, &scan_id_for_task, Some("error"), None,
                    None, None, None, Some(Some(&msg)),
                );
                KPI_SCAN_JOBS.set_status(&app_handle, &scan_id_for_task, "failed", Some(msg.clone()));
                KPI_SCAN_JOBS.emit_line(&app_handle, &scan_id_for_task, format!("[Error] {msg}"));
            }
        }
    });

    Ok(json!({ "scan_id": scan_id }))
}

#[tauri::command]
pub async fn dev_tools_cancel_kpi_scan(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    scan_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    if let Some(token) = KPI_SCAN_JOBS.get_cancel_token(&scan_id)? {
        token.cancel();
        KPI_SCAN_JOBS.set_status(&app, &scan_id, "cancelled", None);
        let _ = repo::update_scan(
            &state.db, &scan_id, Some("error"), None, None, None, None,
            Some(Some("Cancelled by user")),
        );
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Poll a KPI scan's status + streamed lines (frontend resync after navigation).
#[tauri::command]
pub fn dev_tools_get_kpi_scan_status(
    state: State<'_, Arc<AppState>>,
    scan_id: String,
) -> Result<serde_json::Value, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    let jobs = KPI_SCAN_JOBS.lock()?;
    if let Some(job) = jobs.get(&scan_id) {
        Ok(json!({
            "scan_id": scan_id,
            "status": job.status,
            "error": job.error,
            "lines": job.lines,
        }))
    } else {
        Ok(json!({ "scan_id": scan_id, "status": "not_found" }))
    }
}

/// HTTP-bridge accessor for a KPI scan's status (mirrors the command without the
/// IPC `State`), for the local_http `/dev-tools/kpi-scan-status/{id}` route.
pub(crate) fn kpi_scan_status_json(scan_id: &str) -> serde_json::Value {
    match KPI_SCAN_JOBS.lock() {
        Ok(jobs) => match jobs.get(scan_id) {
            Some(job) => json!({ "scan_id": scan_id, "status": job.status, "error": job.error, "lines": job.lines }),
            None => json!({ "scan_id": scan_id, "status": "not_found" }),
        },
        Err(_) => json!({ "scan_id": scan_id, "status": "error", "error": "kpi scan registry lock poisoned" }),
    }
}

/// Build the exact KPI-scan prompt for a project, so it can be run MANUALLY
/// (paste into a Claude CLI from the repo root) with zero app dependency — the
/// `/dev-tools/kpi-scan-prompt/{project_id}` route returns this verbatim.
pub(crate) fn kpi_scan_prompt(pool: &crate::db::DbPool, project_id: &str) -> Result<String, AppError> {
    let project = repo::get_project_by_id(pool, project_id)?;
    Ok(build_kpi_scan_prompt(
        &project.name,
        &context_map_block(pool, project_id),
        &kpi_list_block(pool, project_id, false),
        &kpi_list_block(pool, project_id, true),
        &connectors_block(pool),
    ))
}

// =============================================================================
// Scan core
// =============================================================================

async fn run_kpi_scan(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    project_id: &str,
    root_path: &str,
    prompt_text: String,
) -> Result<i32, AppError> {
    KPI_SCAN_JOBS.emit_line(app, scan_id, "[Milestone] Starting KPI proposal scan...");

    // Group-name → id lookup for proposal validation (hallucinated names →
    // project-level KPI rather than a broken FK).
    let group_ids: std::collections::HashMap<String, String> =
        repo::list_context_groups(pool, project_id)
            .unwrap_or_default()
            .into_iter()
            .map(|g| (g.name.to_lowercase(), g.id))
            .collect();
    // Duplicate guard: existing non-archived KPI names (case-insensitive).
    let existing: std::collections::HashSet<String> = repo::list_kpis(pool, project_id, None)
        .unwrap_or_default()
        .into_iter()
        .filter(|k| k.status != "archived")
        .map(|k| k.name.to_lowercase())
        .collect();
    // Context-name → (context_id, parent_group_id) lookup for context-scoped
    // proposals. A resolved context overrides the named group with its own
    // parent group so context_group_id stays consistent; hallucinated names
    // fall back to group/project-level rather than a broken FK.
    let context_lookup: std::collections::HashMap<String, (String, Option<String>)> =
        repo::list_contexts_by_project(pool, project_id, None)
            .unwrap_or_default()
            .into_iter()
            .map(|c| (c.name.to_lowercase(), (c.id, c.group_id)))
            .collect();

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let exec_dir = std::path::PathBuf::from(root_path);
    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .current_dir(&exec_dir)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }
    // Force monthly-subscription auth (strip ANTHROPIC_API_KEY etc.) so the KPI
    // scan never falls back to pay-as-you-go API billing — parity with the rest
    // of the app's headless Claude spawns.
    crate::engine::cli_process::force_subscription_auth(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Internal("Claude CLI not found.".into())
        } else {
            AppError::Internal(format!("Failed to spawn Claude CLI: {e}"))
        }
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let bytes = prompt_text.into_bytes();
        tokio::spawn(async move {
            let _ = stdin.write_all(&bytes).await;
            let _ = stdin.shutdown().await;
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        let scan_id_clone = scan_id.to_string();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if !line.trim().is_empty() {
                    KPI_SCAN_JOBS.emit_line(&app_clone, &scan_id_clone, format!("[stderr] {line}"));
                }
            }
        });
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Missing stdout pipe".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    let mut created = 0i32;
    let timeout_duration = std::time::Duration::from_secs(900); // 15 min — no repo mutation, exploration only
    let stream = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            let Some(text) = extract_display_text(&line) else { continue };
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            KPI_SCAN_JOBS.emit_line(app, scan_id, trimmed.to_string());

            for proto_line in trimmed.lines() {
                let Some(p) = parse_kpi_proposal(proto_line) else { continue };
                if created as usize >= MAX_PROPOSALS_PER_SCAN {
                    continue;
                }
                if existing.contains(&p.name.to_lowercase()) {
                    KPI_SCAN_JOBS.emit_line(app, scan_id, format!("[Skip] duplicate: {}", p.name));
                    continue;
                }
                let group_id = group_ids.get(&p.group_name.to_lowercase()).cloned();
                // Optional single-context scope. A resolved context supplies
                // its own parent group, overriding a mismatched group_name.
                let (context_id, group_id) =
                    match context_lookup.get(&p.context_name.trim().to_lowercase()) {
                        Some((cid, cgid)) => (Some(cid.as_str()), cgid.clone().or(group_id)),
                        None => (None, group_id),
                    };
                let measure_config = if p.measure_config.is_null() {
                    "{}".to_string()
                } else {
                    p.measure_config.to_string()
                };
                let needed = p.needed_connector.trim();
                match repo::create_kpi(
                    pool,
                    project_id,
                    &p.name,
                    if p.description.is_empty() { None } else { Some(&p.description) },
                    group_id.as_deref(),
                    if matches!(p.category.as_str(), "technical" | "traffic" | "value" | "quality") {
                        &p.category
                    } else {
                        "technical"
                    },
                    if matches!(p.measure_kind.as_str(), "codebase" | "connector" | "manual" | "derived") {
                        &p.measure_kind
                    } else {
                        "manual"
                    },
                    &measure_config,
                    &p.unit,
                    if p.direction == "down" { "down" } else { "up" },
                    p.baseline_hint,
                    p.suggested_target,
                    p.target_date.as_deref(),
                    if matches!(p.cadence.as_str(), "daily" | "weekly") { &p.cadence } else { "manual" },
                    Some("proposed"),
                    "scan",
                    if p.rationale.is_empty() { None } else { Some(&p.rationale) },
                    if needed.is_empty() { None } else { Some(needed) },
                    if p.metric_type.is_empty() { None } else { Some(&p.metric_type) },
                    context_id,
                ) {
                    Ok(kpi) => {
                        created += 1;
                        KPI_SCAN_JOBS.emit_line(
                            app,
                            scan_id,
                            format!("[Proposal #{created}] [{}] {}", kpi.category, kpi.name),
                        );
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, name = %p.name, "kpi_scan: create proposal failed");
                    }
                }
            }
        }
    })
    .await;

    if stream.is_err() {
        let _ = child.kill().await;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;
        if created > 0 {
            KPI_SCAN_JOBS.emit_line(
                app,
                scan_id,
                format!("[Warning] Scan timed out but {created} proposal(s) were created — partial success."),
            );
            return Ok(created);
        }
        return Err(AppError::Internal("KPI scan timed out (15 min)".into()));
    }
    let _ = child.wait().await;
    KPI_SCAN_JOBS.emit_line(app, scan_id, "[Milestone] KPI scan complete.");
    Ok(created)
}
