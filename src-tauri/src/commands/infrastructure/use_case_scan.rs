//! Use-case proposal scan (docs/plans/use-case-slice-layer.md P3).
//!
//! A headless Claude pass that PROPOSES the project's *key use cases* — the
//! behavioral units ("checkout conversion", "agent execution") that slice
//! through the context map's code-ownership partition. It consumes the finished
//! context map plus the project's existing use cases (active = don't duplicate;
//! archived = the user removed these, don't re-propose), then explores the repo
//! (cwd = project root) to ground each proposal in real code.
//!
//! Proposals land as `dev_use_cases` rows with `status='active'`,
//! `created_by='scan'` — there is no review queue. A bad feature is archived
//! (which also keeps it out of the next scan); if scans produce noise, the fix
//! is this prompt, not a gate in front of it.
//!
//! Pipeline shape mirrors `kpi_scan.rs`: dev_scans record + BackgroundJobManager
//! (cancel/status/lines) + line-streamed protocol parse.

use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

use crate::background_job::spawn_guarded;
use crate::background_job::BackgroundJobManager;
use crate::commands::design::analysis::extract_display_text;
use crate::db::repos::dev_tools as repo;
use crate::engine::event_registry::event_name;
use crate::error::AppError;
use personas_core::models::UseCaseRelinkSummary;

use crate::ipc_auth::require_auth;
use crate::AppState;

#[derive(Clone, Default)]
struct UseCaseScanExtra;

static USE_CASE_SCAN_JOBS: BackgroundJobManager<UseCaseScanExtra> = BackgroundJobManager::new(
    "use-case-scanner lock poisoned",
    event_name::USE_CASE_SCAN_STATUS,
    event_name::USE_CASE_SCAN_OUTPUT,
);

/// Hard cap on proposals applied from one scan (the prompt also states it).
/// Deliberately small — use cases are meant to be FEW and KEY; enumerating every
/// screen would reintroduce the cardinality problem this layer exists to solve.
const MAX_PROPOSALS_PER_SCAN: usize = 12;

/// How many of one scan's proposals may be marked `major`. Stated in the
/// prompt AND enforced here: a cap that only exists in a prompt is a request.
const MAX_MAJOR_PER_SCAN: usize = 5;

/// The `BackgroundJobManager` lifecycle tokens, named once.
///
/// A bare `"running"` at a call site makes the legal set a convention spread
/// across N sites with nothing comparing them (census
/// `untyped-lifecycle-transition`); naming them puts the vocabulary in one
/// place a reader can find. The scan above still spells them inline and is
/// baselined - it is not blessed, and the next hand in that function should
/// take these.
const JOB_RUNNING: &str = "running";
const JOB_COMPLETED: &str = "completed";
const JOB_FAILED: &str = "failed";

/// How long a relink may explore before it is cut off. Named rather than
/// written at the `timeout(...)` call, so another bound can be derived from it
/// and a test can assert its ordering (census `anonymous-deadline`).
const RELINK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(900);

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
    /// `major` | `standard`. Absent or unknown reads as `standard`: a tier the
    /// model did not state is not a promotion.
    #[serde(default)]
    tier: String,
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

## ARCHIVED use cases — the user removed these; do not re-propose
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
6. `rationale`: ONE sentence on why this is a unit worth steering by.
7. `tier`: `major` or `standard`. Mark AT MOST 5 of your proposals `major` - the ones a competitor review would name. Everything else is `standard`. Omit the field and it is read as `standard`, so mark deliberately rather than generously: a `major` feature is one a person will be asked to sign off, and a list where everything is major is a list where nothing is.

For each proposal emit EXACTLY ONE line that is this JSON object and nothing else on that line:
{{"use_case_proposal": {{"name": "...", "description": "...", "kind": "capability", "context_names": ["..."], "primary_context_name": "...", "tier": "standard", "rationale": "..."}}}}

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
        for c in contexts
            .iter()
            .filter(|c| c.group_id.as_deref() == Some(g.id.as_str()))
        {
            out.push_str(&format!(
                "- {}: {}\n",
                c.name,
                c.description
                    .as_deref()
                    .unwrap_or("")
                    .chars()
                    .take(160)
                    .collect::<String>()
            ));
        }
    }
    let ungrouped: Vec<&str> = contexts
        .iter()
        .filter(|c| c.group_id.is_none())
        .map(|c| c.name.as_str())
        .collect();
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

/// The minimum number of contexts a use case must resolve before its slice is
/// written.
///
/// A use case is a slice THROUGH contexts; one context is a module, and the
/// scan prompt has said so since this layer shipped. Both doors enforce it, and
/// both enforce it the same way: the row is KEPT and left UNLINKED, and the
/// count is reported. Rejecting the row instead would throw away a real feature
/// because the model could only ground half of it.
pub(crate) const MIN_SPANNED_CONTEXTS: usize = 2;

/// Apply the span rule to one resolved slice.
///
/// Returns the slice to write, or `None` when the use case must be kept
/// unlinked. Split out so the two doors cannot drift apart about it.
pub(crate) fn spanning_slice(resolved: Vec<String>) -> Option<Vec<String>> {
    if resolved.len() < MIN_SPANNED_CONTEXTS {
        None
    } else {
        Some(resolved)
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
    let app_handle_for_panic = app_handle.clone();
    let pool_for_panic = pool_task.clone();
    let scan_id_for_panic = scan_id_for_task.clone();
    spawn_guarded(
        "use-case scan",
        scan_id_for_panic.clone(),
        async move {
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
                        &pool_task,
                        &scan_id_for_task,
                        Some("complete"),
                        Some(created),
                        None,
                        None,
                        None,
                        None,
                    );
                    USE_CASE_SCAN_JOBS.set_status(
                        &app_handle,
                        &scan_id_for_task,
                        "completed",
                        None,
                    );
                    let _ = app_handle.emit(
                        event_name::USE_CASE_SCAN_COMPLETE,
                        json!({ "scan_id": scan_id_for_task, "proposals": created }),
                    );
                    crate::notifications::send(
                        &app_handle,
                        "Use-case scan complete",
                        &format!("{project_name}: {created} feature(s) added."),
                    );
                }
                Err(e) => {
                    let msg = format!("{e}");
                    let _ = repo::update_scan(
                        &pool_task,
                        &scan_id_for_task,
                        Some("error"),
                        None,
                        None,
                        None,
                        None,
                        Some(Some(&msg)),
                    );
                    USE_CASE_SCAN_JOBS.set_status(
                        &app_handle,
                        &scan_id_for_task,
                        "failed",
                        Some(msg.clone()),
                    );
                    USE_CASE_SCAN_JOBS.emit_line(
                        &app_handle,
                        &scan_id_for_task,
                        format!("[Error] {msg}"),
                    );
                }
            }
        },
        move |msg| async move {
            let _ = repo::update_scan(
                &pool_for_panic,
                &scan_id_for_panic,
                Some("error"),
                None,
                None,
                None,
                None,
                Some(Some(&msg)),
            );
            USE_CASE_SCAN_JOBS.set_status(
                &app_handle_for_panic,
                &scan_id_for_panic,
                "failed",
                Some(msg.clone()),
            );
            USE_CASE_SCAN_JOBS.emit_line(
                &app_handle_for_panic,
                &scan_id_for_panic,
                format!("[Error] {msg}"),
            );
        },
    );

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
            &state.db,
            &scan_id,
            Some("error"),
            None,
            None,
            None,
            None,
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
    Ok(use_case_scan_status_json(&scan_id))
}

/// Status snapshot for one use-case scan, shaped like the context-scan and
/// KPI-scan equivalents (`context_generation::scan_status_json`,
/// `kpi_scan::kpi_scan_status_json`). Shared by the IPC command above and the
/// loopback `/dev-tools` bridge, so a terminal polls exactly what the UI does.
pub(crate) fn use_case_scan_status_json(scan_id: &str) -> serde_json::Value {
    match USE_CASE_SCAN_JOBS.lock() {
        Ok(jobs) => match jobs.get(scan_id) {
            Some(job) => json!({
                "scan_id": scan_id,
                "status": job.status,
                "error": job.error,
                "lines": job.lines,
            }),
            None => json!({ "scan_id": scan_id, "status": "not_found" }),
        },
        Err(_) => json!({
            "scan_id": scan_id,
            "status": "error",
            "error": "use-case scan registry lock poisoned",
        }),
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
    USE_CASE_SCAN_JOBS.emit_line(
        app,
        scan_id,
        "[Milestone] Starting use-case proposal scan...",
    );

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
                    USE_CASE_SCAN_JOBS.emit_line(
                        &app_clone,
                        &scan_id_clone,
                        format!("[stderr] {line}"),
                    );
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
    // The prompt asks for at most five; the door counts, because a cap only a
    // prompt states is a cap the model may quietly exceed.
    let mut major_marked = 0usize;
    // Proposals the model produced but the cap discarded — surfaced so a scan
    // that "found" more than MAX_PROPOSALS_PER_SCAN doesn't report a clean
    // count with no trace of the shortfall.
    let mut dropped = 0i32;
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
            let Some(text) = extract_display_text(&line) else {
                continue;
            };
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            USE_CASE_SCAN_JOBS.record_line(scan_id, trimmed.to_string());

            for proto_line in trimmed.lines() {
                let Some(p) = parse_use_case_proposal(proto_line) else {
                    continue;
                };
                if created as usize >= MAX_PROPOSALS_PER_SCAN {
                    dropped += 1;
                    USE_CASE_SCAN_JOBS.emit_line(
                        app,
                        scan_id,
                        format!(
                            "[Cap] {MAX_PROPOSALS_PER_SCAN} proposals reached — ignoring the rest"
                        ),
                    );
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
                // The span rule: a use case is a slice THROUGH contexts. Fewer
                // than two and the row is still written, unlinked, and counted
                // - the feature is real even when the model could only ground
                // half of it, and an unlinked row is visible where a rejected
                // one is not.
                let under_spanned = resolved.len() < MIN_SPANNED_CONTEXTS;
                if under_spanned {
                    USE_CASE_SCAN_JOBS.emit_line(
                        app,
                        scan_id,
                        format!(
                            "[Unlinked] {name}: {} context(s) resolved, fewer than \
                             {MIN_SPANNED_CONTEXTS} - keeping the feature without a slice",
                            resolved.len()
                        ),
                    );
                }
                // Primary must be inside the slice; else fall back to its first
                // context rather than pointing outside the use case.
                let primary = context_ids
                    .get(&p.primary_context_name.trim().to_lowercase())
                    .filter(|id| resolved.contains(id))
                    .cloned()
                    .or_else(|| resolved.first().cloned());
                let (primary, resolved) = match spanning_slice(resolved) {
                    Some(slice) => (primary, slice),
                    None => (None, Vec::new()),
                };

                match repo::create_use_case(
                    pool,
                    project_id,
                    name,
                    if p.description.trim().is_empty() {
                        None
                    } else {
                        Some(p.description.trim())
                    },
                    &p.kind,
                    primary.as_deref(),
                    &resolved,
                    Some("active"),
                    "scan",
                    if p.rationale.trim().is_empty() {
                        None
                    } else {
                        Some(p.rationale.trim())
                    },
                ) {
                    Ok(uc) => {
                        // The tier is a separate write on purpose: it is not an
                        // editorial field and `create_use_case` must not learn
                        // to take one, or every caller gains the power to
                        // promote a feature past the council's gate.
                        if p.tier.trim() == "major" {
                            if major_marked < MAX_MAJOR_PER_SCAN {
                                if let Err(e) = repo::set_use_case_tier(pool, &uc.id, "major") {
                                    USE_CASE_SCAN_JOBS.emit_line(
                                        app,
                                        scan_id,
                                        format!("[Skip] {name}: could not mark major: {e}"),
                                    );
                                } else {
                                    major_marked += 1;
                                }
                            } else {
                                USE_CASE_SCAN_JOBS.emit_line(
                                    app,
                                    scan_id,
                                    format!(
                                        "[Cap] {MAX_MAJOR_PER_SCAN} major features already \
                                         marked - {name} stays standard"
                                    ),
                                );
                            }
                        }
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

    let suffix = if dropped > 0 {
        format!(" ({dropped} more capped and dropped)")
    } else {
        String::new()
    };
    USE_CASE_SCAN_JOBS.emit_line(
        app,
        scan_id,
        format!("[Complete] {created} feature(s) added{suffix}"),
    );
    Ok(created)
}

// =============================================================================
// Relink
// =============================================================================
//
// A full rescan deletes and recreates `dev_contexts` rows under fresh ids, and
// `reconcile_context_links` restores what it can by name. What it cannot
// restore is a link whose context was RENAMED - and on this machine that is not
// hypothetical: all twelve of Personas' own features carry zero context links
// because a rescan moved the names out from under them.
//
// Relink is the repair for that case, and it is deliberately NOT a scan. The
// model is given the features that already exist and the map as it is now, and
// is asked for one thing only: which contexts each EXISTING slug spans. It may
// not propose, rename, retire or re-tier anything, and the door writes nothing
// but `dev_use_case_contexts` and `primary_context_id`. That asymmetry is the
// whole safety argument - a repair that can also invent is not a repair.

/// What starting a relink hands back. A named struct rather than a
/// `serde_json::Value`: an untyped success payload generates no binding, and
/// the caller then hand-authors the contract (census
/// `untyped-command-payload`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UseCaseRelinkLaunch {
    /// The `dev_scans` row this relink reports through. Poll it with
    /// `dev_tools_get_use_case_scan_status`, which the two doors share.
    pub scan_id: String,
}

#[derive(Debug, Deserialize)]
struct UseCaseRelinkEnvelope {
    use_case_relink: UseCaseRelink,
}

#[derive(Debug, Deserialize)]
struct UseCaseRelink {
    /// The EXISTING use case's slug. Unknown slugs are counted and ignored -
    /// the model does not get to create a feature through this door.
    #[serde(default)]
    slug: String,
    #[serde(default)]
    context_names: Vec<String>,
    #[serde(default)]
    primary_context_name: String,
}

fn parse_use_case_relink(line: &str) -> Option<UseCaseRelink> {
    let trimmed = line.trim();
    if !trimmed.contains("\"use_case_relink\"") {
        return None;
    }
    let start = trimmed.find('{')?;
    serde_json::from_str::<UseCaseRelinkEnvelope>(&trimmed[start..])
        .ok()
        .map(|e| e.use_case_relink)
}

fn build_relink_prompt(project_name: &str, groups_block: &str, features_block: &str) -> String {
    format!(
        r#"You are re-grounding the feature map of "{project_name}" after a codebase rescan renamed its contexts.

## Context map as it is NOW (each file belongs to exactly one context)
{groups_block}

## The features that already exist - these are FIXED
{features_block}

## Your job, and only this
For each feature listed above, say which of the contexts in the map it slices through. You are NOT proposing features, renaming them, retiring them or ranking them. Every feature in that list stays exactly as it is; the only thing you produce is its slice.

Explore the repository (you are in its root) enough to ground each answer in real code.

Rules:
1. Answer for the EXACT `slug` shown. A slug that is not in the list above will be ignored.
2. `context_names`: the EXACT context names from the map. A feature is a slice THROUGH contexts, so give at least 2 and at most 5. Never invent a name.
3. `primary_context_name`: the one context that most owns the feature; MUST be one of `context_names`.
4. If you genuinely cannot ground a feature in two or more contexts, answer for it anyway with what you have. The app keeps the feature and leaves it unlinked rather than guessing.

For each feature emit EXACTLY ONE line that is this JSON object and nothing else on that line:
{{"use_case_relink": {{"slug": "...", "context_names": ["..."], "primary_context_name": "..."}}}}

Finish with one line: {{"use_case_relink_summary": {{"answered": <count>}}}}
"#
    )
}

/// The features a relink is allowed to answer for: active ones, by slug.
fn relink_feature_block(pool: &crate::db::DbPool, project_id: &str) -> String {
    let rows = repo::list_use_cases(pool, project_id, Some("active")).unwrap_or_default();
    if rows.is_empty() {
        return "(none)".into();
    }
    rows.iter()
        .map(|u| {
            format!(
                "- `{}` - {}: {}",
                u.slug,
                u.name,
                u.description
                    .as_deref()
                    .unwrap_or("(no description)")
                    .chars()
                    .take(200)
                    .collect::<String>()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Re-ground every active feature's slice against the current context map.
///
/// Returns the scan id immediately, like the scan it borrows its plumbing
/// from; the summary lands on the `dev_scans` row and the status command
/// reports it. The payload is a NAMED struct rather than a `serde_json::Value`
/// so ts-rs can generate a binding for it (census
/// `untyped-command-payload`).
#[tauri::command]
pub async fn dev_tools_relink_use_cases(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    project_id: String,
) -> Result<UseCaseRelinkLaunch, AppError> {
    require_auth(&state).await?;
    let project = repo::get_project_by_id(&state.db, &project_id)?;
    launch_use_case_relink(app, &state.db, &project)
}

pub(crate) fn launch_use_case_relink(
    app: tauri::AppHandle,
    pool: &crate::db::DbPool,
    project: &crate::db::models::DevProject,
) -> Result<UseCaseRelinkLaunch, AppError> {
    let project_id = project.id.clone();
    let mapped = repo::list_contexts_by_project(pool, &project_id, None)
        .map(|c| c.len())
        .unwrap_or(0);
    if mapped == 0 {
        return Err(AppError::Validation(
            "Scan the codebase into a context map first - there is nothing to relink against."
                .into(),
        ));
    }
    if repo::list_use_cases(pool, &project_id, Some("active"))
        .map(|u| u.is_empty())
        .unwrap_or(true)
    {
        return Err(AppError::Validation(
            "This project has no active features to relink.".into(),
        ));
    }

    let prompt_text = build_relink_prompt(
        &project.name,
        &context_map_block(pool, &project_id),
        &relink_feature_block(pool, &project_id),
    );

    // Same job registry, same cancellation, same status plumbing as the scan:
    // one background lane for use-case work, not two that drift.
    // ONE deliberate difference from the scan above: the admission door is
    // asked FIRST. The scan writes its durable `running` row and only then asks
    // the registry whether the work may start, so a refusal strands a
    // `dev_scans` row in the one state nothing sweeps (census
    // `start-marker-before-admission`; the operator's own database holds four
    // such rows, stuck since June). Two statements swapping places is the whole
    // fix, and a new door has no reason to inherit the order.
    let scan_id = uuid::Uuid::new_v4().to_string();
    let cancel_token = CancellationToken::new();
    USE_CASE_SCAN_JOBS.insert_running(scan_id.clone(), cancel_token.clone(), UseCaseScanExtra)?;
    repo::create_scan_with_id(
        pool,
        &scan_id,
        Some(&project_id),
        "use-case-relink",
        Some(JOB_RUNNING),
    )?;
    USE_CASE_SCAN_JOBS.set_status(&app, &scan_id, JOB_RUNNING, None);

    let app_handle = app.clone();
    let scan_id_for_task = scan_id.clone();
    let pool_task = pool.clone();
    let root_path = project.root_path.clone();
    let project_name = project.name.clone();
    let app_handle_for_panic = app_handle.clone();
    let pool_for_panic = pool_task.clone();
    let scan_id_for_panic = scan_id_for_task.clone();
    spawn_guarded(
        "use-case relink",
        scan_id_for_panic.clone(),
        async move {
            let result = tokio::select! {
                _ = cancel_token.cancelled() => {
                    Err(AppError::Internal("Use-case relink cancelled".into()))
                }
                res = run_use_case_relink(
                    &app_handle,
                    &scan_id_for_task,
                    &pool_task,
                    &project_id,
                    &root_path,
                    prompt_text,
                ) => res
            };
            match result {
                Ok(summary) => {
                    let _ = repo::update_scan(
                        &pool_task,
                        &scan_id_for_task,
                        Some("complete"),
                        Some(summary.relinked as i32),
                        None,
                        None,
                        None,
                        None,
                    );
                    USE_CASE_SCAN_JOBS.set_status(
                        &app_handle,
                        &scan_id_for_task,
                        JOB_COMPLETED,
                        None,
                    );
                    crate::notifications::send(
                        &app_handle,
                        "Feature relink complete",
                        &format!(
                            "{project_name}: {} of {} feature(s) relinked.",
                            summary.relinked, summary.considered
                        ),
                    );
                }
                Err(e) => {
                    let msg = format!("{e}");
                    let _ = repo::update_scan(
                        &pool_task,
                        &scan_id_for_task,
                        Some("error"),
                        None,
                        None,
                        None,
                        None,
                        Some(Some(&msg)),
                    );
                    USE_CASE_SCAN_JOBS.set_status(
                        &app_handle,
                        &scan_id_for_task,
                        JOB_FAILED,
                        Some(msg.clone()),
                    );
                    USE_CASE_SCAN_JOBS.emit_line(
                        &app_handle,
                        &scan_id_for_task,
                        format!("[Error] {msg}"),
                    );
                }
            }
        },
        move |msg| async move {
            let _ = repo::update_scan(
                &pool_for_panic,
                &scan_id_for_panic,
                Some("error"),
                None,
                None,
                None,
                None,
                Some(Some(&msg)),
            );
            USE_CASE_SCAN_JOBS.set_status(
                &app_handle_for_panic,
                &scan_id_for_panic,
                JOB_FAILED,
                Some(msg.clone()),
            );
        },
    );

    Ok(UseCaseRelinkLaunch { scan_id })
}

/// Apply one model reply to the store. Pure of the LLM: takes the parsed
/// answers, so the whole door can be tested with a canned reply and no process.
pub(crate) fn apply_relink_answers(
    pool: &crate::db::DbPool,
    project_id: &str,
    scan_id: &str,
    answers: &[(String, Vec<String>, String)],
) -> Result<UseCaseRelinkSummary, AppError> {
    let contexts: std::collections::HashMap<String, String> =
        repo::list_contexts_by_project(pool, project_id, None)?
            .into_iter()
            .map(|c| (c.name.to_lowercase(), c.id))
            .collect();
    let by_slug: std::collections::HashMap<String, String> =
        repo::list_use_cases(pool, project_id, Some("active"))?
            .into_iter()
            .map(|u| (u.slug, u.id))
            .collect();

    let mut summary = UseCaseRelinkSummary {
        project_id: project_id.to_string(),
        scan_id: scan_id.to_string(),
        considered: by_slug.len() as u32,
        ..Default::default()
    };

    for (slug, names, primary_name) in answers {
        let slug = slug.trim();
        let Some(use_case_id) = by_slug.get(slug) else {
            // Counted, never created. The relink door writes links, not rows.
            if !summary.unknown_slugs.iter().any(|s| s == slug) {
                summary.unknown_slugs.push(slug.to_string());
            }
            continue;
        };
        let mut resolved: Vec<String> = Vec::new();
        for n in names {
            let key = n.trim().to_lowercase();
            match contexts.get(&key) {
                Some(id) if !resolved.contains(id) => resolved.push(id.clone()),
                Some(_) => {}
                None => {
                    if !summary.unknown_contexts.iter().any(|c| c == n.trim()) {
                        summary.unknown_contexts.push(n.trim().to_string());
                    }
                }
            }
        }
        let primary = contexts
            .get(&primary_name.trim().to_lowercase())
            .filter(|id| resolved.contains(id))
            .cloned()
            .or_else(|| resolved.first().cloned());

        match spanning_slice(resolved) {
            Some(slice) => {
                repo::update_use_case(
                    pool,
                    use_case_id,
                    None,
                    None,
                    None,
                    Some(primary.as_deref()),
                    None,
                    None,
                    Some(&slice),
                )?;
                summary.relinked += 1;
            }
            None => {
                // Kept, unlinked, counted. The row is the operator's; the
                // guess the model could not make is not ours to invent.
                summary.under_spanned.push(slug.to_string());
            }
        }
    }
    Ok(summary)
}

async fn run_use_case_relink(
    app: &tauri::AppHandle,
    scan_id: &str,
    pool: &crate::db::DbPool,
    project_id: &str,
    root_path: &str,
    prompt_text: String,
) -> Result<UseCaseRelinkSummary, AppError> {
    USE_CASE_SCAN_JOBS.emit_line(app, scan_id, "[Milestone] Re-grounding the feature map...");

    let exec_dir = std::path::PathBuf::from(root_path);
    // The same spawn chokepoint as the scan - one place decides how a headless
    // claude is configured here.
    let mut child = crate::engine::cli_process::spawn_headless_claude(
        prompt_text,
        // Named, not spelled: a retirement is then a one-file diff rather than
        // a tree-wide grep (census `bare-model-id-literal`).
        personas_core::model_ids::DEFAULT_BALANCED,
        &[],
        Some(&exec_dir),
        true,
    )?;

    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        let scan_id_clone = scan_id.to_string();
        // Through the guarded spawn, not a bare `tokio::spawn`: a detached
        // task whose JoinHandle dies in the same statement makes 'finished',
        // 'crashed' and 'cancelled' one observable - nothing (census
        // `unobservable-detached-task`). `spawn_guarded` carries the
        // catch_unwind and names the task in the panic report.
        spawn_guarded(
            "use-case relink stderr",
            scan_id.to_string(),
            async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    if !line.trim().is_empty() {
                        USE_CASE_SCAN_JOBS.emit_line(
                            &app_clone,
                            &scan_id_clone,
                            format!("[stderr] {line}"),
                        );
                    }
                }
            },
            |msg| async move {
                tracing::warn!(error = %msg, "use-case relink: the stderr pump died");
            },
        );
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("Missing stdout pipe".into()))?;
    let mut reader = BufReader::new(stdout).lines();

    let mut answers: Vec<(String, Vec<String>, String)> = Vec::new();
    let spend_ctx = crate::db::repos::llm_spend::SpendCtx {
        source: "scanner",
        trigger_kind: "use_case_relink",
        model: Some(personas_core::model_ids::DEFAULT_BALANCED),
        project_id: Some(project_id),
        persona_id: None,
    };
    let stream = tokio::time::timeout(RELINK_TIMEOUT, async {
        while let Ok(Some(line)) = reader.next_line().await {
            crate::db::repos::llm_spend::observe_line(pool, &spend_ctx, &line);
            let Some(text) = extract_display_text(&line) else {
                continue;
            };
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            USE_CASE_SCAN_JOBS.record_line(scan_id, trimmed.to_string());
            for proto_line in trimmed.lines() {
                if let Some(r) = parse_use_case_relink(proto_line) {
                    answers.push((r.slug, r.context_names, r.primary_context_name));
                }
            }
        }
    })
    .await;

    if stream.is_err() {
        let _ = child.kill().await;
        if answers.is_empty() {
            return Err(AppError::Internal(format!(
                "Use-case relink timed out after {}s with no answers",
                RELINK_TIMEOUT.as_secs()
            )));
        }
        USE_CASE_SCAN_JOBS.emit_line(
            app,
            scan_id,
            format!(
                "[Warning] Relink timed out; applying {} answer(s).",
                answers.len()
            ),
        );
    } else {
        let _ = child.wait().await;
    }

    let summary = apply_relink_answers(pool, project_id, scan_id, &answers)?;
    USE_CASE_SCAN_JOBS.emit_line(
        app,
        scan_id,
        format!(
            "[Complete] {} of {} feature(s) relinked; {} left unlinked (under-spanned), \
             {} unknown slug(s), {} unknown context name(s)",
            summary.relinked,
            summary.considered,
            summary.under_spanned.len(),
            summary.unknown_slugs.len(),
            summary.unknown_contexts.len()
        ),
    );
    Ok(summary)
}

#[cfg(test)]
mod relink_tests {
    use super::*;
    use crate::db::repos::dev::contexts::create_context;
    use crate::db::repos::dev::projects::create_project;
    use crate::db::repos::dev::use_cases::create_use_case;
    use crate::db::DbPool;

    fn ctx(pool: &DbPool, project_id: &str, name: &str) -> String {
        create_context(
            pool,
            project_id,
            name,
            None,
            None,
            Some(r#"["a.ts"]"#),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .id
    }

    /// A project whose three features lost their slices to a rescan.
    fn seeded() -> (DbPool, String, Vec<String>) {
        let pool = crate::db::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
        let ids = vec![
            ctx(&pool, &project.id, "Checkout UI"),
            ctx(&pool, &project.id, "checkout-api"),
            ctx(&pool, &project.id, "Billing Store"),
        ];
        for name in ["Checkout conversion", "Billing", "Reporting"] {
            create_use_case(
                &pool,
                &project.id,
                name,
                None,
                "capability",
                None,
                &[],
                Some("active"),
                "scan",
                None,
            )
            .unwrap();
        }
        (pool, project.id, ids)
    }

    #[test]
    fn a_canned_reply_relinks_the_slugs_it_knows() {
        let (pool, project_id, ids) = seeded();
        let answers = vec![(
            "checkout-conversion".to_string(),
            vec!["Checkout UI".to_string(), "checkout-api".to_string()],
            "checkout-api".to_string(),
        )];
        let summary = apply_relink_answers(&pool, &project_id, "scan-1", &answers).unwrap();
        assert_eq!(summary.considered, 3);
        assert_eq!(summary.relinked, 1);
        assert!(summary.unknown_slugs.is_empty());
        assert!(summary.unknown_contexts.is_empty());

        let uc = repo::list_use_cases(&pool, &project_id, Some("active"))
            .unwrap()
            .into_iter()
            .find(|u| u.slug == "checkout-conversion")
            .unwrap();
        assert_eq!(uc.context_ids.len(), 2);
        assert_eq!(uc.primary_context_id.as_deref(), Some(ids[1].as_str()));
    }

    /// The door writes links, never rows: a slug this project does not have is
    /// counted and ignored, and the feature count does not move.
    #[test]
    fn an_unknown_slug_is_counted_and_never_created() {
        let (pool, project_id, _) = seeded();
        let before = repo::list_use_cases(&pool, &project_id, None)
            .unwrap()
            .len();
        let answers = vec![(
            "invented-feature".to_string(),
            vec!["Checkout UI".to_string(), "checkout-api".to_string()],
            "Checkout UI".to_string(),
        )];
        let summary = apply_relink_answers(&pool, &project_id, "scan-1", &answers).unwrap();
        assert_eq!(summary.relinked, 0);
        assert_eq!(summary.unknown_slugs, vec!["invented-feature".to_string()]);
        assert_eq!(
            repo::list_use_cases(&pool, &project_id, None)
                .unwrap()
                .len(),
            before
        );
    }

    #[test]
    fn an_unknown_context_name_is_counted_and_the_rest_still_lands() {
        let (pool, project_id, _) = seeded();
        let answers = vec![(
            "checkout-conversion".to_string(),
            vec![
                "Checkout UI".to_string(),
                "checkout-api".to_string(),
                "A Context That Never Existed".to_string(),
            ],
            "Checkout UI".to_string(),
        )];
        let summary = apply_relink_answers(&pool, &project_id, "scan-1", &answers).unwrap();
        assert_eq!(summary.relinked, 1);
        assert_eq!(
            summary.unknown_contexts,
            vec!["A Context That Never Existed".to_string()]
        );
    }

    /// The span rule: the row is KEPT, the slice is not written, and the slug
    /// is reported. Rejecting the feature instead would lose a real one.
    #[test]
    fn one_resolvable_context_leaves_the_feature_unlinked_and_counted() {
        let (pool, project_id, _) = seeded();
        let answers = vec![(
            "billing".to_string(),
            vec!["Billing Store".to_string()],
            "Billing Store".to_string(),
        )];
        let summary = apply_relink_answers(&pool, &project_id, "scan-1", &answers).unwrap();
        assert_eq!(summary.relinked, 0);
        assert_eq!(summary.under_spanned, vec!["billing".to_string()]);

        let rows = repo::list_use_cases(&pool, &project_id, Some("active")).unwrap();
        let billing = rows.iter().find(|u| u.slug == "billing").unwrap();
        assert!(billing.context_ids.is_empty(), "unlinked, not deleted");
        assert_eq!(rows.len(), 3, "the feature is kept");
    }

    /// The whole reason the relink exists: the answer arrives under the
    /// contexts' CURRENT names, which are not the names the links were made
    /// with, and case and punctuation drift is normal.
    #[test]
    fn context_names_are_matched_case_insensitively() {
        let (pool, project_id, ids) = seeded();
        let answers = vec![(
            "checkout-conversion".to_string(),
            vec!["CHECKOUT ui".to_string(), "Checkout-API".to_string()],
            "CHECKOUT ui".to_string(),
        )];
        let summary = apply_relink_answers(&pool, &project_id, "scan-1", &answers).unwrap();
        assert_eq!(summary.relinked, 1);
        let uc = repo::list_use_cases(&pool, &project_id, Some("active"))
            .unwrap()
            .into_iter()
            .find(|u| u.slug == "checkout-conversion")
            .unwrap();
        assert_eq!(uc.primary_context_id.as_deref(), Some(ids[0].as_str()));
    }

    #[test]
    fn the_protocol_line_parses_and_anything_else_is_ignored() {
        let r = parse_use_case_relink(
            r#"{"use_case_relink": {"slug": "a", "context_names": ["X"], "primary_context_name": "X"}}"#,
        )
        .unwrap();
        assert_eq!(r.slug, "a");
        assert!(parse_use_case_relink("just some prose").is_none());
        // A PROPOSAL must not be read by the relink parser: the two doors share
        // a lane, not a vocabulary.
        assert!(parse_use_case_relink(
            r#"{"use_case_proposal": {"name": "X", "context_names": []}}"#
        )
        .is_none());
    }

    /// The span rule is one function, so the two doors cannot drift.
    #[test]
    fn the_span_rule_is_the_same_for_both_doors() {
        assert_eq!(spanning_slice(vec![]), None);
        assert_eq!(spanning_slice(vec!["a".into()]), None);
        assert_eq!(
            spanning_slice(vec!["a".into(), "b".into()]),
            Some(vec!["a".into(), "b".into()])
        );
    }
}
