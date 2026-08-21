//! Boot phase: reconcile rows an unclean shutdown left mid-flight.

use crate::commands;
use crate::db::{self, DbPool};
use crate::engine;
use crate::startup_timing::StartupTimer;

// Mark any executions left in running/queued state as failed
// (their processes died when the app last exited)
pub fn recover_interrupted_work(
    pool: &DbPool,
    user_db_pool: &db::UserDbPool,
    st: &mut StartupTimer,
) {
    engine::ExecutionEngine::recover_stale_executions(pool);
    st.checkpoint("stale_execution_recovery");

    // Mark n8n transform sessions interrupted by app exit as failed
    // and clear their in-memory job entries (dead cancellation tokens,
    // expired status channels) so new transforms aren't shadowed.
    match db::repos::resources::n8n_sessions::recover_interrupted_sessions(pool) {
        Ok(transform_ids) if !transform_ids.is_empty() => {
            let n8n_manager = commands::design::n8n_transform::job_state::manager();
            for tid in &transform_ids {
                let _ = n8n_manager.remove(tid);
            }
            tracing::info!(
                "Recovered {} interrupted n8n transform session(s), cleared in-memory job state",
                transform_ids.len()
            );
        }
        Err(e) => {
            tracing::warn!("Failed to recover n8n sessions: {}", e);
        }
        _ => {}
    }

    // Mark team pipeline runs left in running/awaiting_approval by an
    // unclean shutdown as failed. Without this the team is permanently
    // blocked from new pipeline runs and from deletion (both guard on the
    // stale `running` row), and cancel_pipeline can't help post-restart.
    match db::repos::resources::teams::recover_interrupted_pipeline_runs(pool) {
        Ok(n) if n > 0 => {
            tracing::info!("Startup: failed {} interrupted pipeline run(s)", n)
        }
        Err(e) => tracing::warn!("Failed to recover interrupted pipeline runs: {}", e),
        _ => {}
    }
    st.checkpoint("pipeline_run_recovery");

    // Fail lab_*_runs (arena/ab/matrix/eval) left non-terminal by a crash
    // so they stop re-hydrating as phantom active runs that pin the UI's
    // launch/cancel/orbit state.
    match db::repos::lab::recover_interrupted_lab_runs(pool) {
        Ok(n) if n > 0 => tracing::info!("Startup: failed {} interrupted lab run(s)", n),
        Err(e) => tracing::warn!("Failed to recover interrupted lab runs: {}", e),
        _ => {}
    }
    st.checkpoint("lab_run_recovery");

    // Reset companion approvals left `running` by a crash back to
    // `pending` so the user's un-run consent decision resurfaces (still
    // consent-freshness gated) instead of silently vanishing.
    match commands::companion::approvals::recover_interrupted_approvals(user_db_pool) {
        Ok(n) if n > 0 => {
            tracing::info!("Startup: reset {} interrupted approval(s) to pending", n)
        }
        Err(e) => tracing::warn!("Failed to recover interrupted approvals: {}", e),
        _ => {}
    }
    st.checkpoint("approval_recovery");

    // Reconcile the workspace adoption queue against the backlog: any
    // `to_process` cell of an adopted actionable practice that has no
    // materialized idea gets one (docs/plans/workspace-knowledge-center.md
    // + plan 1C). Idempotent and dedup-gated — one indexed join and no
    // writes when the queue is already drained.
    match db::repos::dev_workspaces::backfill_practice_ideas(pool) {
        Ok(n) if n > 0 => {
            tracing::info!(
                "Startup: materialized {} workspace-practice backlog idea(s)",
                n
            )
        }
        Err(e) => tracing::warn!("Failed to backfill workspace practice ideas: {}", e),
        _ => {}
    }
    st.checkpoint("practice_idea_backfill");

    // Purge old completed/failed events to prevent unbounded table growth
    match db::repos::communication::events::cleanup(pool, Some(7)) {
        Ok(n) if n > 0 => tracing::info!("Startup: cleaned up {} old events", n),
        Err(e) => tracing::warn!("Startup event cleanup failed: {}", e),
        _ => {}
    }
    st.checkpoint("event_cleanup");
}
