//! Boot-time recovery of build sessions a dead process left in flight.
//!
//! A build session is run by one tokio task in one process; the row records
//! its state, the task holds its progress. Before this, nothing looked at an
//! in-flight row after a restart, so a hire whose build was running when the
//! app (or another session's instance) restarted read `approved` /
//! `analyzing` to kp's poller until the 24h sweeper cancelled it
//! (2026-09-25, two gig hires).
//!
//! The data half — what counts as an orphan, the at-most-once resume, the
//! compare-and-set writes — is `build_session_repo::recover_orphans`,
//! unit-tested in the db crate. This file decides only which orphans may be
//! RESUMED and starts their runners again.
//!
//! **Not leader-gated, on purpose.** A follower instance runs its own builds
//! in-process, so engine leadership says nothing about who owns a session.
//! Ownership is the per-session claim + heartbeat (`claimed_by_instance` /
//! `claim_expires_at`), and a session a live instance is running keeps a
//! fresh claim, so any instance's boot may run this safely.

use std::sync::Arc;

use crate::db::models::BuildSession;
use crate::db::repos::core::build_sessions::{self as build_session_repo, OrphanOutcome};
use crate::AppState;

/// May this orphan be re-run from its row?
///
/// Only a **kp hire's one-shot build**: nobody is watching it (so a rerun is
/// the only way it ever finishes), and its door
/// (`approval_exec_core::execute_kp_hire_request`) passes no `language` and no
/// `context` — the two start inputs the row does not persist. Every other
/// orphan is failed with `interrupted_by_restart` rather than rebuilt from
/// inputs it may not have had.
fn resumable(pool: &crate::db::DbPool, session: &BuildSession) -> bool {
    if session.mode.as_deref() != Some("one_shot") {
        return false;
    }
    crate::db::repos::core::personas::get_by_id(pool, &session.persona_id)
        .map(|p| p.parsed_design_context().kp_link.is_some())
        .unwrap_or(false)
}

/// Settle every orphaned build session and restart the resumable ones.
/// Best-effort: a failure is logged and never blocks boot.
pub(crate) fn recover_after_restart(state: &Arc<AppState>, app: &tauri::AppHandle) {
    let pool = state.db.clone();
    let owner = state.build_session_manager.owner_id().to_string();
    let outcomes =
        match build_session_repo::recover_orphans(&pool, &owner, chrono::Utc::now(), &|s| {
            resumable(&pool, s)
        }) {
            Ok(o) => o,
            Err(e) => {
                tracing::warn!(error = %e, "build-session restart recovery failed");
                return;
            }
        };
    for outcome in outcomes {
        match outcome {
            OrphanOutcome::Failed { id, reason } => {
                tracing::info!(session_id = %id, reason = %reason, "restart recovery: failed an interrupted build session");
            }
            OrphanOutcome::Resumed(session) => {
                let id = session.id.clone();
                match state.build_session_manager.resume_session(
                    *session,
                    pool.clone(),
                    state.process_registry.clone(),
                    app.clone(),
                ) {
                    Ok(_) => tracing::info!(
                        session_id = %id,
                        "restart recovery: resumed an interrupted kp hire build (one automatic resume)"
                    ),
                    Err(e) => {
                        // The row was reset and claimed; a runner that cannot
                        // start must not leave it looking in flight.
                        tracing::error!(session_id = %id, error = %e, "restart recovery: resume failed to start");
                        let _ = build_session_repo::update(
                            &pool,
                            &id,
                            &crate::db::models::UpdateBuildSession {
                                phase: Some("failed".into()),
                                error_message: Some(Some(format!(
                                    "{}: the build was resumed after a restart but could not start: {e}",
                                    build_session_repo::INTERRUPTED_BY_RESTART
                                ))),
                                ..Default::default()
                            },
                        );
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{BuildPhase, CreatePersonaInput};

    fn persona(pool: &crate::db::DbPool, design_context: Option<&str>) -> String {
        crate::db::repos::core::personas::create(
            pool,
            CreatePersonaInput {
                name: "Hire".into(),
                system_prompt: "sp".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: design_context.map(str::to_string),
                notification_channels: None,
                lifecycle: Some("draft".into()),
            },
        )
        .unwrap()
        .id
    }

    fn session(persona_id: &str, mode: &str) -> BuildSession {
        BuildSession {
            id: "s".into(),
            persona_id: persona_id.into(),
            phase: BuildPhase::Analyzing,
            resolved_cells: "{}".into(),
            pending_question: None,
            agent_ir: None,
            adoption_answers: None,
            intent: "i".into(),
            error_message: None,
            cli_pid: None,
            workflow_json: None,
            parser_result_json: None,
            mode: Some(mode.into()),
            companion_session_id: None,
            disabled_dims_json: None,
            phase_timings_json: None,
            total_cost_usd: None,
            input_tokens: None,
            output_tokens: None,
            num_turns: None,
            created_at: "t".into(),
            updated_at: "t".into(),
        }
    }

    /// Only a kp hire's one-shot build is rebuilt from its row; everything
    /// else is failed with `interrupted_by_restart` instead.
    #[test]
    fn only_a_kp_hires_one_shot_build_is_resumable() {
        let pool = crate::db::init_test_db().unwrap();
        let kp = persona(
            &pool,
            Some(
                r#"{"kpLink":{"jobId":"gig-1","jobTitle":"t","baseUrl":"http://x","reportToken":"tok"}}"#,
            ),
        );
        let plain = persona(&pool, None);
        assert!(resumable(&pool, &session(&kp, "one_shot")));
        assert!(!resumable(&pool, &session(&kp, "interactive")));
        assert!(!resumable(&pool, &session(&plain, "one_shot")));
        assert!(!resumable(&pool, &session("gone", "one_shot")));
    }
}
