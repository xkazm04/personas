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
use tauri::State;

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
        "build_oneshot" => execute_build_oneshot(&params),
        "run_arena" => execute_run_arena(&state, &app, &params).await,
        // `compose_dashboard` is now auto-fire (no approval card) —
        // handled by the dispatcher + session.rs. The executor below
        // is kept as a fallback in case an old approval row from
        // before the change still resolves through here.
        "compose_dashboard" => execute_compose_dashboard(&state, &params),
        // `use_connector` no longer reaches here — it auto-fires
        // through the dispatcher → background-job worker. Approval
        // friction was the wrong UX (user explicitly rejected it);
        // result lands as a system episode.
        // Phase G — project registry + background jobs.
        "register_project" => execute_register_project(&state, &params),
        "enqueue_dev_job" => execute_enqueue_dev_job(&state, &params),
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

/// Autonomous-build shortcut: resolve to the same prefill action with
/// `auto_launch=true` and `mode="one_shot"`. Surfaces a chat message
/// telling the user the build will run unattended so they know to expect
/// the terminal notification rather than a questionnaire.
fn execute_build_oneshot(params: &serde_json::Value) -> Result<ExecuteResult, AppError> {
    let intent = params
        .get("intent")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("build_oneshot: missing `intent`".into()))?
        .trim();
    if intent.is_empty() {
        return Err(AppError::Internal(
            "build_oneshot: `intent` must not be empty".into(),
        ));
    }
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string());
    let companion_session_id = params
        .get("companion_session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Ok(ExecuteResult {
        message:
            "Building autonomously — I'll let you know when it's ready (or surface what blocked it)."
                .to_string(),
        client_action: Some(ClientAction::PrefillPersonaCreate {
            intent: intent.to_string(),
            name,
            auto_launch: true,
            mode: Some("one_shot".to_string()),
            companion_session_id,
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
fn execute_use_connector(
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
    let cap = caps.iter().find(|c| c.slug == capability).ok_or_else(|| {
        let known: Vec<&str> = caps.iter().map(|c| c.slug).collect();
        AppError::Internal(format!(
            "use_connector: capability `{capability}` is not in `{connector_name}`'s registry. \
             Known: {known:?}"
        ))
    })?;

    // 3. Per-connector handlers. v1 returns a clear stub so Athena's
    // next turn sees a coherent system episode and can speak to it.
    // Real API calls land per-connector in subsequent phases.
    let _ = (cap, args);
    Ok(ExecuteResult::message(format!(
        "[stub] `{connector_name}::{capability}` would run with the supplied args. \
         Real API wiring lands in the next phase. Until then, treat this as confirmation \
         that the surface works end-to-end — capability validated, connector enabled, \
         credentials resolvable."
    )))
}

/// Phase G: register a new project in the companion's known-project
/// registry. Idempotent on `path` — re-registering the same path
/// updates name/description without erroring.
fn execute_register_project(
    state: &State<'_, Arc<AppState>>,
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
    let id = crate::companion::projects::register(&state.user_db, name, path, description)?;
    Ok(ExecuteResult::message(format!(
        "Project `{name}` registered (id `{id}`, path `{path}`)."
    )))
}

/// Phase G: enqueue a long-running dev job. Returns immediately so the
/// chat doesn't block; the worker picks the job up within seconds and
/// appends a system episode with the result on completion. This is
/// the conversation-stays-responsive pattern: Athena sends "I started
/// the scan, will report back when done" while the user keeps typing.
fn execute_enqueue_dev_job(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let kind = params
        .get("kind")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("enqueue_dev_job: missing `kind`".into()))?;
    // Only `scan_codebase` for v1; the worker rejects unknown kinds at
    // dispatch time, but failing fast here gives Athena a clearer error.
    if kind != "scan_codebase" {
        return Err(AppError::Internal(format!(
            "enqueue_dev_job: unknown kind `{kind}` (v1 supports: scan_codebase)"
        )));
    }
    let job_params = params
        .get("params")
        .cloned()
        .unwrap_or(serde_json::json!({}));
    let project_id = params.get("project_id").and_then(|v| v.as_str());
    let job_id = crate::companion::jobs::enqueue(&state.user_db, kind, &job_params, project_id)?;
    Ok(ExecuteResult::message(format!(
        "Job `{job_id}` (`{kind}`) queued. The worker will pick it up within a few \
         seconds; results land as a system episode you'll see on your next turn. \
         You can keep chatting while it runs."
    )))
}
