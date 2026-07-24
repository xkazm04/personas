//! `approval_exec_core` — part of the approval module family (split from the
//! former approvals.rs god file, 2026-07-24). Shared imports, status
//! consts and the Tauri-facing types live in `mod.rs`; siblings are
//! reachable through the parent's glob re-exports.

#[allow(unused_imports)]
use super::*;

// ── action executors ────────────────────────────────────────────────────

pub(crate) async fn execute_run_persona(
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

/// Apply an approved `update_identity` op. Two modes (F1):
///   - `diffs: [...]` — anchored edits (AppendBullet / ReplaceBullet /
///     RemoveBullet) against named sections. Preferred for incremental learning
///     (reflection / synthesis): targeted, reviewable, preserves the rest.
///   - `content: "..."` — a full identity.md replacement. The intake interview's
///     first-draft path (nothing exists yet to diff against).
/// Both back up the prior file first.
pub(crate) fn execute_update_identity(params: &serde_json::Value) -> Result<ExecuteResult, AppError> {
    use crate::companion::brain::identity;

    // Anchored-diff mode (preferred).
    if let Some(arr) = params.get("diffs").and_then(|v| v.as_array()) {
        if arr.is_empty() || arr.len() > identity::MAX_DIFFS_PER_OP {
            return Err(AppError::Validation(format!(
                "update_identity: 1..={} diffs required, got {}",
                identity::MAX_DIFFS_PER_OP,
                arr.len()
            )));
        }
        let mut diffs = Vec::with_capacity(arr.len());
        let mut parse_failures = Vec::new();
        for dj in arr {
            match identity::IdentityDiff::from_json(dj) {
                Ok(d) => diffs.push(d),
                Err(e) => parse_failures.push(e.to_string()),
            }
        }
        if diffs.is_empty() {
            return Err(AppError::Validation(format!(
                "update_identity: no valid diffs ({})",
                parse_failures.join("; ")
            )));
        }
        let (applied, mut skipped, backup) = identity::apply_diffs_on_disk(&diffs)?;
        skipped.extend(parse_failures);
        // Applied/skipped change list + backup path are developer detail — trace
        // them; the user just gets a plain confirmation.
        tracing::debug!(
            applied = applied.len(),
            skipped = skipped.len(),
            backup = %backup,
            "companion: updated identity (anchored diffs)"
        );
        return Ok(ExecuteResult::message(
            "Updated what I know about you.".to_string(),
        ));
    }

    // Full-content mode (intake first draft).
    let content = params
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            AppError::Internal("update_identity: need `diffs` (anchored) or `content` (full)".into())
        })?;
    let backup = identity::write_full(content)?;
    tracing::debug!(
        bytes = content.len(),
        backup = %backup,
        "companion: updated identity (full content)"
    );
    Ok(ExecuteResult::message(
        "Updated what I know about you.".to_string(),
    ))
}

pub(crate) async fn execute_resolve_human_review(
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
    // the Tauri command boundary): resolve, then publish review_decision.* to
    // the event bus via the SHARED helper so the signal is symmetric with the
    // user-driven path (P1b — previously this path emitted nothing, so an
    // Athena-resolved review was invisible to downstream subscribers).
    manual_repo::update_status(&state.db, &review_id, status, comment.clone())?;
    match manual_repo::get_by_id(&state.db, &review_id) {
        Ok(review) => {
            crate::commands::design::reviews::publish_review_decision(&state.db, app, &review);
            // Resume-loop (Phase 1) — same reaction as the user path.
            crate::commands::design::reviews::react_to_review_decision(state, app, &review);
        }
        Err(e) => {
            // The status update committed, but we couldn't re-load the review
            // to publish review_decision.* or run the resume-loop. Don't let
            // those side effects vanish silently — an Athena-resolved review
            // would then look done while downstream subscribers and the resume
            // loop never fired. Log loudly so the dropped propagation is
            // diagnosable.
            tracing::warn!(
                review_id = %review_id,
                error = %e,
                "resolve_human_review: status updated but review re-load failed — \
                 decision event + resume-loop were NOT fired"
            );
        }
    }

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
pub(crate) async fn execute_write_fact(
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

    // Developer detail (id, scope/key, importance, source count) stays in the log;
    // the user just sees a plain confirmation with the saved content.
    tracing::debug!(
        fact_id = %id,
        scope = %scope.as_str(),
        key,
        importance,
        sources = sources.len(),
        "companion: wrote fact"
    );
    let trimmed = value.trim();
    let preview: String = trimmed.chars().take(100).collect();
    let ellipsis = if trimmed.chars().count() > 100 { "…" } else { "" };
    Ok(ExecuteResult::message(format!(
        "Saved that to memory: \"{preview}{ellipsis}\"."
    )))
}

/// Move a fact to `semantic/_deleted/`. Rare — most "wrong" facts get
/// superseded instead, which preserves the historical record.
pub(crate) fn execute_delete_fact(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("delete_fact: missing `id`".into()))?;
    crate::companion::brain::semantic::delete_fact(&state.user_db, id)?;
    tracing::debug!(fact_id = %id, "companion: deleted fact");
    Ok(ExecuteResult::message("Removed that from memory.".to_string()))
}

// ── Phase D executors ───────────────────────────────────────────────────

pub(crate) async fn execute_write_procedural(
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
    tracing::debug!(
        rule_id = %id,
        scope = %scope.as_str(),
        trigger,
        importance,
        sources = sources.len(),
        "companion: wrote procedural rule"
    );
    Ok(ExecuteResult::message(format!(
        "Got it — I'll {}.",
        behavior.trim().trim_end_matches('.')
    )))
}

pub(crate) fn execute_delete_procedural(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("delete_procedural: missing `id`".into()))?;
    crate::companion::brain::procedural::delete_rule(&state.user_db, id)?;
    tracing::debug!(rule_id = %id, "companion: deleted procedural rule");
    Ok(ExecuteResult::message(
        "Okay — I'll stop doing that.".to_string(),
    ))
}

pub(crate) fn execute_write_goal(
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
    tracing::debug!(goal_id = %id, priority, "companion: wrote goal");
    Ok(ExecuteResult::message(format!(
        "Added a goal: \"{}\".",
        title.trim()
    )))
}

/// Goals hub — apply an Athena-proposed dev-goal update (approval-gated; never
/// auto-approved). Updates status/progress on the main-DB `dev_goals` row and
/// records an `athena_update` signal so the change shows in the goal's feed.
pub(crate) fn execute_update_dev_goal(
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
        &state.db, goal_id, None, None, status, progress, None, None, None, None, None,
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

pub(crate) fn execute_update_goal_status(
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
    tracing::debug!(goal_id = %id, status = %status.as_str(), "companion: updated goal status");
    let plain = match status {
        goals::GoalStatus::Active => "in progress",
        goals::GoalStatus::Paused => "paused",
        goals::GoalStatus::Completed => "done",
        goals::GoalStatus::Abandoned => "dropped",
    };
    Ok(ExecuteResult::message(format!(
        "Marked that goal as {plain}."
    )))
}

pub(crate) fn execute_delete_goal(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("delete_goal: missing `id`".into()))?;
    crate::companion::brain::goals::delete_goal(&state.user_db, id)?;
    tracing::debug!(goal_id = %id, "companion: deleted goal");
    Ok(ExecuteResult::message("Removed that goal.".to_string()))
}

pub(crate) fn execute_write_ritual(
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
    tracing::debug!(ritual_id = %id, kind = %kind.as_str(), "companion: wrote ritual");
    Ok(ExecuteResult::message("Saved that routine.".to_string()))
}

pub(crate) fn execute_set_ritual_active(
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
    tracing::debug!(ritual_id = %id, active, "companion: set ritual active");
    Ok(ExecuteResult::message(
        if active {
            "Turned that routine back on.".to_string()
        } else {
            "Paused that routine.".to_string()
        },
    ))
}

pub(crate) fn execute_delete_ritual(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("delete_ritual: missing `id`".into()))?;
    crate::companion::brain::rituals::delete_ritual(&state.user_db, id)?;
    tracing::debug!(ritual_id = %id, "companion: deleted ritual");
    Ok(ExecuteResult::message("Removed that routine.".to_string()))
}

pub(crate) fn execute_write_backlog_item(
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
    tracing::debug!(item_id = %id, kind = %kind.as_str(), "companion: wrote backlog item");
    Ok(ExecuteResult::message(
        "Noted — I'll follow up on that.".to_string(),
    ))
}

pub(crate) fn execute_resolve_backlog_item(
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
    tracing::debug!(item_id = %id, dropped, "companion: resolved backlog item");
    Ok(ExecuteResult::message(
        if dropped {
            "Dropped that follow-up.".to_string()
        } else {
            "Marked that follow-up as done.".to_string()
        },
    ))
}

// ── Phase F executors ───────────────────────────────────────────────────

/// Prefill the persona-creation wizard. The actual UI work happens
/// frontend-side via the `PrefillPersonaCreate` client action — this
/// executor just validates params and emits the action so a single
/// click on the approval card lands the user on personas/ with the
/// intent box filled (and optionally launches the build).
pub(crate) fn execute_prefill_persona_create(params: &serde_json::Value) -> Result<ExecuteResult, AppError> {
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
pub(crate) fn derive_build_name(intent: &str) -> String {
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
pub(crate) async fn execute_build_oneshot(
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
            // First-class draft: this is a build stub, promoted to `active`
            // by promote_build_draft once the build finishes.
            lifecycle: Some("draft".to_string()),
        },
    )?;

    // 2. Start the one-shot build headlessly. No-op Channel: events fire on the
    //    global emit stream, exactly like start_build_session_headless.
    let session_id = uuid::Uuid::new_v4().to_string();
    let dummy_channel: tauri::ipc::Channel<serde_json::Value> =
        tauri::ipc::Channel::new(|_response| Ok(()));
    if let Err(spawn_err) = state.build_session_manager.start_session(
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
        None, // build context: companion chat-grounding is a future extension (UAT P7)
        None, // orchestration: companion-driven builds run sequential (env override applies)
    ) {
        // Roll back the orphan draft persona. The build never started, so the
        // just-committed stub ('New Persona' / "You are a helpful AI assistant.")
        // would otherwise linger in the user's persona list — polluting team
        // rosters, dashboards, and Director rollups with identical empty
        // duplicates on every failed one-shot. Best-effort cleanup: log a
        // delete failure but still surface the original spawn error.
        if let Err(cleanup_err) = crate::db::repos::core::personas::delete(&state.db, &persona.id) {
            tracing::error!(
                persona_id = %persona.id,
                error = %cleanup_err,
                "Failed to roll back orphan draft persona after build_oneshot spawn failure"
            );
        }
        return Err(spawn_err);
    }

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
pub(crate) async fn execute_run_arena(
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
        // Companion-triggered arena measures the persona's current prompt.
        None,
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

/// Headless breed: cross-breed 2+ personas via the genome engine. The Versions
/// & Ratings redesign descoped Breed from the Lab UI, so Athena is now its only
/// driver — she proposes it (approval-gated, since it spawns a compute-heavy
/// run) and this forwards to the existing `genome_start_breeding` command.
/// Offspring land in the genome breeding tables for any future surface to read.
pub(crate) async fn execute_companion_breed_personas(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let parent_ids: Vec<String> = params
        .get("parent_ids")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if parent_ids.len() < 2 {
        return Err(AppError::Internal(
            "companion_breed_personas: `parent_ids` needs at least 2 persona ids".into(),
        ));
    }
    // Fitness weights default to a quality-leaning blend when Athena omits them.
    let fitness_objective: crate::engine::genome::FitnessObjective = params
        .get("fitness_objective")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or(crate::engine::genome::FitnessObjective {
            speed: 0.2,
            quality: 0.6,
            cost: 0.2,
        });
    let mutation_rate = params.get("mutation_rate").and_then(|v| v.as_f64());
    let generations = params
        .get("generations")
        .and_then(|v| v.as_i64())
        .map(|n| n as i32);

    let run = crate::commands::execution::genome::genome_start_breeding(
        state.clone(),
        app.clone(),
        parent_ids.clone(),
        fitness_objective,
        mutation_rate,
        generations,
    )
    .await?;

    Ok(ExecuteResult::message(format!(
        "Breeding run `{}` started from {} parents. Offspring appear once the run completes.",
        run.id,
        parent_ids.len()
    )))
}

/// Headless evolve: trigger one auto-evolution cycle for a persona (breed →
/// evaluate → promote) via the existing `evolution_trigger_cycle` command.
/// Approval-gated; descoped from the Lab UI in the redesign.
pub(crate) async fn execute_companion_evolve_persona(
    state: &State<'_, Arc<AppState>>,
    _app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let persona_id = params
        .get("persona_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("companion_evolve_persona: missing `persona_id`".into()))?
        .to_string();

    let cycle = crate::commands::execution::evolution::evolution_trigger_cycle(
        state.clone(),
        persona_id.clone(),
    )
    .await?;

    Ok(ExecuteResult::message(format!(
        "Evolution cycle `{}` triggered for persona `{persona_id}`.",
        cycle.id
    )))
}

/// Persist a dashboard composition (singleton). The spec is stored as
/// markdown body on a single `companion_node` row with kind='dashboard'
/// and id='dashboard'. Replacing it overwrites the spec; the frontend
/// re-renders on the next dashboard tab open.
pub(crate) fn execute_compose_dashboard(
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
pub(crate) async fn execute_use_connector(
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
        &state.db,
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
pub(crate) fn execute_register_project(
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
    let _id = crate::companion::projects::register(&state.user_db, name, path, description)?;

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

// ----------------------------------------------------------------------------
// Phase C3 — assign_team (Athena dispatcher op → orchestrator entry)
// ----------------------------------------------------------------------------

/// Handle the `assign_team` op when the user approves it. Reads
/// `team_id` + `goal` + optional `title` from params, then delegates to
/// the shared `companion_assign_team_inner` helper (same path the
/// `companion_assign_team` Tauri command uses).
pub(crate) async fn execute_assign_team(
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

/// C2: execute the `post_team_message` op — Athena posts a message into a team
/// channel (`author_kind='athena'`, `consumer='inject'`). Params: `team_id`,
/// `body` (or `message`), optional `addressed_to` (array of persona ids).
pub(crate) fn execute_post_team_message(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let team_id = params
        .get("team_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Internal("post_team_message: missing `team_id`".into()))?
        .to_string();
    let body = params
        .get("body")
        .and_then(|v| v.as_str())
        .or_else(|| params.get("message").and_then(|v| v.as_str()))
        .ok_or_else(|| AppError::Internal("post_team_message: missing `body`".into()))?
        .to_string();
    let addressed_to = params.get("addressed_to").and_then(|v| v.as_array()).map(|a| {
        a.iter()
            .filter_map(|x| x.as_str().map(String::from))
            .collect::<Vec<_>>()
    });

    let msg = crate::db::repos::resources::team_channel::create(
        &state.db,
        crate::db::models::CreateChannelMessageInput {
            team_id: team_id.clone(),
            author_kind: "athena".into(),
            author_id: None,
            body,
            addressed_to,
            reply_to: None,
            assignment_id: None,
            consumer: Some("inject".into()),
        },
    )?;
    Ok(ExecuteResult::message(format!(
        "Posted to team `{}` channel (message `{}`).",
        &team_id[..team_id.len().min(8)],
        &msg.id[..msg.id.len().min(12)],
    )))
}
