pub mod background;
pub mod bus;
pub mod chain;
pub mod compiler;
pub mod connector_strategy;
pub mod credential_design;
pub mod dispatch;
pub mod credential_negotiator;
pub mod cron;
pub mod crypto;
pub mod design;
pub mod eval;
pub mod failover;
pub mod google_oauth;
pub mod healing;
pub mod healthcheck;
pub mod intent_compiler;
pub mod knowledge;
pub mod logger;
pub mod optimizer;
pub mod parser;
pub mod pipeline;
pub mod polling;
pub mod topology;
pub mod topology_graph;
pub mod prompt;
pub mod provider;
pub mod queue;
pub mod rate_limiter;
pub mod rotation;
pub mod runner;
pub mod scheduler;
pub mod subscription;
pub mod test_runner;
pub mod trace;
pub mod types;
pub mod webhook;
pub mod platform_rules;

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

use self::types::{ExecutionResult, ExecutionState, HealingEventPayload, QueueStatusEvent};

use self::queue::{AdmitResult, ConcurrencyTracker, ExecutionPriority};

/// Maximum retry attempts for DB status persistence.
const PERSIST_MAX_RETRIES: u32 = 3;
/// Initial backoff delay (doubles each retry: 200ms → 400ms → 800ms).
const PERSIST_INITIAL_BACKOFF_MS: u64 = 200;

/// Try to write an execution status update to the DB with exponential backoff.
///
/// On each failure, waits with `tokio::time::sleep` (non-blocking) and retries.
/// After `PERSIST_MAX_RETRIES` failures, force-marks the execution as error
/// (dead-letter) so it doesn't stay stuck in "running" forever, and emits a
/// healing event so the user knows the original result was lost.
pub(crate) async fn persist_status_update(
    pool: &DbPool,
    app: Option<&AppHandle>,
    exec_id: &str,
    update: UpdateExecutionStatus,
) {
    let mut last_err = None;
    let mut backoff_ms = PERSIST_INITIAL_BACKOFF_MS;

    for attempt in 0..=PERSIST_MAX_RETRIES {
        match exec_repo::update_status(pool, exec_id, update.clone()) {
            Ok(()) => return,
            Err(e) => {
                tracing::error!(
                    execution_id = %exec_id,
                    attempt = attempt + 1,
                    max_attempts = PERSIST_MAX_RETRIES + 1,
                    error = %e,
                    "DB status update failed",
                );
                last_err = Some(e);

                if attempt < PERSIST_MAX_RETRIES {
                    tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                    backoff_ms *= 2;
                }
            }
        }
    }

    // Dead-letter: all retries exhausted. Force-mark as error so the
    // execution doesn't stay stuck in "running" state forever.
    let err_msg = last_err
        .as_ref()
        .map(|e| format!("Status persist failed after {} retries: {}", PERSIST_MAX_RETRIES + 1, e))
        .unwrap_or_else(|| "Status persist failed".into());

    // Only attempt dead-letter if the original update wasn't already an error/failed state,
    // to avoid infinite recursion.
    if !matches!(update.status, ExecutionState::Failed) {
        let dead_letter = exec_repo::update_status(
            pool,
            exec_id,
            UpdateExecutionStatus {
                status: ExecutionState::Failed,
                error_message: Some(err_msg.clone()),
                // Preserve any metrics from the original update
                duration_ms: update.duration_ms,
                input_tokens: update.input_tokens,
                output_tokens: update.output_tokens,
                cost_usd: update.cost_usd,
                ..Default::default()
            },
        );
        if let Err(e) = dead_letter {
            tracing::error!(
                execution_id = %exec_id,
                error = %e,
                "Dead-letter write also failed — execution stuck in running state",
            );
        }
    }

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
                suggested_fix: Some(err_msg),
                persona_name: String::new(),
                description: None,
                strategy: None,
                backoff_seconds: None,
                retry_number: None,
                max_retries: None,
            },
        );
    }
}

/// Maximum consecutive failures before the circuit breaker trips.
const CIRCUIT_BREAKER_THRESHOLD: u32 = 5;

/// Saved execution context for queued executions. When a running slot opens,
/// the engine uses this context to start the promoted execution.
struct QueuedExecutionContext {
    app: AppHandle,
    pool: DbPool,
    #[allow(dead_code)]
    execution_id: String,
    persona: Persona,
    tools: Vec<PersonaToolDefinition>,
    input_data: Option<serde_json::Value>,
    continuation: Option<types::Continuation>,
}

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
    /// Per-provider circuit breaker for failover.
    pub(crate) circuit_breaker: Arc<failover::ProviderCircuitBreaker>,
    /// Saved contexts for queued executions, keyed by execution_id.
    queued_contexts: Arc<Mutex<HashMap<String, QueuedExecutionContext>>>,
}

impl ExecutionEngine {
    pub fn new(log_dir: PathBuf) -> Self {
        Self {
            tracker: Arc::new(Mutex::new(ConcurrencyTracker::new())),
            tasks: Arc::new(Mutex::new(HashMap::new())),
            child_pids: Arc::new(Mutex::new(HashMap::new())),
            cancelled_flags: Arc::new(Mutex::new(HashMap::new())),
            log_dir,
            circuit_breaker: Arc::new(failover::ProviderCircuitBreaker::new()),
            queued_contexts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns the log directory root used by the execution engine.
    pub fn log_dir(&self) -> &std::path::Path {
        &self.log_dir
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
                    // Startup recovery uses a direct sync DB call — no async retry
                    // needed because there is no contention during app init.
                    let _ = exec_repo::update_status(
                        pool,
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

    /// Start an execution in a background tokio task, or enqueue it if
    /// the persona's concurrency limit is reached.
    ///
    /// Returns `Ok(())` for both immediate start and successful enqueue.
    /// Returns `Err` only for backpressure rejection (queue full).
    #[allow(clippy::too_many_arguments)]
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
        self.start_execution_with_priority(
            app,
            pool,
            execution_id,
            persona,
            tools,
            input_data,
            continuation,
            ExecutionPriority::Normal,
        )
        .await
    }

    /// Start or enqueue an execution with an explicit priority level.
    #[allow(clippy::too_many_arguments)]
    pub async fn start_execution_with_priority(
        &self,
        app: AppHandle,
        pool: DbPool,
        execution_id: String,
        persona: Persona,
        tools: Vec<PersonaToolDefinition>,
        input_data: Option<serde_json::Value>,
        continuation: Option<types::Continuation>,
        priority: ExecutionPriority,
    ) -> Result<(), AppError> {
        // Atomically try to run or enqueue
        let admit_result = {
            let mut tracker = self.tracker.lock().await;
            tracker.admit(
                &persona.id,
                &execution_id,
                persona.max_concurrent,
                priority,
            )
        };

        match admit_result {
            AdmitResult::Running => {
                // Slot available — spawn the execution task immediately
                self.spawn_execution_task(
                    app, pool, execution_id, persona, tools, input_data, continuation,
                )
                .await;
                Ok(())
            }
            AdmitResult::Queued { position } => {
                let queue_depth = self.tracker.lock().await.queue_depth(&persona.id);
                tracing::info!(
                    persona_id = %persona.id,
                    execution_id = %execution_id,
                    position = position,
                    queue_depth = queue_depth,
                    "Execution queued (position {})", position,
                );
                // Emit queue status event to frontend
                let _ = app.emit(
                    "queue-status",
                    QueueStatusEvent {
                        execution_id: execution_id.clone(),
                        persona_id: persona.id.clone(),
                        action: "queued".into(),
                        position: Some(position),
                        queue_depth,
                    },
                );
                // Store the execution context for when a slot opens
                self.queued_contexts.lock().await.insert(
                    execution_id.clone(),
                    QueuedExecutionContext {
                        app,
                        pool,
                        execution_id,
                        persona,
                        tools,
                        input_data,
                        continuation,
                    },
                );
                Ok(())
            }
            AdmitResult::QueueFull { max_depth } => {
                tracing::warn!(
                    persona_id = %persona.id,
                    execution_id = %execution_id,
                    max_depth = max_depth,
                    "Execution rejected: queue full",
                );
                Err(AppError::Validation(format!(
                    "Persona '{}' execution queue is full ({} queued, {} running). Try again later.",
                    persona.name, max_depth, persona.max_concurrent
                )))
            }
        }
    }

    /// Internal: spawn the actual execution task for an admitted execution.
    #[allow(clippy::too_many_arguments)]
    async fn spawn_execution_task(
        &self,
        app: AppHandle,
        pool: DbPool,
        execution_id: String,
        persona: Persona,
        tools: Vec<PersonaToolDefinition>,
        input_data: Option<serde_json::Value>,
        continuation: Option<types::Continuation>,
    ) {
        // Update status to running (may have been queued before)
        persist_status_update(
            &pool,
            Some(&app),
            &execution_id,
            UpdateExecutionStatus {
                status: ExecutionState::Running,
                ..Default::default()
            },
        )
        .await;
        let _ = app.emit(
            "execution-status",
            types::ExecutionStatusEvent {
                execution_id: execution_id.clone(),
                status: ExecutionState::Running,
                error: None,
                duration_ms: None,
                cost_usd: None,
            },
        );

        // Create cancellation flag for this execution
        let cancelled = Arc::new(AtomicBool::new(false));
        self.cancelled_flags
            .lock()
            .await
            .insert(execution_id.clone(), cancelled.clone());

        let exec_id = execution_id.clone();
        let persona_id = persona.id.clone();
        let persona_timeout_ms = persona.timeout_ms;
        let persona_max_concurrent = persona.max_concurrent;
        let log_dir = self.log_dir.clone();
        let pool_clone = pool.clone();

        // Clone AppHandle so the healing hook can emit events after run_execution
        let app_for_healing = app.clone();
        let app_for_drain = app.clone();
        let pool_for_drain = pool.clone();

        // Clone Arcs for the spawned task
        let tracker = self.tracker.clone();
        let tasks = self.tasks.clone();
        let child_pids = self.child_pids.clone();
        let cancelled_flags = self.cancelled_flags.clone();
        let circuit_breaker = self.circuit_breaker.clone();
        let queued_contexts = self.queued_contexts.clone();

        // Clone log_dir for potential healing retries (log_dir is moved into run_execution)
        let log_dir_for_retry = log_dir.clone();

        // Extract chain_trace_id from input_data if present (chain trigger payloads embed it)
        let chain_trace_id = input_data
            .as_ref()
            .and_then(|v| v.get("_chain_trace_id"))
            .and_then(|t| t.as_str())
            .map(String::from);

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
                chain_trace_id,
                circuit_breaker.clone(),
            )
            .await;

            if cancelled.load(Ordering::Acquire) {
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
                )
                .await;
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
                    circuit_breaker,
                )
                .await;
            }

            // Clean up tracker and task handle (always, regardless of cancellation)
            tracker
                .lock()
                .await
                .remove_running(&persona_id, &exec_id);
            tasks.lock().await.remove(&exec_id);
            cancelled_flags.lock().await.remove(&exec_id);

            // Drain queue: promote next waiting execution for this persona
            drain_and_start_next(
                tracker,
                tasks.clone(),
                queued_contexts,
                persona_id,
                persona_max_concurrent,
                app_for_drain,
                pool_for_drain,
            )
            .await;
        });

        // Store the task handle
        self.tasks.lock().await.insert(execution_id, handle);
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
        // 0. Check if execution is queued (not yet running) — just remove from queue
        if let Some(pid) = persona_id {
            let was_queued = self.tracker.lock().await.remove_queued(pid, execution_id);
            if was_queued {
                // Remove saved context
                self.queued_contexts.lock().await.remove(execution_id);
                // Write cancelled status to DB
                persist_status_update(
                    pool,
                    None,
                    execution_id,
                    UpdateExecutionStatus {
                        status: ExecutionState::Cancelled,
                        error_message: Some("Cancelled while queued".into()),
                        ..Default::default()
                    },
                )
                .await;
                tracing::info!(execution_id = %execution_id, "Cancelled queued execution");
                return true;
            }
        }

        // 1. Set cancellation flag — tells the spawned task to write
        //    status='cancelled' with metrics instead of completed/failed
        if let Some(flag) = self.cancelled_flags.lock().await.get(execution_id) {
            flag.store(true, Ordering::Release);
        }

        // 2. Write bare cancelled status to DB as a safety net.
        persist_status_update(
            pool,
            None,
            execution_id,
            UpdateExecutionStatus {
                status: ExecutionState::Cancelled,
                ..Default::default()
            },
        )
        .await;

        // 3. Kill the child OS process to stop API credit consumption.
        if let Some(pid) = self.child_pids.lock().await.remove(execution_id) {
            tracing::info!(execution_id = %execution_id, pid = pid, "Killing child process");
            kill_process(pid);
        }

        // 4. Give the spawned task up to 5 seconds to finish writing metrics.
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
                    // The task may have spawned a new child process during the
                    // grace period (e.g. chain retry). Kill it before the
                    // JoinHandle is dropped to prevent orphaned OS processes
                    // that continue consuming LLM API credits.
                    if let Some(pid) = self.child_pids.lock().await.remove(execution_id) {
                        tracing::info!(
                            execution_id = %execution_id,
                            pid = pid,
                            "Killing child process spawned during grace period",
                        );
                        kill_process(pid);
                    }
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
        )
        .await;

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

        if current_retry_count >= healing::MAX_RETRY_COUNT {
            tracing::warn!(
                persona_id = %persona_id,
                retry_count = current_retry_count,
                max = healing::MAX_RETRY_COUNT,
                "Healing analysis: retry count exhausted, skipping retry",
            );
            return;
        }

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
                    self.circuit_breaker.clone(),
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
                    self.circuit_breaker.clone(),
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
// Queue drain: promote next waiting execution when a slot opens
// =============================================================================

/// After an execution finishes and its running slot is freed, check if there's
/// a queued execution waiting for this persona and start it.
///
/// Takes owned types and returns a boxed Send future so the function can be
/// awaited inside `tokio::spawn` blocks (which require Send futures).
#[allow(clippy::too_many_arguments)]
fn drain_and_start_next(
    tracker: Arc<Mutex<ConcurrencyTracker>>,
    tasks: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    queued_contexts: Arc<Mutex<HashMap<String, QueuedExecutionContext>>>,
    persona_id: String,
    max_concurrent: i32,
    app: AppHandle,
    pool: DbPool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
    Box::pin(async move {
    let persona_id = persona_id.as_str();
    // Try to promote the next queued execution
    let next = {
        let mut t = tracker.lock().await;
        t.drain_next(persona_id, max_concurrent)
    };

    if let Some(queued) = next {
        let exec_id = queued.execution_id.clone();
        let exec_id_for_tasks = exec_id.clone();

        // Emit promoted event
        let queue_depth = tracker.lock().await.queue_depth(persona_id);
        let _ = app.emit(
            "queue-status",
            QueueStatusEvent {
                execution_id: exec_id.clone(),
                persona_id: persona_id.to_string(),
                action: "promoted".into(),
                position: None,
                queue_depth,
            },
        );

        tracing::info!(
            persona_id = %persona_id,
            execution_id = %exec_id,
            "Queue: promoted execution to running slot",
        );

        // Retrieve the saved context
        let ctx = queued_contexts.lock().await.remove(&exec_id);
        if let Some(ctx) = ctx {
            // Update status to running in DB
            persist_status_update(
                &pool,
                Some(&app),
                &exec_id,
                UpdateExecutionStatus {
                    status: ExecutionState::Running,
                    ..Default::default()
                },
            )
            .await;
            let _ = app.emit(
                "execution-status",
                types::ExecutionStatusEvent {
                    execution_id: exec_id.clone(),
                    status: ExecutionState::Running,
                    error: None,
                    duration_ms: None,
                    cost_usd: None,
                },
            );

            // Spawn the actual execution — reuse the saved context.
            // We build a mini execution task inline since we don't have &self here.
            let persona = ctx.persona;
            let persona_id_owned = persona.id.clone();
            let persona_timeout_ms = persona.timeout_ms;
            let persona_max_concurrent_inner = persona.max_concurrent;
            let pool_clone = ctx.pool.clone();
            let pool_for_drain = ctx.pool.clone();
            let app_handle = ctx.app.clone();
            let app_for_healing = ctx.app.clone();
            let app_for_drain = ctx.app.clone();
            let child_pids: Arc<Mutex<HashMap<String, u32>>> = Arc::new(Mutex::new(HashMap::new()));
            let cancelled = Arc::new(AtomicBool::new(false));
            let cancelled_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>> =
                Arc::new(Mutex::new(HashMap::new()));
            cancelled_flags
                .lock()
                .await
                .insert(exec_id.clone(), cancelled.clone());

            let log_dir = std::env::temp_dir().join("personas").join("logs");
            let log_dir_for_retry = log_dir.clone();

            let chain_trace_id = ctx
                .input_data
                .as_ref()
                .and_then(|v| v.get("_chain_trace_id"))
                .and_then(|t| t.as_str())
                .map(String::from);

            let tracker_clone = tracker.clone();
            let tasks_clone = tasks.clone();
            let queued_contexts_clone = queued_contexts.clone();
            let circuit_breaker = Arc::new(failover::ProviderCircuitBreaker::new());

            let handle = tokio::spawn(async move {
                let result = runner::run_execution(
                    app_handle,
                    pool_clone.clone(),
                    exec_id.clone(),
                    persona,
                    ctx.tools,
                    ctx.input_data,
                    log_dir,
                    child_pids.clone(),
                    cancelled.clone(),
                    ctx.continuation,
                    chain_trace_id,
                    circuit_breaker.clone(),
                )
                .await;

                if cancelled.load(Ordering::Acquire) {
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
                    )
                    .await;
                } else {
                    handle_execution_result(
                        &pool_clone,
                        &app_for_healing,
                        &exec_id,
                        &persona_id_owned,
                        persona_timeout_ms,
                        &result,
                        tracker_clone.clone(),
                        child_pids.clone(),
                        cancelled_flags.clone(),
                        log_dir_for_retry.clone(),
                        circuit_breaker,
                    )
                    .await;
                }

                // Clean up
                tracker_clone
                    .lock()
                    .await
                    .remove_running(&persona_id_owned, &exec_id);
                tasks_clone.lock().await.remove(&exec_id);

                // Recursively drain next (owned types for Send safety)
                drain_and_start_next(
                    tracker_clone,
                    tasks_clone.clone(),
                    queued_contexts_clone,
                    persona_id_owned,
                    persona_max_concurrent_inner,
                    app_for_drain,
                    pool_for_drain,
                )
                .await;
            });

            tasks.lock().await.insert(exec_id_for_tasks, handle);
        } else {
            // Context was missing (e.g., cancelled while queued) — release the slot
            tracker.lock().await.remove_running(persona_id, &exec_id);
        }
    }
    }) // close Box::pin(async move { ... })
}

// =============================================================================
// Extracted sub-functions for start_execution post-processing
// =============================================================================

/// Handle the result of a completed execution: write status, notify, enforce
/// budget, evaluate chain triggers, and run healing/retry if needed.
#[allow(clippy::too_many_arguments)]
async fn handle_execution_result(
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
    circuit_breaker: Arc<failover::ProviderCircuitBreaker>,
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
    )
    .await;

    // Knowledge graph extraction — learn from every execution
    {
        let use_case_id = exec_repo::get_by_id(pool, exec_id)
            .ok()
            .and_then(|e| e.use_case_id);
        knowledge::extract_and_persist(
            pool,
            exec_id,
            persona_id,
            use_case_id.as_deref(),
            result.success,
            result.cost_usd,
            result.duration_ms as i64,
            result.model_used.as_deref(),
            result.tool_steps.as_deref(),
            result.error.as_deref(),
        );
    }

    // OS Notification
    notify_execution(app, pool, persona_id, status.as_str(), result.duration_ms);

    // Budget enforcement (only on success)
    if result.success {
        check_budget_enforcement(pool, persona_id, exec_id);
    }

    // Chain triggers — extract chain depth/visited/trace_id from execution's input_data
    // (propagated via chain event payloads to prevent infinite cycles)
    let (chain_depth, mut visited, existing_chain_trace_id) =
        exec_repo::get_by_id(pool, exec_id)
            .ok()
            .and_then(|exec| exec.input_data)
            .map(|input| chain::extract_chain_metadata(Some(&input)))
            .unwrap_or_default();
    visited.insert(persona_id.to_string());

    // Use existing chain_trace_id if this execution is part of a chain,
    // otherwise use this execution's trace_id as the root of a new chain trace
    let chain_trace_id = existing_chain_trace_id
        .or_else(|| result.trace_id.clone());

    chain::evaluate_chain_triggers(
        pool,
        persona_id,
        status.as_str(),
        result.output.as_deref(),
        exec_id,
        chain_depth,
        &visited,
        chain_trace_id.as_deref(),
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
            circuit_breaker,
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
    circuit_breaker: Arc<failover::ProviderCircuitBreaker>,
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

    let current_retry_count = exec_repo::get_by_id(pool, exec_id)
        .map(|e| e.retry_count)
        .unwrap_or(0);

    let diagnosis = healing::diagnose(&category, error_str, timeout_ms, consecutive, current_retry_count);

    record_failure_to_knowledge_base(pool, persona_id, &category, &diagnosis);

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
        && current_retry_count < healing::MAX_RETRY_COUNT;

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

    // Derive retry-specific storytelling fields
    let (strategy, backoff_seconds) = if auto_fixed {
        match &diagnosis.action {
            healing::HealingAction::RetryWithBackoff { delay_secs } => {
                let effective = kb_delay
                    .map(|kb| std::cmp::max(kb, *delay_secs))
                    .unwrap_or(*delay_secs);
                (Some("Exponential backoff".to_string()), Some(effective))
            }
            healing::HealingAction::RetryWithTimeout { new_timeout_ms } => {
                (Some(format!("Increased timeout to {}ms", new_timeout_ms)), Some(5u64))
            }
            _ => (None, None),
        }
    } else {
        (Some("Manual investigation required".to_string()), None)
    };

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
            description: Some(diagnosis.description.clone()),
            strategy,
            backoff_seconds,
            retry_number: if auto_fixed { Some(current_retry_count + 1) } else { None },
            max_retries: Some(healing::MAX_RETRY_COUNT),
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
            circuit_breaker,
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
            description: Some(format!(
                "Agent disabled after {} consecutive failures. Investigation required.",
                consecutive,
            )),
            strategy: Some("Persona disabled — manual intervention required".into()),
            backoff_seconds: None,
            retry_number: None,
            max_retries: Some(healing::MAX_RETRY_COUNT),
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
    circuit_breaker: Arc<failover::ProviderCircuitBreaker>,
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
                circuit_breaker,
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
                circuit_breaker,
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
    circuit_breaker: Arc<failover::ProviderCircuitBreaker>,
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
        )
        .await;

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
            None, // chain_trace_id — healing retries don't inherit chain context
            circuit_breaker,
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
            )
            .await;
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
            )
            .await;

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
