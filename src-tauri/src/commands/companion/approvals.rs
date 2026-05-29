//! Approval queue + action executors. Phase 3 ships a small, deliberately
//! constrained action set (run_persona, resolve_human_review) that maps to
//! existing Tauri command bodies — no new privileged surface beyond what
//! the rest of the app already exposes.
//!
//! Flow:
//!   1. Athena emits `{"op": "propose_action", ...}` in her reply.
//!   2. `dispatcher::dispatch` strips the line, creates a `companion_approval`
//!      row with status='pending'.
//!   3. UI renders an approval card with the rationale + params.
//!   4. User clicks Approve → `companion_approve_action` here →
//!      status='running' → action executor → outcome appended as an episode →
//!      status='approved' or status='approved_failed' when the executor fails
//!      after approval.
//!   5. User clicks Reject → `companion_reject_action` → status='rejected'
//!      and an episode is logged with the rejection reason.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{Manager, State};

use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::session::DEFAULT_SESSION_ID;
use crate::db::models::ManualReviewStatus;
use crate::db::repos::communication::manual_reviews as manual_repo;
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

const APPROVAL_STATUS_APPROVED: &str = "approved";
const APPROVAL_STATUS_APPROVED_FAILED: &str = "approved_failed";
const APPROVAL_STATUS_RUNNING: &str = "running";
const APPROVAL_STATUS_REJECTED: &str = "rejected";

// ── Tauri-facing types ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    pub id: String,
    pub action: String,
    pub rationale: String,
    pub params_json: String,
    pub human_review_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalOutcome {
    pub id: String,
    pub status: String,
    pub message: String,
    /// Optional client-side action the frontend should perform after the
    /// approval lands. UI-only operations (route navigation, prefill) emit
    /// these instead of a backend execute. The frontend's ApprovalCard
    /// dispatches them via the appropriate Zustand store.
    pub client_action: Option<ClientAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientAction {
    /// Switch the sidebar to the given top-level section.
    Navigate { route: String },
    /// Phase F: prefill the persona creation wizard with `intent` (and
    /// optionally a name), then optionally auto-click launch. The
    /// frontend writes a slot in the system store and navigates to
    /// `personas`; UnifiedMatrixEntry consumes the slot on mount.
    ///
    /// `mode` selects the build strategy when `auto_launch` is true:
    ///   - `Some("interactive")` or `None` → ask-the-user gate flow.
    ///   - `Some("one_shot")` → autonomous build; the frontend opens
    ///     a read-only Glyph view and waits for the terminal
    ///     notification rather than driving the questionnaire.
    /// `companion_session_id` links the build back to the chat that
    /// originated it so the BuildWatcher job can post the result message
    /// into that chat's episode log on terminal phase.
    PrefillPersonaCreate {
        intent: String,
        name: Option<String>,
        auto_launch: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        companion_session_id: Option<String>,
    },
    /// Phase F: open a specific tab inside the Companion plugin. Used
    /// by `compose_dashboard` (tab="dashboard") so the user lands on
    /// the rendered result without manually navigating. Tab values
    /// match `CompanionPluginTab` on the frontend
    /// (`setup` | `memory` | `voice` | `dashboard`).
    OpenCompanionTab { tab: String },
}

/// Internal: each `execute_*` returns this so we can build either a
/// pure-message outcome (run_persona, etc.) or one carrying a client
/// action (open_route).
struct ExecuteResult {
    message: String,
    client_action: Option<ClientAction>,
}

impl ExecuteResult {
    fn message(message: String) -> Self {
        Self {
            message,
            client_action: None,
        }
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────

#[tauri::command]
pub fn companion_list_pending_approvals(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PendingApproval>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let conn = state.user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, payload, human_review_id, created_at
         FROM companion_approval
         WHERE status = 'pending'
         ORDER BY created_at DESC
         LIMIT 50",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut out = Vec::with_capacity(rows.len());
    for (id, payload, human_review_id, created_at) in rows {
        let v: serde_json::Value = serde_json::from_str(&payload).unwrap_or_default();
        out.push(PendingApproval {
            id,
            action: v
                .get("action")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .into(),
            rationale: v
                .get("rationale")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .into(),
            params_json: v
                .get("params")
                .map(|p| p.to_string())
                .unwrap_or_else(|| "{}".into()),
            human_review_id,
            created_at,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn companion_approve_action(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    approval_id: String,
) -> Result<ApprovalOutcome, AppError> {
    ipc_auth::require_auth(&state).await?;
    let (action, params) = load_pending(&state, &approval_id)?;
    let exec_result = match action.as_str() {
        "run_persona" => execute_run_persona(&state, &app, &params).await,
        "resolve_human_review" => execute_resolve_human_review(&state, &app, &params).await,
        "update_identity" => execute_update_identity(&params),
        "write_fact" => execute_write_fact(&state, &params).await,
        "delete_fact" => execute_delete_fact(&state, &params),
        // Phase D
        "write_procedural" => execute_write_procedural(&state, &params).await,
        "delete_procedural" => execute_delete_procedural(&state, &params),
        "write_goal" => execute_write_goal(&state, &params),
        "update_goal_status" => execute_update_goal_status(&state, &params),
        "delete_goal" => execute_delete_goal(&state, &params),
        "write_ritual" => execute_write_ritual(&state, &params),
        "set_ritual_active" => execute_set_ritual_active(&state, &params),
        "delete_ritual" => execute_delete_ritual(&state, &params),
        "write_backlog_item" => execute_write_backlog_item(&state, &params),
        "resolve_backlog_item" => execute_resolve_backlog_item(&state, &params),
        // Phase F — advanced UI control.
        "prefill_persona_create" => execute_prefill_persona_create(&params),
        // 2026-05-06 — autonomous build shortcut. Same ClientAction shape as
        // prefill_persona_create but defaults `auto_launch=true` and
        // `mode="one_shot"` so the prompt vocabulary cleanly separates the
        // "let me edit it first" path from the "decide everything for me"
        // path. Behavior is otherwise identical — the frontend's
        // UnifiedMatrixEntry consumes both via the same prefill slot.
        "build_oneshot" => execute_build_oneshot(&state, &app, &params).await,
        "run_arena" => execute_run_arena(&state, &app, &params).await,
        // `compose_dashboard` is now auto-fire (no approval card) —
        // handled by the dispatcher + session.rs. The executor below
        // is kept as a fallback in case an old approval row from
        // before the change still resolves through here.
        "compose_dashboard" => execute_compose_dashboard(&state, &params),
        // `use_connector` for read-only capabilities auto-fires through
        // the dispatcher → background-job worker. For write capabilities
        // (`requires_approval: true` on `ConnectorCapability`) the
        // dispatcher routes here instead, so destructive / external-
        // visible actions land behind an approval card. Athena
        // spontaneously requested this gate during the 2026-05-27
        // connector audit.
        "use_connector" => execute_use_connector(&state, &params).await,
        // Phase G — project registry + background jobs.
        "register_project" => execute_register_project(&state, &app, &params),
        "enqueue_dev_job" => execute_enqueue_dev_job(&state, &app, &params),
        "update_dev_goal" => execute_update_dev_goal(&state, &params),
        "schedule_proactive" => execute_schedule_proactive(&state, &params),
        // Phase J — Fleet integration.
        "fleet_send_input" => execute_fleet_send_input(&params),
        "fleet_broadcast" => execute_fleet_broadcast(&params),
        "fleet_kill" => execute_fleet_kill(&params),
        "fleet_spawn" => execute_fleet_spawn(&app, &params),
        "fleet_dispatch" => execute_fleet_dispatch(&app, &params),
        "fleet_intervene" => execute_fleet_intervene(&app, &params),
        "fleet_redirect_op" => execute_fleet_redirect_op(&app, &params),
        // Phase C3 — Team assignment dispatch.
        "assign_team" => execute_assign_team(&state, &app, &params).await,
        "analyze_fleet" => execute_analyze_fleet(&state, &app, &params).await,
        other => Err(AppError::Internal(format!(
            "approval `{approval_id}`: unknown action `{other}`"
        ))),
    };

    let (status_text, message, client_action, embedder_log) = match exec_result {
        Ok(r) => (
            APPROVAL_STATUS_APPROVED,
            r.message.clone(),
            r.client_action,
            format!(
                "[Athena action approved & executed] {action}\n\n{}",
                r.message
            ),
        ),
        Err(e) => {
            let m = format!("Execution failed: {e}");
            (
                APPROVAL_STATUS_APPROVED_FAILED,
                m.clone(),
                None,
                format!("[Athena action approved but failed] {action}\n\n{m}"),
            )
        }
    };

    finalize_approval(&state, &approval_id, status_text)?;
    log_action_episode(&state, &embedder_log).await;

    Ok(ApprovalOutcome {
        id: approval_id,
        status: status_text.into(),
        message,
        client_action,
    })
}

#[tauri::command]
pub async fn companion_reject_action(
    state: State<'_, Arc<AppState>>,
    approval_id: String,
    reason: Option<String>,
) -> Result<ApprovalOutcome, AppError> {
    ipc_auth::require_auth(&state).await?;
    let (action, _params) = load_pending(&state, &approval_id)?;
    finalize_approval(&state, &approval_id, APPROVAL_STATUS_REJECTED)?;
    let reason = reason.unwrap_or_else(|| "no reason given".into());
    let log = format!("[Athena action rejected] {action}\n\nReason: {reason}");
    log_action_episode(&state, &log).await;
    Ok(ApprovalOutcome {
        id: approval_id,
        status: APPROVAL_STATUS_REJECTED.into(),
        message: reason,
        client_action: None,
    })
}

// ── Goal 3: conservative autoapprove ────────────────────────────────────

/// Action kinds that auto-resolve when autonomous mode is on. Conservative
/// by design — only low-blast-radius, reversible actions land here:
/// memory writes (scoped), background scan jobs, future self-nudges.
/// External writes (`use_connector` writes — Gmail send, Discord post),
/// DB mutations (`execute_mutation`), agent creation (`build_oneshot` /
/// `prefill_persona_create`), team work (`assign_team`) ALWAYS stay
/// gated — autonomous mode does not override the user's click on those.
const AUTOAPPROVE_ALLOWLIST: &[&str] = &[
    "write_fact",
    "write_backlog_item",
    "enqueue_dev_job",
    "schedule_proactive",
];

/// If `approval.action` is on the conservative autoapprove allowlist,
/// resolve it immediately (executes the action + transitions status the
/// same way `companion_approve_action` does on a user click). Returns
/// `Ok(true)` when the approval was auto-resolved (success OR failure),
/// `Ok(false)` when it was left pending for the user.
///
/// Caller contract: only call this when autonomous mode is on (the
/// reviewer / autonomous chain already gated on the toggle; this helper
/// does NOT re-check it, so manual flows can't accidentally invoke
/// autoapprove behavior). Best-effort: a DB / executor failure surfaces
/// as an Err and the approval is left in 'running' status; the caller
/// can log + continue. Mirrors `companion_approve_action`'s structure
/// to keep the manual + auto paths in lockstep.
pub async fn auto_resolve_if_allowed(
    app: &tauri::AppHandle,
    approval: &crate::companion::dispatcher::CreatedApproval,
) -> Result<bool, AppError> {
    if !AUTOAPPROVE_ALLOWLIST.contains(&approval.action.as_str()) {
        return Ok(false);
    }
    let state = app.state::<Arc<AppState>>();
    // Same atomic pending→running transition the manual path uses.
    let (action, params) = load_pending(&state, &approval.id)?;
    // Belt-and-suspenders: re-check the loaded action matches the
    // allowlist. CreatedApproval.action and the persisted payload are
    // written together so this is unreachable in practice; if it ever
    // diverges (manual DB tampering), finalize as approved_failed
    // rather than leaving the row stuck in 'running'.
    if !AUTOAPPROVE_ALLOWLIST.contains(&action.as_str()) {
        finalize_approval(&state, &approval.id, APPROVAL_STATUS_APPROVED_FAILED)?;
        return Ok(false);
    }
    let exec_result = match action.as_str() {
        "write_fact" => execute_write_fact(&state, &params).await,
        "write_backlog_item" => execute_write_backlog_item(&state, &params),
        "enqueue_dev_job" => execute_enqueue_dev_job(&state, app, &params),
        "schedule_proactive" => execute_schedule_proactive(&state, &params),
        _ => unreachable!("allowlist mismatch"),
    };
    let (status_text, embedder_log) = match exec_result {
        Ok(r) => (
            APPROVAL_STATUS_APPROVED,
            format!(
                "[Athena action auto-approved & executed — conservative policy] {action}\n\n{}",
                r.message
            ),
        ),
        Err(e) => (
            APPROVAL_STATUS_APPROVED_FAILED,
            format!(
                "[Athena action auto-approved but failed — conservative policy] {action}\n\nExecution failed: {e}"
            ),
        ),
    };
    finalize_approval(&state, &approval.id, status_text)?;
    log_action_episode(&state, &embedder_log).await;
    Ok(true)
}

// ── helpers ─────────────────────────────────────────────────────────────

fn load_pending(
    state: &State<'_, Arc<AppState>>,
    approval_id: &str,
) -> Result<(String, serde_json::Value), AppError> {
    let conn = state.user_db.get()?;
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT status, payload FROM companion_approval WHERE id = ?1",
            params![approval_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?;
    let (status, payload) =
        row.ok_or_else(|| AppError::Internal(format!("approval `{approval_id}` not found")))?;
    if status != "pending" {
        return Err(AppError::Internal(format!(
            "approval `{approval_id}` is `{status}`, not pending"
        )));
    }
    let v: serde_json::Value = serde_json::from_str(&payload)
        .map_err(|e| AppError::Internal(format!("payload parse: {e}")))?;
    let action = v
        .get("action")
        .and_then(|x| x.as_str())
        .ok_or_else(|| AppError::Internal("payload missing `action`".into()))?
        .to_string();
    let params = v.get("params").cloned().unwrap_or(serde_json::json!({}));
    let changed = conn.execute(
        "UPDATE companion_approval
         SET status = ?1
         WHERE id = ?2 AND status = 'pending'",
        params![APPROVAL_STATUS_RUNNING, approval_id],
    )?;
    if changed == 0 {
        let latest = conn
            .query_row(
                "SELECT status FROM companion_approval WHERE id = ?1",
                params![approval_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_else(|| "missing".to_string());
        return Err(AppError::Internal(format!(
            "approval `{approval_id}` is `{latest}`, not pending"
        )));
    }
    Ok((action, params))
}

fn finalize_approval(
    state: &State<'_, Arc<AppState>>,
    approval_id: &str,
    status: &str,
) -> Result<(), AppError> {
    let conn = state.user_db.get()?;
    let changed = conn.execute(
        "UPDATE companion_approval
         SET status = ?1, resolved_at = datetime('now')
         WHERE id = ?2 AND status = ?3",
        params![status, approval_id, APPROVAL_STATUS_RUNNING],
    )?;
    if changed == 0 {
        let latest = conn
            .query_row(
                "SELECT status FROM companion_approval WHERE id = ?1",
                params![approval_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_else(|| "missing".to_string());
        return Err(AppError::Internal(format!(
            "approval `{approval_id}` could not finalize from `{latest}` to `{status}`"
        )));
    }
    Ok(())
}

/// Persist an action outcome as a system-role episode so future turns'
/// system prompt sees what happened. Best-effort — failures here just
/// mean the conversation transcript doesn't carry the action record.
async fn log_action_episode(state: &State<'_, Arc<AppState>>, content: &str) {
    let pool = &state.user_db;
    let log_result = {
        #[cfg(feature = "ml")]
        {
            match state.embedding_manager.as_ref() {
                Some(emb) => {
                    episodic::append_episode_and_embed(
                        pool,
                        emb,
                        DEFAULT_SESSION_ID,
                        EpisodeRole::System,
                        content,
                    )
                    .await
                }
                None => {
                    episodic::append_episode(pool, DEFAULT_SESSION_ID, EpisodeRole::System, content)
                }
            }
        }
        #[cfg(not(feature = "ml"))]
        {
            episodic::append_episode(pool, DEFAULT_SESSION_ID, EpisodeRole::System, content)
        }
    };
    if let Err(e) = log_result {
        tracing::warn!(error = %e, "companion: failed to log action episode");
    }
}

// ── action executors ────────────────────────────────────────────────────

async fn execute_run_persona(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let persona_id = params
        .get("persona_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("run_persona: missing `persona_id`".into()))?
        .to_string();
    let input_data = params
        .get("input")
        .and_then(|v| v.as_str())
        .map(String::from);

    // Reuse the inner executor so we don't need to re-implement spawn/log
    // wiring. The inner skips the privileged-auth check that the public
    // command does (we already authed in the approval command).
    let exec = crate::commands::execution::executions::execute_persona_inner(
        state,
        app.clone(),
        persona_id.clone(),
        /* trigger_id */ None,
        input_data.clone(),
        /* use_case_id */ None,
        /* continuation */ None,
        /* idempotency_key */ None,
        /* is_simulation */ false,
    )
    .await?;

    Ok(ExecuteResult::message(format!(
        "Started execution `{exec_id}` on persona `{persona_id}`{input_note}.",
        exec_id = exec.id,
        input_note = match input_data {
            Some(_) => " with provided input",
            None => "",
        }
    )))
}

/// Write a new identity.md, backing up the existing one. Used by the
/// onboarding interview at the end of the intake, and by reflection
/// cycles later (Phase 5).
fn execute_update_identity(params: &serde_json::Value) -> Result<ExecuteResult, AppError> {
    let content = params
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("update_identity: missing `content`".into()))?;
    let root = crate::companion::disk::brain_root()?;
    let identity_path = root.join("identity.md");
    let backup_path = root.join(format!(
        "identity.bak-{}-{}.md",
        chrono::Utc::now().format("%Y%m%dT%H%M%S%.3f"),
        uuid::Uuid::new_v4()
    ));
    if identity_path.exists() {
        std::fs::copy(&identity_path, &backup_path).map_err(|e| {
            AppError::Internal(format!(
                "update_identity: failed to back up identity.md to {}: {e}",
                backup_path.display()
            ))
        })?;
    }
    std::fs::write(&identity_path, content)?;
    Ok(ExecuteResult::message(format!(
        "identity.md updated ({} bytes). Previous version backed up to {}.",
        content.len(),
        backup_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("identity.bak-*.md")
    )))
}

async fn execute_resolve_human_review(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let review_id = params
        .get("review_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("resolve_human_review: missing `review_id`".into()))?
        .to_string();
    let decision = params
        .get("decision")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("resolve_human_review: missing `decision`".into()))?;
    let comment = params
        .get("comment")
        .and_then(|v| v.as_str())
        .map(String::from);

    let status = match decision {
        "approved" | "approve" => ManualReviewStatus::Approved,
        "rejected" | "reject" => ManualReviewStatus::Rejected,
        "resolved" | "resolve" => ManualReviewStatus::Resolved,
        other => {
            return Err(AppError::Internal(format!(
                "resolve_human_review: invalid decision `{other}` (expected approved/rejected/resolved)"
            )))
        }
    };

    // Mirror the body of `update_manual_review_status` (without re-entering
    // the Tauri command boundary). The same repo + event emit live here.
    manual_repo::update_status(&state.db, &review_id, status, comment.clone())?;
    let _ = app; // event emit handled by the original command path; we keep this minimal.

    Ok(ExecuteResult::message(format!(
        "Human Review `{review_id}` marked `{}`{comment_note}.",
        status.as_str(),
        comment_note = match comment {
            Some(_) => " with a comment",
            None => "",
        }
    )))
}

// open_route is intentionally NOT in this match — it's auto-fired
// by the dispatcher via `companion://navigate` events (no approval
// card) so chat-driven nav stays smooth. The `ClientAction::Navigate`
// variant is preserved on `ApprovalOutcome` for future approval-gated
// UI ops (e.g., `prefill_persona_create` once that's wired).

/// Persist a semantic fact. Provenance was already validated at
/// dispatch time (write_fact requires non-empty `sources`), so this
/// path can trust the params shape.
async fn execute_write_fact(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let scope_str = params
        .get("scope")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("write_fact: missing `scope`".into()))?;
    let scope = crate::companion::brain::semantic::FactScope::parse(scope_str)?;
    let key = params
        .get("key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("write_fact: missing `key`".into()))?;
    let value = params
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("write_fact: missing `value`".into()))?;
    let sources: Vec<String> = params
        .get("sources")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if sources.is_empty() {
        return Err(AppError::Internal(
            "write_fact: `sources` must be a non-empty array of episode_id strings".into(),
        ));
    }
    let importance = params
        .get("importance")
        .and_then(|v| v.as_i64())
        .unwrap_or(3) as i32;
    let confidence = params
        .get("confidence")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.8) as f32;
    let supersedes = params.get("supersedes_id").and_then(|v| v.as_str());
    let contradicts = params.get("contradicts_id").and_then(|v| v.as_str());

    let input = crate::companion::brain::semantic::FactInput {
        scope,
        key,
        value,
        sources: &sources,
        importance,
        confidence,
        supersedes_id: supersedes,
        contradicts_id: contradicts,
    };

    let pool = &state.user_db;
    let id = {
        #[cfg(feature = "ml")]
        {
            match state.embedding_manager.as_ref() {
                Some(emb) => {
                    crate::companion::brain::semantic::write_fact_and_embed(pool, emb, &input)
                        .await?
                }
                None => crate::companion::brain::semantic::write_fact(pool, &input)?,
            }
        }
        #[cfg(not(feature = "ml"))]
        {
            crate::companion::brain::semantic::write_fact(pool, &input)?
        }
    };

    Ok(ExecuteResult::message(format!(
        "Fact `{id}` written to `{}/{key}` (importance {importance}, {n} source(s)).",
        scope.as_str(),
        n = sources.len()
    )))
}

/// Move a fact to `semantic/_deleted/`. Rare — most "wrong" facts get
/// superseded instead, which preserves the historical record.
fn execute_delete_fact(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("delete_fact: missing `id`".into()))?;
    crate::companion::brain::semantic::delete_fact(&state.user_db, id)?;
    Ok(ExecuteResult::message(format!(
        "Fact `{id}` archived to `semantic/_deleted/`."
    )))
}

// ── Phase D executors ───────────────────────────────────────────────────

async fn execute_write_procedural(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    use crate::companion::brain::procedural;
    let scope = procedural::ProceduralScope::parse(
        params
            .get("scope")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Internal("write_procedural: missing `scope`".into()))?,
    )?;
    let trigger = params
        .get("trigger")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("write_procedural: missing `trigger`".into()))?;
    let behavior = params
        .get("behavior")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("write_procedural: missing `behavior`".into()))?;
    let sources: Vec<String> = params
        .get("sources")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if sources.is_empty() {
        return Err(AppError::Internal(
            "write_procedural: `sources` must be a non-empty array of episode_id strings".into(),
        ));
    }
    let importance = params
        .get("importance")
        .and_then(|v| v.as_i64())
        .unwrap_or(3) as i32;
    let confidence = params
        .get("confidence")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.8) as f32;
    let supersedes = params.get("supersedes_id").and_then(|v| v.as_str());
    let input = procedural::ProceduralInput {
        scope,
        trigger,
        behavior,
        sources: &sources,
        importance,
        confidence,
        supersedes_id: supersedes,
    };
    let id = {
        #[cfg(feature = "ml")]
        {
            match state.embedding_manager.as_ref() {
                Some(emb) => procedural::write_rule_and_embed(&state.user_db, emb, &input).await?,
                None => procedural::write_rule(&state.user_db, &input)?,
            }
        }
        #[cfg(not(feature = "ml"))]
        {
            procedural::write_rule(&state.user_db, &input)?
        }
    };
    Ok(ExecuteResult::message(format!(
        "Procedural rule `{id}` written under `{}/{}` (importance {}, {} source(s)).",
        scope.as_str(),
        trigger,
        importance,
        sources.len()
    )))
}

fn execute_delete_procedural(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("delete_procedural: missing `id`".into()))?;
    crate::companion::brain::procedural::delete_rule(&state.user_db, id)?;
    Ok(ExecuteResult::message(format!(
        "Procedural `{id}` archived to `procedurals/_deleted/`."
    )))
}

fn execute_write_goal(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    use crate::companion::brain::goals;
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("write_goal: missing `title`".into()))?;
    let description = params
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let priority = params.get("priority").and_then(|v| v.as_i64()).unwrap_or(3) as i32;
    let target_date = params.get("target_date").and_then(|v| v.as_str());
    let sources: Vec<String> = params
        .get("sources")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let id = goals::write_goal(
        &state.user_db,
        &goals::GoalInput {
            title,
            description,
            priority,
            target_date,
            sources: &sources,
        },
    )?;
    Ok(ExecuteResult::message(format!(
        "Goal `{id}` recorded: \"{}\" (priority {}).",
        title, priority
    )))
}

/// Goals hub — apply an Athena-proposed dev-goal update (approval-gated; never
/// auto-approved). Updates status/progress on the main-DB `dev_goals` row and
/// records an `athena_update` signal so the change shows in the goal's feed.
fn execute_update_dev_goal(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    use crate::db::repos::dev_tools as dt;
    let goal_id = params
        .get("goal_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("update_dev_goal: missing `goal_id`".into()))?;
    let status = params.get("status").and_then(|v| v.as_str());
    let progress = params
        .get("progress")
        .and_then(|v| v.as_i64())
        .map(|n| n.clamp(0, 100) as i32);
    let note = params.get("note").and_then(|v| v.as_str());
    if status.is_none() && progress.is_none() {
        return Err(AppError::Internal(
            "update_dev_goal: nothing to update (need `status` and/or `progress`)".into(),
        ));
    }
    dt::update_goal(
        &state.db, goal_id, None, None, status, progress, None, None, None, None,
    )?;
    let summary = note.map(str::to_string).unwrap_or_else(|| {
        let mut parts = Vec::new();
        if let Some(s) = status {
            parts.push(format!("status → {s}"));
        }
        if let Some(p) = progress {
            parts.push(format!("progress → {p}%"));
        }
        format!("Athena updated goal ({})", parts.join(", "))
    });
    let _ = dt::create_goal_signal(&state.db, goal_id, "athena_update", None, progress, Some(&summary));
    Ok(ExecuteResult::message(format!(
        "Dev goal `{goal_id}` updated — {summary}."
    )))
}

/// Spawn a proactive Athena turn that reviews the whole fleet (or one team)
/// against the certification rubric — the post-certification "are the teams on
/// track?" analysis. Athena gathers current state from her observability digest
/// + connectors, recalls her prior per-team note (timeline continuity), writes
/// an updated note, and proposes improvements via her normal approval-gated ops.
async fn execute_analyze_fleet(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let team = params.get("team_id").and_then(|v| v.as_str());
    let days = params
        .get("days")
        .and_then(|v| v.as_i64())
        .unwrap_or(14)
        .clamp(1, 90);
    spawn_fleet_analysis(state, app, team, days);
    let scope = team
        .map(|t| format!("team `{t}`"))
        .unwrap_or_else(|| "the whole fleet".into());
    Ok(ExecuteResult::message(format!(
        "Fleet analysis started — Athena is reviewing {scope} over the last {days}d and will report back here."
    )))
}

/// Compact per-team execution digest from the OPERATIONAL store (state.db),
/// embedded in the directive so the turn reasons over real numbers. Best-effort:
/// any query failure degrades to a short note rather than aborting the turn.
fn gather_fleet_digest(db: &crate::db::DbPool, team: Option<&str>, days: i64) -> String {
    let conn = match db.get() {
        Ok(c) => c,
        Err(e) => return format!("(fleet data unavailable: {e})"),
    };
    let window = format!("-{days} days");
    let all_teams: Vec<(String, String)> = match conn
        .prepare("SELECT id, name FROM persona_teams WHERE COALESCE(enabled,1)=1 ORDER BY name")
    {
        Ok(mut stmt) => stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    let teams: Vec<(String, String)> = all_teams
        .into_iter()
        .filter(|(id, name)| {
            team.map_or(true, |t| {
                t == id || name.to_lowercase().contains(&t.to_lowercase())
            })
        })
        .collect();
    if teams.is_empty() {
        return "(no matching teams in the operational store)".to_string();
    }
    let mut out = format!("## Fleet data — operational store (personas.db), last {days}d\n");
    for (id, name) in teams {
        let short = &id[..id.len().min(8)];
        let agg = conn.query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN status IN ('failed','error','timeout') THEN 1 ELSE 0 END),
                    SUM(CASE WHEN business_outcome='value_delivered' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN business_outcome='partial' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN business_outcome='precondition_failed' THEN 1 ELSE 0 END),
                    COALESCE(SUM(cost_usd),0),
                    AVG(director_score)
             FROM persona_executions
             WHERE COALESCE(is_simulation,0)=0
               AND created_at >= datetime('now', ?1)
               AND persona_id IN (
                 SELECT id FROM personas WHERE home_team_id = ?2
                 UNION SELECT persona_id FROM persona_team_members WHERE team_id = ?2
               )",
            params![window, id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1).unwrap_or(0),
                    r.get::<_, i64>(2).unwrap_or(0),
                    r.get::<_, i64>(3).unwrap_or(0),
                    r.get::<_, i64>(4).unwrap_or(0),
                    r.get::<_, f64>(5).unwrap_or(0.0),
                    r.get::<_, Option<f64>>(6).unwrap_or(None),
                ))
            },
        );
        // Goal-linked via EITHER a team_assignment's goal_id OR a goal on the
        // team's pinned dev_project (the natural association — a team works its
        // repo; goals live on the project, not the assignment).
        let assignment_goals: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM team_assignments ta JOIN dev_goals g ON g.id = ta.goal_id WHERE ta.team_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let project_id: Option<String> = {
            let mut found = None;
            if let Ok(mut stmt) = conn.prepare(
                "SELECT design_context FROM personas WHERE (home_team_id = ?1 OR id IN (SELECT persona_id FROM persona_team_members WHERE team_id = ?1)) AND design_context IS NOT NULL",
            ) {
                if let Ok(rows) = stmt.query_map(params![id], |r| r.get::<_, String>(0)) {
                    for dc in rows.flatten() {
                        if let Ok(j) = serde_json::from_str::<serde_json::Value>(&dc) {
                            if let Some(p) = j
                                .get("dev_project_id")
                                .or_else(|| j.get("devProjectId"))
                                .and_then(|v| v.as_str())
                            {
                                found = Some(p.to_string());
                                break;
                            }
                        }
                    }
                }
            }
            found
        };
        // Goal ENGAGEMENT (extended scope): is a team_assignment actively
        // advancing a goal, and how are the goal's breakdown to-dos progressing?
        let advancing = assignment_goals > 0;
        let mut goal_summ: Vec<String> = Vec::new();
        if let Some(pid) = project_id.as_deref() {
            if let Ok(mut stmt) = conn.prepare(
                "SELECT id, title, status, COALESCE(progress,0) FROM dev_goals WHERE project_id = ?1 ORDER BY created_at DESC LIMIT 5",
            ) {
                if let Ok(rows) = stmt.query_map(params![pid], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                    ))
                }) {
                    for (gid, title, status, progress) in rows.flatten() {
                        let (td, tt): (i64, i64) = conn
                            .query_row(
                                "SELECT COALESCE(SUM(done),0), COUNT(*) FROM dev_goal_items WHERE goal_id = ?1",
                                params![gid],
                                |r| Ok((r.get(0)?, r.get(1)?)),
                            )
                            .unwrap_or((0, 0));
                        let blk: i64 = conn
                            .query_row(
                                "SELECT COUNT(*) FROM dev_goal_dependencies WHERE goal_id = ?1",
                                params![gid],
                                |r| r.get(0),
                            )
                            .unwrap_or(0);
                        let blk_s = if blk > 0 { format!(", {blk} blocker(s)") } else { String::new() };
                        let t: String = title.chars().take(40).collect();
                        goal_summ.push(format!("\"{t}\" {status} {progress}% (to-dos {td}/{tt}{blk_s})"));
                    }
                }
            }
        }
        let last_signal: Option<String> = project_id.as_deref().and_then(|pid| {
            conn.query_row(
                "SELECT s.signal_type FROM dev_goal_signals s JOIN dev_goals g ON g.id = s.goal_id WHERE g.project_id = ?1 ORDER BY s.created_at DESC LIMIT 1",
                params![pid],
                |r| r.get::<_, String>(0),
            )
            .ok()
        });
        let goal_state = if goal_summ.is_empty() {
            "goal: NONE".to_string()
        } else {
            let mode = if advancing { "ADVANCING" } else { "has-goal/NOT-advancing" };
            let sig = last_signal.map(|s| format!(" · last-goal-signal {s}")).unwrap_or_default();
            format!("goal [{mode}]: {}{sig}", goal_summ.join("; "))
        };
        match agg {
            Ok((total, failed, vd, partial, pf, cost, dir)) => {
                // Director score + band (mirrors the Director command-center banding
                // so the digest carries the same quality semantics, not a bare number).
                let dir_s = dir
                    .map(|d| {
                        let band = if d >= 4.0 {
                            "excellent"
                        } else if d >= 3.0 {
                            "healthy"
                        } else if d >= 2.0 {
                            "at-risk"
                        } else {
                            "broken"
                        };
                        format!("{d:.1}/5 ({band})")
                    })
                    .unwrap_or_else(|| "— (unrated)".into());
                out.push_str(&format!(
                    "- **{name}** (`{short}`): {total} exec · {failed} failed · vd {vd} · partial {partial} · precond {pf} · ${cost:.2} · director {dir_s} · {goal_state}\n",
                ));
            }
            Err(_) => out.push_str(&format!("- **{name}** (`{short}`): (no execution data) · {goal_state}\n")),
        }
    }
    out
}

/// The directive handed to the proactive fleet-analysis turn. The per-team data
/// is pre-gathered (`gather_fleet_digest`) and embedded, so Athena reasons over
/// real numbers instead of trying to fetch them via the wrong-DB connector.
fn build_fleet_directive(team: Option<&str>, days: i64, digest: &str) -> String {
    let scope = match team {
        Some(t) => format!("the team `{t}`"),
        None => "every active team (the whole fleet)".to_string(),
    };
    format!(
        "Run a fleet analysis of {scope} over the last {days} days. You are the \
         post-certification analyst: the user is letting all teams run and needs to not \
         lose control.\n\n\
         The per-team data is ALREADY GATHERED for you below, from the OPERATIONAL store. \
         Reason over THIS — do NOT try to fetch it via a connector (your personas_database \
         connector points at the companion-brain DB, not the execution store):\n\n\
         {digest}\n\n\
         For each team, assess against these certification dimensions: (1) GOAL ENGAGEMENT \
         (the focus this round) — is a team_assignment ACTIVELY ADVANCING the goal, or does \
         the goal just sit on the project ('has-goal/NOT-advancing')? How complete are the \
         goal's breakdown to-dos (the `to-dos X/Y` per goal)? Is it blocked (blocker count)? \
         When did the team last touch it (`last-goal-signal`)? 'has-goal/NOT-advancing', \
         '0 to-dos done', or no recent goal signal are real gaps — call them out and propose \
         a fix. (2) value delivery — value-delivered vs partial / precond-failed; (3) health \
         — failures; (4) cost + outliers; (5) portfolio balance. Then: (a) recall any prior \
         fleet-analysis note \
         from your memory for timeline continuity (did last round's gap get fixed?); \
         (b) write a concise per-team timeline note via write_fact (scope the fact to the \
         team) so the next review builds on this one; (c) propose at most a few concrete \
         improvements (update_dev_goal, a template/roster fix, a persona to add) as your \
         approval-gated ops. Ground every claim in the data above. If a team is healthy and \
         nothing changed since your last note, say so in one line."
    )
}

/// Shared spawn used by both the approval-gated `analyze_fleet` op executor and
/// the direct `companion_analyze_fleet` command (the skill button). Spawns a
/// proactive turn carrying the fleet-analysis directive.
fn spawn_fleet_analysis(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    team: Option<&str>,
    days: i64,
) {
    // Pre-gather per-team data from the OPERATIONAL store (state.db) and embed
    // it in the directive. Athena's personas_database connector points at the
    // companion-brain DB, not the execution store, so asking her to fetch it
    // fails — we supply it instead.
    let digest = gather_fleet_digest(&state.db, team, days);
    let directive = build_fleet_directive(team, days, &digest);
    crate::companion::session::spawn_proactive_turn(
        app.clone(),
        std::sync::Arc::new(state.user_db.clone()),
        std::sync::Arc::new(state.db.clone()),
        #[cfg(feature = "ml")]
        state.embedding_manager.clone(),
        "fleet_analysis".to_string(),
        team.map(str::to_string),
        directive,
    );
}

/// Direct, deterministic fleet-analysis trigger for the "Analyze fleet" skill
/// button. Unlike a chat message — which Athena can reasonably shortcut to an
/// inline read from her observability digest — this ALWAYS spawns the
/// rubric-graded proactive turn that writes the per-team timeline note (the
/// continuity that is the whole point). The button click is the consent, so
/// there is no approval gate.
#[tauri::command]
pub fn companion_analyze_fleet(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    team_id: Option<String>,
    days: Option<i64>,
) -> Result<String, AppError> {
    let days = days.unwrap_or(14).clamp(1, 90);
    spawn_fleet_analysis(&state, &app, team_id.as_deref(), days);
    Ok("Fleet analysis started.".to_string())
}

fn execute_update_goal_status(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    use crate::companion::brain::goals;
    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("update_goal_status: missing `id`".into()))?;
    let status_str = params
        .get("status")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("update_goal_status: missing `status`".into()))?;
    let status = goals::GoalStatus::parse(status_str)?;
    goals::update_status(&state.user_db, id, status)?;
    Ok(ExecuteResult::message(format!(
        "Goal `{id}` → `{}`.",
        status.as_str()
    )))
}

fn execute_delete_goal(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("delete_goal: missing `id`".into()))?;
    crate::companion::brain::goals::delete_goal(&state.user_db, id)?;
    Ok(ExecuteResult::message(format!(
        "Goal `{id}` archived to `goals/_deleted/`."
    )))
}

fn execute_write_ritual(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    use crate::companion::brain::rituals;
    let kind = rituals::RitualKind::parse(
        params
            .get("kind")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Internal("write_ritual: missing `kind`".into()))?,
    )?;
    let description = params
        .get("description")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("write_ritual: missing `description`".into()))?;
    // schedule may arrive as object or string; normalize to JSON string.
    let schedule_json = match params.get("schedule") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => {
            return Err(AppError::Internal(
                "write_ritual: missing `schedule`".into(),
            ))
        }
    };
    let sources: Vec<String> = params
        .get("sources")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let id = rituals::write_ritual(
        &state.user_db,
        &rituals::RitualInput {
            kind,
            description,
            schedule_json: &schedule_json,
            sources: &sources,
        },
    )?;
    Ok(ExecuteResult::message(format!(
        "Ritual `{id}` (`{}`) recorded.",
        kind.as_str()
    )))
}

fn execute_set_ritual_active(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("set_ritual_active: missing `id`".into()))?;
    let active = params
        .get("active")
        .and_then(|v| v.as_bool())
        .ok_or_else(|| AppError::Internal("set_ritual_active: missing `active` (bool)".into()))?;
    crate::companion::brain::rituals::set_active(&state.user_db, id, active)?;
    Ok(ExecuteResult::message(format!(
        "Ritual `{id}` {}.",
        if active { "enabled" } else { "paused" }
    )))
}

fn execute_delete_ritual(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("delete_ritual: missing `id`".into()))?;
    crate::companion::brain::rituals::delete_ritual(&state.user_db, id)?;
    Ok(ExecuteResult::message(format!(
        "Ritual `{id}` archived to `rituals/_deleted/`."
    )))
}

fn execute_write_backlog_item(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    use crate::companion::brain::backlog;
    let kind = backlog::BacklogKind::parse(
        params
            .get("kind")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Internal("write_backlog_item: missing `kind`".into()))?,
    )?;
    let summary = params
        .get("summary")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("write_backlog_item: missing `summary`".into()))?;
    let source_episode_id = params.get("source_episode_id").and_then(|v| v.as_str());
    let id = backlog::write_item(
        &state.user_db,
        &backlog::BacklogInput {
            kind,
            summary,
            source_episode_id,
        },
    )?;
    Ok(ExecuteResult::message(format!(
        "Backlog item `{id}` (`{}`) recorded.",
        kind.as_str()
    )))
}

fn execute_resolve_backlog_item(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("resolve_backlog_item: missing `id`".into()))?;
    let dropped = params
        .get("dropped")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    crate::companion::brain::backlog::resolve_item(&state.user_db, id, dropped)?;
    Ok(ExecuteResult::message(format!(
        "Backlog item `{id}` → `{}`.",
        if dropped { "dropped" } else { "done" }
    )))
}

// ── Phase F executors ───────────────────────────────────────────────────

/// Prefill the persona-creation wizard. The actual UI work happens
/// frontend-side via the `PrefillPersonaCreate` client action — this
/// executor just validates params and emits the action so a single
/// click on the approval card lands the user on personas/ with the
/// intent box filled (and optionally launches the build).
fn execute_prefill_persona_create(params: &serde_json::Value) -> Result<ExecuteResult, AppError> {
    let intent = params
        .get("intent")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("prefill_persona_create: missing `intent`".into()))?
        .trim();
    if intent.is_empty() {
        return Err(AppError::Internal(
            "prefill_persona_create: `intent` must not be empty".into(),
        ));
    }
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string());
    let auto_launch = params
        .get("auto_launch")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let mode = params
        .get("mode")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let companion_session_id = params
        .get("companion_session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Ok(ExecuteResult {
        message: if auto_launch {
            "Opening persona creation with your intent and starting the build.".to_string()
        } else {
            "Opening persona creation with your intent prefilled — review and launch when ready."
                .to_string()
        },
        client_action: Some(ClientAction::PrefillPersonaCreate {
            intent: intent.to_string(),
            name,
            auto_launch,
            mode,
            companion_session_id,
        }),
    })
}

/// Cheap server-side draft name from an intent. The one-shot build's design
/// pass renames the persona from its agent_ir once it resolves, so this is only
/// the placeholder label the row carries while the build is in flight.
fn derive_build_name(intent: &str) -> String {
    let mut n: String = intent.split_whitespace().take(5).collect::<Vec<_>>().join(" ");
    if n.chars().count() > 40 {
        n = n.chars().take(40).collect();
    }
    if n.trim().is_empty() {
        "New Persona".to_string()
    } else {
        n
    }
}

/// Autonomous-build shortcut ("decide everything for me, ping me when done").
///
/// Unlike `prefill_persona_create` (interactive — the frontend opens the create
/// screen for the user to review, then they launch), `build_oneshot` must run
/// unattended. The original implementation returned a `PrefillPersonaCreate`
/// client action with `auto_launch=true` and relied on `UnifiedBuildEntry`
/// being MOUNTED to consume the prefill and fire the launch — so when the user
/// was looking at the chat panel (the common case) the build silently never
/// started. (Verified 2026-05-26: three `build_oneshot` approvals produced zero
/// build_sessions, while interactive prefills built fine.)
///
/// The fix: start the build SERVER-SIDE here — create the draft persona and
/// kick off a headless one-shot build session via the same engine path
/// `start_build_session_headless` uses (no per-call Channel; progress flows on
/// the global `build-session-event` emit + `get_build_status`). The returned
/// client action is now a plain `Navigate` to Personas so the user can watch —
/// NOT a prefill+auto_launch, which would double-build if the screen mounts.
async fn execute_build_oneshot(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let intent = params
        .get("intent")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("build_oneshot: missing `intent`".into()))?
        .trim()
        .to_string();
    if intent.is_empty() {
        return Err(AppError::Internal(
            "build_oneshot: `intent` must not be empty".into(),
        ));
    }
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| derive_build_name(&intent));
    let companion_session_id = params
        .get("companion_session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 1. Create the draft persona (mirrors UnifiedBuildEntry.handleLaunch's
    //    create step) so the build does not depend on the create screen.
    let description: String = intent.chars().take(200).collect();
    let persona = crate::db::repos::core::personas::create(
        &state.db,
        crate::db::models::CreatePersonaInput {
            name,
            system_prompt: "You are a helpful AI assistant.".to_string(),
            project_id: None,
            description: Some(description),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: Some(true),
            max_concurrent: None,
            timeout_ms: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            notification_channels: None,
        },
    )?;

    // 2. Start the one-shot build headlessly. No-op Channel: events fire on the
    //    global emit stream, exactly like start_build_session_headless.
    let session_id = uuid::Uuid::new_v4().to_string();
    let dummy_channel: tauri::ipc::Channel<serde_json::Value> =
        tauri::ipc::Channel::new(|_response| Ok(()));
    state.build_session_manager.start_session(
        session_id,
        persona.id.clone(),
        intent,
        dummy_channel,
        state.db.clone(),
        state.process_registry.clone(),
        None,
        None,
        app.clone(),
        None,
        Some("one_shot".to_string()),
        companion_session_id,
    )?;

    Ok(ExecuteResult {
        message:
            "Building autonomously now — I'll let you know when it's ready (or surface what blocked it). Opening Personas so you can watch."
                .to_string(),
        client_action: Some(ClientAction::Navigate {
            route: "personas".to_string(),
        }),
    })
}

/// Run an arena pass directly via `lab_start_arena` so the user gets
/// the result in the lab tab without Athena having to script the UI.
/// `models` is the JSON shape the lab Tauri command expects (an array
/// of `ModelTestConfig`); we forward it verbatim after a shape check.
async fn execute_run_arena(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let persona_id = params
        .get("persona_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("run_arena: missing `persona_id`".into()))?
        .to_string();
    let models = params
        .get("models")
        .ok_or_else(|| AppError::Internal("run_arena: missing `models`".into()))?
        .clone();
    if !models.is_array() || models.as_array().map_or(true, |a| a.is_empty()) {
        return Err(AppError::Internal(
            "run_arena: `models` must be a non-empty array of ModelTestConfig".into(),
        ));
    }
    let use_case_filter = params
        .get("use_case_filter")
        .and_then(|v| v.as_str())
        .map(String::from);

    // Forward to the existing `lab_start_arena` Tauri command. The
    // command itself is just an async fn we can call directly — no
    // IPC round-trip needed. Models is already a JSON Value array;
    // we deserialize into Vec<Value> for the parser inside the lab
    // command (which calls `parse_model_configs` next).
    let started_at = chrono::Utc::now().to_rfc3339();
    let models_vec: Vec<serde_json::Value> = models.as_array().cloned().unwrap_or_default();
    crate::commands::execution::lab::lab_start_arena(
        state.clone(),
        app.clone(),
        persona_id.clone(),
        models_vec,
        use_case_filter.clone(),
    )
    .await?;

    let n_models = models.as_array().map(|a| a.len()).unwrap_or(0);
    Ok(ExecuteResult {
        message: format!(
            "Arena started for persona `{persona_id}` with {n_models} model(s) at {started_at}. \
             Watch progress in the lab tab."
        ),
        // Bonus UX: emit an open_lab navigation so the user lands on
        // the arena view automatically.
        client_action: None,
    })
}

/// Persist a dashboard composition (singleton). The spec is stored as
/// markdown body on a single `companion_node` row with kind='dashboard'
/// and id='dashboard'. Replacing it overwrites the spec; the frontend
/// re-renders on the next dashboard tab open.
fn execute_compose_dashboard(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let widgets = params
        .get("widgets")
        .ok_or_else(|| AppError::Internal("compose_dashboard: missing `widgets`".into()))?;
    if !widgets.is_array() {
        return Err(AppError::Internal(
            "compose_dashboard: `widgets` must be an array".into(),
        ));
    }
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Athena dashboard");
    let now = chrono::Utc::now().to_rfc3339();
    let spec = serde_json::json!({
        "title": title,
        "widgets": widgets,
        "updated_at": now,
    });
    let spec_str = spec.to_string();

    crate::companion::brain::dashboard::save_dashboard(&state.user_db, &spec_str)?;

    let n = widgets.as_array().map(|a| a.len()).unwrap_or(0);
    Ok(ExecuteResult {
        message: format!(
            "Dashboard composition saved with {n} widget(s) — opening it for you now."
        ),
        client_action: Some(ClientAction::OpenCompanionTab {
            tab: "dashboard".into(),
        }),
    })
}

/// Generic connector capability dispatch. Validates the connector is
/// pinned + enabled and that the capability is registered for that
/// service-type, then routes to a per-connector handler.
///
/// v1: per-connector handlers return a clear "stub" message rather
/// than calling the actual API. This is a deliberate two-step rollout —
/// the awareness/intent surface (this executor + the prompt block)
/// proves out the conversation shape *before* we invest in real API
/// wiring per connector. The user gets a coherent reply ("listed 5
/// Sentry issues — wiring in flight, here's what I would have shown
/// you") rather than the prior "this connector cannot be used" dead
/// end.
async fn execute_use_connector(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let connector_name = params
        .get("connector_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("use_connector: missing `connector_name`".into()))?;
    let capability = params
        .get("capability")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("use_connector: missing `capability`".into()))?;
    let args = params.get("args").cloned().unwrap_or(serde_json::json!({}));

    // 1. Connector must be pinned + enabled in the sidebar.
    let active = crate::companion::connectors::list(&state.user_db)?;
    let row = active
        .iter()
        .find(|c| c.connector_name == connector_name)
        .ok_or_else(|| {
            AppError::Internal(format!(
                "use_connector: `{connector_name}` is not pinned in the sidebar"
            ))
        })?;
    if !row.enabled {
        return Err(AppError::Internal(format!(
            "use_connector: `{connector_name}` is pinned but disabled — toggle it on first"
        )));
    }

    // 2. Capability must be registered for this service-type.
    let caps = crate::companion::connectors::capabilities_for(connector_name).ok_or_else(|| {
        AppError::Internal(format!(
            "use_connector: `{connector_name}` has no registered capabilities yet — wiring in flight"
        ))
    })?;
    let _cap = caps.iter().find(|c| c.slug == capability).ok_or_else(|| {
        let known: Vec<&str> = caps.iter().map(|c| c.slug).collect();
        AppError::Internal(format!(
            "use_connector: capability `{capability}` is not in `{connector_name}`'s registry. \
             Known: {known:?}"
        ))
    })?;

    // 3. Dispatch through the same per-service handler the auto-fire
    // job worker uses. This way read/write capabilities both share one
    // implementation path; only the *routing* (auto-fire vs approval-
    // card) differs based on `requires_approval`. Pre-2026-05-27 this
    // was a stub — Athena's audit run flagged the silent gap.
    //
    // Zero-config builtins (local_drive, personas_database) have no
    // credential — pass an empty HashMap so the handler can read from
    // pool / managed root directly. The handler must be defensive about
    // empty fields anyway (required_field reports a clean error).
    // Credentials live in `state.db` (persona_credentials table), NOT
    // `state.user_db` (companion brain). Using the wrong pool surfaces
    // as "no such table: persona_credentials" — caught during the
    // 2026-05-27 tier-2 audit run.
    let fields = match crate::db::repos::resources::credentials::get_by_service_type(
        &state.db,
        connector_name,
    )?
    .into_iter()
    .next()
    {
        Some(cred) => crate::db::repos::resources::credentials::get_decrypted_fields(
            &state.db,
            &cred,
        )?,
        None => std::collections::HashMap::new(),
    };
    let result = crate::companion::jobs::connector_use::dispatch_capability_public(
        &state.user_db,
        connector_name,
        capability,
        &args,
        &fields,
    )
    .await?;
    Ok(ExecuteResult::message(result))
}

/// Phase G: register a new project in the companion's known-project
/// registry. Idempotent on `path` — re-registering the same path
/// updates name/description without erroring.
fn execute_register_project(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("register_project: missing `name`".into()))?;
    let path = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("register_project: missing `path`".into()))?;
    let description = params.get("description").and_then(|v| v.as_str());
    // 1. Companion project registry (Athena's awareness / scan-status tracking).
    let id = crate::companion::projects::register(&state.user_db, name, path, description)?;

    // 2. Real Dev Tools project (`dev_projects` row). THIS is what satisfies the
    //    `codebase` connector for adopted personas — the connector probes
    //    `dev_projects`, not the companion registry. Without it, registering a
    //    project left teams' codebase connector unsatisfied. Idempotent on
    //    root_path (UNIQUE): reuse an existing row rather than erroring.
    let existing_id: Option<String> = {
        let conn = state.db.get()?;
        conn.query_row(
            "SELECT id FROM dev_projects WHERE root_path = ?1",
            rusqlite::params![path],
            |r| r.get(0),
        )
        .ok()
    };

    let (dev_project_id, scan_note) = match existing_id {
        Some(eid) => (
            eid,
            "(already a Dev Tools project — re-using it; trigger a rescan if the code changed)"
                .to_string(),
        ),
        None => {
            let tech = params.get("tech_stack").and_then(|v| v.as_str());
            let github = params.get("github_url").and_then(|v| v.as_str());
            let project = crate::db::repos::dev_tools::create_project(
                &state.db,
                name,
                path,
                description,
                Some("active"),
                tech,
                github,
                None,
            )?;
            // 3. Auto-launch the real context scan (Claude-CLI → dev_contexts) so
            //    the team's codebase tools return rich results. Best-effort: a
            //    bad path / missing CLI logs and continues; the project + codebase
            //    connector are already valid.
            let scan_note = match crate::commands::infrastructure::context_generation::launch_context_scan(
                app.clone(),
                &state.db,
                &project,
                path,
                false,
            ) {
                Ok(_) => "(context scan started — its structure will be mapped in the background)"
                    .to_string(),
                Err(e) => {
                    tracing::warn!(project = %project.id, error = %e, "register_project: auto-scan launch failed (continuing)");
                    format!("(couldn't auto-start the context scan: {e} — start it manually from Dev Tools)")
                }
            };
            (project.id, scan_note)
        }
    };

    Ok(ExecuteResult::message(format!(
        "Project `{name}` is set up — registered in your project list and created as Dev Tools \
         project `{dev_project_id}` so the codebase connector is now available for any team \
         working this repo at `{path}`. {scan_note}"
    )))
}

/// `enqueue_dev_job` — run a real Dev Tools **context scan** on a registered
/// project. This is the precise "scan / map the codebase" operation: it launches
/// the same Claude-CLI context generation as `dev_tools_scan_codebase`
/// (populating dev_context_groups + dev_contexts), NOT a shallow file-walk and
/// NOT an agent build. Returns immediately; the scan runs in the background and
/// reports on completion. It does not create or modify any persona.
fn execute_enqueue_dev_job(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let kind = params
        .get("kind")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("enqueue_dev_job: missing `kind`".into()))?;
    if kind != "scan_codebase" {
        return Err(AppError::Internal(format!(
            "enqueue_dev_job: unknown kind `{kind}` (supported: scan_codebase)"
        )));
    }
    // Resolve the target Dev Tools project. Accept ANY of project_id / path /
    // project name (Athena may send several); try each. Path comparison is
    // slash-normalized because a stored root_path uses OS separators (Windows
    // backslashes) while the chat passes forward slashes. Fall back to the
    // most-recently-registered project when nothing is specified.
    let p = params.get("params").cloned().unwrap_or(serde_json::json!({}));
    let mut candidates: Vec<String> = Vec::new();
    for v in [
        params.get("project_id").and_then(|v| v.as_str()),
        p.get("project_id").and_then(|v| v.as_str()),
        p.get("project_name").and_then(|v| v.as_str()),
        p.get("name").and_then(|v| v.as_str()),
        p.get("path").and_then(|v| v.as_str()),
        params.get("path").and_then(|v| v.as_str()),
    ]
    .into_iter()
    .flatten()
    {
        let v = v.trim();
        if !v.is_empty() && !candidates.iter().any(|c| c == v) {
            candidates.push(v.to_string());
        }
    }

    let project_id: String = {
        let conn = state.db.get()?;
        let mut found: Option<String> = None;
        for n in &candidates {
            if let Ok(id) = conn.query_row(
                "SELECT id FROM dev_projects \
                 WHERE id = ?1 OR name = ?1 \
                    OR replace(root_path, '\\', '/') = replace(?1, '\\', '/') \
                 ORDER BY (id = ?1) DESC LIMIT 1",
                rusqlite::params![n],
                |r| r.get::<_, String>(0),
            ) {
                found = Some(id);
                break;
            }
        }
        // Two fallback layers:
        //   1. Athena passed no candidates → use most-recent project.
        //   2. Athena passed candidates but none matched (typically a stale
        //      project_id she carried over from a prior session's
        //      observability digest) → fall back to most-recent project AND
        //      record the mismatch so the success message names what we
        //      actually scanned. This keeps the user's "kick off a scan"
        //      ask from silently no-op'ing when the ID rotted.
        if found.is_none() {
            found = conn
                .query_row(
                    "SELECT id FROM dev_projects ORDER BY created_at DESC LIMIT 1",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .ok();
        }
        match found {
            Some(id) => id,
            None => {
                return Err(AppError::Validation(
                    "No Dev Tools projects registered yet. Register one first with \
                     register_project (name + filesystem path)."
                        .into(),
                ))
            }
        }
    };
    let project = crate::db::repos::dev_tools::get_project_by_id(&state.db, &project_id)?;
    let stale_id_note = if !candidates.is_empty()
        && !candidates.iter().any(|c| c == &project.id || c == &project.name)
    {
        format!(
            " (note: requested {:?} didn't match any project — using the most-recently-registered one)",
            candidates
        )
    } else {
        String::new()
    };
    let delta = p.get("delta_mode").and_then(|v| v.as_bool()).unwrap_or(false);

    crate::commands::infrastructure::context_generation::launch_context_scan(
        app.clone(),
        &state.db,
        &project,
        &project.root_path,
        delta,
    )?;
    Ok(ExecuteResult::message(format!(
        "Context scan started for `{}` (`{}`){}. Claude is mapping its structure — business-domain \
         groups + per-feature contexts — in the background; I'll report when it lands. This is a \
         code-structure scan only: it does NOT build or change any agent.",
        project.name, project.root_path, stale_id_note
    )))
}

/// Athena's `schedule_proactive` approval — persist a future-dated row in
/// `companion_proactive_message`. The deliver-due sweep
/// (`proactive::deliver_due_scheduled`, called from
/// `companion_evaluate_proactive_now`) releases it when the time arrives.
fn execute_schedule_proactive(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("schedule_proactive: missing `message`".into()))?;
    let when_iso = params
        .get("when_iso")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Internal("schedule_proactive: missing `when_iso` (ISO8601 UTC)".into())
        })?;
    // Parse + revalidate the timestamp so a malformed string fails the
    // approval at execution time rather than silently stranding the row
    // forever (the sweep query just compares strings — a non-ISO value
    // would never match). chrono accepts both RFC3339 and ISO8601 with
    // `Z` / offset suffixes, which is the shape Athena's prompt
    // documents.
    let parsed = chrono::DateTime::parse_from_rfc3339(when_iso).map_err(|e| {
        AppError::Internal(format!(
            "schedule_proactive: `when_iso` ({when_iso}) is not RFC3339 — {e}"
        ))
    })?;
    let now = chrono::Utc::now();
    if parsed.with_timezone(&chrono::Utc) <= now {
        return Err(AppError::Internal(format!(
            "schedule_proactive: `when_iso` ({when_iso}) is in the past"
        )));
    }
    let canonical = parsed
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let msg = crate::companion::proactive::insert_scheduled(&state.user_db, message, &canonical)?;
    Ok(ExecuteResult::message(format!(
        "Scheduled check-in `{id}` for {canonical}: \"{preview}\"",
        id = msg.id,
        preview = if message.chars().count() > 80 {
            format!(
                "{}…",
                message.chars().take(79).collect::<String>()
            )
        } else {
            message.to_string()
        }
    )))
}

// ── Phase J — Fleet dispatcher executors ────────────────────────────
//
// All four hit the fleet's in-process registry directly; no IPC
// roundtrip. Each returns a human-readable message that lands as a
// system episode so Athena can quote it on the next turn.

fn execute_fleet_send_input(params: &serde_json::Value) -> Result<ExecuteResult, AppError> {
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_send_input: missing `session_id`".into()))?;
    let text = params
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_send_input: missing `text`".into()))?;
    let press_enter = params
        .get("press_enter")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let payload = if press_enter {
        format!("{text}\r")
    } else {
        text.to_string()
    };
    crate::commands::fleet::registry::registry()
        .write_input(session_id, payload.as_bytes())
        .map_err(AppError::Internal)?;
    Ok(ExecuteResult::message(format!(
        "Sent {} bytes to fleet session `{}`.",
        payload.len(),
        &session_id[..session_id.len().min(8)],
    )))
}

fn execute_fleet_broadcast(params: &serde_json::Value) -> Result<ExecuteResult, AppError> {
    let target = params
        .get("target")
        .and_then(|v| v.as_str())
        .unwrap_or("all_waiting");
    let text = params
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_broadcast: missing `text`".into()))?;
    let press_enter = params
        .get("press_enter")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let payload = if press_enter {
        format!("{text}\r")
    } else {
        text.to_string()
    };

    let snapshot = crate::commands::fleet::registry::registry().list_dto();
    let mut targets: Vec<String> = match target {
        "all_waiting" => snapshot
            .iter()
            .filter(|s| s.state == crate::commands::fleet::types::FleetSessionState::AwaitingInput)
            .map(|s| s.id.clone())
            .collect(),
        "all" => snapshot
            .iter()
            .filter(|s| s.state != crate::commands::fleet::types::FleetSessionState::Exited)
            .map(|s| s.id.clone())
            .collect(),
        "ids" => params
            .get("ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default(),
        other => {
            return Err(AppError::Internal(format!(
                "fleet_broadcast: unknown target `{other}` (use all_waiting | all | ids)"
            )));
        }
    };
    targets.dedup();
    if targets.is_empty() {
        return Ok(ExecuteResult::message(
            "fleet_broadcast: no sessions matched the target (nothing sent).".into(),
        ));
    }

    let mut ok = 0;
    let mut failed = 0;
    for sid in &targets {
        match crate::commands::fleet::registry::registry().write_input(sid, payload.as_bytes()) {
            Ok(()) => ok += 1,
            Err(_) => failed += 1,
        }
    }
    Ok(ExecuteResult::message(format!(
        "Broadcast delivered to {ok}/{total} fleet session{plural}{fail_note}.",
        total = targets.len(),
        plural = if targets.len() == 1 { "" } else { "s" },
        fail_note = if failed > 0 {
            format!(" ({failed} failed)")
        } else {
            String::new()
        },
    )))
}

fn execute_fleet_kill(params: &serde_json::Value) -> Result<ExecuteResult, AppError> {
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_kill: missing `session_id`".into()))?;
    // Soft-kill (PTY EOF). Future hard-kill (Child::kill) is a Phase 6
    // enhancement in the fleet module itself.
    let ok = crate::commands::fleet::registry::registry().close_pty_handles(session_id);
    if !ok {
        return Err(AppError::Internal(format!(
            "fleet_kill: session `{session_id}` not found"
        )));
    }
    Ok(ExecuteResult::message(format!(
        "Closed fleet session `{}` (soft kill — PTY EOF sent).",
        &session_id[..session_id.len().min(8)],
    )))
}

fn execute_fleet_spawn(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let cwd = params
        .get("cwd")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("fleet_spawn: missing `cwd`".into()))?;
    let args: Vec<String> = params
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    let cols = params.get("cols").and_then(|v| v.as_u64()).unwrap_or(120) as u16;
    let rows = params.get("rows").and_then(|v| v.as_u64()).unwrap_or(32) as u16;

    let id = crate::commands::fleet::pty::spawn_session(
        app.clone(),
        std::path::PathBuf::from(cwd),
        args,
        cols,
        rows,
    )
    .map_err(AppError::Internal)?;

    // Recursion guard sentinel: tag this session with the user-visible
    // name "athena" so it's obvious in the fleet UI which sessions are
    // Athena-spawned. The proactive evaluator can grow a "skip if name
    // == 'athena'" branch in Phase E without changing the FleetSession
    // schema. Public rename() preserves the optimistic-update path.
    let _ = crate::commands::fleet::registry::registry().rename(&id, Some("athena".to_string()));

    Ok(ExecuteResult::message(format!(
        "Spawned fleet session `{}` in `{}`. Tagged \"athena\" for visibility.",
        &id[..id.len().min(8)],
        cwd,
    )))
}

/// D5 v2 — `fleet_dispatch`: one ApprovalCard, N sessions under one
/// Operation. Athena creates the Operation upfront, spawns each role
/// as its own claude session (PTY), pre-attaches the SessionRef so the
/// op carries every session even before the first hook fires. The
/// reconciler in `commands::companion::fleet_bridge` synthesizes the
/// cross-session wrap-up once all dispatched sessions have exited.
///
/// `params` shape:
/// ```json
/// {
///   "operation_intent": "add tests for login flow",
///   "role_specs": [
///     { "role": "writer", "cwd": "C:/path/to/project", "args": [] },
///     { "role": "reviewer", "cwd": "C:/path/to/project", "args": [] }
///   ]
/// }
/// ```
/// Test-only public wrapper around `execute_fleet_dispatch` so the
/// real-claude E2E spec can fire a dispatch without going through the
/// approval pipeline. Returns the human-readable message that the
/// approval flow would otherwise surface.
#[cfg(feature = "test-automation")]
pub fn test_only_execute_fleet_dispatch(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<String, AppError> {
    execute_fleet_dispatch(app, params).map(|r| r.message)
}

fn execute_fleet_dispatch(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let intent = params
        .get("operation_intent")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_dispatch: missing `operation_intent`".into()))?;
    let specs = params
        .get("role_specs")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Internal("fleet_dispatch: missing `role_specs`".into()))?;
    if specs.is_empty() {
        return Err(AppError::Internal(
            "fleet_dispatch: role_specs must not be empty".into(),
        ));
    }
    if specs.len() > 8 {
        return Err(AppError::Internal(
            "fleet_dispatch: role_specs capped at 8 sessions per operation".into(),
        ));
    }

    // Create the operation in operative memory before spawning any
    // sessions — this way even if a spawn fails partway through, the
    // op exists and the reconciler can finalize from whatever sessions
    // did make it. dispatched_by_athena=true so the proactive evaluator
    // can skip nudging sessions Athena herself spawned.
    let op_id = crate::companion::orchestration::operative_memory::memory()
        .begin_dispatched_operation(intent.to_string());

    let mut spawned: Vec<(String, String)> = Vec::new(); // (session_id_prefix, role)
    let mut failures: Vec<String> = Vec::new();

    for (i, spec) in specs.iter().enumerate() {
        let role = spec
            .get("role")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("role-{i}"));
        let cwd = match spec.get("cwd").and_then(|v| v.as_str()) {
            Some(c) => c,
            None => {
                failures.push(format!("role `{role}`: missing `cwd`"));
                continue;
            }
        };
        let args: Vec<String> = spec
            .get("args")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let cols = spec.get("cols").and_then(|v| v.as_u64()).unwrap_or(120) as u16;
        let rows = spec.get("rows").and_then(|v| v.as_u64()).unwrap_or(32) as u16;

        let id = match crate::commands::fleet::pty::spawn_session(
            app.clone(),
            std::path::PathBuf::from(cwd),
            args,
            cols,
            rows,
        ) {
            Ok(id) => id,
            Err(e) => {
                failures.push(format!("role `{role}`: spawn failed: {e}"));
                continue;
            }
        };

        // Pre-attach SessionRef on the op so the reconciler sees this
        // session immediately, even before the SessionStart hook fires.
        let _ = crate::companion::orchestration::operative_memory::memory()
            .attach_session_to_operation(&op_id, &id, &role, cwd);

        // Visible-name = "athena-<role>" so the user sees both the
        // recursion-guard sentinel AND the role in the Fleet UI.
        let _ = crate::commands::fleet::registry::registry()
            .rename(&id, Some(format!("athena-{role}")));

        spawned.push((id[..id.len().min(8)].to_string(), role));
    }

    if spawned.is_empty() {
        return Err(AppError::Internal(format!(
            "fleet_dispatch: every spawn failed.\n{}",
            failures.join("\n"),
        )));
    }

    // D7 — fresh dispatched op + attached sessions; nudge the
    // live-ops strip to re-fetch.
    crate::companion::orchestration::emit_digest_changed(app);

    let mut msg = format!(
        "Dispatched operation `{intent}` (op_id `{}`) across {} session(s):",
        &op_id[..op_id.len().min(8)],
        spawned.len(),
    );
    for (id8, role) in &spawned {
        msg.push_str(&format!("\n  - `{id8}` ({role})"));
    }
    if !failures.is_empty() {
        msg.push_str("\nFailures:");
        for f in &failures {
            msg.push_str(&format!("\n  ⚠ {f}"));
        }
    }
    msg.push_str(
        "\n\nThe reconciler will synthesize a wrap-up summary once \
every session in this operation has exited.",
    );

    Ok(ExecuteResult::message(msg))
}

/// D9 — `fleet_intervene`: write a guidance message into a running
/// session's PTY stdin. Capped at one intervention per session via
/// operative_memory tracking — second invocation refuses with a
/// reason. The session sees the message text + a newline (so its
/// REPL processes it as a turn).
///
/// `params`: `{ session_id: string, message: string }`. Used by the
/// proactive evaluator's stuck-session detector — see
/// `proactive/fleet_triggers.rs`. The user approves before this
/// fires; auto-fire would be too aggressive at this maturity.
fn execute_fleet_intervene(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let session_id = params
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_intervene: missing `session_id`".into()))?;
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_intervene: missing `message`".into()))?;

    // Cap check + bookkeeping first. If we already intervened, refuse
    // before touching the PTY — easier to debug a clean refusal than
    // a no-op write.
    crate::companion::orchestration::operative_memory::memory()
        .record_intervention(session_id)
        .map_err(|e| AppError::Internal(format!("fleet_intervene: {e}")))?;

    let bytes = format!("{message}\n");
    crate::commands::fleet::registry::registry()
        .write_input(session_id, bytes.as_bytes())
        .map_err(|e| AppError::Internal(format!("fleet_intervene: PTY write failed: {e}")))?;

    crate::companion::orchestration::emit_digest_changed(app);

    Ok(ExecuteResult::message(format!(
        "Intervention delivered to session `{}`. Message: {message}",
        &session_id[..session_id.len().min(8)],
    )))
}

/// D9 — `fleet_redirect_op`: update the operation's user_intent +
/// broadcast a redirection message to every active (non-Exited)
/// session in the op. Useful when Athena spots that the whole op is
/// going in a wrong direction (not just one session).
///
/// `params`: `{ op_id: string, new_intent: string, message?: string }`.
/// `message` defaults to a synthesized "New direction: {new_intent}"
/// when omitted. Each broadcast counts as an intervention against its
/// session — the per-session cap still applies, so a session that's
/// already been intervened on is skipped (logged).
fn execute_fleet_redirect_op(
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let op_id = params
        .get("op_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_redirect_op: missing `op_id`".into()))?;
    let new_intent = params
        .get("new_intent")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("fleet_redirect_op: missing `new_intent`".into()))?;
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("New direction from Athena: {new_intent}"));

    let mem = crate::companion::orchestration::operative_memory::memory();
    if !mem.redirect_operation(op_id, new_intent) {
        return Err(AppError::Internal(format!(
            "fleet_redirect_op: operation `{op_id}` not found in operative memory",
        )));
    }
    let targets = mem.op_active_sessions(op_id);
    if targets.is_empty() {
        crate::companion::orchestration::emit_digest_changed(app);
        return Ok(ExecuteResult::message(format!(
            "Updated op `{op}` intent to \"{new_intent}\". No active sessions to broadcast to.",
            op = &op_id[..op_id.len().min(8)],
        )));
    }

    let mut delivered: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    for sid in &targets {
        match mem.record_intervention(sid) {
            Ok(()) => {
                let bytes = format!("{message}\n");
                if let Err(e) = crate::commands::fleet::registry::registry()
                    .write_input(sid, bytes.as_bytes())
                {
                    skipped.push(format!("`{}` PTY write failed: {e}", &sid[..sid.len().min(8)]));
                    continue;
                }
                delivered.push(format!("`{}`", &sid[..sid.len().min(8)]));
            }
            Err(reason) => {
                skipped.push(format!("`{}` skipped: {reason}", &sid[..sid.len().min(8)]));
            }
        }
    }

    crate::companion::orchestration::emit_digest_changed(app);

    let mut msg = format!(
        "Redirected op `{op}` to \"{new_intent}\". Broadcast to {} session(s).",
        delivered.len(),
        op = &op_id[..op_id.len().min(8)],
    );
    if !delivered.is_empty() {
        msg.push_str(&format!("\nDelivered: {}", delivered.join(", ")));
    }
    if !skipped.is_empty() {
        msg.push_str("\nSkipped:");
        for s in &skipped {
            msg.push_str(&format!("\n  ⚠ {s}"));
        }
    }
    Ok(ExecuteResult::message(msg))
}

// ----------------------------------------------------------------------------
// Phase C3 — assign_team (Athena dispatcher op → orchestrator entry)
// ----------------------------------------------------------------------------

/// Handle the `assign_team` op when the user approves it. Reads
/// `team_id` + `goal` + optional `title` from params, then delegates to
/// the shared `companion_assign_team_inner` helper (same path the
/// `companion_assign_team` Tauri command uses).
async fn execute_assign_team(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let team_id = params
        .get("team_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("assign_team: missing `team_id`".into()))?
        .to_string();
    let goal = params
        .get("goal")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("assign_team: missing `goal`".into()))?
        .to_string();
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .map(String::from);

    let result = crate::commands::teams::assignments::companion_assign_team_inner(
        state,
        app.clone(),
        team_id.clone(),
        goal.clone(),
        title,
    )
    .await?;

    Ok(ExecuteResult::message(format!(
        "Dispatched assignment `{}` to team `{}` (op `{}`). The team will run the goal in parallel; results land in the title-bar notification center on failure, and the assignments panel shows live progress.",
        &result.assignment_id[..result.assignment_id.len().min(8)],
        &team_id[..team_id.len().min(8)],
        &result.companion_op_id[..result.companion_op_id.len().min(8)],
    )))
}
