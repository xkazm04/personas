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
use crate::error::AppError;
use crate::engine::types::Continuation;

/// cfg-gated accessor for the optional ml-feature EmbeddingManager off
/// AppState (the orchestrator's auto-resume signature needs it; lite builds
/// pass the stub None).
#[cfg(feature = "ml")]
fn embedding_manager_of(
    app: &AppHandle,
) -> Option<Arc<crate::engine::embedder::EmbeddingManager>> {
    use tauri::Manager;
    app.try_state::<Arc<crate::AppState>>()
        .and_then(|s| s.inner().embedding_manager.clone())
}
#[cfg(not(feature = "ml"))]
fn embedding_manager_of(
    _app: &AppHandle,
) -> Option<Arc<crate::engine::team_assignment_matching::EmbeddingManager>> {
    None
}
use crate::engine::ExecutionEngine;

/// Max incidents continued per tick — bounds the burst when a batch of
/// incidents is resolved at once (e.g. a bulk-resolve). The rest are picked up
/// on subsequent ticks.
const MAX_CONTINUATIONS_PER_TICK: i64 = 10;

/// Look up the ids of a parked team assignment's `status='failed'` steps.
///
/// Returns a real `Result` (NOT a swallowed empty `Vec`) so the caller can tell
/// a transient DB error (e.g. SQLITE_BUSY/lock) apart from a genuine zero-
/// failed-steps outcome. The old inline `.ok() … .unwrap_or_default()` collapsed
/// both into an empty vec, which — after the continuation claim was already
/// stamped — permanently mis-classified a transient error as "already resumed"
/// and stranded the assignment.
fn failed_assignment_steps(pool: &DbPool, assignment_id: &str) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id FROM team_assignment_steps
         WHERE assignment_id = ?1 AND status = 'failed'",
    )?;
    let rows = stmt.query_map([assignment_id], |r| r.get::<_, String>(0))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}

/// Re-run the blocked work for every resolved-but-uncontinued persona incident.
///
/// Best-effort per incident: a candidate whose blocked execution or persona no
/// longer exists is skipped (it was already claimed, so it won't be retried —
/// the blocker is moot if the work is gone). Returns the number of
/// continuations actually started.
pub async fn continue_resolved_incidents(
    engine: &Arc<ExecutionEngine>,
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
        // For a team_assignments incident the un-park needs a fallible lookup of
        // the assignment's failed steps. Run that lookup BEFORE taking the
        // permanent claim: a transient DB error (SQLITE_BUSY/lock) must NOT be
        // misread as "zero failed steps" and then locked in by the claim. On
        // Err we skip WITHOUT claiming, so `continued_at` stays NULL and the
        // next tick retries this incident; a genuine Ok(empty) is claimed-and-
        // skipped below exactly as before (legitimately already-resumed/done).
        let team_failed_steps: Option<Vec<String>> =
            if incident.source_table == "team_assignments" {
                match failed_assignment_steps(&pool, &incident.source_id) {
                    Ok(steps) => Some(steps),
                    Err(e) => {
                        tracing::warn!(
                            incident_id = %incident.id,
                            assignment_id = %incident.source_id,
                            error = %e,
                            "incident_continuation: failed-steps lookup errored; leaving incident unclaimed to retry next tick"
                        );
                        continue;
                    }
                }
            } else {
                None
            };

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

        // Athena review-resolution incident (source_table='team_assignments'):
        // source_id is a PARKED assignment whose blocker (missing access /
        // credential) the human just resolved. Mechanically un-park it: reset
        // its failed steps + restore cascade-skipped dependents + restart the
        // tick — the same auto-resume path the orchestrator uses. Closes the
        // loop the 2026-06-10 live run exposed: an incident-parked assignment
        // had no machine path back to `running` after the fix.
        if incident.source_table == "team_assignments" {
            let assignment_id = incident.source_id.clone();
            // Computed before the claim above; a query error already `continue`d
            // (without claiming), so this only ever unwraps a successful lookup.
            let failed_steps = team_failed_steps.unwrap_or_default();
            if failed_steps.is_empty() {
                tracing::info!(
                    incident_id = %incident.id,
                    assignment_id = %assignment_id,
                    "incident_continuation: assignment has no failed steps (already resumed/done); skipping"
                );
                continue;
            }
            match crate::engine::team_assignment_orchestrator::auto_resume_retryable_steps(
                Arc::new(pool.clone()),
                app.clone(),
                engine.clone(),
                embedding_manager_of(&app),
                &assignment_id,
                &failed_steps,
            ) {
                Ok(()) => {
                    started += 1;
                    tracing::info!(
                        incident_id = %incident.id,
                        assignment_id = %assignment_id,
                        steps = failed_steps.len(),
                        "incident_continuation: parked assignment resumed after incident resolution"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        incident_id = %incident.id,
                        assignment_id = %assignment_id,
                        error = %e,
                        "incident_continuation: assignment resume failed"
                    );
                }
            }
            continue;
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

        // Refuse to continue a simulation/lab/eval origin: a dry-run must never
        // spawn a real follow-up that could take irreversible actions. The
        // promote site already guards is_simulation; re-check it here.
        if blocked.is_simulation {
            tracing::warn!(
                incident_id = %incident.id,
                blocked_execution_id = %blocked_id,
                "incident_continuation: blocked run was a simulation; refusing continuation"
            );
            continue;
        }

        let tools = tool_repo::get_tools_for_persona(&pool, &blocked.persona_id).unwrap_or_default();

        // Require the original task context. Previously NULL and unparseable
        // input_data both silently collapsed to None, starting a contextless
        // re-run that fabricates work (or runs against empty input) while logging
        // a "successful continuation" — and could take real, irreversible actions
        // off a hallucinated reconstruction. Abort instead, leaving the incident
        // claimed-but-not-continued for human attention.
        let input_data = match blocked.input_data.as_deref() {
            Some(s) if !s.trim().is_empty() => match serde_json::from_str::<serde_json::Value>(s) {
                Ok(v) => Some(v),
                Err(e) => {
                    tracing::warn!(
                        incident_id = %incident.id,
                        blocked_execution_id = %blocked_id,
                        error = %e,
                        "incident_continuation: blocked run input_data is unparseable; refusing contextless continuation"
                    );
                    continue;
                }
            },
            _ => {
                tracing::warn!(
                    incident_id = %incident.id,
                    blocked_execution_id = %blocked_id,
                    "incident_continuation: blocked run has no input_data; refusing contextless continuation"
                );
                continue;
            }
        };

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

/// Reactive background loop that re-runs blocked work when its incident is
/// resolved. Registered in `engine::background::start_loops`. Always-on: the
/// trigger is an explicit human/Athena resolve (the consent), not unsupervised
/// autonomy, so unlike `GoalAdvanceSubscription` it needs no opt-in setting.
/// Leadership-gated by default so only one instance drives it (the atomic claim
/// would make double-running safe regardless, but leadership avoids wasted work).
pub struct IncidentContinuationSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
    pub engine: Arc<ExecutionEngine>,
}

#[async_trait::async_trait]
impl crate::engine::subscription::ReactiveSubscription for IncidentContinuationSubscription {
    fn name(&self) -> &'static str {
        "incident_continuation"
    }

    fn interval(&self) -> std::time::Duration {
        std::time::Duration::from_secs(60)
    }

    fn idle_interval(&self) -> std::time::Duration {
        std::time::Duration::from_secs(300)
    }

    fn initial_delay(&self) -> std::time::Duration {
        std::time::Duration::from_secs(30)
    }

    async fn tick(&self) {
        run_tick(self.engine.clone(), self.app.clone(), self.pool.clone()).await;
    }
}
