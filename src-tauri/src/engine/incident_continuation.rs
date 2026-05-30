//! Incident auto-continuation (P2.3b).
//!
//! When a persona hits a real blocker it emits a `raise_incident` protocol
//! message, which `dispatch.rs` records as an `audit_incidents` row with
//! `source_table = "persona_blocker"` and `source_id = <the blocked execution
//! id>`. The execution itself finishes (incidents are non-blocking). When a
//! human or Athena later RESOLVES that incident, the blocked work should pick
//! up where it left off — that is what this module does.
//!
//! Mirrors `ExecutionEngine::requeue_persisted_executions` (the P1a restart
//! path): load the originating execution, reconstruct its persona + tools +
//! input, then admit a fresh execution through the durable queue. The new run
//! is a `create_retry` row (per the locked design: a NEW execution row, healing-
//! retry style, so the original blocked run stays terminal and the continuation
//! is a distinct, linked row) carrying a `PromptHint` continuation that tells
//! the persona the blocker was cleared.
//!
//! ## Idempotency (the safety guarantee)
//!
//! Driven by [`IncidentContinuationSubscription`], a reactive background loop.
//! Each tick selects resolved-but-uncontinued candidates
//! ([`audit_incidents::find_continuation_candidates`]) and, for each, performs
//! an ATOMIC claim ([`audit_incidents::claim_continuation`] — `UPDATE ... SET
//! continued_at = now WHERE id = ? AND continued_at IS NULL`) BEFORE doing any
//! work. Exactly one tick (or engine instance) ever wins the claim, so a given
//! incident is re-run AT MOST ONCE regardless of loop cadence, overlap, or
//! restart. A buggy or duplicated consumer therefore cannot cause runaway
//! re-runs — the worst case is that nothing re-runs (a no-op), never a storm.

use std::sync::Arc;

use tauri::AppHandle;

use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::audit_incidents as incident_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::engine::types::Continuation;
use crate::engine::ExecutionEngine;

/// Max incidents continued per tick — bounds the burst when a batch of
/// incidents is resolved at once (e.g. a bulk-resolve). The rest are picked up
/// on subsequent ticks.
const MAX_CONTINUATIONS_PER_TICK: i64 = 10;

/// Re-run the blocked work for every resolved-but-uncontinued persona incident.
///
/// Best-effort per incident: a candidate whose blocked execution or persona no
/// longer exists is skipped (it was already claimed, so it won't be retried —
/// the blocker is moot if the work is gone). Returns the number of
/// continuations actually started.
pub async fn continue_resolved_incidents(
    engine: &ExecutionEngine,
    app: AppHandle,
    pool: DbPool,
) -> usize {
    let candidates = match incident_repo::find_continuation_candidates(&pool, MAX_CONTINUATIONS_PER_TICK)
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "incident_continuation: candidate query failed");
            return 0;
        }
    };
    if candidates.is_empty() {
        return 0;
    }

    let mut started = 0usize;
    for incident in candidates {
        // Atomic claim — exactly one caller wins. Losers (already claimed by a
        // racing tick/instance) and errors are skipped, never retried.
        match incident_repo::claim_continuation(&pool, &incident.id) {
            Ok(true) => {}
            Ok(false) => continue,
            Err(e) => {
                tracing::warn!(incident_id = %incident.id, error = %e, "incident_continuation: claim failed");
                continue;
            }
        }

        // For a persona_blocker incident, source_id IS the blocked execution id.
        let blocked_id = incident.source_id.clone();
        let blocked = match exec_repo::get_by_id(&pool, &blocked_id) {
            Ok(e) => e,
            Err(_) => {
                tracing::warn!(
                    incident_id = %incident.id,
                    blocked_execution_id = %blocked_id,
                    "incident_continuation: blocked execution no longer exists; skipping"
                );
                continue;
            }
        };

        let persona = match persona_repo::get_by_id(&pool, &blocked.persona_id) {
            Ok(p) => p,
            Err(_) => {
                tracing::warn!(
                    incident_id = %incident.id,
                    persona_id = %blocked.persona_id,
                    "incident_continuation: originating persona no longer exists; skipping"
                );
                continue;
            }
        };

        let tools = tool_repo::get_tools_for_persona(&pool, &blocked.persona_id).unwrap_or_default();
        let input_data = blocked
            .input_data
            .as_deref()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok());

        // NEW execution row (healing-retry style): the original blocked run stays
        // terminal; this is a distinct, linked continuation. create_retry copies
        // the original input_data; we also pass it explicitly to start_execution.
        let retry = match exec_repo::create_retry(
            &pool,
            &blocked.persona_id,
            &blocked_id,
            blocked.retry_count + 1,
        ) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(incident_id = %incident.id, error = %e, "incident_continuation: create_retry failed");
                continue;
            }
        };

        let hint = format!(
            "A blocker that stopped a previous run has been resolved, and you are being re-run to \
             continue that work. Incident: \"{}\".{} Pick up where the blocked run left off — do not \
             restart from scratch if the earlier work is still valid.",
            incident.title,
            incident
                .resolution_note
                .as_deref()
                .filter(|n| !n.trim().is_empty())
                .map(|n| format!(" Resolution note: {n}."))
                .unwrap_or_default(),
        );

        match engine
            .start_execution(
                app.clone(),
                pool.clone(),
                retry.id.clone(),
                persona,
                tools,
                input_data,
                Some(Continuation::PromptHint(hint)),
            )
            .await
        {
            Ok(()) => {
                started += 1;
                tracing::info!(
                    incident_id = %incident.id,
                    blocked_execution_id = %blocked_id,
                    continuation_execution_id = %retry.id,
                    "incident_continuation: re-ran blocked work after incident resolved"
                );
            }
            Err(e) => {
                tracing::warn!(
                    incident_id = %incident.id,
                    continuation_execution_id = %retry.id,
                    error = %e,
                    "incident_continuation: start_execution failed (continuation row left queued)"
                );
            }
        }
    }

    if started > 0 {
        tracing::info!(count = started, "incident_continuation: started {started} continuation(s)");
    }
    started
}

/// Drive [`continue_resolved_incidents`] from the engine handle (used by the
/// reactive subscription, which holds an `Arc<ExecutionEngine>`).
pub async fn run_tick(engine: Arc<ExecutionEngine>, app: AppHandle, pool: DbPool) {
    let _ = continue_resolved_incidents(&engine, app, pool).await;
}
