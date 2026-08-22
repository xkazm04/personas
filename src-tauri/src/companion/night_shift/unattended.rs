//! Unattended-guidance policy — what happens to a blocking MCP request when
//! the human is asleep.
//!
//! Watchdogs are armed by the MCP handlers at request time. They are inert
//! unless a night window is OPEN (an approved plan — each watchdog checks
//! [`super::active_plan`] itself): outside the window the request simply waits
//! for the human / the 10-minute TTL, exactly as before.
//!
//! This is the ONLY place the approved-plan gate is enforced. It used to have a
//! `night_window_active` wrapper beside it, but the wrapper's one caller was
//! the sleep cycle — memory maintenance, which is not autonomy-answering and
//! stopped consulting it in L1c — so the wrapper was removed rather than left
//! dead. The gate itself is unchanged: no approved plan ⇒ no night-shift
//! autonomy.
//!
//! - `request_guidance`: after T minutes unresolved, Athena answers from the
//!   project's dev memories + her decision precedent via a one-shot CLI call
//!   (a `TurnOrigin::Proactive`-class judgment turn recorded in the turn
//!   ledger). Every answer is logged as an episode AND a decision — the hard
//!   invariant that makes overnight judgment auditable.
//! - `request_approval`: ALWAYS parked. Athena never approves destructive or
//!   cost-bearing actions unattended; the worker receives an explicit DENIED
//!   + park note and the item surfaces in the morning report.

use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::brain::oneshot::call_claude_text;
use crate::companion::model_routing;
use crate::companion::orchestration::mcp::pending;
use crate::companion::session::DEFAULT_SESSION_ID;
use crate::companion::turn_ledger::{self, TurnRecord};
use crate::AppState;

/// Answer-call budget. Bounded well under the MCP TTL so the resolve lands
/// while the worker is still waiting.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(90);

/// How long a parked approval waits before parking. Short — there is no
/// judgment to compose, and the worker is blocked the whole time.
const APPROVAL_PARK_DELAY: Duration = Duration::from_secs(45);

/// Arm the guidance watchdog for one pending request. Fire-and-forget.
pub fn spawn_guidance_watchdog(
    app: tauri::AppHandle,
    request_id: String,
    fleet_session_id: String,
    question: String,
    context: Option<String>,
) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<Arc<AppState>>().inner().clone();
        if !super::enabled(&state.db) {
            return;
        }
        let delay = Duration::from_secs(super::guidance_minutes(&state.db) * 60);
        tokio::time::sleep(delay).await;
        if !pending::is_pending(&request_id) {
            return; // a human got there first
        }
        let Some(plan) = super::active_plan(&state.user_db).ok().flatten() else {
            return; // no open night window — leave it to the human/TTL
        };
        if let Err(e) = answer_guidance(
            &state,
            &plan.id,
            &request_id,
            &fleet_session_id,
            &question,
            context.as_deref(),
        )
        .await
        {
            tracing::warn!(error = %e, request_id = %request_id, "night_shift: unattended guidance failed (request left for TTL)");
        }
    });
}

/// Arm the approval-parking watchdog. Fire-and-forget.
pub fn spawn_approval_watchdog(
    app: tauri::AppHandle,
    request_id: String,
    fleet_session_id: String,
    action: String,
    rationale: String,
) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<Arc<AppState>>().inner().clone();
        if !super::enabled(&state.db) {
            return;
        }
        tokio::time::sleep(APPROVAL_PARK_DELAY).await;
        if !pending::is_pending(&request_id) {
            return;
        }
        let Some(plan) = super::active_plan(&state.user_db).ok().flatten() else {
            return;
        };
        park_approval(
            &state,
            &plan.id,
            &request_id,
            &fleet_session_id,
            &action,
            &rationale,
        );
    });
}

async fn answer_guidance(
    state: &Arc<AppState>,
    plan_id: &str,
    request_id: &str,
    fleet_session_id: &str,
    question: &str,
    context: Option<&str>,
) -> Result<(), crate::error::AppError> {
    let (project_label, cwd) = crate::commands::fleet::registry::registry()
        .lookup_meta(fleet_session_id)
        .unwrap_or_else(|| ("unknown".to_string(), String::new()));

    // Grounding: the project's dev memories (constraints first) + Athena's
    // recent decision precedent.
    let memories_block = project_memories_block(&state.db, &cwd);
    let decisions_block = decisions_block(&state.user_db);

    let prompt = format!(
        "You are Athena, supervising an unattended overnight fleet worker in project \
         `{project_label}` ({cwd}). The worker is BLOCKED on this question and no human is \
         awake. Answer in 2-6 sentences, decisively and conservatively: prefer the \
         reversible option, prefer staying on the worker's night branch, and if every option \
         is risky tell the worker to skip that path and continue other safe work. Do not \
         approve anything destructive.\n\n\
         WORKER QUESTION: {question}\n\
         {context_block}\n\
         PROJECT MEMORY (constraints/decisions recorded for this repo):\n{memories}\n\n\
         DECISION PRECEDENT (how the user has decided recently):\n{decisions}\n\n\
         Reply with ONLY the answer text for the worker.",
        context_block = context
            .map(|c| format!("WORKER CONTEXT: {c}\n"))
            .unwrap_or_default(),
        memories = if memories_block.is_empty() {
            "(none)"
        } else {
            memories_block.as_str()
        },
        decisions = if decisions_block.is_empty() {
            "(none)"
        } else {
            decisions_block.as_str()
        },
    );

    let answer = call_claude_text(
        &state.user_db,
        &prompt,
        model_routing::ASIDE.model,
        crate::companion::brain::oneshot::leg::NIGHT_UNATTENDED,
        ANSWER_TIMEOUT,
    )
    .await?;
    let answer = answer.trim().to_string();
    if answer.is_empty() {
        return Err(crate::error::AppError::Internal(
            "night guidance call returned empty answer".into(),
        ));
    }

    // Resolve the blocked worker FIRST (it's been waiting for minutes), then
    // write the audit trail.
    let resolved = pending::resolve(request_id, Ok(serde_json::json!({ "text": answer })));
    if !resolved {
        // Human/TTL raced us — don't log an answer that never reached anyone.
        return Ok(());
    }

    // Turn ledger — attribution for the spend + the act.
    turn_ledger::record_turn(
        &state.user_db,
        &TurnRecord {
            origin: "proactive".into(),
            trigger_kind: Some("night_guidance".into()),
            model: Some(model_routing::ASIDE.model.to_string()),
            ..Default::default()
        },
    );
    // Episode — Athena's own transcript sees what she told the worker.
    let episode = format!(
        "[Night shift] A worker in `{project_label}` asked while you slept:\n> {question}\n\nI answered unattended:\n{answer}"
    );
    if let Err(e) = episodic::append_episode(
        &state.user_db,
        DEFAULT_SESSION_ID,
        EpisodeRole::System,
        &episode,
    ) {
        tracing::warn!(error = %e, "night_shift: guidance episode write failed");
    }
    // Decision log — the judgment is retraceable next to human decisions.
    let label = format!("Unattended night guidance ({project_label})");
    let _ = crate::companion::brain::decisions::save_batch(
        &state.user_db,
        DEFAULT_SESSION_ID,
        Some("night_shift"),
        &[crate::companion::brain::decisions::DecisionInput {
            label: &label,
            choice: &answer,
            rationale: question,
            decision_timestamp: None,
        }],
    );
    // Night ledger row.
    let _ = super::record_event(
        &state.user_db,
        Some(plan_id),
        super::EVENT_UNATTENDED_GUIDANCE,
        Some(fleet_session_id),
        Some(&project_label),
        &serde_json::json!({ "question": question, "answer": answer }),
    );
    tracing::info!(request_id = %request_id, "night_shift: answered guidance unattended");
    Ok(())
}

fn park_approval(
    state: &Arc<AppState>,
    plan_id: &str,
    request_id: &str,
    fleet_session_id: &str,
    action: &str,
    rationale: &str,
) {
    let note = "Parked for morning review — I don't approve destructive or cost-bearing \
                actions unattended. Skip this action, continue safe work on your branch, or \
                end the session cleanly.";
    let resolved = pending::resolve(
        request_id,
        Ok(serde_json::json!({ "approved": false, "note": note })),
    );
    if !resolved {
        return;
    }
    let (project_label, _cwd) = crate::commands::fleet::registry::registry()
        .lookup_meta(fleet_session_id)
        .unwrap_or_else(|| ("unknown".to_string(), String::new()));
    let episode = format!(
        "[Night shift] A worker in `{project_label}` requested approval for `{action}` \
         while you slept. I parked it (denied unattended): it's listed in the morning \
         report.\nWorker's rationale: {rationale}"
    );
    if let Err(e) = episodic::append_episode(
        &state.user_db,
        DEFAULT_SESSION_ID,
        EpisodeRole::System,
        &episode,
    ) {
        tracing::warn!(error = %e, "night_shift: park episode write failed");
    }
    let _ = super::record_event(
        &state.user_db,
        Some(plan_id),
        super::EVENT_APPROVAL_PARKED,
        Some(fleet_session_id),
        Some(&project_label),
        &serde_json::json!({ "action": action, "rationale": rationale }),
    );
    tracing::info!(request_id = %request_id, action = %action, "night_shift: parked destructive approval");
}

/// Render the dev-memories block for the project owning `cwd` (matched by
/// registered root prefix). Empty when no project matches.
fn project_memories_block(sys_db: &crate::db::DbPool, cwd: &str) -> String {
    if cwd.trim().is_empty() {
        return String::new();
    }
    let norm = cwd.trim().replace('\\', "/").to_ascii_lowercase();
    let Ok(projects) = crate::db::repos::dev_tools::list_projects(sys_db, None) else {
        return String::new();
    };
    let Some(project) = projects.iter().find(|p| {
        let root = p
            .root_path
            .trim()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_ascii_lowercase();
        !root.is_empty() && (norm == root || norm.starts_with(&format!("{root}/")))
    }) else {
        return String::new();
    };
    let Ok(memories) = crate::db::repos::dev_memories::get_for_injection(sys_db, &project.id, 12)
    else {
        return String::new();
    };
    crate::db::repos::dev_memories::render_for_prompt(&memories, 2400).unwrap_or_default()
}

fn decisions_block(user_db: &crate::db::UserDbPool) -> String {
    let Ok(decisions) = crate::companion::brain::decisions::list_recent(user_db, 10) else {
        return String::new();
    };
    decisions
        .iter()
        .map(|d| format!("- {}: {} — {}", d.label, d.choice, d.rationale))
        .collect::<Vec<_>>()
        .join("\n")
}
