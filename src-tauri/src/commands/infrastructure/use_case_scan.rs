//! Use-case proposal scan (docs/plans/use-case-slice-layer.md P3).
//!
//! A headless Claude pass that PROPOSES the project's *key use cases* — the
//! behavioral units ("checkout conversion", "agent execution") that slice
//! through the context map's code-ownership partition. It consumes the finished
//! context map plus the project's existing use cases (active = don't duplicate;
//! archived = the user rejected these, don't re-propose), then explores the repo
//! (cwd = project root) to ground each proposal in real code.
//!
//! Proposals land as `dev_use_cases` rows with `status='proposed'`,
//! `created_by='scan'` — triage-gated exactly like KPI proposals, which is what
//! keeps a *narrower* scope from flooding the review queue (the §10-decision-#1
//! failure mode the original KPI plan feared about per-context KPIs).
//!
//! Pipeline shape mirrors `kpi_scan.rs`: dev_scans record + BackgroundJobManager
//! (cancel/status/lines) + line-streamed protocol parse.

use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

use crate::background_job::BackgroundJobManager;
use crate::commands::design::analysis::extract_display_text;
use crate::db::repos::dev_tools as repo;
use crate::engine::event_registry::event_name;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

#[derive(Clone, Default)]
struct UseCaseScanExtra;

static USE_CASE_SCAN_JOBS: BackgroundJobManager<UseCaseScanExtra> = BackgroundJobManager::new(
    "use-case-scanner lock poisoned",
    event_name::USE_CASE_SCAN_STATUS,
    event_name::USE_CASE_SCAN_OUTPUT,
);

/// Review-queue backpressure: proposing into an undrained queue just buries it.
const MAX_PENDING_PROPOSALS: i64 = 12;
/// Hard cap on proposals applied from one scan (the prompt also states it).
/// Deliberately small — use cases are meant to be FEW and KEY; enumerating every
/// screen would reintroduce the cardinality problem this layer exists to solve.
const MAX_PROPOSALS_PER_SCAN: usize = 12;

// =============================================================================
// Protocol
// =============================================================================

#[derive(Debug, Deserialize)]
struct UseCaseProposalEnvelope {
    use_case_proposal: UseCaseProposal,
}

#[derive(Debug, Deserialize)]
struct UseCaseProposal {
    name: String,
    #[serde(default)]
    description: String,
    /// user_flow | capability | integration | ops
    #[serde(default)]
    kind: String,
    /// Exact context names from the map that this use case slices through.
    #[serde(default)]
    context_names: Vec<String>,
    /// The context that most owns it — must be one of `context_names`.
    #[serde(default)]
    primary_context_name: String,
    #[serde(default)]
    rationale: String,
}

fn parse_use_case_proposal(line: &str) -> Option<UseCaseProposal> {
    let trimmed = line.trim();
    if !trimmed.contains("\"use_case_proposal\"") {
        return None;
    }
    let start = trimmed.find('{')?;
    serde_json::from_str::<UseCaseProposalEnvelope>(&trimmed[start..])
        .ok()
        .map(|e| e.use_case_proposal)
}

// =============================================================================
// Prompt
// =============================================================================

fn build_use_case_scan_prompt(
    project_name: &str,
    groups_block: &str,
    existing: &str,
    rejected: &str,
) -> String {
    format!(
        r#"You are a product-minded staff engineer mapping what the project "{project_name}" actually DOES for its users, so an autonomous dev team can be steered by outcomes.

## Context map (code-ownership partition — each file belongs to exactly one context)
{groups_block}

## Existing use cases — do NOT propose duplicates or near-duplicates
{existing}

## Previously REJECTED use cases — the user does not want these; do not re-propose
{rejected}

## What a use case is (read carefully — this is the whole job)
A **use case** is a behavioral unit: something the product does that a user or operator would name, and whose success could be MEASURED. It is a *slice through* contexts, not a subdivision of one. "Checkout conversion" touches a UI context, an API context and a data context; that is normal and expected.

A use case is NOT:
- a context, a module, a file, or a layer (the map above already has those);
- every screen or endpoint — do not enumerate;
- an internal refactor or a piece of infrastructure with no observable behavior.

## Your job
Explore the repository (you are in its root) to ground yourself: read the README, the entry points listed in the map, the routes/commands. Then propose AT MOST {max} use cases — the KEY ones, the handful this product would be judged on. Fewer, sharper proposals beat a long list.

Rules:
1. `name`: 2-4 words, the words a product person would use ("Checkout conversion", "Agent execution", "Credential vault"). Title case. It becomes a stable join key, so avoid version numbers and internal codenames.
2. `context_names`: the EXACT context names from the map above that this use case spans. 1-5 of them. Never invent a name — if you cannot ground it in the map, do not propose it.
3. `primary_context_name`: the one context that most owns it; MUST be one of `context_names`.
4. `kind`: `user_flow` (a user-visible journey), `capability` (something the product can do), `integration` (an external system boundary), `ops` (operator/maintenance behavior).
5. Propose it ONLY if you can name a plausible way to measure whether it is working. If nothing about it could ever be measured, it is not a use case worth tracking.
6. `rationale`: ONE sentence the user reads in the review queue — why this is a unit worth steering by.

For each proposal emit EXACTLY ONE line that is this JSON object and nothing else on that line:
{{"use_case_proposal": {{"name": "...", "description": "...", "kind": "capability", "context_names": ["..."], "primary_context_name": "...", "rationale": "..."}}}}

Finish with one line: {{"use_case_scan_summary": {{"proposals": <count>}}}}
"#,
        project_name = project_name,
        groups_block = groups_block,
        existing = existing,
        rejected = rejected,
        max = MAX_PROPOSALS_PER_SCAN,
    )
}

/// Markdown digest of the context map (group → contexts) for the prompt.
fn context_map_block(pool: &crate::db::DbPool, project_id: &str) -> String {
    let groups = repo::list_context_groups(pool, project_id).unwrap_or_default();
    let contexts = repo::list_contexts_by_project(pool, project_id, None).unwrap_or_default();
    if contexts.is_empty() {
        return "(no context map yet — run a codebase scan first)".into();
    }
    let mut out = String::new();
    for g in &groups {
        out.push_str(&format!("### {}\n", g.name));
        for c in contexts.iter().filter(|c| c.group_id.as_deref() == Some(g.id.as_str())) {
            out.push_str(&format!(
                "- {}: {}\n",
                c.name,
                c.description.as_deref().unwrap_or("").chars().take(160).collect::<String>()
            ));
        }
    }
    let ungrouped: Vec<&str> =
        contexts.iter().filter(|c| c.group_id.is_none()).map(|c| c.name.as_str()).collect();
    if !ungrouped.is_empty() {
        out.push_str(&format!("### (ungrouped)\n- {}\n", ungrouped.join(", ")));
    }
    out
}

/// Existing (`archived=false`) or rejected (`archived=true`) use-case names.
fn use_case_list_block(pool: &crate::db::DbPool, project_id: &str, archived: bool) -> String {
    let all = repo::list_use_cases(pool, project_id, None).unwrap_or_default();
    let names: Vec<String> = all
        .iter()
        .filter(|u| (u.status == "archived") == archived)
        .map(|u| format!("- {}", u.name))
        .collect();
    if names.is_empty() {
        "(none)".into()
    } else {
        names.join("\n")
    }
}

// =============================================================================
// Commands
// =============================================================================

/// Start a use-case proposal scan. Returns `{scan_id}` immediately.
#[tauri::command]
pub async fn dev_tools_scan_use_cases(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    project_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    launch_use_case_scan(app, &state.db, &project)
}

pub(crate) fn launch_use_case_scan(
    app: tauri::AppHandle,
    pool: &crate::db::DbPool,
    project: &crate::db::models::DevProject,
) -> Result<serde_json::Value, AppError> {
    let project_id = project.id.clone();

    // A use-case scan is meaningless without a map to slice through.
    let mapped = repo::list_contexts_by_project(pool, &project_id, None)
        .map(|c| c.len())
        .unwrap_or(0);
    if mapped == 0 {
        return Err(AppError::Validation(
            "Scan the codebase into a context map first — use cases are slices through it.".into(),
        ));
    }

    let pending: i64 = pool
        .get()?
        .query_row(
            "SELECT COUNT(*) FROM dev_use_cases WHERE project_id = ?1 AND status = 'proposed'",
            rusqlite::params![project_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if pending >= MAX_PENDING_PROPOSALS {
        return Err(AppError::Validation(format!(
            "Use-case scan skipped: {pending} proposals already await review (cap {MAX_PENDING_PROPOSALS}). \
             Accept or reject the existing queue first."
        )));
    }

    let prompt_text = build_use_case_scan_prompt(
        &project.name,
        &context_map_block(pool, &project_id),
        &use_case_list_block(pool, &project_id, false),
        &use_case_list_block(pool, &project_id, true),
    );

    let scan = repo::create_scan(pool, Some(&project_id), "use-case-scan", Some("running"))?;
    let scan_id = scan.id.clone();
    let cancel_token = CancellationToken::new();
    USE_CASE_SCAN_JOBS.insert_running(scan_id.clone(), cancel_token.clone(), UseCaseScanExtra)?;
    USE_CASE_SCAN_JOBS.set_status(&app, &scan_id, "running", None);

    let app_handle = app.clone();
    let scan_id_for_task = scan_id.clone();
    let pool_task = pool.clone();
    let root_path = project.root_path.clone();
    let project_name = project.name.clone();
    tokio::spawn(async move {
        let result = tokio::select! {
            _ = cancel_token.cancelled() => {
                Err(AppError::Internal("Use-case scan cancelled".into()))
            }
            res = run_use_case_scan(
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
                USE_CASE_SCAN_JOBS.set_status(&app_handle, &scan_id_for_task, "completed", None);
                let _ = app_handle.emit(
                    event_name::USE_CASE_SCAN_COMPLETE,
                    json!({ "scan_id": scan_id_for_task, "proposals": created }),
                );
                crate::notifications::send(
                    &app_handle,
                    "Use-case scan complete",
                    &format!("{project_name}: {created} use-case proposal(s) await your review."),
                );
            }
            Err(e) => {
                let msg = format!("{e}");
                let _ = repo::update_scan(
                    &pool_task, &scan_id_for_task, Some("error"), None,
                    None, None, None, Some(Some(&msg)),
                );
                USE_CASE_SCAN_JOBS.set_status(&app_handle, &scan_id_for_task, "failed", Some(msg.clone()));
                USE_CASE_SCAN_JOBS.emit_line(&app_handle, &scan_id_for_task, format!("[Error] {msg}"));
            }
        }
    });

    Ok(json!({ "scan_id": scan_id }))
}

#[tauri::command]
pub async fn dev_tools_cancel_use_case_scan(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    scan_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    if let Some(token) = USE_CASE_SCAN_JOBS.get_cancel_token(&scan_id)? {
        token.cancel();
        USE_CASE_SCAN_JOBS.set_status(&app, &scan_id, "cancelled", None);
        let _ = repo::update_scan(
            &state.db, &scan_id, Some("error"), None, None, None, None,
            Some(Some("Cancelled by user")),
        );
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn dev_tools_get_use_case_scan_status(
    state: State<'_, Arc<AppState>>,
    scan_id: String,
) -> Result<serde_json::Value, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    let jobs = USE_CASE_SCAN_JOBS.lock()?;
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

// =============================================================================
// Runner
// =============================================================================

async fn run_use_case_scan(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    project_id: &str,
    root_path: &str,
    prompt_text: String,
) -> Result<i32, AppError> {
    USE_CASE_SCAN_JOBS.emit_line(app, scan_id, "[Milestone] Starting use-case proposal scan...");

    // Context-name → id. A proposal naming a context that does not exist is
    // hallucinating the slice; we drop the unknown names rather than write a
    // broken link, and refuse the proposal outright if none resolve.
    let context_ids: std::collections::HashMap<String, String> =
        repo::list_contexts_by_project(pool, project_id, None)
            .unwrap_or_default()
            .into_iter()
            .map(|c| (c.name.to_lowercase(), c.id))
            .collect();
    // Duplicate guard across every status: an archived (rejected) name must not
    // come back either.
    let existing_slugs: std::collections::HashSet<String> =
        repo::list_use_cases(pool, project_id, None)
            .unwrap_or_default()
            .into_iter()
            .map(|u| u.slug)
            .collect();

    let exec_dir = std::path::PathBuf::from(root_path);
    let mut child = crate::engine::cli_process::spawn_headless_claude(
        prompt_text,
        "claude-sonnet-4-6",
        &[],
        Some(&exec_dir),
        true,
    )?;

    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        let scan_id_clone = scan_id.to_string();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if !line.trim().is_empty() {
                    USE_CASE_SCAN_JOBS.emit_line(&app_clone, &scan_id_clone, format!("[stderr] {line}"));
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
    let timeout_duration = std::time::Duration::from_secs(900); // exploration only, no repo mutation
    let spend_ctx = crate::db::repos::llm_spend::SpendCtx {
        source: "scanner",
        trigger_kind: "use_case_scan",
        model: Some("claude-sonnet-4-6"),
        project_id: Some(project_id),
        persona_id: None,
    };
    let stream = tokio::time::timeout(timeout_duration, async {
        while let Ok(Some(line)) = reader.next_line().await {
            crate::db::repos::llm_spend::observe_line(pool, &spend_ctx, &line);
            let Some(text) = extract_display_text(&line) else { continue };
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            USE_CASE_SCAN_JOBS.record_line(scan_id, trimmed.to_string());

            for proto_line in trimmed.lines() {
                let Some(p) = parse_use_case_proposal(proto_line) else { continue };
                if created as usize >= MAX_PROPOSALS_PER_SCAN {
                    continue;
                }
                let name = p.name.trim();
                if name.is_empty() {
                    continue;
                }
                if existing_slugs.contains(&repo::slugify_use_case(name)) {
                    USE_CASE_SCAN_JOBS.emit_line(app, scan_id, format!("[Skip] duplicate: {name}"));
                    continue;
                }
                // Ground the slice: keep only context names that exist.
                let resolved: Vec<String> = p
                    .context_names
                    .iter()
                    .filter_map(|n| context_ids.get(&n.trim().to_lowercase()).cloned())
                    .collect();
                if resolved.is_empty() {
                    USE_CASE_SCAN_JOBS.emit_line(
                        app,
                        scan_id,
                        format!("[Skip] {name}: no proposed context resolved against the map"),
                    );
                    continue;
                }
                // Primary must be inside the slice; else fall back to its first
                // context rather than pointing outside the use case.
                let primary = context_ids
                    .get(&p.primary_context_name.trim().to_lowercase())
                    .filter(|id| resolved.contains(id))
                    .cloned()
                    .or_else(|| resolved.first().cloned());

                match repo::create_use_case(
                    pool,
                    project_id,
                    name,
                    if p.description.trim().is_empty() { None } else { Some(p.description.trim()) },
                    &p.kind,
                    primary.as_deref(),
                    &resolved,
                    Some("proposed"),
                    "scan",
                    if p.rationale.trim().is_empty() { None } else { Some(p.rationale.trim()) },
                ) {
                    Ok(uc) => {
                        created += 1;
                        USE_CASE_SCAN_JOBS.emit_line(
                            app,
                            scan_id,
                            format!(
                                "[Proposal #{created}] [{}] {} — spans {} context(s)",
                                uc.kind,
                                uc.name,
                                uc.context_ids.len()
                            ),
                        );
                    }
                    Err(e) => {
                        USE_CASE_SCAN_JOBS.emit_line(app, scan_id, format!("[Skip] {name}: {e}"));
                    }
                }
            }
        }
    })
    .await;

    if stream.is_err() {
        let _ = child.kill().await;
        if created > 0 {
            USE_CASE_SCAN_JOBS.emit_line(
                app,
                scan_id,
                format!("[Warning] Scan timed out but {created} proposal(s) were saved."),
            );
            return Ok(created);
        }
        return Err(AppError::Internal(
            "Use-case scan timed out after 15 minutes with no proposals".into(),
        ));
    }
    let _ = child.wait().await;

    USE_CASE_SCAN_JOBS.emit_line(
        app,
        scan_id,
        format!("[Complete] {created} use-case proposal(s) await review"),
    );
    Ok(created)
}
