//! The execution engine proper: admission, spawning, cancellation, the queue
//! drain, and the completion pipeline that runs once a run returns.
//!
//! Split out of `engine/mod.rs` verbatim (Rust refactor wave 1). This half owns
//! a run from the moment something asks for it until its terminal status is
//! written: the timeout ceiling, [`ExecutionEngine`] and its impl, the global
//! queue drain, the F7 fix-loop re-entry channel, `handle_execution_result`,
//! the completion notifications, the budget check and the value-delivery
//! breaker. When a run has failed and there is aftermath to decide, this half
//! hands off to `super::healing_retry` and does not come back.
//!
//! `use super::*` re-imports the parent's module set and import block, so the
//! bodies below are byte-identical to the ones that used to live in `mod.rs`.

use super::healing_retry::{
    evaluate_healing_and_retry, retry_reason_for, spawn_delayed_retry, spawn_healing_chain,
};
use super::*;

/// Run an execution with a hard engine-level timeout ceiling.
///
/// Wraps `runner::run_execution` with `tokio::time::timeout` using
/// `ENGINE_MAX_EXECUTION_SECS` so that no execution can run longer than the
/// engine ceiling, regardless of per-persona timeout configuration.
#[allow(clippy::too_many_arguments)]
pub(super) async fn run_execution_with_ceiling(
    app: AppHandle,
    pool: DbPool,
    execution_id: String,
    persona: Persona,
    tools: Vec<PersonaToolDefinition>,
    input_data: Option<serde_json::Value>,
    log_dir: PathBuf,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled: Arc<AtomicBool>,
    continuation: Option<types::Continuation>,
    chain_trace_id: Option<String>,
    circuit_breaker: Arc<failover::ProviderCircuitBreaker>,
) -> ExecutionResult {
    let ceiling = std::time::Duration::from_secs(ENGINE_MAX_EXECUTION_SECS);

    // Phase 3 c: inject ambient desktop signals into the persona's
    // system_prompt before execution. Persona-authored instructions
    // remain the recency-weighted last block; ambient prepends with a
    // blank-line separator. Non-desktop builds skip this entirely
    // (the AmbientContextFusion machinery is desktop-feature gated).
    // Failures are non-fatal: a None result simply means the rolling
    // window is empty for this persona's policy and we pass through.
    //
    // Phase 5 v1: AFTER ambient injection (so ambient lands closer to
    // the persona prompt and CLI session lands further from it — the
    // model reads ambient as "right now" context and CLI as "what I
    // was discussing earlier"), inject the user's active Claude CLI
    // session if BOTH gates are on (per-persona `cli_awareness_enabled`
    // AND in-memory global `cli_session_enabled`). Same shadow shape
    // as ambient — no-op if gates off, empty discovery, or empty
    // transcript.
    #[cfg(feature = "desktop")]
    let persona = {
        let mut persona = persona;
        // Pulled directly rather than through `AppState`: this is an
        // engine-owned handle, and reaching it via the app struct made the
        // engine depend on the whole application state.
        let ambient_ctx = app
            .state::<ambient_context::AmbientContextHandle>()
            .inner()
            .clone();
        if let Some(md) =
            ambient_context::format_ambient_for_persona(&ambient_ctx, &persona.id).await
        {
            ambient_context::prepend_ambient_to_system_prompt(&mut persona, &md);
        }

        // Phase 5 v1: CLI session injection (windowed path).
        if persona.cli_awareness_enabled {
            let global_enabled = {
                let guard = ambient_ctx.lock().await;
                guard.is_source_enabled("cli_session")
            };
            if global_enabled {
                if let Some(home) = dirs::home_dir() {
                    let now = std::time::SystemTime::now();
                    if let Some(active) = cli_session_awareness::discovery::discover_active_session(
                        &home,
                        now,
                        cli_session_awareness::discovery::DEFAULT_FRESHNESS_CUTOFF,
                    ) {
                        // Cap at 8 turns total (~4 user + 4 assistant; the
                        // tail-N is role-agnostic so the boundary is
                        // approximate). 500-char/turn cap is enforced
                        // inside the reader.
                        let turns =
                            cli_session_awareness::transcript::read_recent_turns(&active.path, 8);
                        if let Some(md) =
                            cli_session_awareness::render::render_cli_session_for_prompt(
                                &active, &turns, now,
                            )
                        {
                            ambient_context::prepend_ambient_to_system_prompt(&mut persona, &md);

                            // Phase 5 v1: write the transparency audit row
                            // so the user can see what was extracted via
                            // the "What did Athena see?" modal. Failure
                            // is non-fatal — the run already happened.
                            let read_at_secs = now
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_secs())
                                .unwrap_or(0);
                            let audit_id = format!("cliread_{}", uuid::Uuid::new_v4().simple());
                            if let Err(e) = cli_session_audit_repo::insert_audit(
                                &pool,
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
                                    "cli_session: failed to write audit row"
                                );
                            }
                        }
                    }
                }
            }
        }

        persona
    };

    // Wrap the AppHandle in a TauriEmitter so runner::run_execution
    // works through the abstracted ExecutionEventEmitter trait.
    let emitter: Arc<dyn events::ExecutionEventEmitter> = Arc::new(events::TauriEmitter::new(app));

    // Derive the log path before `log_dir` is moved into the runner. The runner
    // streams to this exact file from its first line, so if the ceiling fires we
    // can still point the persisted result at the partial log instead of
    // recording `None` and losing all trace of the most expensive runs.
    let log_file_path = logger::ExecutionLogger::log_path(&log_dir, &execution_id)
        .to_string_lossy()
        .to_string();

    // Keep a handle to the PID map so the ceiling arm can reap an orphaned
    // child; the runner takes its own clone for normal registration/cleanup.
    let child_pids_for_ceiling = child_pids.clone();

    // Reversible Agent: every DB write issued while this run's future is
    // polled is attributed to this execution in the change journal (the
    // task-local scope is read back inside SQLite's preupdate hook — see
    // db::attribution / db::journal). This is the single injection point:
    // repos below this frame need no signature changes.
    match tokio::time::timeout(
        ceiling,
        crate::db::attribution::with_execution(
            execution_id.clone(),
            runner::run_execution(
                emitter,
                pool,
                execution_id.clone(),
                persona,
                tools,
                input_data,
                log_dir,
                child_pids,
                cancelled,
                continuation,
                chain_trace_id,
                circuit_breaker,
            ),
        ),
    )
    .await
    {
        Ok(result) => result,
        Err(_elapsed) => {
            // The runner future has already been dropped by `timeout`, so its
            // CliProcessDriver is gone and `kill_on_drop(true)` has signalled
            // the direct child. But (a) the PID was never removed from the
            // shared map — the runner's `unregister_pid` only runs on the
            // normal completion path — and (b) kill_on_drop terminates only the
            // immediate process, not the descendant tree the CLI may have
            // spawned. Reap both here: remove the stale entry and kill the whole
            // tree by PID so no orphan keeps billing the user's API account.
            if let Some(pid) = child_pids_for_ceiling.lock().await.remove(&execution_id) {
                tracing::error!(
                    execution_id = %execution_id,
                    pid,
                    ceiling_secs = ENGINE_MAX_EXECUTION_SECS,
                    "Engine safety ceiling reached — killing orphaned CLI process tree",
                );
                kill_process(pid);
            } else {
                tracing::error!(
                    execution_id = %execution_id,
                    ceiling_secs = ENGINE_MAX_EXECUTION_SECS,
                    "Engine safety ceiling reached — execution forcibly terminated (no live PID registered)",
                );
            }

            ExecutionResult {
                success: false,
                error: Some(format!(
                    "Engine safety ceiling exceeded ({}m). Execution forcibly terminated.",
                    ENGINE_MAX_EXECUTION_SECS / 60,
                )),
                duration_ms: ENGINE_MAX_EXECUTION_SECS * 1000,
                // Point at the partial log so the run stays auditable. cost_usd /
                // input_tokens / output_tokens stay 0: the Claude CLI only emits
                // its cost summary on the final `result` line, which by
                // definition never arrived for a ceiling-terminated run, so there
                // is no captured figure to report here.
                log_file_path: Some(log_file_path),
                ..Default::default()
            }
        }
    }
}

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
    /// Shared scheduler state for recording queue rejection metrics.
    scheduler: Arc<SchedulerState>,
    /// Persona IDs currently undergoing two-phase deletion.
    /// While a persona is in this set, new executions are rejected.
    deleting_personas: Arc<Mutex<HashSet<String>>>,
    /// Oneshot senders awaiting execution completion, keyed by execution ID.
    /// Fired when the spawned task finishes (regardless of success/failure).
    completion_waiters: Arc<Mutex<HashMap<String, Vec<oneshot::Sender<()>>>>>,
    /// Persona IDs currently undergoing AI healing.
    /// Prevents concurrent healing sessions from overwriting each other's fixes.
    healing_personas: Arc<Mutex<HashSet<String>>>,
}

impl ExecutionEngine {
    pub fn new(
        log_dir: PathBuf,
        scheduler: Arc<SchedulerState>,
        pool: Option<Arc<crate::db::DbPool>>,
    ) -> Self {
        // Resolve the global concurrency cap from the max_parallel_executions
        // setting ONCE at startup (hot-reload out of scope for P0 — restart to
        // change). Defensively clamp so a corrupt/out-of-range stored value
        // falls back to the documented default. No pool (headless/test) keeps
        // the GLOBAL_MAX_CONCURRENT const fallback.
        let spawn_governor = pool.is_some();
        let mut tracker = ConcurrencyTracker::new();
        if let Some(p) = pool.as_ref() {
            let configured = crate::db::repos::core::settings::get(
                p,
                crate::db::settings_keys::MAX_PARALLEL_EXECUTIONS,
            )
            .ok()
            .flatten()
            .and_then(|s| s.trim().parse::<usize>().ok())
            .filter(|&n| {
                (crate::db::settings_keys::MAX_PARALLEL_EXECUTIONS_MIN
                    ..=crate::db::settings_keys::MAX_PARALLEL_EXECUTIONS_MAX)
                    .contains(&n)
            })
            .unwrap_or(crate::db::settings_keys::MAX_PARALLEL_EXECUTIONS_DEFAULT);
            tracker.set_global_max_concurrent(configured);

            // Seed the per-persona skill-scratchpad enable state from its
            // registered setting (default ON). Read once here; the env var
            // still overrides at read time. See skill_scratchpad::is_enabled.
            crate::engine::skill_scratchpad::seed_enabled_from_settings(p);
            // Same for the per-connector SKILL.md sidecar (skills_sidecar_enabled,
            // default ON). See skills_sidecar::is_enabled.
            crate::engine::skills_sidecar::seed_enabled_from_settings(p);
        }

        let circuit_breaker = match pool {
            Some(p) => Arc::new(failover::ProviderCircuitBreaker::with_persistence(p)),
            None => Arc::new(failover::ProviderCircuitBreaker::new()),
        };
        let tracker = Arc::new(Mutex::new(tracker));
        // Resource-aware admission governor: pause new admissions under high host
        // load so we don't pile executions onto a stressed machine and risk an
        // OOM kill. Real-app context only (a pool exists); headless/test skips it.
        if spawn_governor {
            let governor_tracker = tracker.clone();
            tauri::async_runtime::spawn(async move {
                resource_governor::run(governor_tracker).await;
            });
        }
        Self {
            tracker,
            tasks: Arc::new(Mutex::new(HashMap::new())),
            child_pids: Arc::new(Mutex::new(HashMap::new())),
            cancelled_flags: Arc::new(Mutex::new(HashMap::new())),
            log_dir,
            circuit_breaker,
            queued_contexts: Arc::new(Mutex::new(HashMap::new())),
            scheduler,
            deleting_personas: Arc::new(Mutex::new(HashSet::new())),
            completion_waiters: Arc::new(Mutex::new(HashMap::new())),
            healing_personas: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// Returns the log directory root used by the execution engine.
    pub fn log_dir(&self) -> &std::path::Path {
        &self.log_dir
    }

    /// Promote a queued execution after a running/healing/retry slot has been
    /// freed. Called from cleanup blocks inside spawned healing and retry
    /// tasks that don't otherwise have the full set of shared Arcs in scope —
    /// they retrieve the engine from `AppState` and call this method.
    pub(crate) async fn drain_after_slot_freed(&self, app: AppHandle, pool: DbPool) {
        drain_and_start_next(
            self.tracker.clone(),
            self.tasks.clone(),
            self.queued_contexts.clone(),
            self.cancelled_flags.clone(),
            self.child_pids.clone(),
            app,
            pool,
            self.circuit_breaker.clone(),
            self.healing_personas.clone(),
        )
        .await;
    }

    /// Hot-apply a new global concurrency cap (the `max_parallel_executions`
    /// setting) WITHOUT an app restart.
    ///
    /// Lowering the cap takes effect for the next admission decision — running
    /// executions are never interrupted, they simply aren't replaced as fast.
    /// Raising the cap frees slots immediately, so we proactively promote
    /// queued work into the new headroom via `drain_after_slot_freed`.
    ///
    /// The drain loop is doubly bounded so it can never spin: it stops after at
    /// most `max` iterations AND as soon as a pass promotes nothing (every
    /// remaining queued item is blocked on its own per-persona limit, or global
    /// capacity is exhausted). Progress is detected by the global queued count
    /// strictly decreasing.
    pub async fn set_global_max_concurrent(&self, app: AppHandle, pool: DbPool, max: usize) {
        let raised = {
            let mut t = self.tracker.lock().await;
            let prev = t.global_max_concurrent();
            t.set_global_max_concurrent(max);
            tracing::info!(
                prev,
                new = max,
                "Global concurrency cap updated (hot-reload)"
            );
            max > prev
        };
        if !raised {
            return;
        }
        for _ in 0..max {
            let before = {
                let t = self.tracker.lock().await;
                if !(t.has_global_capacity() && t.total_queued() > 0) {
                    break;
                }
                t.total_queued()
            };
            self.drain_after_slot_freed(app.clone(), pool.clone()).await;
            let after = self.tracker.lock().await.total_queued();
            if after >= before {
                // Nothing was promoted this pass (all remaining queued work is
                // blocked on per-persona limits) — stop rather than spin.
                break;
            }
        }
    }

    /// Returns a reference to the concurrency tracker (for tier usage reporting).
    pub fn tracker(&self) -> &Arc<Mutex<queue::ConcurrencyTracker>> {
        &self.tracker
    }

    /// Mark a persona as "deleting" to block new executions.
    pub async fn mark_deleting(&self, persona_id: &str) {
        self.deleting_personas
            .lock()
            .await
            .insert(persona_id.to_string());
    }

    /// Remove the "deleting" marker (called if deletion is aborted or after
    /// successful deletion).
    pub async fn unmark_deleting(&self, persona_id: &str) {
        self.deleting_personas.lock().await.remove(persona_id);
    }

    /// Check if a persona is currently marked for deletion.
    pub async fn is_deleting(&self, persona_id: &str) -> bool {
        self.deleting_personas.lock().await.contains(persona_id)
    }

    /// Check if a healing session is already active for a persona.
    pub async fn is_healing(&self, persona_id: &str) -> bool {
        self.healing_personas.lock().await.contains(persona_id)
    }

    /// Atomically try to acquire the healing slot for a persona.
    /// Returns `true` if the slot was acquired (no existing session),
    /// `false` if a session is already in progress.
    pub async fn try_start_healing(&self, persona_id: &str) -> bool {
        self.healing_personas
            .lock()
            .await
            .insert(persona_id.to_string())
    }

    /// Blocking-context twin of [`Self::try_start_healing`], for callers running
    /// inside `spawn_blocking` (e.g. the auto-rollback tick) rather than on a
    /// Tokio worker thread. Returns `true` if the healing slot was acquired,
    /// `false` if a session already holds it.
    ///
    /// Auto-rollback acquires this before touching the prompt columns so it can
    /// never write `personas.system_prompt` / `structured_prompt` concurrently
    /// with an AI-healing session (which mutates the same columns and holds this
    /// slot for its whole lifetime). Every `true` return MUST be paired with
    /// [`Self::finish_healing_blocking`] on every exit path, or the persona's
    /// healing is bricked until restart.
    ///
    /// Safe to call only from a blocking thread; `blocking_lock` panics on a
    /// Tokio runtime worker thread.
    pub fn try_start_healing_blocking(&self, persona_id: &str) -> bool {
        self.healing_personas
            .blocking_lock()
            .insert(persona_id.to_string())
    }

    /// Release a healing slot acquired via [`Self::try_start_healing_blocking`].
    /// Safe to call only from a blocking thread (see that method).
    pub fn finish_healing_blocking(&self, persona_id: &str) {
        self.healing_personas.blocking_lock().remove(persona_id);
    }

    /// Register a oneshot receiver that fires when the given execution
    /// reaches a terminal state (completed, failed, cancelled, etc.).
    /// Multiple callers can subscribe to the same execution.
    pub async fn subscribe_completion(&self, execution_id: &str) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        self.completion_waiters
            .lock()
            .await
            .entry(execution_id.to_string())
            .or_default()
            .push(tx);
        rx
    }

    /// Check whether the engine tracker still holds any running or queued
    /// executions for the given persona. Returns `true` when all slots are
    /// cleared.
    pub async fn all_slots_cleared(&self, persona_id: &str) -> bool {
        let tracker = self.tracker.lock().await;
        tracker.running_count(persona_id) == 0 && tracker.queue_depth(persona_id) == 0
    }

    /// Fail executions that were mid-RUN when the app last exited.
    ///
    /// After a restart, a `running` row's CLI subprocess is dead, so the row is
    /// orphaned — mark it `failed` so the tracker stays in sync and the slot is
    /// freed. **`queued` rows are intentionally left untouched** here: they
    /// never started a process, so they are durable work to be re-admitted by
    /// [`Self::requeue_persisted_executions`] once the engine is constructed.
    /// (Previously this failed `queued` rows too, silently dropping any
    /// scheduled / event-triggered execution that was waiting in the queue at
    /// shutdown — the P1 "never lose a queued execution" gap.)
    pub fn recover_stale_executions(pool: &DbPool) {
        match exec_repo::get_running_only(pool) {
            Ok(stale) if stale.is_empty() => {
                tracing::debug!("No mid-run executions to recover");
            }
            Ok(stale) => {
                let count = stale.len();
                for exec in &stale {
                    // Startup recovery uses a direct sync DB call -- no async retry
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
                    "Recovered mid-run executions: marked {} as failed",
                    count
                );
            }
            Err(e) => {
                tracing::warn!("Failed to query mid-run executions: {}", e);
            }
        }
    }

    /// Re-admit executions that were persisted as `queued` when the app last
    /// exited, so scheduled / event-triggered work is never lost across a
    /// restart. The `persona_executions` row IS the durable queue: it persists
    /// `status='queued'`, `persona_id`, `use_case_id`, and `input_data`, so the
    /// runnable context is reconstructed from the DB (the in-memory
    /// `queued_contexts` map does not survive a restart).
    ///
    /// Idempotent + crash-safe: re-admission reuses the existing row (the runner
    /// updates it in place), so a crash mid-recovery just leaves it `queued` for
    /// the next startup. Best-effort per row — a persona that was deleted, or a
    /// row whose persona can't be loaded, is failed with a clear reason rather
    /// than blocking the rest. Runs AFTER [`Self::recover_stale_executions`] and
    /// AFTER the engine is constructed (needs `app` + the live engine to spawn).
    pub async fn requeue_persisted_executions(&self, app: AppHandle, pool: DbPool) {
        let queued = match exec_repo::get_queued_only(&pool) {
            Ok(q) => q,
            Err(e) => {
                tracing::warn!("Failed to query queued executions for re-admit: {}", e);
                return;
            }
        };
        if queued.is_empty() {
            tracing::debug!("No queued executions to re-admit");
            return;
        }

        let total = queued.len();
        let mut readmitted = 0usize;
        for exec in queued {
            // Load the persona; if it's gone, the queued row can never run.
            let persona = match persona_repo::get_by_id(&pool, &exec.persona_id) {
                Ok(p) => p,
                Err(_) => {
                    let _ = exec_repo::update_status(
                        &pool,
                        &exec.id,
                        UpdateExecutionStatus {
                            status: ExecutionState::Failed,
                            error_message: Some(
                                "Queued execution's persona no longer exists (dropped on restart)"
                                    .into(),
                            ),
                            ..Default::default()
                        },
                    );
                    continue;
                }
            };

            let tools =
                tool_repo::get_tools_for_persona(&pool, &exec.persona_id).unwrap_or_default();
            let input_data = exec
                .input_data
                .as_deref()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok());

            // Re-admit through the normal path. continuation = None: a queued
            // row had not yet started a CLI session, so there is nothing to
            // resume — it runs fresh. Errors (e.g. queue full) leave the row
            // queued for a later attempt.
            match self
                .start_execution(
                    app.clone(),
                    pool.clone(),
                    exec.id.clone(),
                    persona,
                    tools,
                    input_data,
                    None,
                )
                .await
            {
                Ok(()) => readmitted += 1,
                Err(e) => {
                    tracing::warn!(
                        execution_id = %exec.id,
                        error = %e,
                        "Failed to re-admit queued execution; left queued for retry",
                    );
                }
            }
        }

        tracing::info!(
            total = total,
            readmitted = readmitted,
            "Re-admitted persisted queued executions after restart",
        );
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
        // Reject new executions for personas that are being deleted
        if self.is_deleting(&persona.id).await {
            return Err(AppError::Validation(format!(
                "Persona '{}' is being deleted — new executions are blocked",
                persona.name,
            )));
        }

        // Atomically try to run or enqueue
        let admit_result = {
            let mut tracker = self.tracker.lock().await;
            tracker.admit(&persona.id, &execution_id, persona.max_concurrent, priority)
        };

        match admit_result {
            AdmitResult::Running => {
                // Slot available -- spawn the execution task immediately
                self.spawn_execution_task(
                    app,
                    pool,
                    execution_id,
                    persona,
                    tools,
                    input_data,
                    continuation,
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
                let global_running = self.tracker.lock().await.total_running();
                let global_capacity = self.tracker.lock().await.global_max_concurrent();
                let _ = app.emit(
                    event_name::QUEUE_STATUS,
                    QueueStatusEvent {
                        execution_id: execution_id.clone(),
                        persona_id: persona.id.clone(),
                        action: "queued".into(),
                        position: Some(position),
                        queue_depth,
                        global_running,
                        global_capacity,
                    },
                );
                // Emit process activity so the drawer shows this process as queued
                process_activity::emit_process_activity(
                    &app,
                    "execution",
                    "queued",
                    Some(&execution_id),
                    Some(&persona.name),
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
                self.scheduler.record_queue_rejection();
                let _ = app.emit(
                    "queue-backpressure",
                    serde_json::json!({
                        "personaId": persona.id,
                        "personaName": persona.name,
                        "executionId": execution_id,
                        "maxDepth": max_depth,
                        "running": persona.max_concurrent,
                    }),
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
            event_name::EXECUTION_STATUS,
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
        let circuit_breaker_for_drain = self.circuit_breaker.clone();
        let queued_contexts = self.queued_contexts.clone();
        let scheduler_for_task = self.scheduler.clone();
        let completion_waiters = self.completion_waiters.clone();
        let healing_personas = self.healing_personas.clone();

        // Clone log_dir for potential healing retries (log_dir is moved into run_execution)
        let log_dir_for_retry = log_dir.clone();

        // Extract chain_trace_id from input_data if present (chain trigger payloads embed it).
        // Tolerates BOTH the raw top-level shape and the event-bus wrapped
        // `{_event, payload}` shape — the latter nests the id under `payload`,
        // which a top-level-only read missed, orphaning every event-dispatched
        // hop's trace (Chain tab showed 'partial' for real chains).
        let chain_trace_id = input_data
            .as_ref()
            .and_then(chain::chain_trace_id_from_input);

        // Canonical session-pool hash for the config this run uses — computed
        // here (before `persona`/`tools` move into the task) with the SAME
        // helper the warm-reuse take() site uses.
        let session_config_hash = session_pool::compute_config_hash(
            persona.system_prompt.as_str(),
            persona.structured_prompt.as_deref(),
            persona.model_profile.as_deref(),
            tools.len(),
            &prompt::active_capabilities_fingerprint(persona.design_context.as_deref()),
        );

        // Spawn background task.
        // The inner work is wrapped in catch_unwind so that a panic inside
        // run_execution (credential failure, spawn failure, etc.) does NOT
        // skip the cleanup block.  Without this guard a panic would
        // permanently leak a ConcurrencyTracker slot, making the persona
        // appear at capacity and blocking all future executions until restart.
        let handle = tokio::spawn(async move {
            let pool_for_cleanup = pool_clone.clone();
            let exec_id_cleanup = exec_id.clone();
            let persona_id_cleanup = persona_id.clone();

            let work = AssertUnwindSafe(async {
                let result = run_execution_with_ceiling(
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
                    persist_status_if_not_final(
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
                            execution_config: result.execution_config.clone(),
                            log_truncated: result.log_truncated,
                            ..Default::default()
                        },
                    )
                    .await;
                    // Signal frontend that persona health data has changed
                    emit_event(
                        &app_for_healing,
                        event_name::PERSONA_HEALTH_CHANGED,
                        &serde_json::json!({
                            "persona_id": persona_id,
                        }),
                    );
                } else {
                    handle_execution_result(
                        &pool_clone,
                        &app_for_healing,
                        &exec_id,
                        &persona_id,
                        persona_timeout_ms,
                        &result,
                        session_config_hash,
                        tracker.clone(),
                        child_pids.clone(),
                        cancelled_flags.clone(),
                        log_dir_for_retry.clone(),
                        circuit_breaker,
                        Some(scheduler_for_task.clone()),
                        healing_personas.clone(),
                    )
                    .await;
                }
            });

            if let Err(panic_info) = work.catch_unwind().await {
                let panic_msg = match panic_info.downcast_ref::<&str>() {
                    Some(s) => s.to_string(),
                    None => match panic_info.downcast_ref::<String>() {
                        Some(s) => s.clone(),
                        None => "unknown panic".to_string(),
                    },
                };
                tracing::error!(
                    execution_id = %exec_id_cleanup,
                    persona_id = %persona_id_cleanup,
                    panic = %panic_msg,
                    "Execution task panicked — releasing concurrency slot",
                );
                // Persist failure so the execution doesn't stay stuck in Running
                persist_status_if_not_final(
                    &pool_for_cleanup,
                    Some(&app_for_drain),
                    &exec_id_cleanup,
                    UpdateExecutionStatus {
                        status: ExecutionState::Failed,
                        error_message: Some(format!("Internal error (panic): {panic_msg}")),
                        ..Default::default()
                    },
                )
                .await;
            }

            // Clean up tracker and task handle (always, regardless of panic/cancellation)
            tracker
                .lock()
                .await
                .remove_running(&persona_id_cleanup, &exec_id_cleanup);
            tasks.lock().await.remove(&exec_id_cleanup);
            cancelled_flags.lock().await.remove(&exec_id_cleanup);

            // Notify any callers waiting for this execution to complete
            if let Some(waiters) = completion_waiters.lock().await.remove(&exec_id_cleanup) {
                for tx in waiters {
                    let _ = tx.send(());
                }
            }

            // Drain queue: promote next waiting execution globally
            drain_and_start_next(
                tracker,
                tasks.clone(),
                queued_contexts,
                cancelled_flags,
                child_pids,
                app_for_drain,
                pool_for_drain,
                circuit_breaker_for_drain,
                healing_personas,
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
        // 0. Check if execution is queued (not yet running) -- just remove from queue
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

        // 1. Set cancellation flag -- tells the spawned task to write
        //    status='cancelled' with metrics instead of completed/failed
        if let Some(flag) = self.cancelled_flags.lock().await.get(execution_id) {
            flag.store(true, Ordering::Release);
        }

        // 2. Write bare cancelled status to DB as a safety net, but ONLY if
        //    the execution is still running. This prevents overwriting a final
        //    status (completed/failed) that the spawned task already wrote.
        persist_status_if_running(
            pool,
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
            match tokio::time::timeout(std::time::Duration::from_secs(5), handle).await {
                Ok(_) => {
                    // Task finished normally -- metrics written to DB
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

    /// Force-cancel **all** remaining running and queued executions for a persona.
    ///
    /// Unlike `cancel_execution` (which gracefully waits for metric writes),
    /// this aborts task handles immediately and cleans up tracker slots.
    /// Used as a last resort when the deletion drain timeout has been reached
    /// and stale tasks would otherwise write to CASCADE-deleted DB rows.
    pub async fn force_cancel_all_for_persona(&self, persona_id: &str, pool: &DbPool) -> usize {
        let mut force_count: usize = 0;

        // 1. Collect running execution IDs for this persona
        let running_ids = self.tracker.lock().await.running_ids(persona_id);

        for exec_id in &running_ids {
            // Set cancellation flag so any in-flight write sees it
            if let Some(flag) = self.cancelled_flags.lock().await.get(exec_id) {
                flag.store(true, Ordering::Release);
            }

            // Kill child OS process
            if let Some(pid) = self.child_pids.lock().await.remove(exec_id) {
                tracing::info!(
                    execution_id = %exec_id,
                    pid = pid,
                    "Force-killing child process during persona deletion",
                );
                kill_process(pid);
            }

            // Abort the tokio task (don't wait for graceful shutdown)
            if let Some(handle) = self.tasks.lock().await.remove(exec_id) {
                handle.abort();
            }

            // Mark as cancelled in DB (best-effort, persona row may be about to be deleted)
            let _ = exec_repo::update_status(
                pool,
                exec_id,
                UpdateExecutionStatus {
                    status: ExecutionState::Cancelled,
                    error_message: Some("Force-cancelled: persona deletion drain timeout".into()),
                    ..Default::default()
                },
            );

            // Clean up tracker slot
            self.tracker
                .lock()
                .await
                .remove_running(persona_id, exec_id);
            self.cancelled_flags.lock().await.remove(exec_id);

            force_count += 1;
        }

        // 2. Drain queued executions
        let queued_ids = self.tracker.lock().await.queued_ids(persona_id);
        for exec_id in &queued_ids {
            self.tracker.lock().await.remove_queued(persona_id, exec_id);
            self.queued_contexts.lock().await.remove(exec_id);
            let _ = exec_repo::update_status(
                pool,
                exec_id,
                UpdateExecutionStatus {
                    status: ExecutionState::Cancelled,
                    error_message: Some("Force-cancelled: persona deletion drain timeout".into()),
                    ..Default::default()
                },
            );
            force_count += 1;
        }

        if force_count > 0 {
            tracing::warn!(
                persona_id = %persona_id,
                force_count,
                "Force-cancelled remaining executions after deletion drain timeout",
            );
        }

        force_count
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

        // 2. Write cancelled status to DB (only if still running)
        persist_status_if_running(
            pool,
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
    pub async fn get_cancelled_flag(&self, execution_id: &str) -> Option<Arc<AtomicBool>> {
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
                    None, // backoff retries restart fresh
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
                    None, // timeout retries restart fresh
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
            healing::HealingAction::RetryAt { retry_at } => {
                // ASSIGNMENT STEPS are excluded: the orchestrator's QA fix loop
                // + AssignmentAutoResumeSubscription own a step's retry
                // lifecycle (reset → pending → re-matched as a NEW execution).
                // Scheduling the ORIGINAL step execution here too would
                // double-drive the same step after the limit resets — two
                // executions, duplicate PR attempts on one branch.
                let is_step_execution = exec_repo::get_by_id(pool, exec_id)
                    .ok()
                    .and_then(|e| e.input_data)
                    .map(|i| i.contains("\"assignment_id\""))
                    .unwrap_or(false);
                if is_step_execution {
                    tracing::info!(
                        persona_id = %persona_id,
                        execution_id = %exec_id,
                        "Healing analysis: usage-limit retry SKIPPED for assignment step (orchestrator owns step retries)",
                    );
                    return;
                }
                // Durable: a multi-hour in-memory sleep would not survive an
                // app restart. Persist and let the event-bus tick drain it.
                tracing::info!(
                    persona_id = %persona_id,
                    execution_id = %exec_id,
                    retry_at = %retry_at,
                    "Healing analysis: persisting scheduled retry",
                );
                if let Err(e) = scheduled_retries_repo::upsert(
                    pool,
                    exec_id,
                    persona_id,
                    &retry_at.to_rfc3339(),
                    retry_reason_for(diagnosis),
                ) {
                    tracing::error!(
                        execution_id = %exec_id,
                        error = %e,
                        "Failed to persist scheduled usage-limit retry",
                    );
                }
            }
            healing::HealingAction::AiHealing | healing::HealingAction::CreateIssue => {}
        }
    }

    /// Drain due rows from `scheduled_retries` and dispatch each as an
    /// immediate healing retry (delay 0 through the normal retry path, so
    /// capacity checks, lineage, and circuit-breaker guards all apply).
    ///
    /// Called from the event-bus tick (2s active / 10s idle cadence) — ample
    /// resolution for multi-hour usage-limit waits, and because the table is
    /// the source of truth, retries survive app restarts.
    pub async fn drain_due_scheduled_retries(&self, app: &AppHandle, pool: &DbPool) {
        let now_iso = chrono::Utc::now().to_rfc3339();
        let due = match scheduled_retries_repo::get_due(pool, &now_iso) {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!(error = %e, "scheduled_retries: failed to load due rows");
                return;
            }
        };
        for row in due {
            // Claim by deleting first — a retry that fails to spawn must not
            // re-fire on every subsequent tick.
            if let Err(e) = scheduled_retries_repo::delete(pool, &row.execution_id) {
                tracing::warn!(
                    execution_id = %row.execution_id,
                    error = %e,
                    "scheduled_retries: failed to claim row",
                );
                continue;
            }
            let exec_row = exec_repo::get_by_id(pool, &row.execution_id).ok();
            let original_exec_id = exec_row
                .as_ref()
                .and_then(|e| e.retry_of_execution_id.clone())
                .unwrap_or_else(|| row.execution_id.clone());
            let current_retry_count = exec_row.as_ref().map(|e| e.retry_count).unwrap_or(0);
            if current_retry_count >= healing::MAX_RETRY_COUNT {
                tracing::warn!(
                    execution_id = %row.execution_id,
                    "scheduled_retries: retry budget exhausted, dropping",
                );
                continue;
            }
            // API/server-error retries resume the prior Claude session so the
            // run continues where it stopped ("please continue"); usage-limit
            // retries restart fresh. Falls back to a fresh restart when the
            // failed run never captured a session id.
            let continuation = if row.reason.as_deref() == Some("api_error_resume") {
                match exec_row.as_ref().and_then(|e| e.claude_session_id.clone()) {
                    Some(sid) => Some(types::Continuation::SessionResume(sid)),
                    None => {
                        tracing::info!(
                            execution_id = %row.execution_id,
                            "scheduled_retries: api-error retry has no session id, restarting fresh",
                        );
                        None
                    }
                }
            } else {
                None
            };
            tracing::info!(
                persona_id = %row.persona_id,
                execution_id = %row.execution_id,
                reason = ?row.reason,
                resume = continuation.is_some(),
                "scheduled_retries: dispatching due retry",
            );
            spawn_delayed_retry(
                0,
                None,
                continuation,
                pool.clone(),
                app.clone(),
                row.persona_id,
                original_exec_id,
                current_retry_count + 1,
                self.tracker.clone(),
                self.child_pids.clone(),
                self.cancelled_flags.clone(),
                self.log_dir.clone(),
                self.circuit_breaker.clone(),
            );
        }
    }

    /// Start a chained AI healing execution that resumes the original Claude
    /// session to diagnose and fix the failure.  Dev-mode only.
    #[allow(clippy::too_many_arguments)]
    pub fn start_healing_chain(
        &self,
        app: &AppHandle,
        pool: &DbPool,
        execution_id: &str,
        persona_id: &str,
        session_id: &str,
        error_message: &str,
        category_str: &str,
    ) {
        spawn_healing_chain(
            pool.clone(),
            app.clone(),
            execution_id.to_string(),
            persona_id.to_string(),
            session_id.to_string(),
            error_message.to_string(),
            category_str.to_string(),
            self.tracker.clone(),
            self.child_pids.clone(),
            self.cancelled_flags.clone(),
            self.log_dir.clone(),
            self.circuit_breaker.clone(),
            self.healing_personas.clone(),
            true, // command path: slot already acquired via try_start_healing
        );
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

/// After an execution finishes and its running slot is freed, check all
/// persona queues globally for the highest-priority candidate and start it.
///
/// Uses `drain_next_global` to pick the best candidate across ALL personas,
/// respecting both per-persona and global concurrency limits.
///
/// Takes owned types and returns a boxed Send future so the function can be
/// awaited inside `tokio::spawn` blocks (which require Send futures).
#[allow(clippy::too_many_arguments)]
fn drain_and_start_next(
    tracker: Arc<Mutex<ConcurrencyTracker>>,
    tasks: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    queued_contexts: Arc<Mutex<HashMap<String, QueuedExecutionContext>>>,
    cancelled_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    app: AppHandle,
    pool: DbPool,
    circuit_breaker: Arc<failover::ProviderCircuitBreaker>,
    healing_personas: Arc<Mutex<HashSet<String>>>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
    Box::pin(async move {
        // Atomically: scan all persona queues for the best candidate, check both
        // per-persona and global capacity, dequeue, register as running.
        let next = {
            let mut t = tracker.lock().await;
            t.drain_next_global().map(|queued| {
                let pid = queued.persona_id.clone();
                let depth = t.queue_depth(&pid);
                let global_running = t.total_running();
                let global_capacity = t.global_max_concurrent();
                (queued, pid, depth, global_running, global_capacity)
            })
        };

        if let Some((queued, persona_id, queue_depth, global_running, global_capacity)) = next {
            let exec_id = queued.execution_id.clone();
            let exec_id_for_tasks = exec_id.clone();

            // Emit promoted event
            let _ = app.emit(
                event_name::QUEUE_STATUS,
                QueueStatusEvent {
                    execution_id: exec_id.clone(),
                    persona_id: persona_id.clone(),
                    action: "promoted".into(),
                    position: None,
                    queue_depth,
                    global_running,
                    global_capacity,
                },
            );

            tracing::info!(
                persona_id = %persona_id,
                execution_id = %exec_id,
                global_running = global_running,
                "Queue: promoted execution to running slot (global {}/{})",
                global_running, global_capacity,
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
                    event_name::EXECUTION_STATUS,
                    types::ExecutionStatusEvent {
                        execution_id: exec_id.clone(),
                        status: ExecutionState::Running,
                        error: None,
                        duration_ms: None,
                        cost_usd: None,
                    },
                );

                // Spawn the actual execution -- reuse the saved context.
                // We build a mini execution task inline since we don't have &self here.
                let persona = ctx.persona;
                let persona_id_owned = persona.id.clone();
                let persona_timeout_ms = persona.timeout_ms;
                let pool_clone = ctx.pool.clone();
                let pool_for_drain = ctx.pool.clone();
                let app_handle = ctx.app.clone();
                let app_for_healing = ctx.app.clone();
                let app_for_drain = ctx.app.clone();
                let child_pids = child_pids.clone();
                let cancelled = Arc::new(AtomicBool::new(false));
                cancelled_flags
                    .lock()
                    .await
                    .insert(exec_id.clone(), cancelled.clone());

                let log_dir = std::env::temp_dir().join("personas").join("logs");
                let log_dir_for_retry = log_dir.clone();

                // See start_execution_with_priority: tolerate both the raw and
                // the event-bus wrapped `{_event, payload}` input shapes.
                let chain_trace_id = ctx
                    .input_data
                    .as_ref()
                    .and_then(chain::chain_trace_id_from_input);

                let tracker_clone = tracker.clone();
                let tasks_clone = tasks.clone();
                let queued_contexts_clone = queued_contexts.clone();
                let cancelled_flags_clone = cancelled_flags.clone();
                let child_pids_clone = child_pids.clone();
                let circuit_breaker = circuit_breaker.clone();
                let circuit_breaker_for_drain = circuit_breaker.clone();
                let healing_personas = healing_personas.clone();

                let pool_for_cleanup = pool_clone.clone();
                let exec_id_cleanup = exec_id.clone();
                let persona_id_cleanup = persona_id_owned.clone();

                // Canonical session-pool hash — same helper as the take() site.
                let session_config_hash = session_pool::compute_config_hash(
                    persona.system_prompt.as_str(),
                    persona.structured_prompt.as_deref(),
                    persona.model_profile.as_deref(),
                    ctx.tools.len(),
                    &prompt::active_capabilities_fingerprint(persona.design_context.as_deref()),
                );

                let handle = tokio::spawn(async move {
                    let work = AssertUnwindSafe(async {
                        let result = run_execution_with_ceiling(
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
                            persist_status_if_not_final(
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
                                    log_truncated: result.log_truncated,
                                    ..Default::default()
                                },
                            )
                            .await;
                            emit_event(
                                &app_for_healing,
                                event_name::PERSONA_HEALTH_CHANGED,
                                &serde_json::json!({
                                    "persona_id": persona_id_owned,
                                }),
                            );
                        } else {
                            handle_execution_result(
                                &pool_clone,
                                &app_for_healing,
                                &exec_id,
                                &persona_id_owned,
                                persona_timeout_ms,
                                &result,
                                session_config_hash,
                                tracker_clone.clone(),
                                child_pids.clone(),
                                cancelled_flags.clone(),
                                log_dir_for_retry.clone(),
                                circuit_breaker,
                                None,
                                healing_personas.clone(),
                            )
                            .await;
                        }
                    });

                    if let Err(panic_info) = work.catch_unwind().await {
                        let panic_msg = match panic_info.downcast_ref::<&str>() {
                            Some(s) => s.to_string(),
                            None => match panic_info.downcast_ref::<String>() {
                                Some(s) => s.clone(),
                                None => "unknown panic".to_string(),
                            },
                        };
                        tracing::error!(
                            execution_id = %exec_id_cleanup,
                            persona_id = %persona_id_cleanup,
                            panic = %panic_msg,
                            "Queued execution task panicked — releasing concurrency slot",
                        );
                        persist_status_if_not_final(
                            &pool_for_cleanup,
                            Some(&app_for_drain),
                            &exec_id_cleanup,
                            UpdateExecutionStatus {
                                status: ExecutionState::Failed,
                                error_message: Some(format!("Internal error (panic): {panic_msg}")),
                                ..Default::default()
                            },
                        )
                        .await;
                    }

                    // Clean up (always, regardless of panic)
                    tracker_clone
                        .lock()
                        .await
                        .remove_running(&persona_id_cleanup, &exec_id_cleanup);
                    tasks_clone.lock().await.remove(&exec_id_cleanup);
                    cancelled_flags.lock().await.remove(&exec_id_cleanup);

                    // Recursively drain next globally (owned types for Send safety)
                    drain_and_start_next(
                        tracker_clone,
                        tasks_clone.clone(),
                        queued_contexts_clone,
                        cancelled_flags_clone,
                        child_pids_clone,
                        app_for_drain,
                        pool_for_drain,
                        circuit_breaker_for_drain,
                        healing_personas,
                    )
                    .await;
                });

                tasks.lock().await.insert(exec_id_for_tasks, handle);
            } else {
                // Context was missing — the queue and the context map diverged
                // (e.g. a cancel removed the saved context after drain_next_global
                // had already popped the queue entry). Release the running slot we
                // just claimed, mark the orphaned row failed so it can't linger in
                // `queued` forever (the zombie reaper only sweeps `running`), and
                // then RE-DRAIN so the freed slot is offered to the next
                // candidate. Every other terminal path re-drains; this branch used
                // to dead-end, permanently stranding the rest of the persona's
                // queue on a single divergence.
                tracker.lock().await.remove_running(&persona_id, &exec_id);
                persist_status_if_not_final(
                    &pool,
                    Some(&app),
                    &exec_id,
                    UpdateExecutionStatus {
                        status: ExecutionState::Failed,
                        error_message: Some(
                            "Queued execution context was lost before it could start".into(),
                        ),
                        ..Default::default()
                    },
                )
                .await;
                drain_and_start_next(
                    tracker,
                    tasks,
                    queued_contexts,
                    cancelled_flags,
                    child_pids,
                    app,
                    pool,
                    circuit_breaker,
                    healing_personas,
                )
                .await;
            }
        }
    }) // close Box::pin(async move { ... })
}

// =============================================================================
// Extracted sub-functions for start_execution post-processing
// =============================================================================

/// Quota-aware admission cooldowns (seconds). When a completed execution failed
/// against the AI provider's limit, the engine pauses admitting NEW work for
/// this long so the fleet doesn't burn the whole queue against the same limit.
/// A short pause for transient rate limits (429); a longer one for session/
/// usage caps (which reset on the order of hours — a probe execution after the
/// cooldown re-arms if the limit is still in force, or resumes admission if not).
const QUOTA_COOLDOWN_RATE_SECS: i64 = 120;
const QUOTA_COOLDOWN_SESSION_SECS: i64 = 900;

/// A queued fix-loop re-entry — plain data, so the producer side (inside the
/// execution pipeline) never names `execute_persona_inner`'s future type.
pub struct FixReentryRequest {
    pub persona_id: String,
    /// The failed run's own `input_data` with the two `_fix_*` keys merged in
    /// (see `fix_loop::build_reentry_input`). Carrying the original input is
    /// what keeps `{{var}}`, `## Current Focus`, the capability policy lines
    /// and the time filter present on the corrective attempt.
    pub input: String,
    /// The capability the failed run was scoped to, replayed so attempt 2
    /// resolves the same `model_override` / capability defaults instead of
    /// silently dropping to the persona's base model profile.
    pub use_case_id: Option<String>,
}

/// Sender to the fix-loop worker, installed once at startup by
/// [`init_fix_loop_worker`].
static FIX_REENTRY_TX: std::sync::OnceLock<tokio::sync::mpsc::UnboundedSender<FixReentryRequest>> =
    std::sync::OnceLock::new();

/// Install the fix-loop re-entry channel and hand the receiver to the host.
///
/// The draining worker deliberately lives OUTSIDE the execution pipeline's
/// async-type graph, so it can drive `execute_persona_inner` without forming
/// the recursive opaque-type cycle a direct call from the completion handler
/// would. It now lives outside this *module* too, for the same reason expressed
/// as a layer: draining needs `AppState`, which sits above the engine. The host
/// owns the loop; the engine owns the channel and the request type.
///
/// Returns `None` if already initialised.
pub fn init_fix_loop_worker() -> Option<tokio::sync::mpsc::UnboundedReceiver<FixReentryRequest>> {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<FixReentryRequest>();
    if FIX_REENTRY_TX.set(tx).is_err() {
        return None; // already initialised
    }
    Some(rx)
}

/// Process-level failure-signature breaker shared across fix-loop re-entries so a
/// persona that keeps producing the *same* quality failure stops looping instead
/// of burning budget on a deterministic error.
static FIX_LOOP_BREAKER: std::sync::LazyLock<
    tokio::sync::Mutex<failure_signature::FailureBreaker>,
> = std::sync::LazyLock::new(|| tokio::sync::Mutex::new(failure_signature::FailureBreaker::new(3)));

/// F7: re-enter a persona with a corrective instruction after a run COMPLETED but
/// failed a critical quality assertion. Opt-in per persona (`fix_loop_enabled`
/// parameter, default off), bounded by `max_fix_attempts` + the failure-signature
/// breaker. Fire-and-forget — the re-entry is a fresh execution carrying the
/// incremented attempt count and the fix prompt in its `input_data`.
async fn maybe_run_fix_loop(
    pool: &DbPool,
    exec_id: &str,
    persona_id: &str,
    first_critical_failure: Option<&str>,
) {
    use crate::engine::fix_loop::{self, FixDecision};

    // Load persona + config; bail fast when the loop isn't enabled.
    let Ok(persona) = crate::db::repos::core::personas::get_by_id(pool, persona_id) else {
        return;
    };
    let config = fix_loop::FixLoopConfig::from_persona_parameters(persona.parameters.as_deref());
    if !config.enabled || persona.headless {
        return;
    }

    // Load the failed run ONCE: it carries both the attempt counter and the
    // input the corrective attempt has to inherit. Re-entering with only the
    // fix metadata assembles a prompt with no resolved variables, no Current
    // Focus and no capability policy — i.e. attempt 2 arrives knowing less
    // than the attempt it is supposed to correct.
    let prior = crate::db::repos::execution::executions::get_by_id(pool, exec_id).ok();
    let prior_input = prior.as_ref().and_then(|e| e.input_data.clone());
    let attempt = prior_input
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|v| {
            v.get(fix_loop::FIX_ATTEMPT_KEY)
                .and_then(serde_json::Value::as_u64)
        })
        .unwrap_or(0) as u32;

    let failures = vec![first_critical_failure
        .map(str::to_string)
        .unwrap_or_else(|| "a critical output assertion failed".to_string())];

    // Circuit breaker on the normalized failure.
    let reason = failures.join("; ");
    let tripped = {
        let mut breaker = FIX_LOOP_BREAKER.lock().await;
        breaker.record(persona_id, "quality_gate", &reason);
        breaker.tripped(persona_id, "quality_gate", &reason)
    };

    match fix_loop::decide(&config, &failures, attempt, tripped) {
        FixDecision::ReEnter { fix, attempt } => {
            let input = fix_loop::build_reentry_input(prior_input.as_deref(), attempt, &fix);
            let use_case_id = prior.as_ref().and_then(|e| e.use_case_id.clone());
            tracing::info!(
                execution_id = %exec_id,
                persona_id,
                attempt,
                carried_input = prior_input.is_some(),
                use_case_id = use_case_id.as_deref().unwrap_or("-"),
                "fix-loop: re-entering persona with correction"
            );
            // Hand off plain data to the startup-spawned worker. Calling
            // execute_persona_inner here would close a mutual-async type cycle
            // (spawn_execution_task → handle_execution_result → here → …); the
            // channel decouples it.
            if let Some(tx) = FIX_REENTRY_TX.get() {
                let _ = tx.send(FixReentryRequest {
                    persona_id: persona_id.to_string(),
                    input,
                    use_case_id,
                });
            } else {
                tracing::warn!("fix-loop worker not initialized; skipping re-entry");
            }
        }
        FixDecision::Stop { reason } => {
            tracing::debug!(execution_id = %exec_id, persona_id, "fix-loop stop: {reason}");
        }
    }
}

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
    // Canonical session-pool config hash computed at spawn time from the
    // persona/tools THIS run used (session_pool::compute_config_hash) — the
    // same helper the take() site uses, so offer/take actually match.
    session_config_hash: u64,
    tracker: Arc<Mutex<ConcurrencyTracker>>,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    log_dir: PathBuf,
    circuit_breaker: Arc<failover::ProviderCircuitBreaker>,
    scheduler: Option<Arc<SchedulerState>>,
    healing_personas: Arc<Mutex<HashSet<String>>>,
) {
    // Evaluate output assertions BEFORE the status write so critical-severity
    // failures can downgrade an otherwise-successful execution to Incomplete.
    // This catches silent setup failures (e.g. "credentials are not configured"
    // prose) that the CLI-exit-code success gate misses — the baseline
    // `NotContains` assertion injected by `template_v3::hoist_output_assertions`
    // fires here, and Phase 5's notification bridge surfaces `Incomplete` as
    // a `warning` in the TitleBar bell.
    let pre_output = result.output.as_deref().unwrap_or("");
    let assertion_summary = if result.success && !pre_output.is_empty() {
        Some(output_assertions::evaluate_assertions(
            pool, exec_id, persona_id, pre_output,
        ))
    } else {
        None
    };
    let assertion_downgrade = assertion_summary
        .as_ref()
        .filter(|s| s.critical_failures > 0);

    let status = if !result.success {
        ExecutionState::Failed
    } else if assertion_downgrade.is_some() {
        ExecutionState::Incomplete
    } else {
        ExecutionState::Completed
    };

    // When assertions force a downgrade, attach the first critical failure
    // as the execution's error message so the notification center shows the
    // reason ("Baseline blocker detection: ...") instead of a blank warning.
    let effective_error = match (&assertion_downgrade, &result.error) {
        (Some(summary), _) => summary
            .first_critical_failure
            .clone()
            .or_else(|| result.error.clone()),
        (None, err) => err.clone(),
    };

    // Direction 2 (runner owns its terminal status): the runner now writes a
    // provisional terminal status before returning (success → Completed,
    // CLI-failure → Failed) with all result fields, so the row is never left
    // `running` even if this handler never runs. This handler's job is now
    // confirmation/refinement rather than the primary write.
    //
    // When an output assertion downgrades a successful run, the runner's
    // provisional `completed` must become `incomplete`. `persist_status_if_not_final`
    // below cannot perform that move (`completed` is terminal, its guard is
    // `status = 'running'`), so first apply a compare-and-set guarded on the
    // current `completed` status. This never clobbers a concurrent cancel — a
    // cancel leaves the row `cancelled`, not `completed`, so the CAS no-ops. And
    // if the runner's provisional write was skipped (row still `running`), this
    // CAS also no-ops and the `persist_status_if_not_final` call below advances
    // running → incomplete instead, so the final state is Incomplete either way.
    if status == ExecutionState::Incomplete && result.success {
        if let Ok(conn) = pool.get() {
            if let Err(e) = conn.execute(
                "UPDATE persona_executions SET status = 'incomplete', \
                 error_message = COALESCE(?1, error_message) \
                 WHERE id = ?2 AND status = 'completed'",
                rusqlite::params![effective_error.clone(), exec_id],
            ) {
                tracing::warn!(
                    execution_id = %exec_id,
                    error = %e,
                    "assertion downgrade CAS (completed → incomplete) failed; \
                     persist_status_if_not_final will retry running → incomplete"
                );
            }
        }
    }

    // Write final status to DB. Use conditional write to avoid overwriting
    // a terminal status if a concurrent cancel already finalized the execution.
    // With the runner's provisional write in place this is idempotent when the
    // row is already terminal, and remains the retrying safety net (dead-letter
    // + healing event) for the case where the runner's single-shot write was
    // skipped and the row is still `running`.
    persist_status_if_not_final(
        pool,
        Some(app),
        exec_id,
        UpdateExecutionStatus {
            status,
            output_data: result.output.clone(),
            error_message: effective_error,
            duration_ms: Some(result.duration_ms as i64),
            log_file_path: result.log_file_path.clone(),
            execution_flows: result.execution_flows.clone(),
            input_tokens: Some(result.input_tokens as i64),
            output_tokens: Some(result.output_tokens as i64),
            cost_usd: Some(result.cost_usd),
            tool_steps: result.tool_steps.clone(),
            claude_session_id: result.claude_session_id.clone(),
            execution_config: result.execution_config.clone(),
            log_truncated: result.log_truncated,
            business_outcome: result.business_outcome.clone(),
        },
    )
    .await;

    // F7 quality-gate fix-loop. A run that COMPLETED but failed a critical
    // assertion (status downgraded to Incomplete) can be auto-re-entered with a
    // corrective instruction — IF the persona explicitly opted in (default off).
    // Hard failures (`!result.success`) go to healing below, not here. Opt-in +
    // bounded attempts + the failure-signature breaker keep it safe; it never
    // fires for personas that didn't enable it, so existing execution/eval paths
    // are untouched.
    if result.success {
        if let Some(summary) = assertion_downgrade {
            maybe_run_fix_loop(
                pool,
                exec_id,
                persona_id,
                summary.first_critical_failure.as_deref(),
            )
            .await;
        }
    }

    // Quota-aware admission: if this execution failed against the AI provider's
    // session/usage/rate limit, arm the engine's admission cooldown so the rest
    // of the fleet stops running straight into the same limit (the soak showed
    // 94% of failures were session-limit — bursts that the concurrency cap
    // alone can't prevent). Reactive + always-on; classifies on the error AND
    // the output (the CLI's "You've hit your session limit" lands in output).
    // Auto-clears by expiry: a probe execution after the cooldown either
    // succeeds (admission resumes) or re-arms it. `drain_*`/`admit` honour it.
    if !result.success {
        let blob = format!(
            "{} {}",
            result.error.as_deref().unwrap_or(""),
            result.output.as_deref().unwrap_or("")
        );
        let cooldown_secs = match failover::classify_error(&blob) {
            Some(error_taxonomy::ErrorCategory::SessionLimit) => {
                // Align the admission pause to the limit's ACTUAL reset when
                // the CLI message carries one ("resets 1:50pm" / unix ts). A
                // fixed 900s cooldown re-admitted a fresh wave into the
                // still-active limit every 15 min — 58 burned executions over
                // one 5h window (2026-06-10). Clamped to [60s, 6h]; the fixed
                // fallback covers messages with no parseable timestamp.
                let aligned = parser::parse_usage_limit(&blob)
                    .and_then(|i| i.resets_at)
                    .map(|t| ((t - chrono::Utc::now()).num_seconds() + 120).clamp(60, 6 * 3600));
                Some(aligned.unwrap_or(QUOTA_COOLDOWN_SESSION_SECS))
            }
            Some(error_taxonomy::ErrorCategory::RateLimit) => Some(QUOTA_COOLDOWN_RATE_SECS),
            _ => None,
        };
        if let Some(secs) = cooldown_secs {
            let until = chrono::Utc::now() + chrono::Duration::seconds(secs);
            tracker.lock().await.set_quota_cooldown(until);
            tracing::warn!(
                execution_id = %exec_id,
                persona_id = %persona_id,
                cooldown_secs = secs,
                until = %until.to_rfc3339(),
                "Quota limit hit — pausing engine admission (quota-aware backpressure)"
            );
        }
    }

    // E1 — circuit breaker. After every successful-CLI run that the LLM
    // self-classified as non-value-delivering, check whether the persona
    // has accumulated 3 consecutive such runs. If so, disable the persona
    // and emit a notification so the user knows to fix the setup. A
    // single value_delivered (or unknown — back-compat) run resets the
    // counter on the SQL side via the most-recent-N window. Failure /
    // crash paths don't trigger this — only LLM self-assessment.
    if result.success
        && matches!(
            result.business_outcome.as_deref(),
            Some("no_input_available") | Some("precondition_failed")
        )
    {
        check_and_apply_circuit_breaker(pool, app, persona_id);
    }

    // Session pool: cache successful session for warm reuse on next execution.
    if result.success {
        if let Some(ref session_id) = result.claude_session_id {
            if let Some(pool_state) = app.try_state::<Arc<session_pool::SessionPool>>() {
                // Canonical hash computed at spawn from the persona/tools this
                // run used. Previously this site hashed execution_config JSON
                // while take() hashed persona fields — they never matched, so
                // warm session reuse was a permanent no-op.
                let config_hash = session_config_hash;
                let pool_ref = pool_state.inner().clone();
                let pid = persona_id.to_string();
                let sid = session_id.clone();
                tokio::spawn(async move {
                    pool_ref.offer(&pid, sid, config_hash).await;
                });
            }
        }
    }

    // Guard: if the persona was deleted (or is being deleted) while this
    // execution was running, skip all post-execution writes that reference
    // the persona. The rows would either hit FK constraint errors or be
    // immediately CASCADE-deleted.
    if persona_repo::get_by_id(pool, persona_id).is_err() {
        tracing::info!(
            persona_id,
            execution_id = %exec_id,
            "Persona no longer exists; skipping post-execution writes",
        );
        return;
    }

    // Trust score refresh -- update graduated autonomy score from execution history
    if let Err(e) = persona_repo::refresh_trust_score(pool, persona_id) {
        tracing::warn!(persona_id, error = %e, "Failed to refresh trust score");
    }

    // SLA breach detection -- cheap bounded read of this persona's recent
    // reliability; emits a typed bus event (once per episode) when it crosses
    // into or back out of a breach. Runs HERE on the completion path, never at
    // dashboard load. Best-effort: never fails the execution.
    sla_breach::evaluate_on_completion(pool, app, persona_id);

    // Knowledge graph extraction -- learn from every execution
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
            result
                .tool_steps
                .as_ref()
                .map(|j| serde_json::to_string(&j.0).unwrap_or_default())
                .as_deref(),
            result.error.as_deref(),
        );
    }

    // Output assertion summary — already evaluated pre-persist so the status
    // downgrade could be factored in. Log + emit here so downstream consumers
    // (Execution Detail assertion tab, notification center) see the result.
    if let Some(ref summary) = assertion_summary {
        if summary.total > 0 {
            tracing::info!(
                execution_id = %exec_id,
                persona_id,
                total = summary.total,
                passed = summary.passed,
                failed = summary.failed,
                critical_failures = summary.critical_failures,
                "Output assertions evaluated"
            );
            let _ = app.emit(event_name::ASSERTION_RESULTS, summary);
        }
    }

    // OS + external channel notification.
    // Phase C3 — simulation runs skip the completed-notification push so
    // the user can preview behavior without pinging real notification channels.
    let is_simulation = exec_repo::get_by_id(pool, exec_id)
        .map(|e| e.is_simulation)
        .unwrap_or(false);
    if !is_simulation {
        notify_execution_rich(app, pool, persona_id, status.as_str(), result);
    }

    // Budget enforcement (only on success)
    if result.success {
        check_budget_enforcement(pool, persona_id, exec_id);
    }

    // Chain triggers -- extract chain depth/visited/trace_id from execution's input_data
    // (propagated via chain event payloads to prevent infinite cycles)
    let source_input = exec_repo::get_by_id(pool, exec_id)
        .ok()
        .and_then(|exec| exec.input_data);
    // T1 (dual-driver): step executions are DAG-driven — suppress their
    // team-handoff chain triggers so the connection graph doesn't double-drive
    // the same work the orchestrator already schedules.
    let source_is_assignment_step = chain::input_is_assignment_step(source_input.as_deref());
    let (chain_depth, mut visited, existing_chain_trace_id, chain_cost_in) = source_input
        .map(|input| chain::extract_chain_metadata(Some(&input)))
        .unwrap_or_default();
    visited.insert(persona_id.to_string());

    // Whether this run is a downstream hop (inherited a chain id) or the ROOT of
    // a fresh chain (mints one from its own trace_id below).
    let is_downstream_hop = existing_chain_trace_id.is_some();
    // Use existing chain_trace_id if this execution is part of a chain,
    // otherwise use this execution's trace_id as the root of a new chain trace
    let chain_trace_id = existing_chain_trace_id.or_else(|| result.trace_id.clone());
    // Direction 3: fold this hop's cost into the running chain total before
    // evaluating the next links (so the ceiling sees spend-through-this-hop).
    let chain_cost_total = chain_cost_in + result.cost_usd;

    let cascade_metrics = chain::evaluate_chain_triggers(
        pool,
        persona_id,
        status.as_str(),
        result.output.as_deref(),
        exec_id,
        chain_depth,
        &visited,
        chain_trace_id.as_deref(),
        source_is_assignment_step,
        chain_cost_total,
    );
    if let Some(ref sched) = scheduler {
        sched.record_chain_cascade(&cascade_metrics);
    }

    // Direction 1b: back-fill this run's trace row so it shares the chain id.
    // Downstream hops already receive it via the stamper, but a fresh chain's
    // ROOT saved its trace with chain_trace_id = NULL (it had no upstream id at
    // spawn) — without this the root is absent from get_by_chain_trace_id and
    // the Chain tab reads 'partial'. Only stamp genuine chain participants (a
    // hop, or a root that actually fired ≥1 link) so standalone runs keep NULL.
    if let Some(ctid) = chain_trace_id.as_deref() {
        if is_downstream_hop || cascade_metrics.events_published > 0 {
            if let Err(e) =
                crate::db::repos::execution::traces::set_chain_trace_id(pool, exec_id, ctid)
            {
                tracing::warn!(
                    execution_id = %exec_id,
                    chain_trace_id = %ctid,
                    error = %e,
                    "Failed to back-fill chain_trace_id on trace row"
                );
            }
        }
    }

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
            healing_personas,
        );
    }

    // Auto-evolution: if the persona has an enabled evolution policy and enough
    // executions have accumulated since the last cycle, spawn a new cycle.
    // Only on successful executions — failed runs shouldn't trigger evolution.
    if result.success {
        if let Ok(Some(policy)) = evolution_repo::get_policy_for_persona(pool, persona_id) {
            if evolution::should_evolve(pool, &policy) {
                if let Ok(cycle) = evolution_repo::create_cycle(pool, &policy.id, persona_id) {
                    let evo_pool = pool.clone();
                    let cycle_id = cycle.id.clone();
                    tokio::spawn(async move {
                        evolution::run_evolution_cycle(evo_pool, policy, cycle_id).await;
                    });
                    tracing::info!(
                        persona_id,
                        "Auto-triggered evolution cycle after execution threshold met",
                    );
                }
            }
        }
    }

    // Signal frontend that persona health data has changed
    emit_event(
        app,
        event_name::PERSONA_HEALTH_CHANGED,
        &serde_json::json!({
            "persona_id": persona_id,
        }),
    );

    // Refresh system tray
    #[cfg(feature = "desktop")]
    (hooks().refresh_tray)(app);
}

/// Send an OS notification for execution completion.
#[allow(dead_code)]
fn notify_execution(
    app: &AppHandle,
    pool: &DbPool,
    persona_id: &str,
    status: &str,
    duration_ms: u64,
) {
    let persona = persona_repo::get_by_id(pool, persona_id).ok();
    let channels = persona
        .as_ref()
        .and_then(|p| p.notification_channels.as_deref());
    let name = persona.as_ref().map(|p| p.name.as_str()).unwrap_or("Agent");
    (hooks().notify_execution_completed)(app, name, status, duration_ms, channels);
}

fn notify_execution_rich(
    app: &AppHandle,
    pool: &DbPool,
    persona_id: &str,
    status: &str,
    result: &ExecutionResult,
) {
    let persona = persona_repo::get_by_id(pool, persona_id).ok();
    let channels = persona
        .as_ref()
        .and_then(|p| p.notification_channels.as_deref());
    let name = persona.as_ref().map(|p| p.name.as_str()).unwrap_or("Agent");
    (hooks().notify_execution_completed_rich)(
        app,
        name,
        status,
        result.duration_ms,
        channels,
        Some(result.cost_usd),
        result.model_used.as_deref(),
        result.error.as_deref(),
    );

    // Goal 1: ping Athena's execution-review debouncer. Cheap (a Notify
    // wake); the debouncer coalesces bursts and only acts when autonomous
    // mode is on, so this is a no-op when the feature's off.
    (hooks().signal_execution_finished)();
}

/// Check if the persona has exceeded its monthly budget and create an alert.
/// Number of consecutive non-value-delivering runs before the circuit
/// breaker disables the persona. Tuned for the "user noticed the persona
/// isn't doing anything useful" feedback: a single fluke shouldn't kill
/// it, but three runs in a row of "no_input_available" or
/// "precondition_failed" is a strong signal the setup is broken (missing
/// connector, dead OAuth token, no data source wired, etc.).
const CIRCUIT_BREAKER_THRESHOLD: usize = 3;

/// E1 — when a persona accumulates `CIRCUIT_BREAKER_THRESHOLD` consecutive
/// non-value-delivering executions, disable it and tell the user. The
/// counter is implicit (windowed over the last N completed runs); a
/// single `value_delivered` run inside that window clears the trip.
///
/// Disabling is automatic but reversible: the user re-enables the
/// persona from the Personas page and the counter starts fresh on the
/// next run. We do NOT clear `setup_status` here — if that was the
/// underlying cause, it stays at `needs_credentials` so the badge is
/// still visible.
///
/// Best-effort: any failure (DB query, persona deleted mid-flight, …)
/// is logged and skipped so the breaker can never prevent the
/// surrounding post-exec pipeline from finishing.
fn check_and_apply_circuit_breaker(pool: &DbPool, app: &AppHandle, persona_id: &str) {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(persona_id, error = %e, "circuit breaker: DB pool unavailable");
            return;
        }
    };

    // Pull the most recent `CIRCUIT_BREAKER_THRESHOLD` completed runs.
    // We only look at terminal status='completed' rows — running/queued/
    // failed don't count toward the consecutive streak.
    let mut stmt = match conn.prepare_cached(
        "SELECT business_outcome FROM persona_executions
         WHERE persona_id = ?1 AND status = 'completed'
         ORDER BY created_at DESC
         LIMIT ?2",
    ) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(persona_id, error = %e, "circuit breaker: prepare failed");
            return;
        }
    };
    let outcomes: Vec<String> = match stmt.query_map(
        rusqlite::params![persona_id, CIRCUIT_BREAKER_THRESHOLD as i64],
        |row| row.get::<_, String>(0),
    ) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(e) => {
            tracing::warn!(persona_id, error = %e, "circuit breaker: query failed");
            return;
        }
    };

    if outcomes.len() < CIRCUIT_BREAKER_THRESHOLD {
        return; // not enough history yet
    }
    let all_non_delivering = outcomes
        .iter()
        .all(|o| matches!(o.as_str(), "no_input_available" | "precondition_failed"));
    if !all_non_delivering {
        return;
    }

    // Check the persona is currently enabled — if a user already
    // disabled it manually we don't need to emit the notification.
    let persona = match persona_repo::get_by_id(pool, persona_id) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(persona_id, error = %e, "circuit breaker: persona lookup failed");
            return;
        }
    };
    if !persona.enabled {
        return;
    }

    // Team-cascade members idle/no-op as part of NORMAL flow — a release with
    // nothing new to ship, a reviewer waiting on an implementation. That's a
    // legitimate idle, not a wastefully-spinning standalone persona, and
    // DISABLING one silently breaks the whole team's handoff chain (observed:
    // Medical Bill's release auto-disabled after consecutive no-op releases,
    // stalling the team and aborting the next run at the health-lint gate). The
    // breaker exists for self-scheduled standalone personas, so skip it for
    // anything bound to a team.
    if persona.home_team_id.is_some() {
        tracing::debug!(
            persona_id = %persona.id,
            persona_name = %persona.name,
            "circuit breaker: skipped for team member (no-ops are normal cascade flow)"
        );
        return;
    }

    // Disable the persona. Use a direct UPDATE so we don't go through
    // the full update_persona pipeline (which would touch design_context,
    // structured_prompt, etc.). Best-effort.
    if let Err(e) = conn.execute(
        "UPDATE personas SET enabled = 0, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![chrono::Utc::now().to_rfc3339(), persona_id],
    ) {
        tracing::warn!(persona_id, error = %e, "circuit breaker: disable write failed");
        return;
    }

    tracing::warn!(
        persona_id = %persona_id,
        persona_name = %persona.name,
        outcomes = ?outcomes,
        "circuit breaker: persona disabled after {} consecutive non-value-delivering runs",
        CIRCUIT_BREAKER_THRESHOLD,
    );

    // Surface to the user via persona_messages so the notification bell
    // picks it up. The message carries enough context for them to know
    // why it was disabled and what to fix.
    let last_outcome = outcomes.first().map(|s| s.as_str()).unwrap_or("unknown");
    let hint = match last_outcome {
        "precondition_failed" => "A required connector or credential is missing or broken. Check Settings → Vault and re-enable the persona once fixed.",
        "no_input_available" => "The persona had nothing to process across the last three runs. Verify the data source (Gmail / Notion / Drive folder) actually contains new items the persona should act on, then re-enable.",
        _ => "Check the persona's recent executions for the precise reason, then re-enable manually.",
    };
    let content = format!(
        "Persona auto-disabled after {} consecutive non-value-delivering runs (last outcome: {}).\n\n{}",
        CIRCUIT_BREAKER_THRESHOLD, last_outcome, hint,
    );
    let _ = crate::db::repos::communication::messages::create(
        pool,
        crate::db::models::CreateMessageInput {
            persona_id: persona_id.into(),
            execution_id: None,
            title: Some(format!("{} — Setup required", persona.name)),
            content,
            content_type: Some("alert".into()),
            priority: Some("high".into()),
            metadata: None,
            thread_id: None,
            use_case_id: None,
        },
    );

    // Emit EXECUTION_STATUS-style notification so the bell picks it up
    // immediately, without waiting for the next message poll.
    let _ = app.emit(
        event_name::EXECUTION_STATUS,
        types::ExecutionStatusEvent {
            execution_id: format!("circuit-breaker-{}", persona_id),
            status: ExecutionState::Failed,
            error: Some(format!("{} auto-disabled — {}", persona.name, last_outcome)),
            duration_ms: None,
            cost_usd: None,
        },
    );
}

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
                        thread_id: None,
                        use_case_id: None,
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
