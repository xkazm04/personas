//! `approval_lifecycle` — part of the approval module family (split from the
//! former approvals.rs god file, 2026-07-24). Shared imports, status
//! consts and the Tauri-facing types live in `mod.rs`; siblings are
//! reachable through the parent's glob re-exports.

#[allow(unused_imports)]
use super::*;

// ── Tauri commands ──────────────────────────────────────────────────────

#[tauri::command]
pub fn companion_list_pending_approvals(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PendingApproval>, AppError> {
    ipc_auth::require_auth_sync(&state)?;
    let conn = state.user_db.get()?;
    // Only surface approvals within the consent-freshness window — a pending
    // approval older than this is stale and must not be presented as actionable.
    let mut stmt = conn.prepare(
        "SELECT id, payload, human_review_id, created_at
         FROM companion_approval
         WHERE status = 'pending' AND created_at >= datetime('now', ?1)
         ORDER BY created_at DESC
         LIMIT 50",
    )?;
    let rows = stmt
        .query_map(params![APPROVAL_FRESHNESS_WINDOW], |row| {
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
        // Skip corrupt/empty payloads instead of unwrap_or_default()-ing them
        // into a card with a blank action — that rendered an *actionable*
        // approval (the user can click Approve) whose action is "", a consent
        // surface showing a no-op as if it were a real decision.
        let v: serde_json::Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(approval_id = %id, error = %e, "skipping approval with unparseable payload");
                continue;
            }
        };
        let action = v.get("action").and_then(|x| x.as_str()).unwrap_or("").trim();
        if action.is_empty() {
            tracing::warn!(approval_id = %id, "skipping approval with no action (would render a blank actionable card)");
            continue;
        }
        out.push(PendingApproval {
            id,
            action: action.to_string(),
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
        "companion_breed_personas" => execute_companion_breed_personas(&state, &app, &params).await,
        "companion_evolve_persona" => execute_companion_evolve_persona(&state, &app, &params).await,
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
        "open_test_env" => execute_open_test_env(&state, &app, &params),
        "update_dev_goal" => execute_update_dev_goal(&state, &params),
        // KPI layer — outcome steering on the user's behalf.
        "calibrate_kpi" => execute_calibrate_kpi(&state, &params),
        "evaluate_kpi" => execute_evaluate_kpi(&state, &params).await,
        "scan_kpis" => execute_scan_kpis(&state, &app, &params),
        "propose_kpi" => execute_propose_kpi(&state, &app, &params),
        "schedule_proactive" => execute_schedule_proactive(&state, &params),
        // Phase J — Fleet integration.
        "fleet_send_input" => execute_fleet_send_input(&app, &params),
        "fleet_broadcast" => execute_fleet_broadcast(&params),
        "fleet_kill" => execute_fleet_kill(&params),
        "fleet_spawn" => execute_fleet_spawn(&app, &params),
        "fleet_dispatch" => execute_fleet_dispatch(&app, &params),
        "fleet_intervene" => execute_fleet_intervene(&app, &params),
        "fleet_redirect_op" => execute_fleet_redirect_op(&app, &params),
        "fleet_wake" => execute_fleet_wake(&app, &params).await,
        "fleet_resume" => execute_fleet_resume(&app, &params).await,
        // DEV MODE — self-development loop. Deliberately NOT on the
        // autoapprove allowlist: every dev-mode operation is an explicit
        // user click (see dispatcher.rs ALLOWED_ACTIONS notes).
        "dev_improve" => execute_dev_improve(&state, &app, &params),
        "dev_merge" => execute_dev_merge(&state, &params),
        // Phase C3 — Team assignment dispatch.
        "assign_team" => execute_assign_team(&state, &app, &params).await,
        "analyze_fleet" => execute_analyze_fleet(&state, &app, &params).await,
        "run_browser_test" => execute_run_browser_test(&state, &app, &params),
        // Team-channel orchestration (C2) — Athena posts into a team channel.
        "post_team_message" => execute_post_team_message(&state, &params),
        other => Err(AppError::Internal(format!(
            "approval `{approval_id}`: unknown action `{other}`"
        ))),
    };

    // Both the outcome shown on the approval card (`message`) and the persisted
    // chat episode (`embedder_log`) carry the plain, humanized result — no
    // `[Athena action ...] <op>` machine prefix, no raw op name. Developer detail
    // (op name, error) goes to the trace, not to the user.
    let (status_text, message, client_action, embedder_log) = match exec_result {
        Ok(r) => {
            let m = r.message;
            (APPROVAL_STATUS_APPROVED, m.clone(), r.client_action, m)
        }
        Err(e) => {
            tracing::warn!(action = %action, error = %e, "companion: approved action failed");
            let m = format!("Sorry, I couldn't finish that. ({e})");
            (APPROVAL_STATUS_APPROVED_FAILED, m.clone(), None, m)
        }
    };

    finalize_approval(&state, &approval_id, status_text)?;
    log_action_episode(&state, &action, &embedder_log).await;

    // The reported gap: after a manual Approve the action ran and a flat outcome
    // line was appended, but Athena never reacted — the user had to send a NEW
    // message to get any response. Spawn ONE brief system-initiated reaction turn
    // so she responds automatically. Success only: a failed action keeps its
    // inline error on the still-open card (the frontend doesn't resolve it), and
    // the skip filter keeps fleet / navigation-only actions quiet.
    //
    // NOTE (auto-approve path): `auto_resolve_if_allowed` deliberately does NOT
    // call this. That path is autonomous-mode-only and fires when Athena's own
    // reasoning turn just proposed the action — her originating reply already
    // spoke to the user, so a second "I saved that" turn would be redundant
    // chatter, exactly what autonomous mode's restraint design avoids. The manual
    // path is the genuine silence gap. Documented follow-up if that changes.
    if status_text == APPROVAL_STATUS_APPROVED {
        spawn_action_reaction(&app, &state, &action, &message, client_action.as_ref());
    }

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
    log_action_episode(&state, &action, &log).await;
    Ok(ApprovalOutcome {
        id: approval_id,
        status: APPROVAL_STATUS_REJECTED.into(),
        message: reason,
        client_action: None,
    })
}

// ── helpers ─────────────────────────────────────────────────────────────

pub(crate) fn load_pending(
    state: &State<'_, Arc<AppState>>,
    approval_id: &str,
) -> Result<(String, serde_json::Value), AppError> {
    let conn = state.user_db.get()?;
    let row: Option<(String, String, bool)> = conn
        .query_row(
            "SELECT status, payload, created_at >= datetime('now', ?2)
             FROM companion_approval WHERE id = ?1",
            params![approval_id, APPROVAL_FRESHNESS_WINDOW],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)? != 0)),
        )
        .optional()?;
    let (status, payload, fresh) =
        row.ok_or_else(|| AppError::Internal(format!("approval `{approval_id}` not found")))?;
    if status != "pending" {
        return Err(AppError::Internal(format!(
            "approval `{approval_id}` is `{status}`, not pending"
        )));
    }
    // Consent freshness: refuse to act on a stale approval whose target may no
    // longer exist. The user must re-issue the request.
    if !fresh {
        return Err(AppError::Validation(format!(
            "Approval `{approval_id}` has expired (pending beyond the consent-freshness window). Dismiss it and re-issue the request."
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

pub(crate) fn finalize_approval(
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

/// Recover approvals left `running` by an unclean shutdown.
///
/// `companion_approve_action` flips the row `pending` → `running` before it
/// awaits the executor; a crash / force-quit / kill (or an error between load
/// and finalize) between there and `finalize_approval` leaves it stuck at
/// `running` forever. `companion_list_pending_approvals` only shows `pending`,
/// so the user's consent decision silently vanishes with no card and no way to
/// retry — and no zombie sweep existed for this table (unlike executions/jobs).
///
/// Reset such rows back to `pending`: the action never actually ran, so it is
/// safe to re-surface, and the existing consent-freshness window still gates
/// whether it can be acted on (a long-stale one shows but can't fire). Called
/// once at startup. Returns the number of rows reset.
pub fn recover_interrupted_approvals(user_db: &crate::db::UserDbPool) -> Result<usize, AppError> {
    let conn = user_db.get()?;
    let reset = conn.execute(
        "UPDATE companion_approval SET status = ?1 WHERE status = ?2",
        params![APPROVAL_STATUS_PENDING, APPROVAL_STATUS_RUNNING],
    )?;
    Ok(reset)
}

/// Persist an action outcome as a system-role episode so future turns'
/// system prompt sees what happened. Best-effort — failures here just
/// mean the conversation transcript doesn't carry the action record.
pub(crate) async fn log_action_episode(state: &State<'_, Arc<AppState>>, action: &str, content: &str) {
    // Fleet actions (fleet_send_input / _broadcast / _kill / _intervene / …) are
    // operational keystrokes into a CLI the user is already watching on the grid —
    // their "approved & executed / failed" result is noise in the companion chat,
    // not a conversational turn. Trace for debugging; do NOT persist as a visible
    // episode. (User report: the Athena chat was overflowing with these.)
    if action.starts_with("fleet_") {
        tracing::debug!(action, "fleet action result not persisted to companion chat");
        return;
    }
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

