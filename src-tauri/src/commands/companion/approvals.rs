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
//!      action executor → outcome appended as an episode → status='approved'.
//!   5. User clicks Reject → `companion_reject_action` → status='rejected'
//!      and an episode is logged with the rejection reason.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::session::DEFAULT_SESSION_ID;
use crate::db::models::ManualReviewStatus;
use crate::db::repos::communication::manual_reviews as manual_repo;
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

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
    let outcome_msg = match action.as_str() {
        "run_persona" => execute_run_persona(&state, &app, &params).await,
        "resolve_human_review" => execute_resolve_human_review(&state, &app, &params).await,
        "update_identity" => execute_update_identity(&params),
        other => Err(AppError::Internal(format!(
            "approval `{approval_id}`: unknown action `{other}`"
        ))),
    };

    let (status_text, message, embedder_log) = match outcome_msg {
        Ok(msg) => (
            "approved",
            msg.clone(),
            format!("[Athena action approved & executed] {action}\n\n{msg}"),
        ),
        Err(e) => {
            let m = format!("Execution failed: {e}");
            (
                "approved", // user approved; execution failed separately. Mark approved.
                m.clone(),
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
    finalize_approval(&state, &approval_id, "rejected")?;
    let reason = reason.unwrap_or_else(|| "no reason given".into());
    let log = format!("[Athena action rejected] {action}\n\nReason: {reason}");
    log_action_episode(&state, &log).await;
    Ok(ApprovalOutcome {
        id: approval_id,
        status: "rejected".into(),
        message: reason,
    })
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
    let (status, payload) = row.ok_or_else(|| {
        AppError::Internal(format!("approval `{approval_id}` not found"))
    })?;
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
    Ok((action, params))
}

fn finalize_approval(
    state: &State<'_, Arc<AppState>>,
    approval_id: &str,
    status: &str,
) -> Result<(), AppError> {
    let conn = state.user_db.get()?;
    conn.execute(
        "UPDATE companion_approval SET status = ?1, resolved_at = datetime('now') WHERE id = ?2",
        params![status, approval_id],
    )?;
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
                None => episodic::append_episode(
                    pool,
                    DEFAULT_SESSION_ID,
                    EpisodeRole::System,
                    content,
                ),
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
) -> Result<String, AppError> {
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

    Ok(format!(
        "Started execution `{exec_id}` on persona `{persona_id}`{input_note}.",
        exec_id = exec.id,
        input_note = match input_data {
            Some(_) => " with provided input",
            None => "",
        }
    ))
}

/// Write a new identity.md, backing up the existing one. Used by the
/// onboarding interview at the end of the intake, and by reflection
/// cycles later (Phase 5).
fn execute_update_identity(params: &serde_json::Value) -> Result<String, AppError> {
    let content = params
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("update_identity: missing `content`".into()))?;
    let root = crate::companion::disk::brain_root()?;
    let identity_path = root.join("identity.md");
    let backup_path = root.join(format!(
        "identity.bak-{}.md",
        chrono::Utc::now().format("%Y%m%dT%H%M%S")
    ));
    if identity_path.exists() {
        let _ = std::fs::copy(&identity_path, &backup_path);
    }
    std::fs::write(&identity_path, content)?;
    Ok(format!(
        "identity.md updated ({} bytes). Previous version backed up to {}.",
        content.len(),
        backup_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("identity.bak-*.md")
    ))
}

async fn execute_resolve_human_review(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<String, AppError> {
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

    Ok(format!(
        "Human Review `{review_id}` marked `{}`{comment_note}.",
        status.as_str(),
        comment_note = match comment {
            Some(_) => " with a comment",
            None => "",
        }
    ))
}
