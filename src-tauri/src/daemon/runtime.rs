//! Daemon trigger runtime — headless trigger evaluation and execution.
//!
//! This module provides the core loop for the `personas-daemon` binary:
//! 1. Poll due triggers (same logic as the windowed app's scheduler tick).
//! 2. Consume events published for headless personas.
//! 3. Execute personas via `runner::run_execution` with a `NoOpEmitter`.
//!
//! Phase 0: simplified serial execution (no concurrency tracker, no queue
//! management). The daemon processes one execution at a time. This is
//! correct for the target use case (scheduled cron agents on an always-on
//! workstation) where executions are infrequent.
//!
//! Credentials are decrypted from the local DB via the existing master
//! key path (OS keychain or DPAPI fallback). They never leave the machine.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::db::models::{PersonaEventStatus, UpdateExecutionStatus};
use crate::engine::types::ExecutionState;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::engine::background::SchedulerState;
use crate::engine::events::NoOpEmitter;
use crate::engine::failover::ProviderCircuitBreaker;
use crate::engine::runner;

use super::lock::TriggerKind;

/// Run one cycle of the daemon: evaluate triggers, consume events, execute.
///
/// Called every tick (5s) by the daemon's main loop. Returns the number
/// of executions completed this tick (0 in the common case).
pub async fn daemon_tick(
    scheduler: &SchedulerState,
    pool: &DbPool,
    log_dir: &Path,
    circuit_breaker: &Arc<ProviderCircuitBreaker>,
    child_pids: &Arc<Mutex<HashMap<String, u32>>>,
    _owns: &[TriggerKind],
) -> u32 {
    // 1. Fire due triggers (publishes events into persona_events table).
    let fired = crate::engine::background::trigger_scheduler_tick_counted(scheduler, pool);
    if fired > 0 {
        tracing::info!(fired, "daemon: trigger tick fired {fired} trigger(s)");
    }

    // 2. Consume pending events for headless personas and execute.
    let executed = consume_headless_events(pool, log_dir, circuit_breaker, child_pids).await;
    if executed > 0 {
        tracing::info!(executed, "daemon: completed {executed} execution(s)");
    }

    executed
}

/// Consume pending events targeting headless personas and execute them.
///
/// Uses `claim_pending` for atomic event claiming (prevents the windowed
/// app from racing us). Only executes events whose target persona has
/// `headless = true`. Events for non-headless personas are released back
/// to pending status for the windowed app.
async fn consume_headless_events(
    pool: &DbPool,
    log_dir: &Path,
    circuit_breaker: &Arc<ProviderCircuitBreaker>,
    child_pids: &Arc<Mutex<HashMap<String, u32>>>,
) -> u32 {
    // Atomically claim up to 5 pending events
    let events = match event_repo::claim_pending(pool, 5) {
        Ok(e) => e,
        Err(e) => {
            tracing::error!(error = %e, "daemon: failed to claim pending events");
            return 0;
        }
    };

    if events.is_empty() {
        return 0;
    }

    let mut executed = 0;

    for event in events {
        let persona_id = match &event.target_persona_id {
            Some(id) => id.clone(),
            None => {
                // No target persona — mark processed and skip
                let _ = event_repo::update_status(
                    pool,
                    &event.id,
                    PersonaEventStatus::Delivered,
                    None,
                );
                continue;
            }
        };

        // Look up persona
        let persona = match persona_repo::get_by_id(pool, &persona_id) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(persona_id, error = %e, "daemon: persona not found, skipping");
                let _ = event_repo::update_status(
                    pool,
                    &event.id,
                    PersonaEventStatus::Failed,
                    Some(format!("persona not found: {e}")),
                );
                continue;
            }
        };

        // Only execute headless personas. Release non-headless events back
        // to pending so the windowed app can pick them up.
        if !persona.headless {
            let _ = event_repo::update_status(
                pool,
                &event.id,
                PersonaEventStatus::Pending,
                None,
            );
            continue;
        }

        if !persona.enabled {
            tracing::debug!(persona_id, "daemon: persona disabled, skipping");
            let _ = event_repo::update_status(
                pool,
                &event.id,
                PersonaEventStatus::Delivered,
                None,
            );
            continue;
        }

        // Get tools for persona
        let tools = tool_repo::get_tools_for_persona(pool, &persona_id).unwrap_or_default();

        // Create execution record
        let exec = match exec_repo::create(
            pool,
            &persona_id,
            event.source_id.clone(),  // trigger_id
            event.payload.clone(),    // input_data
            None,                     // model_used
            event.use_case_id.clone(),
        ) {
            Ok(e) => e,
            Err(e) => {
                tracing::error!(persona_id, error = %e, "daemon: failed to create execution");
                let _ = event_repo::update_status(
                    pool,
                    &event.id,
                    PersonaEventStatus::Failed,
                    Some(format!("execution create failed: {e}")),
                );
                continue;
            }
        };

        tracing::info!(
            execution_id = %exec.id,
            persona_id,
            persona_name = %persona.name,
            "daemon: starting execution"
        );

        // Mark event as processed before execution starts
        let _ = event_repo::update_status(
            pool,
            &event.id,
            PersonaEventStatus::Delivered,
            None,
        );

        // Build input JSON from event payload
        let input_data: Option<serde_json::Value> = event
            .payload
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok());

        // NoOp emitter — daemon has no UI
        let emitter: Arc<dyn crate::engine::events::ExecutionEventEmitter> =
            Arc::new(NoOpEmitter::new());
        let cancelled = Arc::new(AtomicBool::new(false));

        // Execute synchronously (Phase 0 — serial, one at a time)
        let result = runner::run_execution(
            emitter,
            pool.clone(),
            exec.id.clone(),
            persona,
            tools,
            input_data,
            log_dir.to_path_buf(),
            child_pids.clone(),
            cancelled,
            None, // no continuation
            None, // no chain trace
            circuit_breaker.clone(),
        )
        .await;

        // Update execution status in DB
        let status = if result.success {
            ExecutionState::Completed
        } else {
            ExecutionState::Failed
        };
        let _ = exec_repo::update_status(
            pool,
            &exec.id,
            UpdateExecutionStatus {
                status,
                error_message: result.error.clone(),
                duration_ms: Some(result.duration_ms as i64),
                cost_usd: Some(result.cost_usd),
                output_tokens: Some(result.output_tokens as i64),
                input_tokens: Some(result.input_tokens as i64),
                log_file_path: result.log_file_path.clone(),
                ..Default::default()
            },
        );

        if result.success {
            tracing::info!(
                execution_id = %exec.id,
                duration_ms = result.duration_ms,
                "daemon: execution completed"
            );
        } else {
            tracing::error!(
                execution_id = %exec.id,
                error = ?result.error,
                "daemon: execution failed"
            );
        }

        executed += 1;
    }

    executed
}
