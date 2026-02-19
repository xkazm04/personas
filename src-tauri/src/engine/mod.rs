pub mod background;
pub mod bus;
pub mod cron;
pub mod crypto;
pub mod delivery;
pub mod design;
pub mod healing;
pub mod healthcheck;
pub mod logger;
pub mod parser;
pub mod prompt;
pub mod queue;
pub mod runner;
pub mod scheduler;
pub mod types;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

use tauri::Emitter;

use crate::db::models::{Persona, PersonaToolDefinition, UpdateExecutionStatus};
use crate::db::repos::executions as exec_repo;
use crate::db::repos::healing as healing_repo;
use crate::db::DbPool;
use crate::error::AppError;

use self::types::HealingEventPayload;

use self::queue::ConcurrencyTracker;

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
                    let _ = exec_repo::update_status(
                        pool,
                        &exec.id,
                        UpdateExecutionStatus {
                            status: "failed".into(),
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
    ) -> Result<(), AppError> {
        // Register in tracker
        {
            let mut tracker = self.tracker.lock().await;
            tracker.add_running(&persona.id, &execution_id);
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
            )
            .await;

            // Only write final status if not cancelled.
            // If cancelled, cancel_execution already wrote status=cancelled to DB.
            if !cancelled.load(Ordering::Acquire) {
                let status = if result.success { "completed" } else { "failed" };
                let _ = exec_repo::update_status(
                    &pool_clone,
                    &exec_id,
                    UpdateExecutionStatus {
                        status: status.into(),
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

                // --- OS Notification: execution completed ---
                {
                    let persona_for_notify =
                        crate::db::repos::personas::get_by_id(&pool_clone, &persona_id).ok();
                    let notif_channels = persona_for_notify
                        .as_ref()
                        .and_then(|p| p.notification_channels.as_deref());
                    let p_name = persona_for_notify
                        .as_ref()
                        .map(|p| p.name.as_str())
                        .unwrap_or("Agent");

                    crate::notifications::notify_execution_completed(
                        &app_for_healing,
                        p_name,
                        status,
                        result.duration_ms,
                        notif_channels,
                    );
                }

                // --- Budget enforcement ---
                if result.success {
                    let monthly_spend = exec_repo::get_monthly_spend(&pool_clone, &persona_id).unwrap_or(0.0);
                    let persona_data = crate::db::repos::personas::get_by_id(&pool_clone, &persona_id).ok();

                    if let Some(ref p) = persona_data {
                        if let Some(budget) = p.max_budget_usd {
                            if budget > 0.0 && monthly_spend >= budget {
                                // Create alert message
                                let alert_content = format!(
                                    "Budget alert: {} has spent ${:.4} this month (budget: ${:.2}). Agent may be automatically paused.",
                                    p.name, monthly_spend, budget
                                );
                                let _ = crate::db::repos::messages::create(
                                    &pool_clone,
                                    crate::db::models::CreateMessageInput {
                                        persona_id: persona_id.clone(),
                                        execution_id: Some(exec_id.clone()),
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

                // --- Healing check: analyse failed executions ---
                if !result.success {
                    let consecutive = exec_repo::get_recent_failures(
                        &pool_clone, &persona_id, 5,
                    )
                    .unwrap_or_default()
                    .len() as u32;

                    let timeout_ms = if persona_timeout_ms > 0 {
                        persona_timeout_ms as u64
                    } else {
                        600_000
                    };

                    let error_str = result.error.as_deref().unwrap_or("");
                    let timed_out = error_str.contains("timed out");

                    let category = healing::classify_error(
                        error_str,
                        timed_out,
                        result.session_limit_reached,
                    );
                    let diagnosis = healing::diagnose(
                        &category, error_str, timeout_ms, consecutive,
                    );

                    if let Ok(issue) = healing_repo::create(
                        &pool_clone,
                        &persona_id,
                        &diagnosis.title,
                        &diagnosis.description,
                        Some(&diagnosis.severity),
                        Some(&diagnosis.db_category),
                        Some(&exec_id),
                        diagnosis.suggested_fix.as_deref(),
                    ) {
                        let auto_fixed =
                            healing::is_auto_fixable(&category) && consecutive < 3;

                        if auto_fixed {
                            let _ = healing_repo::mark_auto_fixed(
                                &pool_clone, &issue.id,
                            );
                        }

                        // Notify healing issue
                        {
                            let persona_for_heal =
                                crate::db::repos::personas::get_by_id(&pool_clone, &persona_id)
                                    .ok();
                            let heal_channels = persona_for_heal
                                .as_ref()
                                .and_then(|p| p.notification_channels.as_deref());
                            let heal_name = persona_for_heal
                                .as_ref()
                                .map(|p| p.name.as_str())
                                .unwrap_or("Agent");
                            crate::notifications::notify_healing_issue(
                                &app_for_healing,
                                heal_name,
                                &diagnosis.title,
                                heal_channels,
                            );
                        }

                        let _ = app_for_healing.emit(
                            "healing-event",
                            HealingEventPayload {
                                issue_id: issue.id,
                                persona_id: persona_id.clone(),
                                execution_id: exec_id.clone(),
                                title: diagnosis.title,
                                action: if auto_fixed {
                                    "auto_retry".into()
                                } else {
                                    "issue_created".into()
                                },
                                auto_fixed,
                            },
                        );

                        if auto_fixed {
                            match &diagnosis.action {
                                healing::HealingAction::RetryWithBackoff {
                                    delay_secs,
                                } => {
                                    tracing::info!(
                                        persona_id = %persona_id,
                                        delay_secs = delay_secs,
                                        "Healing: retry scheduled after backoff"
                                    );
                                }
                                healing::HealingAction::RetryWithTimeout {
                                    new_timeout_ms,
                                } => {
                                    tracing::info!(
                                        persona_id = %persona_id,
                                        new_timeout_ms = new_timeout_ms,
                                        "Healing: retry with increased timeout"
                                    );
                                }
                                _ => {}
                            }
                        }
                    }
                }

                // Refresh system tray to update recent executions list
                crate::tray::refresh_tray(&app_for_healing);
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
    /// Sets the cancellation flag, writes cancelled status to DB, kills the
    /// child process, cleans up the tracker, and aborts the tokio task.
    /// The cancellation flag prevents the spawned task from overwriting
    /// the cancelled status if it finishes between the kill and the abort.
    pub async fn cancel_execution(
        &self,
        execution_id: &str,
        pool: &DbPool,
        persona_id: Option<&str>,
    ) -> bool {
        // 1. Set cancellation flag FIRST — prevents spawned task from writing to DB
        if let Some(flag) = self.cancelled_flags.lock().await.get(execution_id) {
            flag.store(true, Ordering::Release);
        }

        // 2. Write cancelled status to DB (we are the sole writer now)
        let _ = exec_repo::update_status(
            pool,
            execution_id,
            UpdateExecutionStatus {
                status: "cancelled".into(),
                ..Default::default()
            },
        );

        // 3. Kill the child OS process to stop API credit consumption
        if let Some(pid) = self.child_pids.lock().await.remove(execution_id) {
            tracing::info!(execution_id = %execution_id, pid = pid, "Killing child process");
            kill_process(pid);
        }

        // 4. Clean up tracker immediately (guaranteed regardless of abort timing)
        if let Some(pid) = persona_id {
            self.tracker.lock().await.remove_running(pid, execution_id);
        }

        // 5. Clean up the cancelled flag
        self.cancelled_flags.lock().await.remove(execution_id);

        // 6. Abort the tokio task
        if let Some(handle) = self.tasks.lock().await.remove(execution_id) {
            handle.abort();
            return true;
        }
        false
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
        let _ = exec_repo::update_status(
            pool,
            execution_id,
            UpdateExecutionStatus {
                status: "cancelled".into(),
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
}

/// Kill an OS process by PID. Cross-platform.
fn kill_process(pid: u32) {
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
