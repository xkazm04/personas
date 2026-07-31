//! `approval_exec_night` — executor for the Night Shift plan card
//! (`night_shift_execute_plan`). Part of the approval module family; shared
//! imports and types come from `mod.rs` via `use super::*`.
//!
//! This is the ONLY place a night plan turns into running sessions — the
//! plan job never spawns, so the "no plan runs unapproved" invariant is
//! structural: dispatch code is reachable exclusively from the user's
//! Approve click (`companion_approve_action`).

#[allow(unused_imports)]
use super::*;

use crate::companion::night_shift::{self, planner};

/// Approve tonight's plan: open the night window and dispatch each bounded
/// plan item as an Athena-tagged fleet session in its registered repo.
pub(crate) fn execute_night_shift_execute_plan(
    state: &State<'_, Arc<AppState>>,
    app: &tauri::AppHandle,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let plan_id = params
        .get("plan_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("night_shift_execute_plan: missing `plan_id`".into()))?;

    let plan = night_shift::get_plan(&state.user_db, plan_id)?
        .ok_or_else(|| AppError::Internal(format!("night plan `{plan_id}` not found")))?;
    if plan.status != "proposed" {
        return Err(AppError::Internal(format!(
            "night plan `{plan_id}` is `{}` — only a `proposed` plan can be started",
            plan.status
        )));
    }
    let draft: planner::DraftPlan = serde_json::from_str(&plan.plan_json)
        .map_err(|e| AppError::Internal(format!("night plan `{plan_id}` payload unreadable: {e}")))?;
    if draft.items.is_empty() {
        return Err(AppError::Internal(format!(
            "night plan `{plan_id}` has no sessions to dispatch"
        )));
    }

    // Open the night window BEFORE dispatching so the unattended policy is
    // live from the first second a worker exists.
    let window_end = night_shift::next_local_hour_utc(night_shift::wake_hour(&state.db));
    night_shift::set_window_end(&state.user_db, plan_id, &window_end)?;
    night_shift::set_plan_status(&state.user_db, plan_id, "approved")?;

    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let op_id = crate::companion::orchestration::operative_memory::memory()
        .begin_dispatched_operation(format!("Night shift: {}", plan.summary));

    let mut spawned: Vec<String> = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    for item in draft.items.iter().take(plan.max_sessions.max(1) as usize) {
        // Containment re-check at dispatch time (registrations may have
        // changed since the plan was bounded). Refuse, never apologize.
        if let Err(e) = validate_fleet_cwd(app, &item.cwd) {
            failures.push(format!("{}: {e}", item.project));
            continue;
        }
        let prompt = planner::worker_prompt(item, plan_id, &date);
        let id = match crate::commands::fleet::pty::spawn_session(
            app.clone(),
            std::path::PathBuf::from(&item.cwd),
            vec![prompt],
            120,
            32,
        ) {
            Ok(id) => id,
            Err(e) => {
                failures.push(format!("{}: spawn failed: {e}", item.project));
                continue;
            }
        };
        let _ = crate::companion::orchestration::operative_memory::memory()
            .attach_session_to_operation(&op_id, &id, "night-worker", &item.cwd);
        let _ = crate::commands::fleet::registry::registry().rename(
            &id,
            Some(format!(
                "{}-night-{}",
                crate::commands::fleet::registry::ATHENA_SESSION_NAME_SENTINEL,
                item.project
            )),
        );
        // Audit: attribution row the review sweep + morning report read.
        if let Err(e) = night_shift::record_event(
            &state.user_db,
            Some(plan_id),
            night_shift::EVENT_DISPATCH,
            Some(&id),
            Some(&item.project),
            &serde_json::json!({
                "cwd": item.cwd,
                "project": item.project,
                "objective": item.objective,
            }),
        ) {
            tracing::warn!(error = %e, "night_shift: dispatch event write failed");
        }
        spawned.push(format!("{} (`{}`)", item.project, &id[..id.len().min(8)]));
    }

    if spawned.is_empty() {
        night_shift::set_plan_status(&state.user_db, plan_id, "expired")?;
        return Err(AppError::Internal(format!(
            "night plan `{plan_id}`: every dispatch failed.\n{}",
            failures.join("\n")
        )));
    }
    night_shift::set_plan_status(&state.user_db, plan_id, "running")?;
    crate::companion::orchestration::emit_digest_changed(app);

    let mut msg = format!(
        "Night shift is on. I dispatched {} session(s): {}. Branch-only writes, destructive \
         requests park for you, and your morning report will roll up everything.",
        spawned.len(),
        spawned.join(", "),
    );
    if !failures.is_empty() {
        msg.push_str(&format!("\nNot dispatched: {}", failures.join("; ")));
    }
    Ok(ExecuteResult::message(msg))
}
