pub mod background;
pub mod bus;
pub mod chain;
pub mod compiler;
pub mod credential_design;
pub mod dispatch;
pub mod credential_negotiator;
pub mod cron;
pub mod crypto;
pub mod design;
pub mod eval;
pub mod google_oauth;
pub mod healing;
pub mod healthcheck;
pub mod logger;
pub mod optimizer;
pub mod parser;
pub mod pipeline;
pub mod polling;
pub mod topology;
pub mod prompt;
pub mod provider;
pub mod queue;
pub mod rotation;
pub mod runner;
pub mod scheduler;
pub mod subscription;
pub mod test_runner;
pub mod types;
pub mod webhook;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

use tauri::Emitter;

use crate::db::models::{ConnectorDefinition, Persona, PersonaToolDefinition, UpdateExecutionStatus};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::healing as healing_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::error::AppError;

use self::types::{ExecutionResult, ExecutionState, HealingEventPayload};

use self::queue::ConcurrencyTracker;

/// Try to write an execution status update to the DB. On failure, log at error
/// level, retry once after 1 second, and if still failing emit a healing event
/// so the user knows their execution result was lost.
pub(crate) fn persist_status_update(
    pool: &DbPool,
    app: Option<&AppHandle>,
    exec_id: &str,
    update: UpdateExecutionStatus,
) {
    if let Err(e) = exec_repo::update_status(pool, exec_id, update.clone()) {
        tracing::error!(
            execution_id = %exec_id,
            error = %e,
            "DB status update failed, retrying in 1s",
        );

        std::thread::sleep(std::time::Duration::from_secs(1));

        if let Err(e2) = exec_repo::update_status(pool, exec_id, update) {
            tracing::error!(
                execution_id = %exec_id,
                error = %e2,
                "DB status update failed on retry — execution result lost",
            );

            if let Some(app) = app {
                let _ = app.emit(
                    "healing-event",
                    HealingEventPayload {
                        issue_id: String::new(),
                        persona_id: String::new(),
                        execution_id: exec_id.into(),
                        title: "Execution result lost: DB write failed".into(),
                        action: "issue_created".into(),
                        auto_fixed: false,
                        severity: "critical".into(),
                        suggested_fix: Some(format!(
                            "Status update for execution {} could not be saved: {}",
                            exec_id, e2,
                        )),
                        persona_name: String::new(),
                    },
                );
            }
        }
    }
}

/// Maximum consecutive failures before the circuit breaker trips.
const CIRCUIT_BREAKER_THRESHOLD: u32 = 5;
/// Maximum number of retries for a single execution chain.
const MAX_RETRY_COUNT: i64 = 3;

/// The top-level execution engine. Stored in AppState via Arc.
pub struct ExecutionEngine {
    tracker: Arc<Mutex<ConcurrencyTracker>>,
    /// Active tokio task handles for cancellation
    tasks: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    /// PIDs of spawned CLI child processes, keyed by execution ID.
    /// Used by cancel_execution to kill the OS process before aborting the task.
    pub(crate) child_pids: Arc<Mutex<HashMap<String, u32>>>,
    /// Per-execution cancellation flags. Set to true when cancel is requested.
    /// The spawned task checks this before writing final status to DB.
    cancelled_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    /// Log directory
    log_dir: PathBuf,
}

impl ExecutionEngine {
    pub fn new(log_dir: PathBuf) -> Self {
        Self {
            tracker: Arc::new(Mutex::new(ConcurrencyTracker::new())),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            child_pids: Arc::new(Mutex::new(HashMap::new())),
            cancelled_flags: Arc::new(Mutex::new(HashMap::new())),
            log_dir,
        }
    }

    /// Mark any executions left in running/queued state as failed.
    ///
    /// After an app restart, any previously running executions are orphaned
    /// (their processes are dead). This prevents the ConcurrencyTracker from
    /// being out of sync with DB state and avoids exceeding max_concurrent.
    pub fn recover_stale_executions(pool: &DbPool) {
        match exec_repo::get_running(pool) {
            Ok(stale) if stale.is_empty() => {
                tracing::debug!("No stale executions to recover");
            }
            Ok(stale) => {
                let count = stale.len();
                for exec in &stale {
                    persist_status_update(
                        pool,
                        None,
                        &exec.id,
                        UpdateExecutionStatus {
                            status: ExecutionState::Failed,
                            error_message: Some("App restarted while execution was running".into()),
                            ..Default::default()
                        },
                    );
                }
                tracing::info!(
                    count = count,
                    "Recovered stale executions: marked {} as failed",
                    count
                );
            }
            Err(e) => {
                tracing::warn!("Failed to query stale executions: {}", e);
            }
        }
    }

    /// Check if a persona has capacity for another execution.
    pub async fn has_capacity(&self, persona_id: &str, max_concurrent: i32) -> bool {
        self.tracker
            .lock()
            .await
            .has_capacity(persona_id, max_concurrent)
    }

    /// Start an execution in a background tokio task.
    pub async fn start_execution(
        &self,
        app: AppHandle,
        pool: DbPool,
        execution_id: String,
        persona: Persona,
        tools: Vec<PersonaToolDefinition>,
        input_data: Option<serde_json::Value>,
        continuation: Option<types::Continuation>,
    ) -> Result<(), AppError> {
        // Atomically check capacity and register in tracker
        {
            let mut tracker = self.tracker.lock().await;
            if !tracker.try_add_running(&persona.id, &execution_id, persona.max_concurrent) {
                return Err(AppError::Validation(format!(
                    "Persona '{}' has reached max concurrent executions ({})",
                    persona.name, persona.max_concurrent
                )));
            }
        }

        // Create cancellation flag for this execution
        let cancelled = Arc::new(AtomicBool::new(false));
        self.cancelled_flags
            .lock()
            .await
            .insert(execution_id.clone(), cancelled.clone());

        let exec_id = execution_id.clone();
        let persona_id = persona.id.clone();
        let persona_timeout_ms = persona.timeout_ms;
        let log_dir = self.log_dir.clone();
        let pool_clone = pool.clone();

        // Clone AppHandle so the healing hook can emit events after run_execution
        let app_for_healing = app.clone();

        // Clone Arcs for the spawned task
        let tracker = self.tracker.clone();
        let tasks = self.tasks.clone();
        let child_pids = self.child_pids.clone();
        let cancelled_flags = self.cancelled_flags.clone();

        // Clone log_dir for potential healing retries (log_dir is moved into run_execution)
        let log_dir_for_retry = log_dir.clone();

        // Spawn background task
        let handle = tokio::spawn(async move {
            let result = runner::run_execution(
                app,
                pool_clone.clone(),
                exec_id.clone(),
                persona,
                tools,
                input_data,
                log_dir,
                child_pids.clone(),
                cancelled.clone(),
                continuation,
            )
            .await;

            if cancelled.load(Ordering::Acquire) {
                // Cancelled: write accumulated metrics to DB so cost/token
                // tracking remains accurate. cancel_execution already wrote a
                // bare status='cancelled'; this overwrites the zero-valued
                // fields with whatever the runner collected before the process
                // was killed (COALESCE in the SQL keeps existing non-NULL values).
                persist_status_update(
                    &pool_clone,
                    Some(&app_for_healing),
                    &exec_id,
                    UpdateExecutionStatus {
                        status: ExecutionState::Cancelled,
                        error_message: Some("Cancelled by user".into()),
                        duration_ms: Some(result.duration_ms as i64),
                        log_file_path: result.log_file_path.clone(),
                        input_tokens: Some(result.input_tokens as i64),
                        output_tokens: Some(result.output_tokens as i64),
                        cost_usd: Some(result.cost_usd),
                        tool_steps: result.tool_steps.clone(),
                        ..Default::default()
                    },
                );
            } else {
                handle_execution_result(
                    &pool_clone,
                    &app_for_healing,
                    &exec_id,
                    &persona_id,
                    persona_timeout_ms,
                    &result,
                    tracker.clone(),
                    child_pids.clone(),
                    cancelled_flags.clone(),
                    log_dir_for_retry.clone(),
                );
            }

            // Clean up tracker and task handle (always, regardless of cancellation)
            tracker
                .lock()
                .await
                .remove_running(&persona_id, &exec_id);
            tasks.lock().await.remove(&exec_id);
            cancelled_flags.lock().await.remove(&exec_id);
        });

        // Store the task handle
        self.tasks.lock().await.insert(execution_id, handle);

        Ok(())
    }

    /// Cancel a running execution.
    ///
    /// Sets the cancellation flag, writes a bare cancelled status to DB as a
    /// safety net, kills the child process, then gives the spawned task a brief
    /// window to finish and write accumulated metrics (cost, tokens, duration)
    /// before falling back to abort.
    pub async fn cancel_execution(
        &self,
        execution_id: &str,
        pool: &DbPool,
        persona_id: Option<&str>,
    ) -> bool {
        // 1. Set cancellation flag — tells the spawned task to write
        //    status='cancelled' with metrics instead of completed/failed
        if let Some(flag) = self.cancelled_flags.lock().await.get(execution_id) {
            flag.store(true, Ordering::Release);
        }

        // 2. Write bare cancelled status to DB as a safety net.
        //    The spawned task will overwrite this with metrics data if it
        //    finishes in time. COALESCE in SQL means a later update with
        //    real values will replace these defaults.
        persist_status_update(
            pool,
            None,
            execution_id,
            UpdateExecutionStatus {
                status: ExecutionState::Cancelled,
                ..Default::default()
            },
        );

        // 3. Kill the child OS process to stop API credit consumption.
        //    Once killed, run_execution will return quickly with whatever
        //    metrics were accumulated so far.
        if let Some(pid) = self.child_pids.lock().await.remove(execution_id) {
            tracing::info!(execution_id = %execution_id, pid = pid, "Killing child process");
            kill_process(pid);
        }

        // 4. Give the spawned task up to 5 seconds to finish writing metrics.
        //    The process is dead so the runner should return almost immediately;
        //    this timeout is just a safety net for edge cases.
        if let Some(handle) = self.tasks.lock().await.remove(execution_id) {
            match tokio::time::timeout(
                std::time::Duration::from_secs(5),
                handle,
            )
            .await
            {
                Ok(_) => {
                    // Task finished normally — metrics written to DB
                }
                Err(_) => {
                    tracing::warn!(
                        execution_id = %execution_id,
                        "Cancel: task did not finish within grace period, aborting",
                    );
                    // Timeout expired — the task handle was consumed by the
                    // timeout future so we can't abort it, but since the
                    // child process is dead, the runner's stdout reader will
                    // hit EOF soon and the task will complete on its own.
                    // The bare cancelled status from step 2 is already in DB.
                }
            }
        }

        // 5. Clean up tracker
        if let Some(pid) = persona_id {
            self.tracker.lock().await.remove_running(pid, execution_id);
        }

        // 6. Clean up the cancelled flag (may already be cleaned up by the task)
        self.cancelled_flags.lock().await.remove(execution_id);

        true
    }

    // =========================================================================
    // Cloud execution helpers
    // =========================================================================

    /// Register a cloud execution task in the engine's tracker.
    ///
    /// Uses the same data structures as local execution so that
    /// cancellation and cleanup work identically.
    pub async fn register_cloud_task(
        &self,
        persona_id: &str,
        execution_id: String,
        cancelled: Arc<AtomicBool>,
        handle: tokio::task::JoinHandle<()>,
    ) {
        self.tracker
            .lock()
            .await
            .add_running(persona_id, &execution_id);
        self.cancelled_flags
            .lock()
            .await
            .insert(execution_id.clone(), cancelled);
        self.tasks.lock().await.insert(execution_id, handle);
    }

    /// Cancel a cloud execution.
    ///
    /// Same as `cancel_execution` but without the child PID kill step
    /// (cloud executions have no local OS process).
    pub async fn cancel_cloud_execution(
        &self,
        execution_id: &str,
        pool: &DbPool,
        persona_id: Option<&str>,
    ) -> bool {
        // 1. Set cancellation flag
        if let Some(flag) = self.cancelled_flags.lock().await.get(execution_id) {
            flag.store(true, Ordering::Release);
        }

        // 2. Write cancelled status to DB
        persist_status_update(
            pool,
            None,
            execution_id,
            UpdateExecutionStatus {
                status: ExecutionState::Cancelled,
                ..Default::default()
            },
        );

        // 3. Clean up tracker
        if let Some(pid) = persona_id {
            self.tracker.lock().await.remove_running(pid, execution_id);
        }

        // 4. Clean up cancelled flag
        self.cancelled_flags.lock().await.remove(execution_id);

        // 5. Abort the tokio task
        if let Some(handle) = self.tasks.lock().await.remove(execution_id) {
            handle.abort();
            return true;
        }
        false
    }

    /// Get the cancellation flag for an execution (used by cloud commands).
    pub async fn get_cancelled_flag(
        &self,
        execution_id: &str,
    ) -> Option<Arc<AtomicBool>> {
        self.cancelled_flags.lock().await.get(execution_id).cloned()
    }

    /// Schedule a healing retry based on a diagnosis.
    ///
    /// Called from the manual `run_healing_analysis` command to execute
    /// auto-fixable healing actions (RetryWithBackoff, RetryWithTimeout).
    pub fn schedule_healing_retry(
        &self,
        app: &AppHandle,
        pool: &DbPool,
        exec_id: &str,
        persona_id: &str,
        diagnosis: &healing::HealingDiagnosis,
    ) {
        let current_retry_count = exec_repo::get_by_id(pool, exec_id)
            .map(|e| e.retry_count)
            .unwrap_or(0);
        let original_exec_id = exec_repo::get_by_id(pool, exec_id)
            .ok()
            .and_then(|e| e.retry_of_execution_id)
            .unwrap_or_else(|| exec_id.to_string());

        let next_retry_count = current_retry_count + 1;

        match &diagnosis.action {
            healing::HealingAction::RetryWithBackoff { delay_secs } => {
                tracing::info!(
                    persona_id = %persona_id,
                    delay_secs = delay_secs,
                    "Healing analysis: scheduling retry with {}s backoff",
                    delay_secs,
                );
                spawn_delayed_retry(
                    *delay_secs,
                    None,
                    pool.clone(),
                    app.clone(),
                    persona_id.to_string(),
                    original_exec_id,
                    next_retry_count,
                    self.tracker.clone(),
                    self.child_pids.clone(),
                    self.cancelled_flags.clone(),
                    self.log_dir.clone(),
                );
            }
            healing::HealingAction::RetryWithTimeout { new_timeout_ms } => {
                tracing::info!(
                    persona_id = %persona_id,
                    new_timeout_ms = new_timeout_ms,
                    "Healing analysis: scheduling retry with increased timeout {}ms",
                    new_timeout_ms,
                );
                spawn_delayed_retry(
                    5,
                    Some(*new_timeout_ms),
                    pool.clone(),
                    app.clone(),
                    persona_id.to_string(),
                    original_exec_id,
                    next_retry_count,
                    self.tracker.clone(),
                    self.child_pids.clone(),
                    self.cancelled_flags.clone(),
                    self.log_dir.clone(),
                );
            }
            healing::HealingAction::CreateIssue => {}
        }
    }
}

/// Kill an OS process by PID. Cross-platform.
pub(crate) fn kill_process(pid: u32) {
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        // Use taskkill /F /T to kill the process tree (child and its descendants)
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output();
    }
    #[cfg(not(windows))]
    {
        // Use kill -9 to forcibly terminate the process
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
}

// =============================================================================
// Extracted sub-functions for start_execution post-processing
// =============================================================================

/// Handle the result of a completed execution: write status, notify, enforce
/// budget, evaluate chain triggers, and run healing/retry if needed.
#[allow(clippy::too_many_arguments)]
fn handle_execution_result(
    pool: &DbPool,
    app: &AppHandle,
    exec_id: &str,
    persona_id: &str,
    persona_timeout_ms: i32,
    result: &ExecutionResult,
    tracker: Arc<Mutex<ConcurrencyTracker>>,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    log_dir: PathBuf,
) {
    let status = if result.success { ExecutionState::Completed } else { ExecutionState::Failed };

    // Write final status to DB
    persist_status_update(
        pool,
        Some(app),
        exec_id,
        UpdateExecutionStatus {
            status,
            output_data: result.output.clone(),
            error_message: result.error.clone(),
            duration_ms: Some(result.duration_ms as i64),
            log_file_path: result.log_file_path.clone(),
            execution_flows: result.execution_flows.clone(),
            input_tokens: Some(result.input_tokens as i64),
            output_tokens: Some(result.output_tokens as i64),
            cost_usd: Some(result.cost_usd),
            tool_steps: result.tool_steps.clone(),
        },
    );

    // OS Notification
    notify_execution(app, pool, persona_id, status.as_str(), result.duration_ms);

    // Budget enforcement (only on success)
    if result.success {
        check_budget_enforcement(pool, persona_id, exec_id);
    }

    // Chain triggers — extract chain depth/visited from execution's input_data
    // (propagated via chain event payloads to prevent infinite cycles)
    let (chain_depth, mut visited) = exec_repo::get_by_id(pool, exec_id)
        .ok()
        .and_then(|exec| exec.input_data)
        .map(|input| chain::extract_chain_metadata(Some(&input)))
        .unwrap_or_default();
    visited.insert(persona_id.to_string());

    chain::evaluate_chain_triggers(
        pool,
        persona_id,
        status.as_str(),
        result.output.as_deref(),
        exec_id,
        chain_depth,
        &visited,
    );

    // Healing check for failed executions
    if !result.success {
        evaluate_healing_and_retry(
            pool,
            app,
            exec_id,
            persona_id,
            persona_timeout_ms,
            result,
            tracker,
            child_pids,
            cancelled_flags,
            log_dir,
        );
    }

    // Refresh system tray
    crate::tray::refresh_tray(app);
}

/// Send an OS notification for execution completion.
fn notify_execution(
    app: &AppHandle,
    pool: &DbPool,
    persona_id: &str,
    status: &str,
    duration_ms: u64,
) {
    let persona = persona_repo::get_by_id(pool, persona_id).ok();
    let channels = persona.as_ref().and_then(|p| p.notification_channels.as_deref());
    let name = persona.as_ref().map(|p| p.name.as_str()).unwrap_or("Agent");
    crate::notifications::notify_execution_completed(app, name, status, duration_ms, channels);
}

/// Check if the persona has exceeded its monthly budget and create an alert.
fn check_budget_enforcement(pool: &DbPool, persona_id: &str, exec_id: &str) {
    let monthly_spend = exec_repo::get_monthly_spend(pool, persona_id).unwrap_or(0.0);
    let persona = persona_repo::get_by_id(pool, persona_id).ok();

    if let Some(ref p) = persona {
        if let Some(budget) = p.max_budget_usd {
            if budget > 0.0 && monthly_spend >= budget {
                let alert_content = format!(
                    "Budget alert: {} has spent ${:.4} this month (budget: ${:.2}). Agent may be automatically paused.",
                    p.name, monthly_spend, budget
                );
                let _ = crate::db::repos::communication::messages::create(
                    pool,
                    crate::db::models::CreateMessageInput {
                        persona_id: persona_id.into(),
                        execution_id: Some(exec_id.into()),
                        title: Some("Budget Exceeded".into()),
                        content: alert_content,
                        content_type: Some("budget_alert".into()),
                        priority: Some("critical".into()),
                        metadata: None,
                    },
                );
                tracing::warn!(
                    persona_id = %persona_id,
                    monthly_spend = monthly_spend,
                    budget = budget,
                    "Budget exceeded for persona"
                );
            }
        }
    }
}

/// Evaluate a failed execution for healing opportunities and spawn retries.
#[allow(clippy::too_many_arguments)]
fn evaluate_healing_and_retry(
    pool: &DbPool,
    app: &AppHandle,
    exec_id: &str,
    persona_id: &str,
    persona_timeout_ms: i32,
    result: &ExecutionResult,
    tracker: Arc<Mutex<ConcurrencyTracker>>,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    log_dir: PathBuf,
) {
    let consecutive = exec_repo::get_recent_failures(pool, persona_id, 5)
        .unwrap_or_default()
        .len() as u32;

    let timeout_ms = if persona_timeout_ms > 0 {
        persona_timeout_ms as u64
    } else {
        600_000
    };

    let error_str = result.error.as_deref().unwrap_or("");
    let timed_out = error_str.contains("timed out");

    let category = healing::classify_error(error_str, timed_out, result.session_limit_reached);

    let kb_delay = resolve_service_knowledge_delay(pool, persona_id, &category);

    let diagnosis = healing::diagnose(&category, error_str, timeout_ms, consecutive);

    record_failure_to_knowledge_base(pool, persona_id, &category, &diagnosis);

    let current_retry_count = exec_repo::get_by_id(pool, exec_id)
        .map(|e| e.retry_count)
        .unwrap_or(0);

    let issue = match healing_repo::create(
        pool,
        persona_id,
        &diagnosis.title,
        &diagnosis.description,
        Some(&diagnosis.severity),
        Some(&diagnosis.db_category),
        Some(exec_id),
        diagnosis.suggested_fix.as_deref(),
    ) {
        Ok(issue) => issue,
        Err(_) => return,
    };

    let auto_fixed = healing::is_auto_fixable(&category)
        && consecutive < 3
        && current_retry_count < MAX_RETRY_COUNT;

    // Fetch persona info for notifications
    let persona_for_heal = persona_repo::get_by_id(pool, persona_id).ok();
    let heal_channels = persona_for_heal
        .as_ref()
        .and_then(|p| p.notification_channels.as_deref());
    let heal_name = persona_for_heal
        .as_ref()
        .map(|p| p.name.clone())
        .unwrap_or_else(|| "Agent".into());

    // Circuit breaker check
    if consecutive >= CIRCUIT_BREAKER_THRESHOLD {
        check_circuit_breaker(pool, app, exec_id, persona_id, consecutive, &issue.id, &heal_name);
    }

    if auto_fixed {
        let _ = healing_repo::mark_auto_fixed(pool, &issue.id);
    }

    // Notify healing issue
    crate::notifications::notify_healing_issue(
        app,
        &heal_name,
        &diagnosis.title,
        &diagnosis.severity,
        diagnosis.suggested_fix.as_deref(),
        heal_channels,
    );

    let _ = app.emit(
        "healing-event",
        HealingEventPayload {
            issue_id: issue.id,
            persona_id: persona_id.into(),
            execution_id: exec_id.into(),
            title: diagnosis.title.clone(),
            action: if auto_fixed {
                "auto_retry".into()
            } else {
                "issue_created".into()
            },
            auto_fixed,
            severity: diagnosis.severity.clone(),
            suggested_fix: diagnosis.suggested_fix.clone(),
            persona_name: heal_name,
        },
    );

    // Spawn retry if auto-fixable and under circuit breaker threshold
    if auto_fixed && consecutive < CIRCUIT_BREAKER_THRESHOLD {
        spawn_healing_retry(
            pool,
            app,
            exec_id,
            persona_id,
            current_retry_count,
            kb_delay,
            &diagnosis,
            tracker,
            child_pids,
            cancelled_flags,
            log_dir,
        );
    }
}

/// Disable persona after too many consecutive failures (circuit breaker).
fn check_circuit_breaker(
    pool: &DbPool,
    app: &AppHandle,
    exec_id: &str,
    persona_id: &str,
    consecutive: u32,
    issue_id: &str,
    persona_name: &str,
) {
    tracing::warn!(
        persona_id = %persona_id,
        consecutive = consecutive,
        "Circuit breaker tripped: disabling persona after {} consecutive failures",
        consecutive,
    );
    let _ = crate::db::repos::core::personas::update(
        pool,
        persona_id,
        crate::db::models::UpdatePersonaInput {
            enabled: Some(false),
            ..Default::default()
        },
    );
    let cb_fix = "Review recent failures and fix the underlying issue, then re-enable the persona.";
    let _ = healing_repo::create(
        pool,
        persona_id,
        "Circuit breaker tripped",
        &format!(
            "Persona disabled after {} consecutive failures. Re-enable manually after investigating the root cause.",
            consecutive,
        ),
        Some("critical"),
        Some("config"),
        Some(exec_id),
        Some(cb_fix),
    );
    let _ = app.emit(
        "healing-event",
        HealingEventPayload {
            issue_id: issue_id.into(),
            persona_id: persona_id.into(),
            execution_id: exec_id.into(),
            title: "Circuit breaker tripped".into(),
            action: "circuit_breaker".into(),
            auto_fixed: false,
            severity: "critical".into(),
            suggested_fix: Some(cb_fix.into()),
            persona_name: persona_name.into(),
        },
    );
}

/// Spawn a retry execution based on the healing diagnosis action.
#[allow(clippy::too_many_arguments)]
fn spawn_healing_retry(
    pool: &DbPool,
    app: &AppHandle,
    exec_id: &str,
    persona_id: &str,
    current_retry_count: i64,
    kb_delay: Option<u64>,
    diagnosis: &healing::HealingDiagnosis,
    tracker: Arc<Mutex<ConcurrencyTracker>>,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    log_dir: PathBuf,
) {
    let next_retry_count = current_retry_count + 1;
    let original_exec_id = exec_repo::get_by_id(pool, exec_id)
        .ok()
        .and_then(|e| e.retry_of_execution_id)
        .unwrap_or_else(|| exec_id.into());

    match &diagnosis.action {
        healing::HealingAction::RetryWithBackoff { delay_secs } => {
            let effective_delay = kb_delay
                .map(|kb| std::cmp::max(kb, *delay_secs))
                .unwrap_or(*delay_secs);
            tracing::info!(
                persona_id = %persona_id,
                delay_secs = effective_delay,
                retry_count = next_retry_count,
                "Healing: spawning delayed retry after {}s backoff",
                effective_delay,
            );
            spawn_delayed_retry(
                effective_delay,
                None,
                pool.clone(),
                app.clone(),
                persona_id.into(),
                original_exec_id,
                next_retry_count,
                tracker,
                child_pids,
                cancelled_flags,
                log_dir,
            );
        }
        healing::HealingAction::RetryWithTimeout { new_timeout_ms } => {
            tracing::info!(
                persona_id = %persona_id,
                new_timeout_ms = new_timeout_ms,
                retry_count = next_retry_count,
                "Healing: spawning retry with increased timeout {}ms",
                new_timeout_ms,
            );
            spawn_delayed_retry(
                5,
                Some(*new_timeout_ms),
                pool.clone(),
                app.clone(),
                persona_id.into(),
                original_exec_id,
                next_retry_count,
                tracker,
                child_pids,
                cancelled_flags,
                log_dir,
            );
        }
        _ => {}
    }
}

// =============================================================================
// Healing Executor: autonomous retry spawning
// =============================================================================

/// Spawn a delayed retry execution for a failed persona.
///
/// This is the core of the autonomous self-healing system. It:
/// 1. Sleeps for the specified backoff delay
/// 2. Loads the persona fresh from DB (may have been updated)
/// 3. Checks that the persona is still enabled (circuit breaker not tripped)
/// 4. Creates a new execution record with retry lineage
/// 5. Runs the execution via the standard runner
/// 6. Handles the result (writes status to DB, emits events)
#[allow(clippy::too_many_arguments)]
fn spawn_delayed_retry(
    delay_secs: u64,
    timeout_override_ms: Option<u64>,
    pool: DbPool,
    app: AppHandle,
    persona_id: String,
    original_exec_id: String,
    retry_count: i64,
    tracker: Arc<Mutex<ConcurrencyTracker>>,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    log_dir: PathBuf,
) {
    tokio::spawn(async move {
        // 1. Sleep for the backoff delay
        tracing::info!(
            persona_id = %persona_id,
            delay_secs = delay_secs,
            retry_count = retry_count,
            original_exec_id = %original_exec_id,
            "Healing retry: sleeping {}s before retry #{}",
            delay_secs, retry_count,
        );
        tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;

        // 2. Load persona fresh from DB
        let mut persona = match persona_repo::get_by_id(&pool, &persona_id) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!(
                    persona_id = %persona_id,
                    "Healing retry: failed to load persona: {}", e,
                );
                return;
            }
        };

        // 3. Check persona is still enabled (circuit breaker check)
        if !persona.enabled {
            tracing::warn!(
                persona_id = %persona_id,
                "Healing retry: persona disabled (circuit breaker), skipping retry",
            );
            return;
        }

        // 4. Apply timeout override if specified (for RetryWithTimeout healing)
        if let Some(override_ms) = timeout_override_ms {
            persona.timeout_ms = override_ms as i32;
            // Persist the increased timeout to the persona so future executions use it
            let _ = persona_repo::update(
                &pool,
                &persona_id,
                crate::db::models::UpdatePersonaInput {
                    timeout_ms: Some(override_ms as i32),
                    ..Default::default()
                },
            );
            tracing::info!(
                persona_id = %persona_id,
                new_timeout_ms = override_ms,
                "Healing: persisted increased timeout_ms to persona",
            );
        }

        // 5. Create retry execution record with lineage
        let exec = match exec_repo::create_retry(
            &pool,
            &persona_id,
            &original_exec_id,
            retry_count,
        ) {
            Ok(e) => e,
            Err(e) => {
                tracing::error!(
                    persona_id = %persona_id,
                    "Healing retry: failed to create execution record: {}", e,
                );
                return;
            }
        };

        let exec_id = exec.id.clone();

        // 6. Atomically check capacity and register in tracker
        {
            let mut t = tracker.lock().await;
            if !t.try_add_running(&persona_id, &exec_id, persona.max_concurrent) {
                tracing::warn!(
                    persona_id = %persona_id,
                    "Healing retry: no capacity, skipping retry",
                );
                return;
            }
        }

        // 7. Update to running
        persist_status_update(
            &pool,
            Some(&app),
            &exec_id,
            UpdateExecutionStatus {
                status: ExecutionState::Running,
                ..Default::default()
            },
        );

        // 9. Get tools for persona
        let tools = tool_repo::get_tools_for_persona(&pool, &persona_id)
            .unwrap_or_default();

        // 10. Create cancellation flag
        let cancelled = Arc::new(AtomicBool::new(false));
        cancelled_flags
            .lock()
            .await
            .insert(exec_id.clone(), cancelled.clone());

        tracing::info!(
            execution_id = %exec_id,
            persona_id = %persona_id,
            retry_count = retry_count,
            "Healing retry: starting execution",
        );

        // 11. Run the execution
        let result = runner::run_execution(
            app.clone(),
            pool.clone(),
            exec_id.clone(),
            persona.clone(),
            tools,
            None, // retry uses no additional input
            log_dir,
            child_pids.clone(),
            cancelled.clone(),
            None, // no continuation for healing retries
        )
        .await;

        // 12. Write final status
        if cancelled.load(Ordering::Acquire) {
            // Cancelled: preserve accumulated metrics so budget tracking
            // accounts for API spend consumed before the kill signal.
            persist_status_update(
                &pool,
                Some(&app),
                &exec_id,
                UpdateExecutionStatus {
                    status: ExecutionState::Cancelled,
                    error_message: Some("Cancelled by user".into()),
                    duration_ms: Some(result.duration_ms as i64),
                    log_file_path: result.log_file_path.clone(),
                    input_tokens: Some(result.input_tokens as i64),
                    output_tokens: Some(result.output_tokens as i64),
                    cost_usd: Some(result.cost_usd),
                    tool_steps: result.tool_steps.clone(),
                    ..Default::default()
                },
            );
        } else {
            let status = if result.success { ExecutionState::Completed } else { ExecutionState::Failed };
            persist_status_update(
                &pool,
                Some(&app),
                &exec_id,
                UpdateExecutionStatus {
                    status,
                    output_data: result.output.clone(),
                    error_message: result.error.clone(),
                    duration_ms: Some(result.duration_ms as i64),
                    log_file_path: result.log_file_path.clone(),
                    execution_flows: result.execution_flows.clone(),
                    input_tokens: Some(result.input_tokens as i64),
                    output_tokens: Some(result.output_tokens as i64),
                    cost_usd: Some(result.cost_usd),
                    tool_steps: result.tool_steps.clone(),
                },
            );

            // Emit status to frontend
            let _ = app.emit(
                "execution-status",
                types::ExecutionStatusEvent {
                    execution_id: exec_id.clone(),
                    status,
                    error: result.error.clone(),
                    duration_ms: Some(result.duration_ms),
                    cost_usd: Some(result.cost_usd),
                },
            );

            if result.success {
                tracing::info!(
                    execution_id = %exec_id,
                    persona_id = %persona_id,
                    retry_count = retry_count,
                    "Healing retry: execution succeeded!",
                );
            } else {
                tracing::warn!(
                    execution_id = %exec_id,
                    persona_id = %persona_id,
                    retry_count = retry_count,
                    "Healing retry: execution failed again",
                );
            }

            // Notification
            {
                let persona_for_notify =
                    persona_repo::get_by_id(&pool, &persona_id).ok();
                let notif_channels = persona_for_notify
                    .as_ref()
                    .and_then(|p| p.notification_channels.as_deref());
                let p_name = persona_for_notify
                    .as_ref()
                    .map(|p| p.name.as_str())
                    .unwrap_or("Agent");
                crate::notifications::notify_execution_completed(
                    &app,
                    p_name,
                    status.as_str(),
                    result.duration_ms,
                    notif_channels,
                );
            }
        }

        // 13. Cleanup
        tracker.lock().await.remove_running(&persona_id, &exec_id);
        cancelled_flags.lock().await.remove(&exec_id);
        crate::tray::refresh_tray(&app);
    });
}

/// Find connector names whose `services` JSON lists at least one of the given tools.
///
/// Iterates tools × connectors, parsing each connector's `services` JSON array
/// and checking if any entry's `toolName` matches a tool name.
fn find_matching_connector_names(
    tools: &[PersonaToolDefinition],
    connectors: &[ConnectorDefinition],
) -> Vec<String> {
    let mut names = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for tool in tools {
        for connector in connectors {
            let services: Vec<serde_json::Value> =
                serde_json::from_str(&connector.services).unwrap_or_default();
            let tool_listed = services.iter().any(|s| {
                s.get("toolName")
                    .and_then(|v| v.as_str())
                    .map(|name| name == tool.name)
                    .unwrap_or(false)
            });
            if tool_listed && seen.insert(connector.name.clone()) {
                names.push(connector.name.clone());
            }
        }
    }
    names
}

/// Resolve a service-level recommended delay from the knowledge base.
///
/// Looks up connectors associated with the persona's tools to determine
/// which service types are in use, then queries the knowledge base for
/// matching failure patterns.
fn resolve_service_knowledge_delay(
    pool: &DbPool,
    persona_id: &str,
    category: &healing::FailureCategory,
) -> Option<u64> {
    let pattern_key = match category {
        healing::FailureCategory::RateLimit => "rate_limit",
        healing::FailureCategory::Timeout => "timeout",
        _ => return None,
    };

    let tools = tool_repo::get_tools_for_persona(pool, persona_id).ok()?;
    let connectors = crate::db::repos::resources::connectors::get_all(pool).ok()?;

    for service_name in find_matching_connector_names(&tools, &connectors) {
        if let Ok(Some(delay)) =
            healing_repo::get_recommended_delay(pool, &service_name, pattern_key)
        {
            return Some(delay);
        }
    }

    None
}

/// Record a failure pattern to the knowledge base for fleet-wide learning.
fn record_failure_to_knowledge_base(
    pool: &DbPool,
    persona_id: &str,
    category: &healing::FailureCategory,
    diagnosis: &healing::HealingDiagnosis,
) {
    let pattern_key = match category {
        healing::FailureCategory::RateLimit => "rate_limit",
        healing::FailureCategory::Timeout => "timeout",
        _ => return, // Only track auto-fixable patterns
    };

    let recommended_delay = match &diagnosis.action {
        healing::HealingAction::RetryWithBackoff { delay_secs } => Some(*delay_secs as i64),
        healing::HealingAction::RetryWithTimeout { .. } => None,
        healing::HealingAction::CreateIssue => return,
    };

    let tools = match tool_repo::get_tools_for_persona(pool, persona_id) {
        Ok(t) => t,
        Err(_) => return,
    };
    let connectors = match crate::db::repos::resources::connectors::get_all(pool) {
        Ok(c) => c,
        Err(_) => return,
    };

    for service_name in find_matching_connector_names(&tools, &connectors) {
        let _ = healing_repo::upsert_knowledge(
            pool,
            &service_name,
            pattern_key,
            &diagnosis.description,
            recommended_delay,
        );
    }
}
