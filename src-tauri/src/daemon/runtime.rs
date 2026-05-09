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
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::engine::background::SchedulerState;
use crate::engine::events::NoOpEmitter;
use crate::engine::failover::ProviderCircuitBreaker;
use crate::engine::runner;
use crate::engine::types::ExecutionState;

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
                let _ =
                    event_repo::update_status(pool, &event.id, PersonaEventStatus::Delivered, None);
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
            let _ = event_repo::update_status(pool, &event.id, PersonaEventStatus::Pending, None);
            continue;
        }

        if !persona.enabled {
            tracing::debug!(persona_id, "daemon: persona disabled, skipping");
            let _ = event_repo::update_status(pool, &event.id, PersonaEventStatus::Delivered, None);
            continue;
        }

        // Get tools for persona
        let tools = tool_repo::get_tools_for_persona(pool, &persona_id).unwrap_or_default();

        // Create execution record
        let exec = match exec_repo::create(
            pool,
            &persona_id,
            event.source_id.clone(), // trigger_id
            event.payload.clone(),   // input_data
            None,                    // model_used
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
        let _ = event_repo::update_status(pool, &event.id, PersonaEventStatus::Delivered, None);

        // Build input JSON from event payload
        let input_data: Option<serde_json::Value> = event
            .payload
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok());

        // NoOp emitter — daemon has no UI
        let emitter: Arc<dyn crate::engine::events::ExecutionEventEmitter> =
            Arc::new(NoOpEmitter::new());
        let cancelled = Arc::new(AtomicBool::new(false));

        // Phase 3 c v3: inject ambient desktop signals captured by
        // the windowed app's clipboard/app_focus monitors. Cross-
        // process bridge — signals reach the daemon via the
        // ambient_signal SQL projection (see ambient_signal_repo).
        // Same shadow shape as the windowed runner's injection in
        // engine/mod.rs::run_execution_with_ceiling, for byte-
        // identical prompt rendering between the two paths.
        //
        // Phase 5 v1: After ambient injection, also try to inject
        // the user's active Claude CLI session — gated by both the
        // persona's `cli_awareness_enabled` and the persisted global
        // `cli_session_awareness_enabled` flag in app_settings. The
        // daemon reads the global gate from SQL because it has no
        // access to AmbientContextFusion's in-memory state.
        #[cfg(feature = "desktop")]
        let persona = {
            let mut persona = persona;
            inject_ambient_for_daemon(pool, &mut persona);
            inject_cli_session_for_daemon(pool, &mut persona);
            persona
        };

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

/// Phase 3 c v3 — daemon-side ambient context injection.
///
/// The windowed app's `AmbientContextFusion` is in-memory only, so
/// the daemon process can't see signals captured by clipboard / app
/// focus monitors. The cross-process bridge is the `ambient_signal`
/// SQL table (see `ambient_signal_repo`): capture-side writes
/// redacted rows; this function reads them at execution time,
/// applies the persona's effective `SensoryPolicy`, renders the
/// prompt block via the shared `format_signals_for_prompt`, and
/// prepends to the persona's system prompt.
///
/// Policy choice: the daemon uses `SensoryPolicy::default()`. Per-
/// persona policy overrides live in the windowed app's in-process
/// fusion registry and aren't yet visible cross-process. The
/// capture-time per-source gates (clipboard_enabled / app_focus_
/// enabled) already filter what reaches SQL in the first place,
/// so the daemon's default-policy view is conservative-by-construction.
///
/// Failure modes are non-fatal — a SQL load error or a None render
/// just means this execution runs without ambient context, identical
/// to the pre-Phase-3-c daemon behavior.
#[cfg(feature = "desktop")]
fn inject_ambient_for_daemon(pool: &DbPool, persona: &mut crate::db::models::Persona) {
    use crate::engine::ambient_context;
    use crate::engine::ambient_signal_repo;

    let policy = ambient_context::SensoryPolicy::default();
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let since_secs = now_secs.saturating_sub(policy.max_age_secs);

    let signals = match ambient_signal_repo::recent_signals(
        pool,
        since_secs,
        policy.max_window_size,
    ) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(
                error = %e,
                "daemon: failed to load ambient signals; running without ambient context"
            );
            return;
        }
    };

    // Mirror the per-source policy filter that AmbientContextFusion
    // applies for in-memory signals. Age + window-size were already
    // enforced by the SQL query parameters above.
    let filtered: Vec<_> = signals
        .into_iter()
        .filter(|s| match s.source.as_str() {
            "clipboard" => policy.clipboard,
            "file_watcher" => policy.file_changes,
            "app_focus" => policy.app_focus,
            _ => false,
        })
        .collect();

    // Active-app label is omitted in the daemon path: the
    // AmbientContextFusion's `current_app` / `current_window_title`
    // fields are in-process state and don't cross to SQL. The most
    // recent app_focus signal in the rolling list still surfaces the
    // same information inline. Future enhancement could parse the
    // newest app_focus summary to reconstruct the label.
    if let Some(md) = ambient_context::format_signals_for_prompt(&filtered, None) {
        ambient_context::prepend_ambient_to_system_prompt(persona, &md);
        tracing::debug!(
            persona_id = %persona.id,
            signal_count = filtered.len(),
            "daemon: ambient context prepended to persona system prompt"
        );
    }
}

/// Phase 5 v1 — daemon-side Claude CLI session-resume injection.
///
/// The daemon binary cannot see AmbientContextFusion's in-memory
/// `cli_session_enabled` flag — it lives in the windowed app's
/// process. The bridge is the `app_settings` row keyed by
/// `CLI_SESSION_AWARENESS_ENABLED`: the windowed-app toggle command
/// writes there, the daemon reads from there. Both gates must be true:
/// per-persona `cli_awareness_enabled` AND the persisted global flag.
///
/// Failure modes (all non-fatal):
/// - `app_settings` row missing → treated as `false` (privacy-conservative).
/// - Settings query error → logged, treated as `false`.
/// - `dirs::home_dir()` returns None → no transcript discovery, no-op.
/// - Discovery returns None (no fresh session, or no .claude/projects/) → no-op.
/// - Empty transcript → renderer returns None → no-op.
#[cfg(feature = "desktop")]
fn inject_cli_session_for_daemon(pool: &DbPool, persona: &mut crate::db::models::Persona) {
    use crate::engine::cli_session_awareness::{discovery, render, transcript};

    if !persona.cli_awareness_enabled {
        return;
    }

    // Cross-process gate read.
    let global_enabled = match crate::db::repos::core::settings::get(
        pool,
        crate::db::settings_keys::CLI_SESSION_AWARENESS_ENABLED,
    ) {
        Ok(Some(v)) => v == "true",
        Ok(None) => false,
        Err(e) => {
            tracing::warn!(
                error = %e,
                "daemon: failed to read cli_session_awareness_enabled; treating as off"
            );
            false
        }
    };
    if !global_enabled {
        return;
    }

    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };

    let now = std::time::SystemTime::now();
    let active = match discovery::discover_active_session(
        &home,
        now,
        discovery::DEFAULT_FRESHNESS_CUTOFF,
    ) {
        Some(a) => a,
        None => return,
    };

    let turns = transcript::read_recent_turns(&active.path, 8);
    if let Some(md) = render::render_cli_session_for_prompt(&active, &turns, now) {
        crate::engine::ambient_context::prepend_ambient_to_system_prompt(persona, &md);
        tracing::debug!(
            persona_id = %persona.id,
            project = %active.project_dir_name,
            turn_count = turns.len(),
            "daemon: CLI session prepended to persona system prompt"
        );

        // Phase 5 v1: audit row for the transparency modal. Same
        // shape as the windowed runner's insert.
        let read_at_secs = now
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let audit_id = format!("cliread_{}", uuid::Uuid::new_v4().simple());
        if let Err(e) = crate::engine::cli_session_audit_repo::insert_audit(
            pool,
            &audit_id,
            &persona.id,
            &persona.name,
            &active.project_dir_name,
            turns.len() as i64,
            read_at_secs,
        ) {
            tracing::warn!(
                error = %e,
                persona_id = %persona.id,
                "daemon cli_session: failed to write audit row"
            );
        }
    }
}
