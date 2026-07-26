use std::sync::Arc;
use tauri::State;

mod competitions;
pub mod contexts;
pub mod git_ops;
pub mod goals;
pub mod portfolio;
mod triage;
pub mod workspace;

// Re-export competition + dev-server commands so lib.rs invoke_handler
// references like `commands::infrastructure::dev_tools::dev_tools_start_competition`
// continue to resolve after the split. See ADR
// [[Architect/decisions/2026-05-10-dev-tools-split]].
pub use competitions::*;
pub use contexts::*;
pub use git_ops::*;
pub use goals::*;
pub use portfolio::*;

use crate::db::models::{DevIdea, DevKpi, DevKpiMeasurement, DevPipeline, DevProject, DevScan, DevTask, DevUseCase, TriageRule};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

// ============================================================================
// Projects
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_projects(
    state: State<'_, Arc<AppState>>,
    status: Option<String>,
) -> Result<Vec<DevProject>, AppError> {
    require_auth_sync(&state)?;
    repo::list_projects(&state.db, status.as_deref())
}

#[tauri::command]
pub fn dev_tools_get_project(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevProject, AppError> {
    require_auth_sync(&state)?;
    repo::get_project_by_id(&state.db, &id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_create_project(
    state: State<'_, Arc<AppState>>,
    name: String,
    root_path: String,
    description: Option<String>,
    status: Option<String>,
    tech_stack: Option<String>,
    github_url: Option<String>,
    team_id: Option<String>,
) -> Result<DevProject, AppError> {
    require_auth_sync(&state)?;
    repo::create_project(
        &state.db,
        &name,
        &root_path,
        description.as_deref(),
        status.as_deref(),
        tech_stack.as_deref(),
        github_url.as_deref(),
        team_id.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_update_project(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    status: Option<String>,
    tech_stack: Option<Option<String>>,
    github_url: Option<Option<String>>,
    monitoring_credential_id: Option<Option<String>>,
    monitoring_project_slug: Option<Option<String>>,
    team_id: Option<Option<String>>,
    pr_credential_id: Option<Option<String>>,
    test_env_url: Option<Option<String>>,
    test_env_branch: Option<Option<String>>,
    main_branch: Option<Option<String>>,
    llm_tracking_credential_id: Option<Option<String>>,
    support_credential_id: Option<Option<String>>,
    data_links: Option<Option<String>>,
) -> Result<DevProject, AppError> {
    require_auth_sync(&state)?;
    repo::update_project(
        &state.db,
        &id,
        name.as_deref(),
        description.as_ref().map(|o| o.as_deref()),
        status.as_deref(),
        tech_stack.as_ref().map(|o| o.as_deref()),
        github_url.as_ref().map(|o| o.as_deref()),
        monitoring_credential_id.as_ref().map(|o| o.as_deref()),
        monitoring_project_slug.as_ref().map(|o| o.as_deref()),
        team_id.as_ref().map(|o| o.as_deref()),
        pr_credential_id.as_ref().map(|o| o.as_deref()),
        test_env_url.as_ref().map(|o| o.as_deref()),
        test_env_branch.as_ref().map(|o| o.as_deref()),
        main_branch.as_ref().map(|o| o.as_deref()),
        llm_tracking_credential_id.as_ref().map(|o| o.as_deref()),
        support_credential_id.as_ref().map(|o| o.as_deref()),
        data_links.as_ref().map(|o| o.as_deref()),
    )
}

/// Set or clear the project's standards & branching policy (Pipeline Stage 3).
/// `config` is the raw JSON envelope `{ precommit, branching }` (the shape is
/// owned by the frontend; validated here only to be parseable). `None` clears it.
#[tauri::command]
pub fn dev_tools_set_standards_config(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    config: Option<String>,
) -> Result<DevProject, AppError> {
    require_auth_sync(&state)?;
    if let Some(ref json) = config {
        serde_json::from_str::<serde_json::Value>(json)
            .map_err(|e| AppError::Validation(format!("Invalid standards_config JSON: {e}")))?;
    }
    repo::update_standards_config(&state.db, &project_id, config.as_deref())
}

/// PR-test-merge protocol embedded into existing QA Guardian instances'
/// `design_context.use_cases[]` (the canonical version lives in the template +
/// recipe for new adoptions). Drives the uc_pr_review behavior at execution.
const QA_PR_REVIEW_USE_CASE_DESC: &str = "When Dev Clone opens a PR (this use-case fires on dev-clone.pr.created), test it in ISOLATION and decide merge vs return. (a) Read the event payload for the PR branch + number + repo. (b) Create an isolated git worktree off the PR branch (git worktree add a scratch path on that branch) and work ONLY there so you never disturb the team's checkout. (c) Run the project's full test command inside that worktree. (d) Decide from the result + the STANDARDS & BRANCHING POLICY block in your prompt: tests PASS and the policy enables automerge -> enable GitHub native auto-merge on the PR (gh pr merge --auto, or the auto-merge API) targeting the policy's automerge branch so it merges once required checks pass, then emit qa.pr.approved; tests PASS and automerge is off -> approve the PR (gh pr review --approve) and emit qa.pr.approved; tests FAIL -> request changes (gh pr review --request-changes) with the failing output and emit qa.pr.changes_requested so Dev Clone fixes it. (e) ALWAYS clean up the scratch worktree (git worktree remove), leave no orphan branches. Never merge on a failing or un-run suite. Needs the GitHub connector to apply the PR action; without it, run the tests and emit the verdict event but report the action could not be applied.";

/// In-place backfill (Pipeline Stage 3d) — retrofit the PR-test-merge capability
/// onto EXISTING QA Guardian persona instances in current teams (adopted personas
/// have no template->instance sync). For each persona named like "QA Guardian":
///  1. append a `uc_pr_review` use-case to `design_context.use_cases[]` (if absent), and
///  2. insert a `dev-clone.pr.created` listen subscription (source_filter "*" since QA
///     doesn't emit it — mirrors `wire_event_subscriptions_from_use_cases`).
/// Idempotent + additive (never deletes existing use-cases). Returns a summary.
#[tauri::command]
pub fn dev_tools_backfill_qa_pr_review(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let conn = state.db.get()?;
    let now = chrono::Utc::now().to_rfc3339();

    let rows: Vec<(String, String, Option<String>)> = {
        let mut stmt = conn
            .prepare("SELECT id, name, design_context FROM personas WHERE name LIKE '%QA Guardian%'")?;
        let mapped = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?))
        })?;
        mapped.filter_map(Result::ok).collect()
    };

    let mut use_cases_added = 0u32;
    let mut subscriptions_added = 0u32;
    let mut persona_names: Vec<String> = Vec::new();

    for (pid, name, dc_json) in &rows {
        persona_names.push(name.clone());

        // 1. Append uc_pr_review to design_context.use_cases[] if absent.
        let mut dc: serde_json::Value = dc_json
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        let has_uc = dc
            .get("use_cases")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .any(|u| u.get("id").and_then(|x| x.as_str()) == Some("uc_pr_review"))
            })
            .unwrap_or(false);
        if !has_uc {
            let uc = serde_json::json!({
                "id": "uc_pr_review",
                "title": "PR Test + Merge",
                "description": QA_PR_REVIEW_USE_CASE_DESC,
                "category": "development",
                "enabled": true,
                "event_subscriptions": [
                    { "event_type": "dev-clone.pr.created", "direction": "listen" },
                    { "event_type": "qa.pr.approved", "direction": "emit" },
                    { "event_type": "qa.pr.changes_requested", "direction": "emit" }
                ]
            });
            match dc.get_mut("use_cases").and_then(|v| v.as_array_mut()) {
                Some(arr) => arr.push(uc),
                None => dc["use_cases"] = serde_json::json!([uc]),
            }
            let new_dc = serde_json::to_string(&dc)
                .map_err(|e| AppError::Internal(format!("serialize design_context: {e}")))?;
            conn.execute(
                "UPDATE personas SET design_context = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![new_dc, now, pid],
            )?;
            use_cases_added += 1;
        }

        // 2. Insert the cross-persona dev-clone.pr.created subscription if absent.
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM persona_event_subscriptions WHERE persona_id = ?1 AND event_type = 'dev-clone.pr.created'",
            rusqlite::params![pid],
            |r| r.get(0),
        )?;
        if exists == 0 {
            let sub_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO persona_event_subscriptions
                 (id, persona_id, event_type, source_filter, use_case_id, enabled, created_at, updated_at)
                 VALUES (?1, ?2, 'dev-clone.pr.created', '*', 'uc_pr_review', 1, ?3, ?3)",
                rusqlite::params![sub_id, pid, now],
            )?;
            subscriptions_added += 1;
        }
    }

    let github_credentials_in_vault: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persona_credentials WHERE service_type IN ('github','github_actions')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    Ok(serde_json::json!({
        "personas_matched": rows.len(),
        "use_cases_added": use_cases_added,
        "subscriptions_added": subscriptions_added,
        "persona_names": persona_names,
        "github_credentials_in_vault": github_credentials_in_vault,
    }))
}

#[tauri::command]
pub fn dev_tools_delete_project(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_project(&state.db, &id)
}

// ============================================================================
// Active Project (in-memory session state)
// ============================================================================

static ACTIVE_PROJECT_ID: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[tauri::command]
pub fn dev_tools_get_active_project(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<DevProject>, AppError> {
    require_auth_sync(&state)?;
    let guard = ACTIVE_PROJECT_ID.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_deref() {
        Some(id) => match repo::get_project_by_id(&state.db, id) {
            Ok(p) => Ok(Some(p)),
            Err(_) => Ok(None),
        },
        None => Ok(None),
    }
}

#[tauri::command]
pub fn dev_tools_set_active_project(
    state: State<'_, Arc<AppState>>,
    id: Option<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let mut guard = ACTIVE_PROJECT_ID.lock().unwrap_or_else(|e| e.into_inner());
    *guard = id;
    Ok(())
}

// ============================================================================
// Ideas
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_ideas(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    status: Option<String>,
    category: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<DevIdea>, AppError> {
    require_auth_sync(&state)?;
    repo::list_ideas(
        &state.db,
        project_id.as_deref(),
        status.as_deref(),
        category.as_deref(),
        limit,
        offset,
    )
}

#[tauri::command]
pub fn dev_tools_get_idea(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevIdea, AppError> {
    require_auth_sync(&state)?;
    repo::get_idea_by_id(&state.db, &id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_create_idea(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    context_id: Option<String>,
    scan_type: String,
    category: Option<String>,
    title: String,
    description: Option<String>,
    reasoning: Option<String>,
    status: Option<String>,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<DevIdea, AppError> {
    require_auth_sync(&state)?;
    repo::create_idea(
        &state.db,
        project_id.as_deref(),
        context_id.as_deref(),
        &scan_type,
        category.as_deref(),
        &title,
        description.as_deref(),
        reasoning.as_deref(),
        status.as_deref(),
        effort,
        impact,
        risk,
        provider.as_deref(),
        model.as_deref(),
    )
}

/// Raise a sensor-emitted finding into the idea backlog (the findings spine —
/// `docs/plans/dev-findings-loop.md`). Idempotent: returns `None` when the
/// project already carries an idea with this `dedup_key` in ANY status.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_create_finding(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    origin: String,
    title: String,
    description: Option<String>,
    category: Option<String>,
    context_id: Option<String>,
    use_case_id: Option<String>,
    evidence: Option<String>,
    dedup_key: String,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
) -> Result<Option<DevIdea>, AppError> {
    require_auth_sync(&state)?;
    repo::create_finding(
        &state.db,
        &project_id,
        &origin,
        &title,
        description.as_deref(),
        category.as_deref(),
        context_id.as_deref(),
        use_case_id.as_deref(),
        evidence.as_deref(),
        &dedup_key,
        effort,
        impact,
        risk,
    )
}

/// Record a verification verdict on a finding (Phase 3A) — did shipping the work
/// actually move the signal that raised it?
#[tauri::command]
pub fn dev_tools_set_finding_verify_state(
    state: State<'_, Arc<AppState>>,
    id: String,
    verify_state: String,
    verify_evidence: Option<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    repo::set_finding_verify_state(&state.db, &id, &verify_state, verify_evidence.as_deref())
}

/// Every dedup key already spoken for on this project — lets a sweep filter its
/// drafts in one round-trip instead of one existence check per draft.
#[tauri::command]
pub fn dev_tools_list_finding_dedup_keys(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<String>, AppError> {
    require_auth_sync(&state)?;
    repo::list_finding_dedup_keys(&state.db, &project_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_update_idea(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: Option<String>,
    description: Option<Option<String>>,
    status: Option<String>,
    category: Option<String>,
    effort: Option<Option<i32>>,
    impact: Option<Option<i32>>,
    risk: Option<Option<i32>>,
    rejection_reason: Option<Option<String>>,
) -> Result<DevIdea, AppError> {
    require_auth_sync(&state)?;
    repo::update_idea(
        &state.db,
        &id,
        title.as_deref(),
        description.as_ref().map(|o| o.as_deref()),
        status.as_deref(),
        category.as_deref(),
        effort,
        impact,
        risk,
        rejection_reason.as_ref().map(|o| o.as_deref()),
    )
}

/// Accept a backlog idea (triage). Persists `status = accepted` and records the
/// human decision as a shared team memory when the idea's project is team-bound
/// (the dev-backlog learning loop — mirrors `manual_reviews::update_status`).
#[tauri::command]
pub fn dev_tools_accept_idea(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevIdea, AppError> {
    require_auth_sync(&state)?;
    let idea = repo::update_idea(
        &state.db, &id, None, None, Some("accepted"), None, None, None, None, None,
    )?;
    record_idea_decision(&state.db, &idea, "accepted");
    Ok(idea)
}

/// Reject a backlog idea (triage). Persists `status = rejected` (+ reason) and
/// records the decision as a shared team `constraint` memory when team-bound, so
/// the team + future scans avoid re-surfacing it.
#[tauri::command]
pub fn dev_tools_reject_idea(
    state: State<'_, Arc<AppState>>,
    id: String,
    reason: Option<String>,
) -> Result<DevIdea, AppError> {
    require_auth_sync(&state)?;
    let idea = repo::update_idea(
        &state.db, &id, None, None, Some("rejected"), None, None, None, None,
        Some(reason.as_deref()),
    )?;
    record_idea_decision(&state.db, &idea, "rejected");
    Ok(idea)
}

/// Pending backlog ideas across ALL projects (bounded) — the source for the
/// unified Human-Review inbox's "Dev Tools backlog" group. Project names are
/// resolved client-side from the projects store.
#[tauri::command]
pub fn dev_tools_list_pending_ideas(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
) -> Result<Vec<DevIdea>, AppError> {
    require_auth_sync(&state)?;
    repo::list_ideas(&state.db, None, Some("pending"), None, Some(limit.unwrap_or(100)), None)
}

/// Write a human triage decision to the idea's bound team's shared memory ledger
/// (best-effort). Team-less projects skip the memory; the Scanner-suppress loop
/// (idea_scanner) covers re-surfacing for those. Deduped by `(team_id, title)`.
pub(crate) fn record_idea_decision(pool: &crate::db::DbPool, idea: &DevIdea, verdict: &str) {
    record_idea_decision_by(pool, idea, verdict, "Human")
}

/// Same as [`record_idea_decision`] with an explicit actor ("Human" — the inbox
/// triage — or "Strategist" — the autonomous backlog-triage job).
pub(crate) fn record_idea_decision_by(
    pool: &crate::db::DbPool,
    idea: &DevIdea,
    verdict: &str,
    actor: &str,
) {
    let project_id = match idea.project_id.as_deref() {
        Some(p) if !p.is_empty() => p,
        _ => return,
    };

    // approved → settled decision; rejected → guardrail constraint (mirrors reviews).
    let (category, importance) = if verdict == "rejected" {
        ("constraint", 8)
    } else {
        ("decision", 7)
    };
    let title = format!("{actor} {verdict}: {}", idea.title);
    let content = format!(
        "{actor} {verdict} the backlog idea \"{}\"{}. Apply this to future scans + work — do not re-surface rejected items.",
        idea.title,
        idea.description
            .as_deref()
            .map(|d| format!(": {d}"))
            .unwrap_or_default(),
    );

    // (1) PROJECT memory — the development loop's own store. Written FIRST and
    // unconditionally, because it is the only anchor every participant in the
    // loop shares: a project without a team used to learn nothing at all, and
    // the task executor reads by project, not by team.
    // (docs/plans/backlog-memory-loop.md Phase 2.)
    if let Err(e) = crate::db::repos::dev_memories::record(
        pool,
        project_id,
        category,
        &title,
        &content,
        importance,
        "idea_decision",
        Some(&idea.id),
    ) {
        tracing::warn!(idea_id = %idea.id, error = %e, "dev-backlog learning loop: failed to write project memory");
    }

    // (2) TEAM memory — the cross-persona workspace ledger. Unchanged behaviour:
    // only written when the project actually belongs to a team.
    let team_id: Option<String> = pool.get().ok().and_then(|conn| {
        conn.query_row(
            "SELECT team_id FROM dev_projects WHERE id = ?1",
            rusqlite::params![project_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    });
    let team_id = match team_id.filter(|s| !s.is_empty()) {
        Some(t) => t,
        None => return,
    };
    if let Ok(conn) = pool.get() {
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM team_memories WHERE team_id = ?1 AND title = ?2 LIMIT 1",
                rusqlite::params![team_id, title],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if exists {
            return;
        }
    }

    let tm = crate::db::models::CreateTeamMemoryInput {
        team_id,
        run_id: None,
        member_id: None,
        persona_id: None,
        title,
        content,
        category: Some(category.to_string()),
        importance: Some(importance),
        tags: Some(format!("dev-backlog,{verdict}")),
    };
    if let Err(e) = crate::db::repos::resources::team_memories::create(pool, tm) {
        tracing::warn!(idea_id = %idea.id, error = %e, "dev-backlog learning loop: failed to write team memory");
    }
}

#[tauri::command]
pub fn dev_tools_delete_idea(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_idea(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_bulk_delete_ideas(
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
) -> Result<usize, AppError> {
    require_auth_sync(&state)?;
    repo::bulk_delete_ideas(&state.db, &ids)
}

// ============================================================================
// Scans
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_scans(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<DevScan>, AppError> {
    require_auth_sync(&state)?;
    repo::list_scans(&state.db, project_id.as_deref(), limit)
}

#[tauri::command]
pub fn dev_tools_get_scan(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevScan, AppError> {
    require_auth_sync(&state)?;
    repo::get_scan_by_id(&state.db, &id)
}

#[tauri::command]
pub fn dev_tools_create_scan(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    scan_type: String,
    status: Option<String>,
) -> Result<DevScan, AppError> {
    require_auth_sync(&state)?;
    repo::create_scan(
        &state.db,
        project_id.as_deref(),
        &scan_type,
        status.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_update_scan(
    state: State<'_, Arc<AppState>>,
    id: String,
    status: Option<String>,
    idea_count: Option<i32>,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    duration_ms: Option<i64>,
    error: Option<Option<String>>,
) -> Result<DevScan, AppError> {
    require_auth_sync(&state)?;
    repo::update_scan(
        &state.db,
        &id,
        status.as_deref(),
        idea_count,
        input_tokens,
        output_tokens,
        duration_ms,
        error.as_ref().map(|o| o.as_deref()),
    )
}

// ============================================================================
// Tasks
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_tasks(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<DevTask>, AppError> {
    require_auth_sync(&state)?;
    repo::list_tasks(&state.db, project_id.as_deref(), status.as_deref())
}

#[tauri::command]
pub fn dev_tools_get_task(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevTask, AppError> {
    require_auth_sync(&state)?;
    repo::get_task_by_id(&state.db, &id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_create_task(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    title: String,
    description: Option<String>,
    source_idea_id: Option<String>,
    goal_id: Option<String>,
    status: Option<String>,
    depth: Option<String>,
) -> Result<DevTask, AppError> {
    require_auth_sync(&state)?;
    repo::create_task(
        &state.db,
        project_id.as_deref(),
        &title,
        description.as_deref(),
        source_idea_id.as_deref(),
        goal_id.as_deref(),
        status.as_deref(),
        depth.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_update_task(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: Option<String>,
    description: Option<Option<String>>,
    status: Option<String>,
    session_id: Option<Option<String>>,
    progress_pct: Option<i32>,
    output_lines: Option<i32>,
    error: Option<Option<String>>,
    started_at: Option<Option<String>>,
    completed_at: Option<Option<String>>,
) -> Result<DevTask, AppError> {
    require_auth_sync(&state)?;
    repo::update_task(
        &state.db,
        &id,
        title.as_deref(),
        description.as_ref().map(|o| o.as_deref()),
        status.as_deref(),
        session_id.as_ref().map(|o| o.as_deref()),
        progress_pct,
        output_lines,
        error.as_ref().map(|o| o.as_deref()),
        started_at.as_ref().map(|o| o.as_deref()),
        completed_at.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
pub fn dev_tools_delete_task(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_task(&state.db, &id)
}

// ============================================================================
// Triage Rules
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_triage_rules(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
) -> Result<Vec<TriageRule>, AppError> {
    require_auth_sync(&state)?;
    repo::list_triage_rules(&state.db, project_id.as_deref())
}

#[tauri::command]
pub fn dev_tools_create_triage_rule(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    name: String,
    conditions: String,
    action: String,
    enabled: Option<bool>,
) -> Result<TriageRule, AppError> {
    require_auth_sync(&state)?;
    repo::create_triage_rule(
        &state.db,
        project_id.as_deref(),
        &name,
        &conditions,
        &action,
        enabled,
    )
}

#[tauri::command]
pub fn dev_tools_update_triage_rule(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    conditions: Option<String>,
    action: Option<String>,
    enabled: Option<bool>,
    times_fired: Option<i32>,
) -> Result<TriageRule, AppError> {
    require_auth_sync(&state)?;
    repo::update_triage_rule(
        &state.db,
        &id,
        name.as_deref(),
        conditions.as_deref(),
        action.as_deref(),
        enabled,
        times_fired,
    )
}

#[tauri::command]
pub fn dev_tools_delete_triage_rule(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_triage_rule(&state.db, &id)
}

/// Run all enabled triage rules against pending ideas for a project.
/// Returns the number of ideas affected.
#[tauri::command]
pub fn dev_tools_run_triage_rules(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;

    // 1. Fetch enabled rules
    let rules = repo::list_triage_rules(&state.db, Some(&project_id))?;
    let enabled_rules: Vec<_> = rules.into_iter().filter(|r| r.enabled).collect();

    if enabled_rules.is_empty() {
        return Ok(serde_json::json!({ "applied": 0, "ideas_affected": 0 }));
    }

    // 2. Fetch pending ideas
    let ideas = repo::list_ideas(
        &state.db,
        Some(&project_id),
        Some("pending"),
        None,
        None,
        None,
    )?;

    let mut ideas_affected = 0;

    // 3. Evaluate rules against each idea (first matching rule wins)
    for idea in &ideas {
        for rule in &enabled_rules {
            if triage::evaluate_conditions(&rule.conditions, idea) {
                let new_status = if rule.action == "accept" {
                    "accepted"
                } else {
                    "rejected"
                };
                let rejection_reason = if new_status == "rejected" {
                    Some(format!("Auto-rejected by triage rule '{}'", rule.name))
                } else {
                    None
                };
                let update_result = repo::update_idea(
                    &state.db,
                    &idea.id,
                    None,
                    None,
                    Some(new_status),
                    None,
                    None,
                    None,
                    None,
                    rejection_reason.as_deref().map(Some),
                );
                // Mirror the manual accept/reject path: write the decision to
                // the team's shared memory ledger so future scans don't
                // re-propose an idea this rule was created to kill.
                if let Ok(updated_idea) = &update_result {
                    record_idea_decision_by(&state.db, updated_idea, new_status, "TriageRule");
                }
                // Increment times_fired
                let _ = repo::update_triage_rule(
                    &state.db,
                    &rule.id,
                    None,
                    None,
                    None,
                    None,
                    Some(rule.times_fired + 1),
                );
                ideas_affected += 1;
                break; // first match wins
            }
        }
    }

    Ok(serde_json::json!({ "applied": enabled_rules.len(), "ideas_affected": ideas_affected }))
}

// ============================================================================
// Pipelines (Idea-to-Execution)
// ============================================================================

#[tauri::command]
pub fn dev_tools_create_pipeline(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    idea_id: String,
    auto_execute: Option<bool>,
    verify_after: Option<bool>,
) -> Result<DevPipeline, AppError> {
    require_auth_sync(&state)?;
    repo::create_pipeline(
        &state.db,
        &project_id,
        &idea_id,
        auto_execute.unwrap_or(true),
        verify_after.unwrap_or(false),
    )
}

#[tauri::command]
pub fn dev_tools_list_pipelines(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    stage: Option<String>,
) -> Result<Vec<DevPipeline>, AppError> {
    require_auth_sync(&state)?;
    repo::list_pipelines(&state.db, &project_id, stage.as_deref())
}

#[tauri::command]
pub fn dev_tools_get_pipeline(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevPipeline, AppError> {
    require_auth_sync(&state)?;
    repo::get_pipeline_by_id(&state.db, &id)
}

#[tauri::command]
pub async fn dev_tools_advance_pipeline(
    state: State<'_, Arc<AppState>>,
    id: String,
    new_stage: String,
    task_id: Option<String>,
    error: Option<String>,
) -> Result<DevPipeline, AppError> {
    require_auth_sync(&state)?;
    let pipeline = repo::advance_pipeline_stage(
        &state.db,
        &id,
        &new_stage,
        task_id.as_deref(),
        error.as_deref(),
    )?;

    // F5: non-disruptive auto-checkpoint of the project repo at each stage
    // transition (git stash create + a hidden ref — never touches the user's
    // branch/working tree). Best-effort: a snapshot failure never blocks the
    // advance, and a clean tree records nothing.
    if let Ok(project) = repo::get_project_by_id(&state.db, &pipeline.project_id) {
        if !project.root_path.is_empty() {
            let checkpoint_id = uuid::Uuid::new_v4().to_string();
            let status = if error.is_some() { "failed" } else { "advanced" };
            match crate::engine::git_checkpoint::snapshot_stage(
                std::path::Path::new(&project.root_path),
                &id,
                &checkpoint_id,
            )
            .await
            {
                Ok(Some(sha)) => {
                    let _ = crate::db::repos::dev_run_checkpoints::insert(
                        &state.db,
                        &id,
                        &new_stage,
                        &sha,
                        status,
                    );
                }
                Ok(None) => {}
                Err(e) => tracing::debug!("dev checkpoint snapshot skipped: {e}"),
            }
        }
    }

    Ok(pipeline)
}

#[tauri::command]
pub fn dev_tools_delete_pipeline(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_pipeline(&state.db, &id)
}

// ============================================================================
// KPIs (outcome layer above goals — docs/plans/kpi-driven-orchestration.md)
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_kpis(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    status: Option<String>,
) -> Result<Vec<DevKpi>, AppError> {
    require_auth_sync(&state)?;
    repo::list_kpis(&state.db, &project_id, status.as_deref())
}

#[tauri::command]
pub fn dev_tools_get_kpi(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevKpi, AppError> {
    require_auth_sync(&state)?;
    repo::get_kpi(&state.db, &id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_create_kpi(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    name: String,
    description: Option<String>,
    context_group_id: Option<String>,
    category: String,
    measure_kind: String,
    measure_config: Option<String>,
    unit: Option<String>,
    direction: Option<String>,
    baseline_value: Option<f64>,
    target_value: Option<f64>,
    target_date: Option<String>,
    cadence: Option<String>,
    status: Option<String>,
    created_by: Option<String>,
    rationale: Option<String>,
    needed_connector: Option<String>,
    metric_type: Option<String>,
    context_id: Option<String>,
    use_case_id: Option<String>,
) -> Result<DevKpi, AppError> {
    require_auth_sync(&state)?;
    repo::create_kpi(
        &state.db,
        &project_id,
        &name,
        description.as_deref(),
        context_group_id.as_deref(),
        &category,
        &measure_kind,
        measure_config.as_deref().unwrap_or("{}"),
        unit.as_deref().unwrap_or(""),
        direction.as_deref().unwrap_or("up"),
        baseline_value,
        target_value,
        target_date.as_deref(),
        cadence.as_deref().unwrap_or("manual"),
        status.as_deref(),
        created_by.as_deref().unwrap_or("user"),
        rationale.as_deref(),
        needed_connector.as_deref(),
        metric_type.as_deref(),
        context_id.as_deref(),
        use_case_id.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_update_kpi(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    context_group_id: Option<Option<String>>,
    context_id: Option<Option<String>>,
    category: Option<String>,
    measure_kind: Option<String>,
    measure_config: Option<String>,
    unit: Option<String>,
    direction: Option<String>,
    baseline_value: Option<Option<f64>>,
    target_value: Option<Option<f64>>,
    target_date: Option<Option<String>>,
    cadence: Option<String>,
    status: Option<String>,
    needed_connector: Option<Option<String>>,
    metric_type: Option<Option<String>>,
    tier: Option<String>,
    use_case_id: Option<Option<String>>,
) -> Result<DevKpi, AppError> {
    require_auth_sync(&state)?;
    repo::update_kpi(
        &state.db,
        &id,
        name.as_deref(),
        description.as_ref().map(|o| o.as_deref()),
        context_group_id.as_ref().map(|o| o.as_deref()),
        context_id.as_ref().map(|o| o.as_deref()),
        category.as_deref(),
        measure_kind.as_deref(),
        measure_config.as_deref(),
        unit.as_deref(),
        direction.as_deref(),
        baseline_value,
        target_value,
        target_date.as_ref().map(|o| o.as_deref()),
        cadence.as_deref(),
        status.as_deref(),
        needed_connector.as_ref().map(|o| o.as_deref()),
        metric_type.as_ref().map(|o| o.as_deref()),
        tier.as_deref(),
        use_case_id.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
pub fn dev_tools_delete_kpi(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_kpi(&state.db, &id)
}

/// Persist the Factory KPI console's calibration thresholds + manual assessment
/// (rating / pros / cons). Each field is optional; omitted fields are preserved.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_save_kpi_assessment(
    state: State<'_, Arc<AppState>>,
    id: String,
    warn_at: Option<f64>,
    crit_at: Option<f64>,
    manual_rating: Option<i32>,
    pros: Option<String>,
    cons: Option<String>,
) -> Result<DevKpi, AppError> {
    require_auth_sync(&state)?;
    repo::save_kpi_assessment(
        &state.db,
        &id,
        warn_at,
        crit_at,
        manual_rating,
        pros.as_deref(),
        cons.as_deref(),
    )
}

#[tauri::command]
pub fn dev_tools_list_kpi_measurements(
    state: State<'_, Arc<AppState>>,
    kpi_id: String,
    limit: Option<i64>,
) -> Result<Vec<DevKpiMeasurement>, AppError> {
    require_auth_sync(&state)?;
    repo::list_kpi_measurements(&state.db, &kpi_id, limit)
}

#[tauri::command]
pub fn dev_tools_record_kpi_measurement(
    state: State<'_, Arc<AppState>>,
    kpi_id: String,
    value: f64,
    source: Option<String>,
    evidence: Option<String>,
    note: Option<String>,
) -> Result<DevKpiMeasurement, AppError> {
    require_auth_sync(&state)?;
    repo::record_kpi_measurement(
        &state.db,
        &kpi_id,
        value,
        source.as_deref().unwrap_or("manual"),
        evidence.as_deref(),
        note.as_deref(),
    )
}

/// Measure one KPI now (codebase/derived kinds). Long-running for coverage
/// commands — the frontend invokes with an extended timeout.
#[tauri::command]
pub async fn dev_tools_evaluate_kpi(
    state: State<'_, Arc<AppState>>,
    kpi_id: String,
) -> Result<DevKpiMeasurement, AppError> {
    require_auth(&state).await?;
    crate::engine::kpi_eval::evaluate_kpi(&state.db, &kpi_id).await
}

/// Measure every due active KPI of a project (cadence-elapsed). Returns
/// `{ "<kpi name>": value | "error: ..." }` per evaluated KPI.
#[tauri::command]
pub async fn dev_tools_evaluate_due_kpis(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let results = crate::engine::kpi_eval::evaluate_due_kpis(&state.db, &project_id).await?;
    let mut map = serde_json::Map::new();
    for (name, r) in results {
        map.insert(
            name,
            match r {
                Ok(v) => serde_json::json!(v),
                Err(e) => serde_json::json!(format!("error: {e}")),
            },
        );
    }
    Ok(serde_json::Value::Object(map))
}

/// All KPIs across every project (cross-project dashboard scope).
#[tauri::command]
pub fn dev_tools_list_all_kpis(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DevKpi>, AppError> {
    require_auth_sync(&state)?;
    repo::list_all_kpis(&state.db)
}

/// Bulk measurement history for trend charts (chronological, bounded per KPI).
#[tauri::command]
pub fn dev_tools_list_kpi_measurements_bulk(
    state: State<'_, Arc<AppState>>,
    kpi_ids: Vec<String>,
    per_kpi: Option<i64>,
) -> Result<Vec<DevKpiMeasurement>, AppError> {
    require_auth_sync(&state)?;
    repo::list_kpi_measurements_bulk(&state.db, &kpi_ids, per_kpi.unwrap_or(30))
}

/// Metric-type registry (P6) — the semantic capabilities a connector KPI can bind to.
#[tauri::command]
pub fn dev_tools_list_kpi_metric_types(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    Ok(serde_json::to_value(crate::engine::kpi_binding::METRIC_TYPES).unwrap_or_default())
}

/// Vault credentials able to measure a metric type (category-matched).
#[tauri::command]
pub fn dev_tools_kpi_matching_credentials(
    state: State<'_, Arc<AppState>>,
    metric_type: String,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    let m = crate::engine::kpi_binding::find_matching_credentials(&state.db, &metric_type)?;
    Ok(serde_json::to_value(m).unwrap_or_default())
}

/// Compose + live-verify a binding candidate (recipe or LLM-composed).
/// Returns the procedure + plan + the verified value/evidence; nothing is
/// persisted — activation is the explicit next step after user confirmation.
#[tauri::command]
pub async fn dev_tools_kpi_compose_binding(
    state: State<'_, Arc<AppState>>,
    kpi_id: String,
    credential_id: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;
    let kpi = repo::get_kpi(&state.db, &kpi_id)?;
    let (procedure, composed_by) =
        crate::engine::kpi_binding::compose_procedure(&state.db, &kpi, &credential_id).await?;
    let (value, evidence) =
        crate::engine::kpi_binding::execute_procedure(&state.db, &credential_id, &procedure).await?;
    if let Some(mt) = kpi.metric_type.as_deref().and_then(crate::engine::kpi_binding::metric_type) {
        crate::engine::kpi_binding::check_invariants(mt, value)?;
    }
    Ok(serde_json::json!({
        "procedure": procedure,
        "composed_by": composed_by,
        "value": value,
        "evidence": evidence,
    }))
}

/// Freeze a verified procedure as the KPI's ACTIVE binding (archives any
/// prior binding) and record the verification measurement.
#[tauri::command]
pub async fn dev_tools_kpi_activate_binding(
    state: State<'_, Arc<AppState>>,
    kpi_id: String,
    credential_id: String,
    procedure: String,
    composed_by: String,
    verified_value: f64,
    evidence: Option<String>,
) -> Result<crate::db::models::DevKpiBinding, AppError> {
    require_auth(&state).await?;
    let credential =
        crate::db::repos::resources::credentials::get_by_id(&state.db, &credential_id)?;
    let binding = repo::activate_kpi_binding(
        &state.db,
        &kpi_id,
        &credential_id,
        &credential.service_type,
        &procedure,
        if composed_by == "recipe" { "recipe" } else { "llm" },
    )?;
    let _ = repo::record_kpi_measurement(
        &state.db,
        &kpi_id,
        verified_value,
        "evaluator",
        evidence.as_deref(),
        None,
    )?;
    Ok(binding)
}

#[tauri::command]
pub fn dev_tools_kpi_list_bindings(
    state: State<'_, Arc<AppState>>,
    kpi_id: String,
) -> Result<Vec<crate::db::models::DevKpiBinding>, AppError> {
    require_auth_sync(&state)?;
    repo::list_kpi_bindings(&state.db, &kpi_id)
}

// ============================================================================
// Use cases (behavioral slice layer — docs/plans/use-case-slice-layer.md)
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_use_cases(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    status: Option<String>,
) -> Result<Vec<DevUseCase>, AppError> {
    require_auth_sync(&state)?;
    repo::list_use_cases(&state.db, &project_id, status.as_deref())
}

#[tauri::command]
pub fn dev_tools_get_use_case(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<DevUseCase, AppError> {
    require_auth_sync(&state)?;
    repo::get_use_case(&state.db, &id)
}

/// Every non-archived use case whose slice includes this context.
#[tauri::command]
pub fn dev_tools_list_use_cases_for_context(
    state: State<'_, Arc<AppState>>,
    context_id: String,
) -> Result<Vec<DevUseCase>, AppError> {
    require_auth_sync(&state)?;
    repo::list_use_cases_for_context(&state.db, &context_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_create_use_case(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    name: String,
    description: Option<String>,
    kind: Option<String>,
    primary_context_id: Option<String>,
    context_ids: Option<Vec<String>>,
    status: Option<String>,
    created_by: Option<String>,
    rationale: Option<String>,
) -> Result<DevUseCase, AppError> {
    require_auth_sync(&state)?;
    repo::create_use_case(
        &state.db,
        &project_id,
        &name,
        description.as_deref(),
        kind.as_deref().unwrap_or("capability"),
        primary_context_id.as_deref(),
        &context_ids.unwrap_or_default(),
        status.as_deref(),
        created_by.as_deref().unwrap_or("user"),
        rationale.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_update_use_case(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    kind: Option<String>,
    primary_context_id: Option<Option<String>>,
    status: Option<String>,
    pinned: Option<bool>,
    context_ids: Option<Vec<String>>,
) -> Result<DevUseCase, AppError> {
    require_auth_sync(&state)?;
    repo::update_use_case(
        &state.db,
        &id,
        name.as_deref(),
        description.as_ref().map(|o| o.as_deref()),
        kind.as_deref(),
        primary_context_id.as_ref().map(|o| o.as_deref()),
        status.as_deref(),
        pinned,
        context_ids.as_deref(),
    )
}

#[tauri::command]
pub fn dev_tools_delete_use_case(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_use_case(&state.db, &id)
}

/// Deterministic seed (no LLM): promote each distinct `business_feature` label
/// on the context map into a `proposed` use case sliced across the contexts
/// that carry it. Idempotent — re-running only adds labels that are new.
#[tauri::command]
pub fn dev_tools_backfill_use_cases(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<Vec<DevUseCase>, AppError> {
    require_auth_sync(&state)?;
    repo::backfill_use_cases_from_business_features(&state.db, &project_id)
}

// ============================================================================
// Repo evidence probe (D1 — deep evidence scanner)
//
// A deterministic, NO-LLM scan of a project's working tree that turns the
// passport's permanent honest-gaps (tests always 'none', evals always 'none',
// agent-instructions from team_id rather than the actual CLAUDE.md) into real,
// file-backed signals. Cheap + bounded (skips node_modules/.git/target, caps the
// walk) so it can run for every project on the readiness Wall. The frontend
// derive (`passportDerive.ts`) consumes this defensively — when the command is
// absent (older build) the wrapper returns null and the heuristics still apply.
// ============================================================================

#[derive(Debug, Default, serde::Serialize)]
pub struct RepoEvidence {
    /// false when the root path doesn't exist / isn't a directory.
    pub scanned: bool,
    pub has_package_json: bool,
    pub package_scripts: Vec<String>,
    pub test_framework: Option<String>,
    pub has_tests: bool,
    pub test_file_count: u32,
    /// Detected auth method (Clerk / Auth.js / Auth0 / Supabase / …) from deps.
    pub auth_method: Option<String>,
    pub ci_workflows: Vec<String>,
    pub has_claude_md: bool,
    pub has_readme: bool,
    pub has_security_md: bool,
    pub has_dockerfile: bool,
    pub has_dependabot: bool,
    pub has_codeql: bool,
    pub has_migrations: bool,
    pub has_eval: bool,
    // -- Agent memory (Brainiac-adoption P0) ---------------------------------
    /// In-repo agent memory artifacts: root MEMORY.md, .claude/memory/ or
    /// .claude/MEMORY.md.
    pub has_repo_memory: bool,
    /// Markdown files in the Claude Code auto-memory dir for this repo
    /// (~/.claude/projects/<encoded-root>/memory). 0 when none exists.
    pub memory_file_count: u32,
    /// Bullet lines in that dir's MEMORY.md index (the per-memory pointers).
    pub memory_index_lines: u32,
    /// Days since ANY counted memory file (auto-memory or in-repo) last
    /// changed. None when no memory artifact exists at all.
    pub memory_age_days: Option<u32>,
    // -- Documentation (Brainiac-adoption P0) --------------------------------
    /// Markdown files under docs/ (bounded walk).
    pub docs_file_count: u32,
    /// A source→doc coupling manifest exists (feature-doc-map.json) — the
    /// signal that doc freshness is *managed*, not incidental.
    pub has_doc_map: bool,
    // -- App cost (passport env/cost rows) -----------------------------------
    /// Raw contents of the well-known `app-cost.json` at the repo root — the
    /// user-maintained (and expected-gitignored) monthly-cost ledger. None when
    /// the file doesn't exist; parsed leniently on the frontend.
    pub app_cost_raw: Option<String>,
    // -- Frameworks (passport stack row) -------------------------------------
    /// Application frameworks detected from the dependency manifests
    /// (package.json exact dep names, Cargo.toml), with cleaned versions —
    /// real "Next.js 15.3" instead of the tech-layer heuristic's bare "React".
    pub frameworks: Vec<FrameworkEvidence>,
}

/// One detected application framework + its manifest version (cleaned to
/// major.minor, e.g. "^19.1.0" → "19.1"). Part of [`RepoEvidence`].
#[derive(Debug, Clone, serde::Serialize)]
pub struct FrameworkEvidence {
    pub name: String,
    pub version: Option<String>,
}

/// Clean a manifest version spec to a display "major[.minor]" — strips range
/// operators and pre-release/build tails; None when nothing numeric remains.
fn clean_semver(spec: &str) -> Option<String> {
    let trimmed = spec.trim_start_matches(['^', '~', '=', 'v', '>', '<', ' ']);
    let numeric: String = trimmed
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if numeric.is_empty() || !numeric.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return None;
    }
    let parts: Vec<&str> = numeric.split('.').filter(|p| !p.is_empty()).collect();
    match parts.len() {
        0 => None,
        1 => Some(parts[0].to_string()),
        _ => Some(format!("{}.{}", parts[0], parts[1])),
    }
}

fn re_exists(root: &std::path::Path, rel: &str) -> bool {
    root.join(rel).exists()
}

/// Claude Code's per-project directory name under `~/.claude/projects/`: the
/// absolute cwd with every non-alphanumeric character mapped to `-`
/// (e.g. `C:\Users\x\repo` → `C--Users-x-repo`). Mirrors the CLI's encoding so
/// the probe can find a repo's auto-memory without walking every project dir.
pub(crate) fn encode_claude_project_dir(root_path: &str) -> String {
    root_path
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Days since `mtime`, saturating at 0 for future timestamps. None on error.
fn days_since(meta: std::io::Result<std::fs::Metadata>) -> Option<u32> {
    let modified = meta.ok()?.modified().ok()?;
    let elapsed = std::time::SystemTime::now().duration_since(modified).unwrap_or_default();
    Some((elapsed.as_secs() / 86_400) as u32)
}

/// Agent-memory probe: in-repo artifacts + the Claude Code auto-memory dir for
/// this repo. Returns (has_repo_memory, file_count, index_lines, age_days).
fn probe_agent_memory(root: &std::path::Path, root_path: &str) -> (bool, u32, u32, Option<u32>) {
    let mut newest_age: Option<u32> = None;
    let mut bump_age = |age: Option<u32>| {
        if let Some(a) = age {
            newest_age = Some(newest_age.map_or(a, |n| n.min(a)));
        }
    };

    let repo_candidates = [root.join("MEMORY.md"), root.join(".claude").join("MEMORY.md")];
    let mut has_repo_memory = false;
    for p in &repo_candidates {
        if p.is_file() {
            has_repo_memory = true;
            bump_age(days_since(std::fs::metadata(p)));
        }
    }
    let repo_mem_dir = root.join(".claude").join("memory");
    if repo_mem_dir.is_dir() {
        has_repo_memory = true;
        bump_age(days_since(std::fs::metadata(&repo_mem_dir)));
    }

    // Auto-memory: ~/.claude/projects/<encoded>/memory — flat dir of .md files
    // with a MEMORY.md index. Shallow read, capped; missing dir is the common
    // case and must stay silent + cheap.
    let mut file_count: u32 = 0;
    let mut index_lines: u32 = 0;
    if let Some(home) = dirs::home_dir() {
        let mem_dir = home
            .join(".claude")
            .join("projects")
            .join(encode_claude_project_dir(root_path))
            .join("memory");
        if let Ok(rd) = std::fs::read_dir(&mem_dir) {
            for entry in rd.flatten().take(200) {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.to_lowercase().ends_with(".md") {
                    continue;
                }
                file_count += 1;
                bump_age(days_since(entry.metadata().map_err(std::io::Error::from)));
                if name == "MEMORY.md" {
                    if let Ok(txt) = std::fs::read_to_string(entry.path()) {
                        index_lines = txt
                            .lines()
                            .filter(|l| {
                                let t = l.trim_start();
                                t.starts_with("- ") || t.starts_with("* ")
                            })
                            .count() as u32;
                    }
                }
            }
        }
    }

    (has_repo_memory, file_count, index_lines, newest_age)
}

/// Documentation probe: bounded count of markdown files under docs/ plus the
/// doc-map manifest signal. (README/CLAUDE.md presence is probed separately.)
fn probe_docs(root: &std::path::Path) -> (u32, bool) {
    const MAX_ENTRIES: u32 = 2000;
    const MAX_DEPTH: usize = 4;
    let mut count: u32 = 0;
    let mut seen: u32 = 0;
    let docs = root.join("docs");
    let mut stack: Vec<(std::path::PathBuf, usize)> = vec![(docs, 0)];
    while let Some((dir, depth)) = stack.pop() {
        if seen >= MAX_ENTRIES {
            break;
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            seen += 1;
            if seen >= MAX_ENTRIES {
                break;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                if depth + 1 <= MAX_DEPTH && !name.starts_with('.') {
                    stack.push((entry.path(), depth + 1));
                }
            } else if name.ends_with(".md") || name.ends_with(".mdx") {
                count += 1;
            }
        }
    }
    let has_doc_map = re_exists(root, "scripts/docs/feature-doc-map.json")
        || re_exists(root, "docs/feature-doc-map.json")
        || re_exists(root, "feature-doc-map.json");
    (count, has_doc_map)
}

/// Bounded walk: counts test files + detects migration/eval dirs without
/// recursing into heavy build dirs or past a depth/entry cap.
fn bounded_probe(root: &std::path::Path) -> (u32, bool, bool) {
    const MAX_ENTRIES: u32 = 8000;
    const MAX_DEPTH: usize = 5;
    const SKIP: [&str; 8] = [
        "node_modules", "target", "dist", "build", ".next", "vendor", "coverage", ".git",
    ];
    let mut test_count: u32 = 0;
    let mut has_mig = false;
    let mut has_eval = false;
    let mut seen: u32 = 0;
    let mut stack: Vec<(std::path::PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        if seen >= MAX_ENTRIES {
            break;
        }
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in rd.flatten() {
            seen += 1;
            if seen >= MAX_ENTRIES {
                break;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                if SKIP.contains(&name.as_str()) || name.starts_with('.') {
                    continue;
                }
                if name == "migrations" || name == "migration" {
                    has_mig = true;
                }
                if name == "evals" || name == "eval" {
                    has_eval = true;
                }
                if depth + 1 <= MAX_DEPTH {
                    stack.push((entry.path(), depth + 1));
                }
            } else if name.contains(".test.")
                || name.contains(".spec.")
                || name.ends_with("_test.rs")
                || name.starts_with("test_")
            {
                test_count += 1;
            }
        }
    }
    (test_count, has_mig, has_eval)
}

#[tauri::command]
pub fn dev_tools_probe_repo_evidence(
    state: State<'_, Arc<AppState>>,
    root_path: String,
) -> Result<RepoEvidence, AppError> {
    require_auth_sync(&state)?;
    let root = std::path::Path::new(&root_path);
    let mut ev = RepoEvidence::default();
    if !root.is_dir() {
        return Ok(ev); // scanned stays false — honest "couldn't read it"
    }
    ev.scanned = true;

    // package.json → scripts + JS/TS test framework
    if let Ok(txt) = std::fs::read_to_string(root.join("package.json")) {
        ev.has_package_json = true;
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&txt) {
            if let Some(scripts) = json.get("scripts").and_then(|v| v.as_object()) {
                ev.package_scripts = scripts.keys().cloned().collect();
            }
            let mut deps = String::new();
            let mut dep_versions: std::collections::HashMap<String, String> =
                std::collections::HashMap::new();
            for key in ["dependencies", "devDependencies"] {
                if let Some(obj) = json.get(key).and_then(|v| v.as_object()) {
                    for (dk, dv) in obj {
                        let lower = dk.to_lowercase();
                        deps.push_str(&lower);
                        deps.push(' ');
                        if let Some(vs) = dv.as_str() {
                            dep_versions.entry(lower).or_insert_with(|| vs.to_string());
                        }
                    }
                }
            }
            // Application frameworks + versions — exact dep-name lookups (a
            // `contains` would false-positive on react-dom / vue-router / …).
            for (dep, label) in [
                ("next", "Next.js"),
                ("nuxt", "Nuxt"),
                ("react", "React"),
                ("vue", "Vue"),
                ("svelte", "Svelte"),
                ("@angular/core", "Angular"),
                ("astro", "Astro"),
                ("express", "Express"),
                ("@nestjs/core", "NestJS"),
                ("fastify", "Fastify"),
                ("@remix-run/react", "Remix"),
                ("@tauri-apps/api", "Tauri"),
            ] {
                if let Some(vs) = dep_versions.get(dep) {
                    ev.frameworks.push(FrameworkEvidence {
                        name: label.to_string(),
                        version: clean_semver(vs),
                    });
                }
            }
            ev.test_framework = if deps.contains("vitest") {
                Some("vitest".into())
            } else if deps.contains("jest") {
                Some("jest".into())
            } else if deps.contains("playwright") {
                Some("playwright".into())
            } else if deps.contains("mocha") {
                Some("mocha".into())
            } else {
                None
            };
            // Auth method — most specific brands first; multi-purpose platforms
            // (Supabase/Firebase) last so a dedicated auth lib wins.
            ev.auth_method = if deps.contains("clerk") {
                Some("Clerk".into())
            } else if deps.contains("next-auth") || deps.contains("@auth/") || deps.contains("authjs") {
                Some("Auth.js".into())
            } else if deps.contains("auth0") {
                Some("Auth0".into())
            } else if deps.contains("better-auth") {
                Some("Better Auth".into())
            } else if deps.contains("lucia") {
                Some("Lucia".into())
            } else if deps.contains("workos") {
                Some("WorkOS".into())
            } else if deps.contains("stytch") {
                Some("Stytch".into())
            } else if deps.contains("@kinde") {
                Some("Kinde".into())
            } else if deps.contains("supabase") {
                Some("Supabase".into())
            } else if deps.contains("firebase") {
                Some("Firebase".into())
            } else if deps.contains("passport") {
                Some("Passport".into())
            } else {
                None
            };
        }
    }
    if ev.test_framework.is_none() {
        if re_exists(root, "Cargo.toml") {
            ev.test_framework = Some("cargo".into());
        } else if re_exists(root, "pytest.ini")
            || re_exists(root, "pyproject.toml")
            || re_exists(root, "tox.ini")
        {
            ev.test_framework = Some("pytest".into());
        }
    }

    // Rust frameworks from Cargo manifests (root + the Tauri convention path).
    // Line-based on purpose — a TOML parser dependency isn't warranted for
    // three dep names; a table-style dep still yields its `version = "…"`.
    for manifest in ["Cargo.toml", "src-tauri/Cargo.toml"] {
        let Ok(txt) = std::fs::read_to_string(root.join(manifest)) else {
            continue;
        };
        for (dep, label) in [("tauri", "Tauri"), ("axum", "Axum"), ("actix-web", "Actix")] {
            if ev.frameworks.iter().any(|f| f.name == label) {
                continue;
            }
            let hit = txt.lines().find(|l| {
                let t = l.trim_start();
                t.starts_with(&format!("{dep} ")) || t.starts_with(&format!("{dep}="))
            });
            if let Some(line) = hit {
                let version = line.split('"').nth(1).and_then(clean_semver);
                ev.frameworks.push(FrameworkEvidence {
                    name: label.to_string(),
                    version,
                });
            }
        }
    }

    ev.has_claude_md = re_exists(root, "CLAUDE.md");
    ev.has_readme = re_exists(root, "README.md") || re_exists(root, "readme.md");
    ev.has_security_md = re_exists(root, "SECURITY.md") || re_exists(root, ".github/SECURITY.md");
    ev.has_dockerfile = re_exists(root, "Dockerfile")
        || re_exists(root, "docker-compose.yml")
        || re_exists(root, "compose.yaml");
    ev.has_dependabot =
        re_exists(root, ".github/dependabot.yml") || re_exists(root, ".github/dependabot.yaml");

    // CI workflows + CodeQL
    let wf = root.join(".github/workflows");
    if wf.is_dir() {
        if let Ok(rd) = std::fs::read_dir(&wf) {
            for entry in rd.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".yml") || name.ends_with(".yaml") {
                    if name.to_lowercase().contains("codeql") {
                        ev.has_codeql = true;
                    }
                    ev.ci_workflows.push(name);
                }
            }
        }
    }

    let (test_count, has_mig, has_eval) = bounded_probe(root);
    ev.test_file_count = test_count;
    ev.has_tests = test_count > 0 || ev.package_scripts.iter().any(|s| s == "test");
    ev.has_migrations = has_mig;
    ev.has_eval = has_eval;

    let (has_repo_memory, mem_files, mem_index, mem_age) = probe_agent_memory(root, &root_path);
    ev.has_repo_memory = has_repo_memory;
    ev.memory_file_count = mem_files;
    ev.memory_index_lines = mem_index;
    ev.memory_age_days = mem_age;

    let (docs_count, has_doc_map) = probe_docs(root);
    ev.docs_file_count = docs_count;
    ev.has_doc_map = has_doc_map;

    // App-cost ledger — a small manual file; size-capped so a mislabeled data
    // file never ships over IPC on every wall render.
    let cost_path = root.join("app-cost.json");
    ev.app_cost_raw = std::fs::metadata(&cost_path)
        .ok()
        .filter(|m| m.is_file() && m.len() <= 65_536)
        .and_then(|_| std::fs::read_to_string(&cost_path).ok());

    Ok(ev)
}

/// R21 — probe a project's well-known favicon locations (frontend + Tauri
/// conventions) and return the first hit as a data URL, so the Passport wall
/// can show the real app icon instead of a colored dot. `None` when nothing
/// suitable exists — the wall falls back to its status dot.
#[tauri::command]
pub async fn dev_tools_get_project_favicon(
    root_path: String,
) -> Result<Option<String>, AppError> {
    use base64::Engine as _;
    const CANDIDATES: &[&str] = &[
        "public/favicon.svg",
        "public/favicon.ico",
        "public/favicon.png",
        "public/favicon-32x32.png",
        "public/icon.svg",
        "public/icon.png",
        "src/app/favicon.ico",
        "src/app/icon.svg",
        "src/app/icon.png",
        "app/favicon.ico",
        "app/icon.png",
        "static/favicon.png",
        "static/favicon.ico",
        "src-tauri/icons/32x32.png",
        "favicon.ico",
    ];
    // A favicon larger than this is not a favicon; skip rather than ship it
    // over IPC for every wall render.
    const MAX_BYTES: u64 = 262_144;
    let root = std::path::Path::new(&root_path);
    if !root.is_dir() {
        return Ok(None);
    }
    for rel in CANDIDATES {
        let p = root.join(rel);
        let Ok(meta) = std::fs::metadata(&p) else { continue };
        if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(&p) else { continue };
        let mime = match p.extension().and_then(|e| e.to_str()) {
            Some("svg") => "image/svg+xml",
            Some("ico") => "image/x-icon",
            _ => "image/png",
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(Some(format!("data:{mime};base64,{b64}")));
    }
    Ok(None)
}

#[cfg(test)]
mod repo_evidence_tests {
    use super::encode_claude_project_dir;

    #[test]
    fn encodes_windows_paths_like_claude_code() {
        assert_eq!(
            encode_claude_project_dir(r"C:\Users\mkdol\dolla\personas"),
            "C--Users-mkdol-dolla-personas"
        );
    }

    #[test]
    fn encodes_unix_paths_like_claude_code() {
        assert_eq!(encode_claude_project_dir("/home/x/repo.app"), "-home-x-repo-app");
    }
}
