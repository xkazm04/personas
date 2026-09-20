use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

mod competitions;
pub mod contexts;
/// Council read commands plus the ONE verdict door.
pub mod council;
/// The `/council` skill's one gated door back into the app.
pub mod council_ingest;
pub mod env_connectors;
pub mod git_ops;
pub mod goals;
pub mod milestones;
/// Athena's `show_note_suggestions` card — validation, text application, and
/// the per-row resolution door.
pub mod note_suggestions;
/// The Notepad: scratch requirements and their dispatch handshake.
pub mod notepad;
pub mod portfolio;
/// The `/ship-milestone` skill's one gated door back into the app.
pub mod ship_ingest;
mod triage;
/// The CLI triage-verdicts run's one gated door back into the app.
pub mod triage_ingest;
pub mod workspace;

// Re-export competition + dev-server commands so lib.rs invoke_handler
// references like `commands::infrastructure::dev_tools::dev_tools_start_competition`
// continue to resolve after the split. See ADR
// [[Architect/decisions/2026-05-10-dev-tools-split]].
pub use competitions::*;
pub use contexts::*;
pub use council::*;
pub use council_ingest::*;
pub use env_connectors::*;
pub use git_ops::*;
pub use goals::*;
pub use milestones::*;
pub use note_suggestions::*;
pub use notepad::*;
pub use portfolio::*;
pub use ship_ingest::*;
pub use triage_ingest::*;

use crate::db::models::{
    DevIdea, DevKpi, DevKpiMeasurement, DevProject, DevScan, DevTask, DevUseCase, TriageRule,
};
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
    // Identity-aware: idempotent on an already-registered path, re-points a
    // moved repo through its `.personas/project.json` marker, refuses a
    // clone that carries another checkout's identity.
    crate::db::project_identity::register_project(
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

/// The project switch (e32). OFF overrules every persona homed in the
/// project's team — no schedule, event, attention pass, chain or manual run
/// may start one — without touching the personas' own `enabled`, so switching
/// back ON restores each persona's choice. Returns the updated project.
#[tauri::command]
pub async fn dev_tools_set_project_enabled(
    state: State<'_, Arc<AppState>>,
    id: String,
    enabled: bool,
) -> Result<DevProject, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    let joined = tokio::task::spawn_blocking(move || {
        repo::set_enabled(&db, &id, enabled)?;
        repo::get_project_by_id(&db, &id)
    })
    .await;
    joined.map_err(|e| AppError::Internal(format!("set project enabled join: {e}")))?
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
    let renamed = name.is_some();
    let updated = repo::update_project(
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
    )?;
    // A project's team carries the project's name (one team per project), so a
    // rename here renames the roster too. Best-effort: the rename is already
    // persisted, and a stale team label must not turn it into a failed call.
    if renamed {
        if let Err(e) = crate::db::project_team::sync_team_name(&state.db, &updated) {
            tracing::warn!(project_id = %updated.id, error = %e, "could not sync the project's team name after rename");
        }
    }
    Ok(updated)
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
        let mut stmt = conn.prepare(
            "SELECT id, name, design_context FROM personas WHERE name LIKE '%QA Guardian%'",
        )?;
        let mapped = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
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
    // A verdict must never reach the table as a raw status write, even through
    // the generic editor door (plan 1B): the edit lands first, then the verdict
    // goes through the shared core so the decision memory + workspace adoption
    // sync happen exactly as they would from the triage UI. Non-verdict
    // statuses (`pending`, `archived`) are lifecycle, not decisions, and pass
    // straight through.
    let verdict = match status.as_deref() {
        Some("accepted") => Some(IdeaVerdict::Accept),
        Some("rejected") => Some(IdeaVerdict::Reject {
            reason: rejection_reason.clone().flatten(),
        }),
        _ => None,
    };
    let updated = repo::update_idea(
        &state.db,
        &id,
        title.as_deref(),
        description.as_ref().map(|o| o.as_deref()),
        if verdict.is_some() {
            None
        } else {
            status.as_deref()
        },
        category.as_deref(),
        effort,
        impact,
        risk,
        if verdict.is_some() {
            None
        } else {
            rejection_reason.as_ref().map(|o| o.as_deref())
        },
    )?;
    match verdict {
        Some(v) => apply_idea_verdict(&state.db, &id, v),
        None => Ok(updated),
    }
}

// ============================================================================
// The shared verdict core (plan 1B)
// ============================================================================

/// A triage verdict on a backlog idea. Only two verdicts exist — everything
/// else (`archived`, `pending`) is lifecycle bookkeeping, not a decision, and
/// deliberately does NOT route through [`apply_idea_verdict`].
pub enum IdeaVerdict {
    Accept,
    Reject { reason: Option<String> },
}

impl IdeaVerdict {
    fn status(&self) -> &'static str {
        match self {
            Self::Accept => "accepted",
            Self::Reject { .. } => "rejected",
        }
    }
}

/// THE single door through which a backlog idea gets a verdict.
///
/// Two things must happen together and in this order, or the loop lies:
/// 1. the status write (`update_idea`),
/// 2. the learning write-back (`record_idea_decision_by` → project + team
///    memory, which feeds both future scans and future task prompts).
///
/// Before this existed, four call sites did (1) and three of them did (2) with
/// hand-copied code. Any new path that decides an idea —
/// human triage, a triage rule, the Strategist, Athena's batch verdicts —
/// calls THIS and nothing else. No raw status writes.
///
/// **Idempotent.** Re-applying a verdict an idea already carries is a no-op
/// success: no second memory row, no clobbering of
/// the original rejection reason. That is what makes the Athena batch path
/// (idea writes first, approval status last) safe to replay after a crash.
pub fn apply_idea_verdict(
    db: &crate::db::DbPool,
    id: &str,
    verdict: IdeaVerdict,
) -> Result<DevIdea, AppError> {
    apply_idea_verdict_by(db, id, verdict, ACTOR_HUMAN)
}

/// The one actor whose verdict is a ruling rather than a reading — the triage
/// UI and every other surface a person clicks. Everything else (`TriageRule`,
/// `Strategist`, `Autonomy`, `Athena`, `AppMaster`) is a machine, and
/// [`record_idea_decision_by`] records a machine's rejection as advisory.
pub const ACTOR_HUMAN: &str = "Human";

/// Whether an actor string names the person, not a machine.
pub(crate) fn actor_is_human(actor: &str) -> bool {
    actor.trim().eq_ignore_ascii_case(ACTOR_HUMAN)
}

/// [`apply_idea_verdict`] with an explicit actor for the memory ledger
/// ([`ACTOR_HUMAN`] · "TriageRule" · "Strategist" · "Autonomy" · "Athena" ·
/// "AppMaster").
pub fn apply_idea_verdict_by(
    db: &crate::db::DbPool,
    id: &str,
    verdict: IdeaVerdict,
    actor: &str,
) -> Result<DevIdea, AppError> {
    apply_idea_verdict_cas(db, id, verdict, actor, None)
}

/// [`apply_idea_verdict_by`] with a COMPARE-AND-SWAP guard.
///
/// `expected` is the status the caller SAW when it offered the decision. Pass
/// it from any surface that renders a row and then writes a verdict against it;
/// pass `None` from server-side loops that select their own working set in the
/// same breath (Athena's batch triage, triage rules, the scanner).
///
/// Why it matters: reviews have had a single-winner swap since
/// `manual_reviews::update_status`, and ideas did not. Two surfaces holding the
/// same `pending` row could each write a verdict, and each fired
/// [`record_idea_decision_by`] — so rejecting an idea
/// on the triage deck (which writes a `constraint` memory telling every future
/// scan not to raise it) and then accepting the same stale row in Approvals left
/// status `accepted` WITH a permanent "never raise this" constraint. The two
/// loops disagreed forever and nothing warned anyone.
///
/// A deliberate reversal is still a decision: a reviewer looking at a `rejected`
/// row and accepting it passes `expected = "rejected"` and wins. Only a verdict
/// written against a status the row no longer holds loses.
pub fn apply_idea_verdict_cas(
    db: &crate::db::DbPool,
    id: &str,
    verdict: IdeaVerdict,
    actor: &str,
    expected: Option<&str>,
) -> Result<DevIdea, AppError> {
    let status = verdict.status();
    let existing = repo::get_idea_by_id(db, id)?;
    if existing.status == status {
        return Ok(existing);
    }

    // Fail fast with the informative message before touching the DB. The swap
    // below is still the authority — this only turns the common case (a stale
    // card, seconds old) into a precise error instead of a bare 0-row result.
    if let Some(seen) = expected {
        if existing.status != seen {
            return Err(AppError::Validation(format!(
                "Backlog idea {id} was already decided as '{}' by a concurrent action",
                existing.status
            )));
        }
    }

    let reason = match &verdict {
        IdeaVerdict::Accept => None,
        IdeaVerdict::Reject { reason } => Some(reason.as_deref()),
    };
    // Swap against what we just read even when the caller named nothing: that
    // still closes the read→write interleave, which is the window the
    // side-effect fan-out below must never pass through twice.
    let idea = repo::decide_idea_cas(db, id, &existing.status, status, reason)?;

    record_idea_decision_by(db, &idea, status, actor);
    Ok(idea)
}

/// Accept a backlog idea (triage). Delegates to [`apply_idea_verdict_cas`] —
/// the status write and the decision memory both live there.
///
/// `expected_status` is the status the CALLING SURFACE saw on the row. Every
/// UI that renders a row and then writes a verdict against it should send it;
/// omitting it keeps the pre-CAS behaviour for callers with no rendered row.
#[tauri::command]
pub fn dev_tools_accept_idea(
    state: State<'_, Arc<AppState>>,
    id: String,
    expected_status: Option<String>,
) -> Result<DevIdea, AppError> {
    require_auth_sync(&state)?;
    apply_idea_verdict_cas(
        &state.db,
        &id,
        IdeaVerdict::Accept,
        "Human",
        expected_status.as_deref(),
    )
}

/// Reject a backlog idea (triage). Delegates to [`apply_idea_verdict_cas`],
/// which records the decision as a `constraint` memory (so the team + future
/// scans avoid re-surfacing it).
#[tauri::command]
pub fn dev_tools_reject_idea(
    state: State<'_, Arc<AppState>>,
    id: String,
    reason: Option<String>,
    expected_status: Option<String>,
) -> Result<DevIdea, AppError> {
    require_auth_sync(&state)?;
    apply_idea_verdict_cas(
        &state.db,
        &id,
        IdeaVerdict::Reject { reason },
        "Human",
        expected_status.as_deref(),
    )
}

/// One keyset page of backlog ideas + facet counts — the read behind the
/// unified Backlog (Approvals › Backlog) and its Focus deck.
///
/// `project_id: None` is an explicit CROSS-PROJECT read, not "unfiltered by
/// accident". `status` defaults to `pending`. `origin` accepts the pseudo-value
/// `scanner` for classic Idea-Scanner rows (`origin IS NULL`).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn dev_tools_triage_ideas(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    status: Option<String>,
    origin: Option<String>,
    category: Option<String>,
    limit: Option<i64>,
    cursor: Option<String>,
) -> Result<repo::TriagePage, AppError> {
    require_auth_sync(&state)?;
    let filter = repo::TriageFilter {
        project_id,
        status,
        origin,
        category,
    };
    repo::triage_ideas(&state.db, &filter, limit, cursor.as_deref())
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
    repo::list_ideas(
        &state.db,
        None,
        Some("pending"),
        None,
        Some(limit.unwrap_or(100)),
        None,
    )
}

/// Write a triage decision to the project's dev memory + the bound team's
/// shared ledger (best-effort). Team-less projects skip the team memory; the
/// Scanner-suppress loop (idea_scanner) covers re-surfacing for those. Deduped
/// by `(project_id, source_kind, source_id)` and, in the team ledger, by
/// `(team_id, subject)` — the subject alone, so a later verdict replaces the
/// row rather than standing beside it.
///
/// `actor` names who decided: [`ACTOR_HUMAN`] (triage UI), "TriageRule",
/// "Strategist" (the autonomous backlog-triage job), "Autonomy" (the
/// backlog→goal tick), "Athena", or "AppMaster" (a headless worker's write-back).
///
/// **Only a human ruling becomes a constraint.** A rejection used to be an
/// importance-8 `constraint` — "do not re-surface rejected items" — whatever
/// decided it, and nothing ever expires or weakens one. So a machine that
/// declined an item for a reason that was true for five minutes (the run was
/// blocked, the work turned out to be already on main, a triage rule read a
/// missing score) left a permanent ruling in the shared ledger that every
/// future scan and every injected prompt reads as settled policy. An automated
/// decline is now an advisory `decision` at importance 5, and says in its own
/// text that it is not a human ruling and may be re-raised with evidence.
///
/// Not called directly by verdict paths — [`apply_idea_verdict_by`] owns the
/// ordering. It stays `pub(crate)` for that one caller.
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

    let rejected = verdict == "rejected";
    let by_human = actor_is_human(actor);
    // A human rejection → guardrail constraint (mirrors reviews). An automated
    // one → advisory decision, ranked below every constraint and below an
    // acceptance, because it is a machine's reading and not a ruling.
    let (category, importance) = match (rejected, by_human) {
        (true, true) => ("constraint", 8),
        (true, false) => ("decision", 5),
        (false, _) => ("decision", 7),
    };
    // The subject of the decision, free of any run decoration — see
    // [`strip_bench_decoration`]. It is what both ledgers key on.
    let subject_title = crate::db::repos::dev::ideas::strip_bench_decoration(&idea.title);
    let title = format!("{actor} {verdict}: {subject_title}");
    let subject = format!(
        "{actor} {verdict} the backlog idea \"{}\"{}",
        subject_title,
        idea.description
            .as_deref()
            .map(|d| format!(": {d}"))
            .unwrap_or_default(),
    );
    let content = if rejected && !by_human {
        format!(
            "{subject}. This is an automated judgement, not a human ruling — treat it as \
             advisory. It records what one run concluded at one moment; if the item still \
             matters, re-file it with evidence rather than reading this as settled."
        )
    } else {
        format!("{subject}. Apply this to future scans + work — do not re-surface rejected items.")
    };

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

    // (2) TEAM memory — the cross-persona workspace ledger. Only written when
    // the project actually belongs to a team.
    //
    // It is keyed on `(team_id, title)`, and the title used to carry the actor
    // and the verdict. So "Human accepted: X" and "AppMaster rejected: X" were
    // two different keys: both rows stood, both were injected into every run
    // prompt by `get_for_injection`, and the ledger asserted two contradictory
    // things about one item. The key is now the SUBJECT alone; the verdict
    // lives in the content, and a later decision REPLACES the row rather than
    // sitting beside it.
    let team_title = format!("backlog decision: {subject_title}");
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
    // The ledger is read by people and by prompts; which of them ruled has to be
    // legible from the row, not only from its wording.
    let tags = if by_human {
        format!("dev-backlog,{verdict}")
    } else {
        format!("dev-backlog,{verdict},automated")
    };

    let existing: Option<String> = pool.get().ok().and_then(|conn| {
        conn.query_row(
            "SELECT id FROM team_memories WHERE team_id = ?1 AND title = ?2 LIMIT 1",
            rusqlite::params![team_id, team_title],
            |r| r.get::<_, String>(0),
        )
        .ok()
    });

    // Overwritten in place rather than through `team_memories::update`, which is
    // the human-edit path: it rewrites `tags` into a revision-log JSON object
    // and would erase the `dev-backlog` / `automated` tags this row is keyed by.
    // A repo-level `upsert_decision` belongs in `repos/resources/team_memories.rs`.
    if let Some(id) = existing {
        let written = pool.get().ok().and_then(|conn| {
            conn.execute(
                "UPDATE team_memories
                    SET content = ?1, category = ?2, importance = ?3, tags = ?4,
                        updated_at = ?5
                  WHERE id = ?6",
                rusqlite::params![
                    content,
                    category,
                    importance,
                    tags,
                    chrono::Utc::now().to_rfc3339(),
                    id
                ],
            )
            .ok()
        });
        if written.is_none() {
            tracing::warn!(idea_id = %idea.id, "dev-backlog learning loop: failed to update team memory");
        }
        return;
    }

    let tm = crate::db::models::CreateTeamMemoryInput {
        team_id,
        run_id: None,
        member_id: None,
        persona_id: None,
        title: team_title,
        content,
        category: Some(category.to_string()),
        importance: Some(importance),
        tags: Some(tags),
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

// ============================================================================
// Tasks
// ============================================================================

#[tauri::command]
pub fn dev_tools_list_tasks(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    status: Option<String>,
    since: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<DevTask>, AppError> {
    require_auth_sync(&state)?;
    if since.is_some() || limit.is_some() {
        return repo::list_tasks_since(&state.db, project_id.as_deref(), since.as_deref(), limit);
    }
    repo::list_tasks(&state.db, project_id.as_deref(), status.as_deref())
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
    create_task_core(
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

/// The IPC-free task-creation core — everything `dev_tools_create_task` does
/// minus the auth gate, so headless callers (the Overnight Portfolio Engine
/// tick) create tasks through the exact same path a click would.
#[allow(clippy::too_many_arguments)]
pub fn create_task_core(
    db: &crate::db::DbPool,
    project_id: Option<&str>,
    title: &str,
    description: Option<&str>,
    source_idea_id: Option<&str>,
    goal_id: Option<&str>,
    status: Option<&str>,
    depth: Option<&str>,
) -> Result<DevTask, AppError> {
    let task = repo::create_task(
        db,
        project_id,
        title,
        description,
        source_idea_id,
        goal_id,
        status,
        depth,
    )?;
    Ok(task)
}

// ============================================================================
// The accept → execute bridge (plan 1D)
// ============================================================================

/// One idea that made it onto the runway, with everything either executor needs.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DispatchedIdea {
    pub idea_id: String,
    pub task_id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    /// The project's working directory — `None` when the project is gone or
    /// pathless. The fleet arm needs it; the runner arm doesn't.
    pub root_path: Option<String>,
    /// The composed task description, so the fleet arm can seed a session with
    /// the exact same text the runner would have executed.
    pub prompt: String,
    /// The fleet session spawned for this idea (fleet target only; `None` for
    /// runner dispatches or when the spawn was skipped/failed — see `skipped`).
    pub session_id: Option<String>,
    /// The isolated worktree an UNATTENDED worker was given to author in, and
    /// the branch prepared for it there. `None` for a human-driven dispatch,
    /// which still runs in the project's own checkout under a person who can
    /// see what it does. See `personas_engine::unattended_worktree`.
    pub worktree_path: Option<String>,
    pub branch: Option<String>,
}

/// An idea that could not be dispatched, and why. Reported per item — a batch
/// dispatch that silently drops half its input is worse than one that fails.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DispatchSkip {
    pub idea_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DispatchIdeasResult {
    /// `runner` | `fleet` — echoed so the caller can branch without re-reading
    /// its own request.
    pub target: String,
    pub dispatched: Vec<DispatchedIdea>,
    pub skipped: Vec<DispatchSkip>,
    /// True when execution actually began: the runner batch was started, or
    /// (fleet) at least one headless session was spawned backend-side.
    pub started: bool,
}

/// The prompt a dispatched idea carries into its executor.
///
/// Ported verbatim in spirit from `findings/dispatch.ts::dispatchPrompt`: the
/// description is already written as an instruction (emitters seed it that
/// way), the reasoning explains why it was raised, and the evidence is the bar
/// the fix has to clear — an agent that can see the numbers can tell whether it
/// actually fixed the thing instead of guessing.
pub fn dispatch_prompt(idea: &DevIdea) -> String {
    let mut lines: Vec<String> = vec![idea.title.trim().to_string()];
    if let Some(d) = idea.description.as_deref().filter(|s| !s.trim().is_empty()) {
        lines.push(String::new());
        lines.push(d.trim().to_string());
    }
    if let Some(r) = idea.reasoning.as_deref().filter(|s| !s.trim().is_empty()) {
        lines.push(String::new());
        lines.push(format!("Why this was raised: {}", r.trim()));
    }
    if let Some(e) = idea.evidence.as_deref().filter(|s| !s.trim().is_empty()) {
        lines.push(String::new());
        lines.push(format!("Evidence this was raised on: {}", e.trim()));
        lines.push(
            "Treat those numbers as the bar: the fix has to move them, not merely look plausible."
                .to_string(),
        );
    }
    lines.join("\n")
}

/// Dispatch accepted backlog ideas to an executor — the bridge that made the
/// Backlog's "accept" mean something.
///
/// Per idea: **dispatching IS a decision**, so a still-pending idea is
/// auto-accepted through [`apply_idea_verdict`] (never a raw status write — the
/// decision memory must happen too). Then a task is created through
/// [`dev_tools_create_task`], deliberately reusing that command rather than
/// `repo::create_task`, so every task is minted by one door.
///
/// `runner` starts the created tasks through the existing batch machinery
/// (`dev_tools_start_batch`, unchanged — no fork of the execution path).
/// `fleet` composes AND spawns the sessions backend-side (headless
/// `claude -p`, one per idea, rooted at the project's `root_path`) — the
/// documented v1 "fleet arm stays frontend-composed" limitation is gone, so a
/// headless tick (Overnight Portfolio Engine) can dispatch with no UI present.
#[tauri::command]
pub async fn dev_tools_dispatch_ideas(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    idea_ids: Vec<String>,
    target: String,
    depth: Option<String>,
    max_parallel: Option<usize>,
) -> Result<DispatchIdeasResult, AppError> {
    require_auth(&state).await?;

    // `max_parallel` stays on the wire for the callers that still send it,
    // but capacity is no longer this command's to decide: the fleet's global
    // cap (`fleet.max_parallel_sessions`) admits or queues every session, for
    // the fleet arm here and for the runner batch below alike.
    let _ = max_parallel;
    let mut result =
        dispatch_ideas_core(&state.db, &app, idea_ids, &target, depth.as_deref(), false).await?;

    if target == "runner" {
        let task_ids: Vec<String> = result
            .dispatched
            .iter()
            .map(|d| d.task_id.clone())
            .collect();
        crate::commands::infrastructure::task_executor::dev_tools_start_batch(
            state.clone(),
            app,
            task_ids,
            max_parallel,
        )
        .await?;
        result.started = true;
    }

    Ok(result)
}

// The guardrail block appended to every UNATTENDED fleet dispatch prompt now
// lives in `personas_engine::unattended` (with the composer
// `unattended_task_text`), so the two package-level invariants it carries are
// covered by a test binary that actually launches:
//   • branch-only writes, human merges (batch-2 "safe autonomy"); and
//   • an overnight worker FINISHES — it never ends its turn on a question no
//     one is awake to answer (bench sweep #18, 2026-08-25).

/// Root of every project's unattended authoring worktrees:
/// `<app_data>/worktrees`, honoring `PERSONAS_DATA_DIR` exactly as the DB and
/// the engine-leader lock do — a parallel test instance gets its own worktree
/// root for the same reason it gets its own database.
///
/// **Outside the repository, deliberately.** The reasoning (the night's own
/// file walk, the operator's `git status`, `git clean`, test isolation) is in
/// `personas_engine::unattended_worktree`'s module doc; it is not repeated
/// here so there is one place to correct it.
pub(crate) fn authoring_worktrees_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use personas_engine::unattended_worktree::AUTHORING_WORKTREES_DIRNAME;
    if let Ok(dir) = std::env::var("PERSONAS_DATA_DIR") {
        if !dir.trim().is_empty() {
            return Ok(PathBuf::from(dir.trim()).join(AUTHORING_WORKTREES_DIRNAME));
        }
    }
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|p| p.join(AUTHORING_WORKTREES_DIRNAME))
        .map_err(|e| format!("app data directory unavailable: {e}"))
}

// ---------------------------------------------------------------------------
// Recall into the night (App master §8.1)
// ---------------------------------------------------------------------------

/// Compose the prompt an UNATTENDED worker is actually seeded with: the idea,
/// then whatever the project and (for an App-master project) the holder already
/// know.
///
/// Until this existed the fleet arm dispatched an amnesiac: the task_executor
/// arm has injected `dev_memories` since the backlog-memory loop shipped, and
/// the unattended arm — the one that runs at 03:00 with nobody watching, and
/// the only one an App master uses — injected nothing at all. A night could
/// therefore re-attempt an approach that was reverted last week, or re-open a
/// question the owner already answered.
///
/// Two budgeted blocks, both optional, composed by
/// [`personas_engine::app_master_memory`]:
///
/// * **`## Project memory`** — every unattended dispatch, 12 rows / 1.5k chars,
///   parity with the runner arm. Project memory is a fact about the repository
///   and outlives any one tenure.
/// * **`## Your memory (App master)`** — only when the project carries a
///   mandate: 6 core rows verbatim (core is small by contract) plus the active
///   tier packed into 2k chars by value, carrying its own "+N omitted" line.
///
/// Called BEFORE `unattended::unattended_worktree_task_text`, so the guardrails
/// still land last and the blocks ride inside the worker task text between the
/// task and the rules.
///
/// **Best-effort, never fatal.** Every failure path degrades to "no block":
/// a night that cannot read its memory still dispatches, exactly as it did
/// before this existed.
fn compose_unattended_recall(
    db: &crate::db::DbPool,
    project_id: Option<&str>,
    prompt: &str,
) -> String {
    use personas_engine::app_master_memory as amm;

    let Some(project_id) = project_id.filter(|p| !p.trim().is_empty()) else {
        return prompt.to_string();
    };

    let project_block = match crate::db::repos::dev_memories::get_for_injection(
        db,
        project_id,
        amm::PROJECT_MEMORY_ROWS,
    ) {
        Ok(rows) => amm::project_block_from_rows(&rows),
        Err(e) => {
            tracing::warn!(project_id, error = %e,
                "unattended recall: project memory unreadable; dispatching without it");
            None
        }
    };

    // The persona lane is App-master-only: an ordinary autopilot project has no
    // holder, and there is no persona whose memory it would be.
    let persona_block = personas_engine::responsibility::mandate_for_project_or_none(
        db, project_id,
    )
    .and_then(|record| {
        let tiered = match crate::db::repos::core::memories::get_for_injection_v2(
            db,
            crate::db::repos::core::memories::InjectionScope::for_persona(&record.persona_id),
            amm::PERSONA_CORE_ROWS,
            amm::PERSONA_ACTIVE_ROWS,
        ) {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!(project_id, persona_id = %record.persona_id, error = %e,
                    "unattended recall: persona memory unreadable; dispatching without it");
                return None;
            }
        };
        let packed = personas_db::memory_recall::pack_by_budget(
            tiered.active,
            amm::PERSONA_ACTIVE_BUDGET_CHARS,
            chrono::Utc::now(),
        );
        let block = amm::persona_memory_block(&tiered.core, &packed.selected, packed.omitted)?;

        // The access counters ARE the decay signal: `decay_score` anchors a
        // memory's age at `last_accessed_at` and boosts on `access_count`.
        // Injecting without this write starves decay — every memory the App
        // master actually uses would age as though it had never been read.
        let ids = amm::injected_ids(&tiered.core, &packed.selected);
        if let Err(e) = crate::db::repos::core::memories::increment_access_batch(db, &ids) {
            tracing::warn!(persona_id = %record.persona_id, error = %e,
                "unattended recall: could not record memory access; decay will under-count");
        }
        tracing::debug!(
            project_id,
            persona_id = %record.persona_id,
            core = tiered.core.len(),
            active = packed.selected.len(),
            omitted = packed.omitted,
            "unattended recall: App master memory injected"
        );
        Some(block)
    });

    amm::compose_dispatch_prompt(prompt, project_block.as_deref(), persona_block.as_deref())
}

/// Prepare the isolated worktree one unattended dispatch will author in.
async fn prepare_unattended_worktree(
    db: &crate::db::DbPool,
    app: &tauri::AppHandle,
    d: &DispatchedIdea,
    root: &str,
) -> Result<personas_engine::unattended_worktree::AuthoringWorktree, String> {
    let project_id = d
        .project_id
        .clone()
        .ok_or_else(|| "the idea carries no project".to_string())?;
    let worktrees_root = authoring_worktrees_root(app)?;
    let main_branch = repo::get_project_by_id(db, &project_id)
        .ok()
        .and_then(|p| p.main_branch);
    personas_engine::unattended_worktree::prepare_authoring_worktree(
        std::path::Path::new(root),
        &worktrees_root,
        &project_id,
        &d.title,
        main_branch.as_deref(),
    )
    .await
}

/// Retire the authoring worktrees of one project that have finished their job
/// (branch merged, or old and clean). Best-effort and quiet: a night that
/// cannot prune still dispatches.
pub(crate) async fn prune_project_worktrees(
    app: &tauri::AppHandle,
    project: &DevProject,
) -> Option<personas_engine::unattended_worktree::PruneReport> {
    let root = std::path::PathBuf::from(&project.root_path);
    if project.root_path.trim().is_empty() || !root.exists() {
        return None;
    }
    let worktrees_root = authoring_worktrees_root(app).ok()?;
    if !worktrees_root.exists() {
        return None; // nothing has ever authored here
    }
    let main_branch = personas_engine::app_master_gates::resolve_main_branch(
        &root,
        project.main_branch.as_deref(),
    )
    .await?;
    Some(
        personas_engine::unattended_worktree::prune_authoring_worktrees(
            &root,
            &worktrees_root,
            &main_branch,
            personas_engine::unattended_worktree::PrunePolicy::default(),
        )
        .await,
    )
}

/// How often [`prune_all_project_worktrees`] actually walks the projects.
const PRUNE_ALL_EVERY: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// Retire finished authoring worktrees for EVERY registered project, at most
/// once per [`PRUNE_ALL_EVERY`] per process.
///
/// Until this existed [`prune_project_worktrees`] had one caller, inside the
/// Overnight night run, which only runs for projects whose autopilot mode
/// grants a night. Worktrees are also made by App Master code charters, team
/// assignment steps and the task runner, so a project without autopilot
/// nights accumulated one full checkout per dispatch, forever. The policy is
/// unchanged (merged or old, and clean, and outside the grace window); only
/// the reach is. Called from the always-registered overnight subscription's
/// tick, so the first pass runs a few minutes after boot and then hourly.
pub(crate) async fn prune_all_project_worktrees(pool: &crate::db::DbPool, app: &tauri::AppHandle) {
    use std::sync::Mutex;
    use std::time::Instant;
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    {
        // A poisoned throttle is only a timestamp; recover it.
        let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
        if last.is_some_and(|t| t.elapsed() < PRUNE_ALL_EVERY) {
            return;
        }
        *last = Some(Instant::now());
    }
    let projects = match repo::list_projects(pool, None) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "worktree prune: could not list projects");
            return;
        }
    };
    for project in projects {
        let Some(report) = prune_project_worktrees(app, &project).await else {
            continue;
        };
        if !report.removed.is_empty() || !report.deleted_empty_branches.is_empty() {
            tracing::info!(
                project_id = %project.id,
                removed = ?report.removed,
                deleted_empty_branches = ?report.deleted_empty_branches,
                kept = report.kept,
                "worktree prune: retired finished authoring worktrees"
            );
        }
    }
}

/// The IPC-free dispatch core — compose + (for `fleet`) spawn, no auth gate,
/// no runner batch start (the command wrapper owns that; the overnight tick
/// only uses the fleet arm). `unattended` is set ONLY by the autopilot tick,
/// and it now decides **two** things, not one: the guardrail block appended to
/// the fleet prompt, and — since bench sweep #23 — whether the session is
/// spawned into an isolated authoring worktree
/// (`personas_engine::unattended_worktree`) instead of the project's shared
/// checkout. A human-driven dispatch keeps its existing behavior exactly: it
/// runs in `root_path`, under a person who can see what it does to their tree.
///
/// Per idea: **dispatching IS a decision**, so a still-pending idea is
/// auto-accepted through [`apply_idea_verdict_by`] (never a raw status write —
/// the decision memory must happen too), then a task is created through
/// [`create_task_core`].
///
/// Capacity is the fleet's, not this function's: every `fleet` idea is
/// admitted through `queue::admit` at once (origin `dispatch_ideas`), and the
/// global `fleet.max_parallel_sessions` cap decides how many start now and
/// how many wait as `queued` sessions. The per-project `max_parallel` cap and
/// the in-memory drain loop that used to live here (G5) are retired — the
/// queue is durable, ordered, and visible where the drain was neither.
pub async fn dispatch_ideas_core(
    db: &crate::db::DbPool,
    app: &tauri::AppHandle,
    idea_ids: Vec<String>,
    target: &str,
    depth: Option<&str>,
    unattended: bool,
) -> Result<DispatchIdeasResult, AppError> {
    if idea_ids.is_empty() {
        return Err(AppError::Validation(
            "No ideas selected to dispatch.".into(),
        ));
    }
    if !matches!(target, "runner" | "fleet") {
        return Err(AppError::Validation(format!(
            "dispatch target must be `runner` or `fleet`, got `{target}`"
        )));
    }
    let actor = if unattended { "Autonomy" } else { "Human" };

    let mut dispatched: Vec<DispatchedIdea> = Vec::new();
    let mut skipped: Vec<DispatchSkip> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for id in idea_ids {
        if !seen.insert(id.clone()) {
            continue;
        }
        let idea = match repo::get_idea_by_id(db, &id) {
            Ok(i) => i,
            Err(_) => {
                skipped.push(DispatchSkip {
                    idea_id: id,
                    reason: "not found".into(),
                });
                continue;
            }
        };
        if idea.status == "rejected" || idea.status == "archived" {
            skipped.push(DispatchSkip {
                idea_id: id,
                reason: format!("is {}", idea.status),
            });
            continue;
        }
        // G22 — the backstop, at the door itself. A platform escalation is an
        // item about the Personas app filed by a persona that works on
        // something else; no unattended selector may hand it to a worker, whose
        // worktree is this project's checkout and cannot reach the fix. A HUMAN
        // dispatching it deliberately is a different act and is allowed: they
        // may have opened the right repo.
        if unattended && idea.scan_type == repo::PLATFORM_ESCALATION_SCAN_TYPE {
            skipped.push(DispatchSkip {
                idea_id: id,
                reason: "is a platform escalation — it waits for a human or the orchestrator"
                    .into(),
            });
            continue;
        }
        // Dispatching IS the decision — route it through the shared verdict core
        // so the memory + adoption write-backs happen exactly as they would from
        // a click. Idempotent, so an already-accepted idea costs nothing.
        let idea = if idea.status == "pending" {
            match apply_idea_verdict_by(db, &id, IdeaVerdict::Accept, actor) {
                Ok(i) => i,
                Err(e) => {
                    skipped.push(DispatchSkip {
                        idea_id: id,
                        reason: e.to_string(),
                    });
                    continue;
                }
            }
        } else {
            idea
        };

        let prompt = dispatch_prompt(&idea);
        let task = match create_task_core(
            db,
            idea.project_id.as_deref(),
            &idea.title,
            Some(&prompt),
            Some(&idea.id),
            idea.goal_id.as_deref(),
            None,
            depth,
        ) {
            Ok(t) => t,
            Err(e) => {
                skipped.push(DispatchSkip {
                    idea_id: id,
                    reason: e.to_string(),
                });
                continue;
            }
        };

        let project = idea
            .project_id
            .as_deref()
            .and_then(|pid| repo::get_project_by_id(db, pid).ok());
        dispatched.push(DispatchedIdea {
            idea_id: idea.id.clone(),
            task_id: task.id,
            title: idea.title.clone(),
            project_id: idea.project_id.clone(),
            project_name: project.as_ref().map(|p| p.name.clone()),
            root_path: project.as_ref().map(|p| p.root_path.clone()),
            prompt,
            session_id: None,
            worktree_path: None,
            branch: None,
        });
    }

    if dispatched.is_empty() {
        return Err(AppError::Validation(
            "Nothing could be dispatched — see the per-item reasons.".into(),
        ));
    }

    let mut started = false;
    if target == "fleet" {
        // Backend-side fleet composition: headless sessions seeded with the
        // exact prompt the runner arm would execute. Fleet APIs are call-only
        // here — every session goes through `queue::admit`, behind the
        // [`FleetArm`] seam so the wave can be driven in a test.
        let arm = TauriFleetArm { app: app.clone() };
        let outcome = drive_fleet_wave(db, &arm, dispatched, &mut skipped, unattended).await;
        started = outcome.started;
        dispatched = outcome.settled;
        tracing::info!(
            target = %target,
            summary = %crate::commands::fleet::queue::summarize_admissions(&outcome.admissions),
            "dispatch ideas: fleet admissions"
        );
    }

    Ok(DispatchIdeasResult {
        target: target.to_string(),
        dispatched,
        skipped,
        started,
    })
}

// ---------------------------------------------------------------------------
// The fleet arm — every idea through the fleet's one admission door
// ---------------------------------------------------------------------------

/// Everything the fleet arm does to the world outside `dev_tasks`, behind one
/// trait — so [`drive_fleet_wave`] can be driven against a recording double
/// with no Tauri app, no git worktree and no `claude` process.
///
/// There was no seam here at all before G5, which is why the 51-process night
/// had no test that could have caught it. The seam stays; what it fronts is
/// now the queue, whose cap is global and durable.
#[async_trait::async_trait]
pub(crate) trait FleetArm: Send + Sync {
    /// Prepare the isolated authoring worktree an unattended worker gets.
    /// Returns `(cwd, branch)`.
    async fn prepare_worktree(
        &self,
        d: &DispatchedIdea,
        root: &str,
    ) -> Result<(String, String), String>;

    /// Admit one headless session through `queue::admit`. `name` is the
    /// session's display name (the idea's title). Returns the door's verdict:
    /// started now, or queued at a rank.
    async fn admit(
        &self,
        cwd: String,
        name: String,
        task_text: String,
    ) -> Result<crate::commands::fleet::queue::Admission, String>;
}

/// The real arm: the fleet's admission door.
pub(crate) struct TauriFleetArm {
    pub app: tauri::AppHandle,
}

#[async_trait::async_trait]
impl FleetArm for TauriFleetArm {
    async fn prepare_worktree(
        &self,
        d: &DispatchedIdea,
        root: &str,
    ) -> Result<(String, String), String> {
        use tauri::Manager;
        let state = self.app.state::<Arc<AppState>>();
        let wt = prepare_unattended_worktree(&state.db, &self.app, d, root).await?;
        Ok((wt.path.to_string_lossy().to_string(), wt.branch))
    }

    async fn admit(
        &self,
        cwd: String,
        name: String,
        task_text: String,
    ) -> Result<crate::commands::fleet::queue::Admission, String> {
        use crate::commands::fleet::queue::{self, DispatchOrigin, DispatchRequest};
        queue::admit(
            &self.app,
            DispatchRequest {
                cwd,
                name: Some(name),
                title: None,
                args: queue::headless_args(&task_text, Vec::new()),
                mode: crate::commands::fleet::types::FleetSessionMode::Headless,
                // The dispatch's own run label (an overnight tick opens one),
                // stamped on the request so a row promoted minutes later still
                // carries it — the label is what the night's sweeper keys on.
                run_label: crate::commands::fleet::run::current_run_label(),
                origin: DispatchOrigin::DispatchIdeas,
                persona_id: None,
                goal_id: None,
                cycle_index: None,
                not_before_ms: None,
            },
        )
        .await
        .map_err(|e| e.to_string())
    }
}

/// What one admission wave settled.
pub(crate) struct FleetWaveOutcome {
    /// Every idea, with its session id when one was admitted, or skipped for a
    /// reason waiting cannot fix (no `root_path`, no worktree, admission
    /// refused).
    pub settled: Vec<DispatchedIdea>,
    /// True when at least one session actually started NOW (a queued
    /// admission is bound to its task but has not begun).
    pub started: bool,
    /// The door's verdicts, in admission order — for the summary.
    pub admissions: Vec<crate::commands::fleet::queue::Admission>,
}

/// Run one admission wave: every idea is admitted; the queue decides who runs.
///
/// A task whose session started now goes `running` with its session id and
/// `started_at`; a task whose session was queued keeps `status = queued` and
/// takes only the session id — the queue's promotion hook
/// (`dev_tools::mark_tasks_running_for_session`) flips it when the session
/// actually starts, and a cancel or refused promotion unbinds it again.
pub(crate) async fn drive_fleet_wave(
    db: &crate::db::DbPool,
    arm: &dyn FleetArm,
    dispatched: Vec<DispatchedIdea>,
    skipped: &mut Vec<DispatchSkip>,
    unattended: bool,
) -> FleetWaveOutcome {
    let mut settled: Vec<DispatchedIdea> = Vec::new();
    let mut admissions = Vec::new();
    let mut started = false;

    for mut d in dispatched {
        let Some(root) = d.root_path.clone().filter(|r| !r.trim().is_empty()) else {
            skipped.push(DispatchSkip {
                idea_id: d.idea_id.clone(),
                reason: "project has no root_path — cannot spawn a fleet session".into(),
            });
            // The task row stays (visible in the Run Desk) but no session ran.
            settled.push(d);
            continue;
        };

        // An UNATTENDED worker never authors in the shared checkout. It is
        // handed a branch already checked out in an isolated worktree, and
        // its `cwd` is that worktree — see the module doc of
        // `personas_engine::unattended_worktree` for the night that made
        // this non-negotiable. A human-driven dispatch is unchanged: a
        // person is watching their own tree, and the same `unattended`
        // flag that already picks the prompt picks the isolation.
        let (spawn_cwd, task_text) = if unattended {
            match arm.prepare_worktree(&d, &root).await {
                Ok((wt_str, branch)) => {
                    // Recall FIRST, guardrails last: the worker reads the
                    // idea, then what this project and this holder already
                    // know, then the rules it may not break. `d.prompt` is
                    // left as the idea alone — it is the task row's own
                    // description, and a memory snapshot does not belong in
                    // a durable record of what was asked for.
                    let recalled =
                        compose_unattended_recall(db, d.project_id.as_deref(), &d.prompt);
                    let text = personas_engine::unattended::unattended_worktree_task_text(
                        &recalled, &branch, &wt_str,
                    );
                    d.worktree_path = Some(wt_str.clone());
                    d.branch = Some(branch);
                    (wt_str, text)
                }
                Err(e) => {
                    // Refuse, never fall back to the shared checkout — the
                    // fallback IS the defect.
                    skipped.push(DispatchSkip {
                        idea_id: d.idea_id.clone(),
                        reason: format!("no isolated authoring worktree: {e}"),
                    });
                    settled.push(d);
                    continue;
                }
            }
        } else {
            (root, d.prompt.clone())
        };

        match arm.admit(spawn_cwd, d.title.clone(), task_text).await {
            Ok(admission) => {
                let session_id = admission.session_id.clone();
                let now = chrono::Utc::now().to_rfc3339();
                let started_now = admission.rank.is_none();
                let _ = repo::update_task(
                    db,
                    &d.task_id,
                    None,
                    None,
                    started_now.then_some("running"),
                    Some(Some(session_id.as_str())),
                    None,
                    None,
                    None,
                    started_now.then_some(Some(now.as_str())),
                    None,
                );
                d.session_id = Some(session_id);
                started |= started_now;
                admissions.push(admission);
            }
            Err(e) => {
                skipped.push(DispatchSkip {
                    idea_id: d.idea_id.clone(),
                    reason: format!("fleet admission failed: {e}"),
                });
            }
        }
        settled.push(d);
    }

    FleetWaveOutcome {
        settled,
        started,
        admissions,
    }
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

/// Keyset page of tasks + per-status counts for the Run Desk.
/// `dev_tools_list_tasks` stays as-is for the unpaginated callers.
#[tauri::command]
pub fn dev_tools_tasks_page(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    statuses: Option<Vec<String>>,
    limit: Option<i64>,
    cursor: Option<String>,
) -> Result<repo::TasksPage, AppError> {
    require_auth_sync(&state)?;
    repo::tasks_page(
        &state.db,
        project_id.as_deref(),
        statuses.as_deref(),
        limit,
        cursor.as_deref(),
    )
}

/// Queue a fresh attempt of a task. The new row copies the original verbatim
/// (no `[Retry] ` title prefix) and records lineage via `parent_task_id` /
/// `attempt`.
#[tauri::command]
pub fn dev_tools_retry_task(
    state: State<'_, Arc<AppState>>,
    task_id: String,
) -> Result<DevTask, AppError> {
    require_auth_sync(&state)?;
    repo::retry_task(&state.db, &task_id)
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
    let outcome = run_triage_rules_core(&state.db, &project_id)?;
    Ok(serde_json::json!({
        "applied": outcome.applied,
        "ideas_affected": outcome.ideas_affected,
    }))
}

/// What a mechanical triage-rules pass did — the accepted ids are what the
/// Overnight Portfolio Engine dispatches (its "auto-accepted ideas" set).
#[derive(Debug, Default)]
pub struct TriageRunOutcome {
    /// Number of enabled rules that were evaluated.
    pub applied: usize,
    /// Ideas that received a verdict (accepted + rejected).
    pub ideas_affected: usize,
    /// Ideas auto-ACCEPTED this pass, in evaluation order.
    pub accepted_idea_ids: Vec<String>,
    /// Ideas auto-rejected this pass.
    pub rejected_count: usize,
}

/// The IPC-free triage core — purely mechanical rule evaluation (no LLM), the
/// same first-matching-rule-wins pass `dev_tools_run_triage_rules` runs, minus
/// the auth gate so the overnight tick can call it headlessly.
pub fn run_triage_rules_core(
    db: &crate::db::DbPool,
    project_id: &str,
) -> Result<TriageRunOutcome, AppError> {
    // 1. Fetch enabled rules
    let rules = repo::list_triage_rules(db, Some(project_id))?;
    let enabled_rules: Vec<_> = rules.into_iter().filter(|r| r.enabled).collect();

    if enabled_rules.is_empty() {
        return Ok(TriageRunOutcome::default());
    }

    // 2. Fetch pending ideas
    let ideas = repo::list_ideas(db, Some(project_id), Some("pending"), None, None, None)?;

    let mut outcome = TriageRunOutcome {
        applied: enabled_rules.len(),
        ..Default::default()
    };

    // 3. Evaluate rules against each idea (first matching rule wins)
    for idea in &ideas {
        for rule in &enabled_rules {
            if triage::evaluate_conditions(&rule.conditions, idea) {
                let accepted = rule.action == "accept";
                let rejection_reason = if accepted {
                    None
                } else {
                    Some(format!("Auto-rejected by triage rule '{}'", rule.name))
                };
                // Routed through the shared verdict core (plan 1B), so a rule
                // firing writes the same decision memory and the same
                // workspace-adoption sync a human accept/reject would.
                let verdict = if accepted {
                    IdeaVerdict::Accept
                } else {
                    IdeaVerdict::Reject {
                        reason: rejection_reason,
                    }
                };
                let _ = apply_idea_verdict_by(db, &idea.id, verdict, "TriageRule");
                // Increment times_fired
                let _ = repo::update_triage_rule(
                    db,
                    &rule.id,
                    None,
                    None,
                    None,
                    None,
                    Some(rule.times_fired + 1),
                );
                outcome.ideas_affected += 1;
                if accepted {
                    // G22: a rule may still ACCEPT a platform escalation — the
                    // verdict is a judgement about the item's merit. What it
                    // may not do is hand it to the overnight dispatcher: the
                    // fix lives in the Personas repo and the worker would be
                    // spawned in this project's checkout. Measured 2026-09-08:
                    // every such dispatch ended `FLEET:BLOCKED`.
                    if idea.scan_type != repo::PLATFORM_ESCALATION_SCAN_TYPE {
                        outcome.accepted_idea_ids.push(idea.id.clone());
                    }
                } else {
                    outcome.rejected_count += 1;
                }
                break; // first match wins
            }
        }
    }

    Ok(outcome)
}

// ============================================================================
// Pipelines (Idea-to-Execution)
// ============================================================================

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
pub fn dev_tools_get_kpi(state: State<'_, Arc<AppState>>, id: String) -> Result<DevKpi, AppError> {
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
pub fn dev_tools_delete_kpi(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
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
pub fn dev_tools_list_all_kpis(state: State<'_, Arc<AppState>>) -> Result<Vec<DevKpi>, AppError> {
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
        crate::engine::kpi_binding::execute_procedure(&state.db, &credential_id, &procedure)
            .await?;
    if let Some(mt) = kpi
        .metric_type
        .as_deref()
        .and_then(crate::engine::kpi_binding::metric_type)
    {
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
        if composed_by == "recipe" {
            "recipe"
        } else {
            "llm"
        },
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
    // -- Design system (passport automation artifact) ------------------------
    /// A root `DESIGN.md` exists — the portable location the DESIGN.md format
    /// spec (google-labs-code/design.md) defines, and the one a design-aware
    /// tool will actually look in.
    pub has_design_md: bool,
    /// That `DESIGN.md` opens with YAML frontmatter — the machine-readable
    /// token layer (colors / typography / rounded / spacing / components).
    /// Prose alone documents a system to humans; frontmatter makes it
    /// consumable by a linter or a generator, which is the rung that matters.
    pub design_md_has_tokens: bool,
    /// Design guidance exists but NOT at the spec location — e.g. a project's
    /// own `.claude/Design.md` or `docs/design.md`. Real and useful, just not
    /// portable or machine-readable. Kept distinct so the ladder never calls a
    /// documented system "none".
    pub has_informal_design_doc: bool,
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
    let elapsed = std::time::SystemTime::now()
        .duration_since(modified)
        .unwrap_or_default();
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

    let repo_candidates = [
        root.join("MEMORY.md"),
        root.join(".claude").join("MEMORY.md"),
    ];
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
                bump_age(days_since(entry.metadata()));
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

/// Design-system probe → `(has_design_md, has_tokens, has_informal_doc)`.
///
/// Three rungs, because "does this repo have a design system an agent can read"
/// is genuinely three different answers:
///   - nothing at all;
///   - guidance a human can read, somewhere the project chose (informal);
///   - a root `DESIGN.md` at the spec location — and, separately, whether it
///     carries the YAML token frontmatter that makes it machine-consumable.
///
/// Only the frontmatter rung is checkable by a tool, which is exactly why it is
/// the top of the ladder rather than "a design doc exists".
fn probe_design_system(root: &std::path::Path) -> (bool, bool, bool) {
    let design_md = root.join("DESIGN.md");
    let has_design_md = design_md.is_file();

    // Frontmatter must OPEN the file (`---` on the first non-empty line) and
    // close on a later one. Reading a bounded prefix keeps a large design doc
    // from being slurped on every wall render.
    let has_tokens = has_design_md
        && std::fs::metadata(&design_md)
            .ok()
            .filter(|m| m.len() <= 1_048_576)
            .and_then(|_| std::fs::read_to_string(&design_md).ok())
            .map(|text| {
                let mut lines = text.lines().skip_while(|l| l.trim().is_empty());
                if lines.next().map(str::trim) != Some("---") {
                    return false;
                }
                // A closing fence within a sane prefix, with at least one
                // top-level token group between the fences.
                let mut saw_group = false;
                for line in lines.take(400) {
                    let t = line.trim_end();
                    if t.trim() == "---" {
                        return saw_group;
                    }
                    if matches!(
                        t.split(':').next().map(str::trim),
                        Some("colors" | "typography" | "rounded" | "spacing" | "components")
                    ) {
                        saw_group = true;
                    }
                }
                false
            })
            .unwrap_or(false);

    // Common non-spec locations. Deliberately a short, explicit list: a wide
    // glob would match design *docs about a feature* and inflate the rung.
    let informal = [
        ".claude/Design.md",
        ".claude/DESIGN.md",
        "docs/design.md",
        "docs/DESIGN.md",
        "docs/design-system.md",
        "STYLEGUIDE.md",
        "design/README.md",
    ]
    .iter()
    .any(|rel| re_exists(root, rel));

    (has_design_md, has_tokens, informal)
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
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in rd.flatten() {
            seen += 1;
            if seen >= MAX_ENTRIES {
                break;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                if depth < MAX_DEPTH && !name.starts_with('.') {
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
        "node_modules",
        "target",
        "dist",
        "build",
        ".next",
        "vendor",
        "coverage",
        ".git",
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
                if depth < MAX_DEPTH {
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
            } else if deps.contains("next-auth")
                || deps.contains("@auth/")
                || deps.contains("authjs")
            {
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

    let (has_design_md, design_tokens, informal_design) = probe_design_system(root);
    ev.has_design_md = has_design_md;
    ev.design_md_has_tokens = design_tokens;
    ev.has_informal_design_doc = informal_design;

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
pub async fn dev_tools_get_project_favicon(root_path: String) -> Result<Option<String>, AppError> {
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
        let Ok(meta) = std::fs::metadata(&p) else {
            continue;
        };
        if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(&p) else {
            continue;
        };
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
        assert_eq!(
            encode_claude_project_dir("/home/x/repo.app"),
            "-home-x-repo-app"
        );
    }
}

/// The shared verdict core (plan 1B). The property that matters here is
/// IDEMPOTENCY: the Athena batch path writes ideas first and the approval row
/// last, so a crash between the two replays the whole batch on restart. If
/// re-applying a verdict duplicated the decision memory, every replay would
/// inflate the ledger the executor reads back into task prompts.
#[cfg(test)]
mod verdict_core_tests {
    use super::*;
    use crate::db::DbPool;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn test_pool() -> DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:verdict_core_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("pool");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).expect("migrations");
            crate::db::migrations::run_incremental(&conn).expect("incremental migrations");
        }
        pool
    }

    fn seeded_idea(pool: &DbPool) -> String {
        let project =
            repo::create_project(pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
        repo::create_finding(
            pool,
            &project.id,
            "standards_finding",
            "Avoid unwrap",
            Some("Replace unwrap with ?"),
            Some("technical"),
            None,
            None,
            Some(r#"{"count":3}"#),
            "standards:no-unwrap",
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap()
        .id
    }

    fn decision_memories(pool: &DbPool, idea_id: &str) -> i64 {
        pool.get()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM dev_memories WHERE source_kind = 'idea_decision' AND source_id = ?1",
                rusqlite::params![idea_id],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[test]
    fn re_applying_the_same_verdict_is_a_no_op_success() {
        let pool = test_pool();
        let idea_id = seeded_idea(&pool);

        let first = apply_idea_verdict(&pool, &idea_id, IdeaVerdict::Accept).unwrap();
        assert_eq!(first.status, "accepted");
        assert_eq!(decision_memories(&pool, &idea_id), 1);

        // Replay: same verdict, no error, no second memory row.
        let again = apply_idea_verdict(&pool, &idea_id, IdeaVerdict::Accept).unwrap();
        assert_eq!(again.status, "accepted");
        assert_eq!(decision_memories(&pool, &idea_id), 1);
    }

    fn decision_memory(pool: &DbPool, idea_id: &str) -> (String, i32, String) {
        try_decision_memory(pool, idea_id).expect("decision memory row")
    }

    fn try_decision_memory(
        pool: &DbPool,
        idea_id: &str,
    ) -> Result<(String, i32, String), Box<dyn std::error::Error>> {
        Ok(pool.get()?.query_row(
            "SELECT category, importance, content FROM dev_memories
                 WHERE source_kind = 'idea_decision' AND source_id = ?1",
            rusqlite::params![idea_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?)
    }

    /// A rejection used to become an importance-8 `constraint` — "do not
    /// re-surface rejected items" — whatever decided it, and nothing in the
    /// codebase ever expires or weakens one. So a machine's decline (a blocked
    /// run, a rule that read a missing score, work that turned out to be
    /// already on main) became permanent policy in the ledger every future scan
    /// and every injected prompt reads. Only the person's ruling is a
    /// constraint now; a machine's is advisory and says so.
    #[test]
    fn an_automated_rejection_is_advisory_and_a_humans_is_a_constraint() {
        // One project per pool: `seeded_idea` uses a fixed root_path, which is
        // UNIQUE.
        let pool = test_pool();

        let by_machine = seeded_idea(&pool);
        apply_idea_verdict_by(
            &pool,
            &by_machine,
            IdeaVerdict::Reject {
                reason: Some("the run could not reach the vendor API".into()),
            },
            "AppMaster",
        )
        .unwrap();
        let (category, importance, content) = decision_memory(&pool, &by_machine);
        assert_eq!(category, "decision", "a machine does not write guardrails");
        assert_eq!(importance, 5);
        assert!(
            content.contains("not a human ruling") && content.contains("advisory"),
            "the row has to say what it is: {content}"
        );
        assert!(
            !content.contains("do not re-surface"),
            "an automated decline must not read as settled policy: {content}"
        );

        let human_pool = test_pool();
        let by_human = seeded_idea(&human_pool);
        apply_idea_verdict_by(
            &human_pool,
            &by_human,
            IdeaVerdict::Reject {
                reason: Some("out of scope".into()),
            },
            ACTOR_HUMAN,
        )
        .unwrap();
        let (category, importance, content) = decision_memory(&human_pool, &by_human);
        assert_eq!(category, "constraint");
        assert_eq!(importance, 8);
        assert!(content.contains("do not re-surface"));
    }

    /// `(title, content, importance)` of one team decision memory.
    type TeamDecisionRow = (String, String, i32);

    fn team_decision_rows(pool: &DbPool, team_id: &str) -> Vec<TeamDecisionRow> {
        try_team_decision_rows(pool, team_id).expect("team decision rows")
    }

    fn try_team_decision_rows(
        pool: &DbPool,
        team_id: &str,
    ) -> Result<Vec<TeamDecisionRow>, Box<dyn std::error::Error>> {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT title, content, importance FROM team_memories
             WHERE team_id = ?1 ORDER BY title",
        )?;
        let rows = stmt.query_map(rusqlite::params![team_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// The team ledger keyed its decision row on `(team_id, title)` where the
    /// title carried the ACTOR and the VERDICT. So "Human accepted: X" and
    /// "AppMaster rejected: X" were two keys, both rows stood, and
    /// `get_for_injection` put both in front of every run — the ledger
    /// asserting two contradictory things about one item. The run decoration a
    /// bench seed used to stamp into titles multiplied that by the number of
    /// runs. One row per subject now, holding the latest verdict.
    #[test]
    fn a_later_verdict_replaces_the_teams_decision_row_instead_of_contradicting_it() {
        let pool = test_pool();
        // `team_memories.team_id` references `persona_teams`, so the team has
        // to exist — a bare id makes every team write fail its foreign key.
        let team = crate::db::repos::resources::teams::create(
            &pool,
            crate::db::models::CreateTeamInput {
                name: "Backlog team".into(),
                project_id: None,
                parent_team_id: None,
                description: None,
                canvas_data: None,
                team_config: None,
                icon: None,
                color: None,
                enabled: None,
            },
        )
        .unwrap();
        let project = repo::create_project(
            &pool,
            "P",
            "/tmp/teamed",
            None,
            None,
            None,
            None,
            Some(&team.id),
        )
        .unwrap();
        let idea_id = repo::create_finding(
            &pool,
            &project.id,
            "standards_finding",
            "Avoid unwrap [bench 2026-08-25T16-42]",
            Some("Replace unwrap with ?"),
            Some("technical"),
            None,
            None,
            Some(r#"{"count":3}"#),
            "standards:no-unwrap",
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap()
        .id;

        apply_idea_verdict_by(&pool, &idea_id, IdeaVerdict::Accept, ACTOR_HUMAN).unwrap();
        let rows = team_decision_rows(&pool, &team.id);
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].0, "backlog decision: Avoid unwrap",
            "the key is the subject — no actor, no verdict, no run decoration"
        );
        assert!(rows[0].1.contains("Human accepted"));

        apply_idea_verdict_by(
            &pool,
            &idea_id,
            IdeaVerdict::Reject {
                reason: Some("superseded".into()),
            },
            "AppMaster",
        )
        .unwrap();
        let rows = team_decision_rows(&pool, &team.id);
        assert_eq!(
            rows.len(),
            1,
            "one decision per item, not one per actor+verdict: {rows:?}"
        );
        assert!(
            rows[0].1.contains("AppMaster rejected"),
            "the row holds the LATEST verdict: {}",
            rows[0].1
        );
        assert_eq!(rows[0].2, 5, "and the automated decline's weight with it");
    }

    /// An acceptance is unchanged by actor — it is not a "don't", so it never
    /// had the problem, and weakening it would be a regression nobody asked for.
    #[test]
    fn an_acceptance_is_the_same_decision_whoever_made_it() {
        let pool = test_pool();
        let a = seeded_idea(&pool);
        apply_idea_verdict_by(&pool, &a, IdeaVerdict::Accept, "AppMaster").unwrap();
        assert_eq!(decision_memory(&pool, &a).0, "decision");
        assert_eq!(decision_memory(&pool, &a).1, 7);
    }

    #[test]
    fn re_rejecting_never_clobbers_the_original_reason() {
        let pool = test_pool();
        let idea_id = seeded_idea(&pool);

        apply_idea_verdict(
            &pool,
            &idea_id,
            IdeaVerdict::Reject {
                reason: Some("out of scope".into()),
            },
        )
        .unwrap();
        // A replay carrying no reason must not erase the one a human gave.
        let again =
            apply_idea_verdict(&pool, &idea_id, IdeaVerdict::Reject { reason: None }).unwrap();
        assert_eq!(again.status, "rejected");
        assert_eq!(again.rejection_reason.as_deref(), Some("out of scope"));
    }

    #[test]
    fn a_genuine_verdict_change_still_lands() {
        // Idempotency must not calcify: accepted → rejected is a real decision.
        let pool = test_pool();
        let idea_id = seeded_idea(&pool);
        apply_idea_verdict(&pool, &idea_id, IdeaVerdict::Accept).unwrap();
        let flipped = apply_idea_verdict(
            &pool,
            &idea_id,
            IdeaVerdict::Reject {
                reason: Some("changed our mind".into()),
            },
        )
        .unwrap();
        assert_eq!(flipped.status, "rejected");
        assert_eq!(
            flipped.rejection_reason.as_deref(),
            Some("changed our mind")
        );
    }

    // ------------------------------------------------------------------
    // Compare-and-swap
    // ------------------------------------------------------------------

    #[test]
    fn a_verdict_written_against_a_stale_status_loses_the_swap() {
        // THE failure this exists to stop: the triage deck rejects an idea —
        // which writes a `constraint` memory telling every future scan never to
        // raise it — and Approvals, still rendering the row as `pending`,
        // accepts it. Before the swap the final state was `accepted` PLUS a
        // permanent "do not raise this" constraint, and nothing warned anyone.
        let pool = test_pool();
        let idea_id = seeded_idea(&pool);

        apply_idea_verdict_cas(
            &pool,
            &idea_id,
            IdeaVerdict::Reject {
                reason: Some("out of scope".into()),
            },
            "Human",
            Some("pending"),
        )
        .unwrap();

        let err = apply_idea_verdict_cas(
            &pool,
            &idea_id,
            IdeaVerdict::Accept,
            "Human",
            Some("pending"),
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("already decided"),
            "expected a concurrency conflict, got: {err}"
        );

        let row = crate::db::repos::dev_tools::get_idea_by_id(&pool, &idea_id).unwrap();
        assert_eq!(row.status, "rejected");
        // One verdict, one decision memory — the loser fired no side effects.
        assert_eq!(decision_memories(&pool, &idea_id), 1);
    }

    #[test]
    fn a_verdict_against_the_status_the_reviewer_sees_still_lands() {
        // Reversing a decision you can SEE is a decision. Only a verdict written
        // against a status the row no longer holds is data loss.
        let pool = test_pool();
        let idea_id = seeded_idea(&pool);
        apply_idea_verdict_cas(
            &pool,
            &idea_id,
            IdeaVerdict::Accept,
            "Human",
            Some("pending"),
        )
        .unwrap();
        let flipped = apply_idea_verdict_cas(
            &pool,
            &idea_id,
            IdeaVerdict::Reject {
                reason: Some("changed our mind".into()),
            },
            "Human",
            Some("accepted"),
        )
        .unwrap();
        assert_eq!(flipped.status, "rejected");
    }

    #[test]
    fn replaying_the_same_verdict_survives_a_stale_expectation() {
        // Athena's batch path writes the idea first and the approval status
        // last, so a crash mid-flight replays a verdict the row already carries.
        // That must stay a no-op success even when the caller's expectation is
        // now stale — otherwise recovery reports a conflict against itself.
        let pool = test_pool();
        let idea_id = seeded_idea(&pool);
        apply_idea_verdict_cas(
            &pool,
            &idea_id,
            IdeaVerdict::Accept,
            "Human",
            Some("pending"),
        )
        .unwrap();
        let replay = apply_idea_verdict_cas(
            &pool,
            &idea_id,
            IdeaVerdict::Accept,
            "Human",
            Some("pending"),
        )
        .unwrap();
        assert_eq!(replay.status, "accepted");
        assert_eq!(decision_memories(&pool, &idea_id), 1);
    }
}

#[cfg(test)]
mod fleet_dispatch_cap_tests {
    //! The fleet arm admits every idea through the queue's door.
    //!
    //! Driven against a recording [`FleetArm`] double, so these tests need no
    //! Tauri app, no git worktree and no `claude` process. The seam was cut
    //! for G5's per-project cap; the cap is the queue's now, and what the
    //! tests pin is that NOTHING is held back here and that a queued
    //! admission binds its task without starting it.

    use super::*;
    use crate::commands::fleet::queue::Admission;
    use crate::commands::fleet::types::FleetSessionState;
    use personas_db::init_test_db;
    use std::sync::Mutex;

    /// Records every admission; queues the ones at index ≥ `queue_from`.
    struct RecordingArm {
        /// `(cwd, name, task_text)` of every admission, in order.
        admissions: Mutex<Vec<(String, String, String)>>,
        /// Admissions from this index on come back `Queued` (rank = index+1).
        queue_from: Option<usize>,
        /// When set, every admission fails with this message.
        fail_with: Option<String>,
    }

    impl RecordingArm {
        fn new() -> Self {
            Self {
                admissions: Mutex::new(Vec::new()),
                queue_from: None,
                fail_with: None,
            }
        }
        fn queue_from(mut self, n: usize) -> Self {
            self.queue_from = Some(n);
            self
        }
        fn count(&self) -> usize {
            self.admissions.lock().unwrap().len()
        }
    }

    #[async_trait::async_trait]
    impl FleetArm for RecordingArm {
        async fn prepare_worktree(
            &self,
            _d: &DispatchedIdea,
            root: &str,
        ) -> Result<(String, String), String> {
            Ok((format!("{root}/wt"), "personas/idea".to_string()))
        }
        async fn admit(
            &self,
            cwd: String,
            name: String,
            task_text: String,
        ) -> Result<Admission, String> {
            if let Some(ref e) = self.fail_with {
                return Err(e.clone());
            }
            let mut s = self.admissions.lock().unwrap();
            s.push((cwd, name, task_text));
            let idx = s.len() - 1;
            let queued = self.queue_from.is_some_and(|q| idx >= q);
            Ok(Admission {
                session_id: format!("sess-{}", s.len()),
                state: if queued {
                    FleetSessionState::Queued
                } else {
                    FleetSessionState::Spawning
                },
                rank: queued.then_some(idx as u32 + 1),
                cap: 2,
                running: 2,
            })
        }
    }

    fn idea(n: usize, project_id: &str) -> DispatchedIdea {
        DispatchedIdea {
            idea_id: format!("idea-{n}"),
            task_id: format!("task-{n}"),
            title: format!("Idea {n}"),
            project_id: Some(project_id.to_string()),
            project_name: Some("P".into()),
            root_path: Some("/tmp/p".into()),
            prompt: format!("do thing {n}"),
            session_id: None,
            worktree_path: None,
            branch: None,
        }
    }

    /// The shape that used to be the defect and then the cap: five ideas are
    /// five admissions, none held back here — the queue holds them.
    #[tokio::test]
    async fn every_idea_is_admitted_and_nothing_is_deferred() {
        let pool = init_test_db().unwrap();
        let arm = RecordingArm::new();
        let mut skipped = Vec::new();
        let dispatched: Vec<DispatchedIdea> = (1..=5).map(|n| idea(n, "proj-1")).collect();

        let outcome = drive_fleet_wave(&pool, &arm, dispatched, &mut skipped, false).await;

        assert_eq!(arm.count(), 5, "every idea reached the door");
        assert_eq!(outcome.settled.len(), 5);
        assert_eq!(outcome.admissions.len(), 5);
        assert!(outcome.started);
        assert!(skipped.is_empty());
        assert!(outcome.settled.iter().all(|d| d.session_id.is_some()));
        // The session is named after the idea, so the grid reads it.
        let names: Vec<String> = arm
            .admissions
            .lock()
            .unwrap()
            .iter()
            .map(|(_, n, _)| n.clone())
            .collect();
        assert_eq!(names[0], "Idea 1");
        assert_eq!(
            crate::commands::fleet::queue::summarize_admissions(&outcome.admissions),
            "admitted 5, queued 0, cap 2"
        );
    }

    /// A queued admission binds the task to its session but does not start
    /// it: the row stays `queued` until the queue's promotion hook flips it.
    #[tokio::test]
    async fn a_queued_admission_binds_the_task_without_starting_it() {
        let pool = init_test_db().unwrap();
        let project =
            repo::create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
        let running = repo::create_task(
            &pool,
            Some(&project.id),
            "starts now",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let waiting = repo::create_task(
            &pool,
            Some(&project.id),
            "waits",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let mut first = idea(1, &project.id);
        first.task_id = running.id.clone();
        let mut second = idea(2, &project.id);
        second.task_id = waiting.id.clone();

        let arm = RecordingArm::new().queue_from(1);
        let mut skipped = Vec::new();
        let outcome = drive_fleet_wave(&pool, &arm, vec![first, second], &mut skipped, false).await;

        assert!(outcome.started, "the first one started now");
        assert_eq!(
            crate::commands::fleet::queue::summarize_admissions(&outcome.admissions),
            "admitted 2, queued 1 (position 2), cap 2"
        );
        let started = repo::get_task_by_id(&pool, &running.id).unwrap();
        assert_eq!(started.status, "running");
        assert_eq!(started.session_id.as_deref(), Some("sess-1"));
        assert!(started.started_at.is_some());
        let queued = repo::get_task_by_id(&pool, &waiting.id).unwrap();
        assert_eq!(queued.status, "queued", "bound but not begun");
        assert_eq!(queued.session_id.as_deref(), Some("sess-2"));
        assert!(queued.started_at.is_none());

        // The queue promotes it: the hook the queue calls flips the row.
        assert_eq!(
            repo::mark_tasks_running_for_session(&pool, "sess-2", "2026-09-17T01:00:00Z").unwrap(),
            1
        );
        let promoted = repo::get_task_by_id(&pool, &waiting.id).unwrap();
        assert_eq!(promoted.status, "running");
        assert!(promoted.started_at.is_some());
    }

    #[tokio::test]
    async fn a_pathless_project_is_skipped_not_deferred() {
        let pool = init_test_db().unwrap();
        let arm = RecordingArm::new();
        let mut skipped = Vec::new();
        let mut d = idea(1, "proj-1");
        d.root_path = None;

        let outcome = drive_fleet_wave(&pool, &arm, vec![d], &mut skipped, false).await;

        assert_eq!(skipped.len(), 1, "waiting cannot fix a missing root_path");
        assert!(skipped[0].reason.contains("root_path"));
        assert!(outcome.admissions.is_empty());
        assert_eq!(outcome.settled.len(), 1, "the task row still exists");
    }

    #[tokio::test]
    async fn a_refused_admission_is_skipped_with_its_reason() {
        let pool = init_test_db().unwrap();
        let mut arm = RecordingArm::new();
        arm.fail_with = Some("no claude on PATH".into());
        let mut skipped = Vec::new();
        let dispatched: Vec<DispatchedIdea> = (1..=3).map(|n| idea(n, "proj-1")).collect();

        let outcome = drive_fleet_wave(&pool, &arm, dispatched, &mut skipped, false).await;

        // All three were considered: a refusal at the door is that idea's
        // verdict, not the wave's.
        assert_eq!(skipped.len(), 3);
        assert!(skipped[0].reason.contains("fleet admission failed"));
        assert!(outcome.admissions.is_empty());
        assert!(!outcome.started);
    }

    #[tokio::test]
    async fn an_unattended_wave_spawns_into_the_isolated_worktree() {
        let pool = init_test_db().unwrap();
        let arm = RecordingArm::new();
        let mut skipped = Vec::new();

        let outcome =
            drive_fleet_wave(&pool, &arm, vec![idea(1, "proj-1")], &mut skipped, true).await;

        let spawns = arm.admissions.lock().unwrap();
        assert_eq!(
            spawns[0].0, "/tmp/p/wt",
            "cwd is the worktree, not the checkout"
        );
        assert!(
            spawns[0].2.contains("personas/idea"),
            "the guardrail text names the branch"
        );
        assert_eq!(
            outcome.settled[0].worktree_path.as_deref(),
            Some("/tmp/p/wt")
        );
        assert_eq!(outcome.settled[0].branch.as_deref(), Some("personas/idea"));
    }
}
