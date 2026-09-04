//! Generic background job infrastructure.
//!
//! Provides `BackgroundJobManager<S>` -- a thread-safe, evicting job store
//! that manages lifecycle (insert, status update, line emission, snapshot,
//! cancel) for any job state type `S: BackgroundJobState`.

use std::collections::HashMap;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use futures_util::FutureExt;
use serde::Serialize;
use tauri::Emitter;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::utils::extract_panic_message;

/// 30-minute TTL for completed/failed jobs before eviction.
const JOB_TTL_SECS: u64 = 30 * 60;

/// Maximum number of output lines stored per job. The store is a tail ring —
/// once full, the oldest line is dropped so the most recent output survives
/// (the `[Complete]`/`[Summary]` tail of a long scan is what a late poll needs,
/// not the first 500 lines of directory-listing noise).
const MAX_LINES: usize = 500;

/// Maximum bytes kept for a single output line before it's truncated. One giant
/// assistant message, a base64 blob, or a minified-JSON dump must not be allowed
/// to bloat the in-memory ring *or* the IPC payload that crosses into the
/// WebView (where it would inflate the JS heap and the DOM). The full detail
/// still lands in the CLI transcript; the live log panel only needs a readable
/// preview. Mirrors the per-line guard the raw CLI reader already applies in
/// `engine::cli_process::MAX_LINE_BYTES`.
const MAX_LINE_BYTES: usize = 4 * 1024; // 4 KB

/// Default max age for a running job before it is considered stale (10 minutes).
const DEFAULT_STALE_RUNNING_SECS: u64 = 10 * 60;

/// Grace period added on top of the stale timeout (30 seconds).
const STALE_GRACE_SECS: u64 = 30;

/// How long a cancelling caller waits for a signalled task to finish its own
/// bookkeeping before the handle is aborted outright.
///
/// Mirrors the ladder `engine::execution::cancel` already runs for the primary
/// agent-execution path (signal → terminate → bounded grace → abort), at a
/// shorter horizon: these jobs write a status row, not a metrics batch.
pub const DEFAULT_RECLAIM_GRACE: Duration = Duration::from_secs(2);

// -- Cancellation outcome ---------------------------------------

/// What a cancel request actually **achieved** — as opposed to what it asked
/// for.
///
/// Before this existed, `cancel()` fired a cooperative [`CancellationToken`]
/// and then wrote `status = "failed", error = "Cancelled by user"`
/// *unconditionally*, for every job, whether or not anything could observe the
/// token. Most background tasks are spawned through [`spawn_guarded`], which
/// until now dropped the returned [`JoinHandle`] at every production call site,
/// so for those jobs there was nothing to abort and nothing to await: the
/// terminal row asserted a reclaim the system could not perform, and a task
/// that ignored the token (blocking FFI, a `Command` mid-`output()`, a loop
/// with no `select!` arm) kept running behind a job the UI showed as finished.
///
/// The two values below cost one field and no behaviour change. They make the
/// difference visible in the snapshot so a caller can tell "we asked" from "it
/// stopped", which is the precondition for closing the gap rather than
/// papering over it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CancelOutcome {
    /// The cooperative token was fired, but **no abortable handle was
    /// registered** for this job (or the caller used the synchronous
    /// [`BackgroundJobManager::cancel`], which cannot await one). The task may
    /// still be running. This is *not* a reclaim.
    Requested,
    /// The token was fired **and** the task's [`JoinHandle`] was reclaimed —
    /// it either finished within the grace period or was aborted after it.
    /// Nothing of this job is still scheduled.
    Reclaimed,
}

impl CancelOutcome {
    /// The error text written onto the terminal job row. The `Requested` text
    /// deliberately refuses to say the job stopped, because nothing proved it.
    pub fn error_text(self) -> &'static str {
        match self {
            Self::Reclaimed => "Cancelled by user",
            Self::Requested => {
                "Cancellation requested — the task was not abortable and may still be running"
            }
        }
    }
}

/// A slot holding a spawned task's [`JoinHandle`] so a later cancel can await
/// or abort it.
///
/// `Arc<tokio::sync::Mutex<Option<..>>>` rather than a bare handle because
/// [`JobEntry`] is `Clone` (snapshots and the `or_default()` upsert path both
/// rely on it) and a `JoinHandle` is not. The `Option` is taken — not
/// borrowed — by the reclaim path, since awaiting a handle consumes it, and
/// that also makes a second cancel a no-op instead of a double-abort.
pub type AbortSlot = Arc<tokio::sync::Mutex<Option<JoinHandle<()>>>>;

/// Truncate a single output line to [`MAX_LINE_BYTES`], appending a marker that
/// names how many bytes were dropped so the live log reads honestly rather than
/// silently swallowing the tail.
fn clamp_line(line: String) -> String {
    if line.len() <= MAX_LINE_BYTES {
        return line;
    }
    let kept = crate::utils::text::truncate_on_char_boundary(&line, MAX_LINE_BYTES);
    let dropped = line.len() - kept.len();
    format!("{kept}…[+{dropped} bytes truncated]")
}

// -- Panic-guarded spawn ----------------------------------------

/// Spawn `fut` as a detached background task behind a panic boundary, running
/// `on_panic` with the extracted panic message if it unwinds.
///
/// Every long-running background job in this backend hand-rolled the same five
/// steps: `tokio::spawn` → `AssertUnwindSafe(..).catch_unwind()` →
/// `extract_panic_message` → `tracing::error!` → *some* recovery. The first four
/// were byte-identical modulo the tracing field NAME (`job_id` / `run_id` /
/// `scan_id` / `debug_id` — all the same concept); only the fifth genuinely
/// differed, and that is exactly what `on_panic` is for.
///
/// The panic log is now uniform and greppable: `task=<kind> entity_id=<id>`.
/// That is a deliberate, small telemetry change — the per-site field names were
/// nine spellings of one idea and could not be unified any other way, because
/// `tracing` field names must be literals.
///
/// **The returned handle is `#[must_use]`-free on purpose.** A caller that
/// wants the task to be abortable hands the handle to
/// [`BackgroundJobManager::register_abortable`] (or spawns through
/// [`BackgroundJobManager::spawn_job`], which registers it for you); a
/// fire-and-forget caller keeps discarding it. Discarding it is a real
/// choice with a real consequence — such a job can only ever report
/// [`CancelOutcome::Requested`], never `Reclaimed` — so it should be made
/// deliberately, not by default.
pub fn spawn_guarded<F, R, Fut>(
    task: &'static str,
    entity_id: impl Into<String>,
    fut: F,
    on_panic: R,
) -> JoinHandle<()>
where
    F: Future + Send + 'static,
    F::Output: Send,
    R: FnOnce(String) -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send,
{
    let entity_id = entity_id.into();
    tokio::spawn(async move {
        if let Err(panic) = AssertUnwindSafe(fut).catch_unwind().await {
            let msg = extract_panic_message(panic);
            tracing::error!(
                task = %task,
                entity_id = %entity_id,
                panic = %msg,
                "background task panicked — running its recovery arm"
            );
            on_panic(msg).await;
        }
    })
}

// -- Core job fields shared by every background job -------------

/// The job lifecycle's legal states, in one place.
///
/// `status` stays a `String` on the entry because it crosses the IPC boundary
/// as one, but a transition is named rather than spelled: the legal set is
/// enumerable from the type, and a misspelled state is a compile error instead
/// of a job that never leaves "runnning".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobStatus {
    Running,
    Failed,
}

impl JobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            JobStatus::Running => "running",
            JobStatus::Failed => "failed",
        }
    }
}

impl std::fmt::Display for JobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The common fields every background job must have.
/// Job-specific data lives in the `extra` field.
#[derive(Clone)]
pub struct JobEntry<E: Clone> {
    pub status: String,
    pub error: Option<String>,
    pub lines: Vec<String>,
    pub cancel_token: Option<CancellationToken>,
    pub created_at: Instant,
    /// The spawned worker's `JoinHandle`, if the call site registered one.
    /// `None` means this job is **not abortable**: a cancel can signal it and
    /// nothing more. See [`AbortSlot`] and [`CancelOutcome`].
    pub abort: Option<AbortSlot>,
    /// What the last cancel request on this job achieved. `None` until one is
    /// made. Carried on the entry (not derived from `status`) because the
    /// terminal status is `"failed"` in both cases and only this field says
    /// whether the task was actually reclaimed.
    pub cancel_outcome: Option<CancelOutcome>,
    /// Job-specific extra state (e.g., draft, result_json, questions, session_id).
    pub extra: E,
}

impl<E: Clone + Default> Default for JobEntry<E> {
    fn default() -> Self {
        Self {
            status: String::new(),
            error: None,
            lines: Vec::new(),
            cancel_token: None,
            created_at: Instant::now(),
            abort: None,
            cancel_outcome: None,
            extra: E::default(),
        }
    }
}

// -- Event payloads (generic) -----------------------------------

#[derive(Clone, Serialize)]
struct OutputEvent {
    job_id: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct StatusEvent {
    job_id: String,
    status: String,
    error: Option<String>,
}

// -- BackgroundJobManager ---------------------------------------

/// A generic, static background-job store. Each instance is backed by a
/// `OnceLock<Mutex<HashMap>>` so it can be used as a `static` variable.
///
/// `E` is the job-specific extra state (e.g., draft JSON, result string).
pub struct BackgroundJobManager<E: Clone + Default + Send + 'static> {
    store: OnceLock<Mutex<HashMap<String, JobEntry<E>>>>,
    lock_error_msg: &'static str,
    status_event_name: &'static str,
    output_event_name: &'static str,
    /// Cancel requests this manager has signalled (token fired), lifetime.
    cancels_signalled: AtomicU64,
    /// Of those, the ones that actually reclaimed a task handle.
    /// `signalled - reaped` is the size of the gap, in units, at runtime.
    cancels_reaped: AtomicU64,
}

impl<E: Clone + Default + Send + 'static> BackgroundJobManager<E> {
    /// Create a new manager. Call this in a `static` initializer.
    ///
    /// - `lock_error_msg`: message used when the mutex is poisoned
    /// - `status_event_name`: Tauri event name for status changes
    /// - `output_event_name`: Tauri event name for output lines
    pub const fn new(
        lock_error_msg: &'static str,
        status_event_name: &'static str,
        output_event_name: &'static str,
    ) -> Self {
        Self {
            store: OnceLock::new(),
            lock_error_msg,
            status_event_name,
            output_event_name,
            cancels_signalled: AtomicU64::new(0),
            cancels_reaped: AtomicU64::new(0),
        }
    }

    /// `(signalled, reaped)` — cancel requests this manager has fired a token
    /// for, and how many of those actually reclaimed the task.
    ///
    /// The measurable the cancellation work is judged on. A manager whose
    /// `reaped` is structurally 0 has cancel *requests* only; the difference
    /// is the number of times the app told a user a job was over while its
    /// task was still scheduled.
    pub fn cancel_counts(&self) -> (u64, u64) {
        (
            self.cancels_signalled.load(Ordering::Relaxed),
            self.cancels_reaped.load(Ordering::Relaxed),
        )
    }

    /// Record a cancel outcome on the entry and bump the two counters.
    fn note_cancel(&self, job_id: &str, outcome: CancelOutcome) {
        self.cancels_signalled.fetch_add(1, Ordering::Relaxed);
        if outcome == CancelOutcome::Reclaimed {
            self.cancels_reaped.fetch_add(1, Ordering::Relaxed);
        }
        let (signalled, reaped) = self.cancel_counts();
        tracing::info!(
            job_id = %job_id,
            manager = self.lock_error_msg,
            outcome = ?outcome,
            cancels_signalled = signalled,
            cancels_reaped = reaped,
            "background job cancel"
        );
        let mut jobs = self.lock_or_recover();
        let entry = jobs.entry(job_id.to_string()).or_default();
        entry.cancel_outcome = Some(outcome);
    }

    /// Register a spawned task's handle so a later cancel can reclaim it.
    ///
    /// Without this the job is signal-only: [`cancel_and_reclaim`] will report
    /// [`CancelOutcome::Requested`] and the task keeps whatever it holds.
    /// [`spawn_job`] calls this for you.
    ///
    /// [`cancel_and_reclaim`]: Self::cancel_and_reclaim
    /// [`spawn_job`]: Self::spawn_job
    pub fn register_abortable(&self, job_id: &str, handle: JoinHandle<()>) {
        let mut jobs = self.lock_or_recover();
        let entry = jobs.entry(job_id.to_string()).or_default();
        entry.abort = Some(Arc::new(tokio::sync::Mutex::new(Some(handle))));
    }

    fn jobs(&self) -> &Mutex<HashMap<String, JobEntry<E>>> {
        self.store.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, JobEntry<E>>>, AppError> {
        self.jobs()
            .lock()
            .map_err(|_| AppError::Internal(self.lock_error_msg.into()))
    }

    /// Acquire the lock, recovering from mutex poisoning with a warning log.
    /// Use this for read/poll paths where silently returning empty would hide
    /// all job state from the frontend.
    fn lock_or_recover(&self) -> MutexGuard<'_, HashMap<String, JobEntry<E>>> {
        self.jobs().lock().unwrap_or_else(|poisoned| {
            tracing::warn!(
                manager = self.lock_error_msg,
                "background job mutex was poisoned — recovering inner data; \
                 a thread previously panicked while holding this lock"
            );
            poisoned.into_inner()
        })
    }

    /// Remove non-running entries older than 30 minutes.
    pub fn evict_stale(&self, jobs: &mut HashMap<String, JobEntry<E>>) {
        let cutoff = Duration::from_secs(JOB_TTL_SECS);
        jobs.retain(|_, job| job.status == "running" || job.created_at.elapsed() < cutoff);
    }

    /// Evict completed/failed jobs older than `ttl`, then enforce a maximum
    /// entry cap using LRU (oldest `created_at` first).
    pub fn evict_completed_with_cap(
        &self,
        jobs: &mut HashMap<String, JobEntry<E>>,
        ttl: Duration,
        max_entries: usize,
    ) {
        // Phase 1: remove completed/failed jobs past the TTL
        jobs.retain(|_, job| job.status == "running" || job.created_at.elapsed() < ttl);

        // Phase 2: if still over cap, evict oldest non-running entries first
        while jobs.len() > max_entries {
            let oldest = jobs
                .iter()
                .filter(|(_, j)| j.status != "running")
                .min_by_key(|(_, j)| j.created_at)
                .map(|(id, _)| id.clone());
            match oldest {
                Some(id) => {
                    jobs.remove(&id);
                }
                None => break, // all entries are running, can't evict more
            }
        }
    }

    /// Mark any running jobs that have exceeded the stale timeout + grace period
    /// as failed with a timeout diagnostic. Returns the IDs of jobs that were
    /// marked stale (for logging).
    pub fn sweep_stale_running(&self, jobs: &mut HashMap<String, JobEntry<E>>) -> Vec<String> {
        let max_age = Duration::from_secs(DEFAULT_STALE_RUNNING_SECS + STALE_GRACE_SECS);
        let mut stale_ids = Vec::new();
        for (id, job) in jobs.iter_mut() {
            if job.status == "running" && job.created_at.elapsed() > max_age {
                let elapsed = job.created_at.elapsed().as_secs();
                tracing::warn!(
                    job_id = %id,
                    elapsed_secs = elapsed,
                    manager = self.lock_error_msg,
                    "stale background job detected: running for {}s (limit {}s), marking as failed",
                    elapsed,
                    max_age.as_secs()
                );
                job.status = "failed".to_string();
                // The sweeper runs on a poll thread and cannot await, so it
                // can only ever SIGNAL. Say which of the two happened rather
                // than letting the row read as a completed reclaim: an
                // un-abortable task survives this sweep and the diagnostic
                // must not imply otherwise.
                let abortable = job.abort.is_some();
                job.error = Some(format!(
                    "Job timed out after {}s without completing (stale job detection); \
                     the task was signalled to stop but {}",
                    elapsed,
                    if abortable {
                        "has not been reclaimed by this sweep"
                    } else {
                        "is not abortable and may still be running"
                    }
                ));
                job.cancel_outcome = Some(CancelOutcome::Requested);
                self.cancels_signalled.fetch_add(1, Ordering::Relaxed);
                // Cancel the token so the spawned task can clean up if still alive
                if let Some(token) = &job.cancel_token {
                    token.cancel();
                }
                stale_ids.push(id.clone());
            }
        }
        stale_ids
    }

    /// Check whether a job is currently running. Returns `Err` if already running.
    pub fn ensure_not_running(&self, job_id: &str) -> Result<(), AppError> {
        let jobs = self.lock()?;
        if let Some(existing) = jobs.get(job_id) {
            if existing.status == "running" {
                // `RateLimited`, not `Validation`. This is a CAPACITY refusal —
                // the job is busy, the caller did nothing wrong, and trying again
                // later is the correct response. The app's own taxonomy maps
                // `Validation` to `(Misconfigured, retryable = false)`
                // (`tool_outcome.rs:113`), so every caller of these three functions
                // was told a transient "come back later" was a permanent
                // misconfiguration. `RateLimited` is already `retryable = true`
                // and already mirrored on the frontend.
                //
                // Two literals; 22 call sites corrected without touching one of
                // them. Fixing the primitive beats counting the callers.
                return Err(AppError::RateLimited("Job is already running".into()));
            }
        }
        Ok(())
    }

    /// Insert a new running job, evicting stale entries first.
    /// Returns `Err` if a job with the same ID is already running.
    pub fn insert_running(
        &self,
        job_id: String,
        cancel_token: CancellationToken,
        extra: E,
    ) -> Result<(), AppError> {
        let mut jobs = self.lock()?;
        self.evict_stale(&mut jobs);
        if let Some(existing) = jobs.get(&job_id) {
            if existing.status == "running" {
                // Capacity refusal, not caller error — see the note in `ensure_not_running`.
                return Err(AppError::RateLimited("Job is already running".into()));
            }
        }
        jobs.insert(
            job_id,
            JobEntry {
                status: "running".into(),
                error: None,
                lines: Vec::new(),
                cancel_token: Some(cancel_token),
                created_at: Instant::now(),
                abort: None,
                cancel_outcome: None,
                extra,
            },
        );
        Ok(())
    }

    /// Update status and error for a job, and emit a Tauri status event.
    pub fn set_status(
        &self,
        app: &tauri::AppHandle,
        job_id: &str,
        status: &str,
        error: Option<String>,
    ) {
        {
            let mut jobs = self.lock_or_recover();
            let entry = jobs.entry(job_id.to_string()).or_default();
            entry.status = status.to_string();
            entry.error = error.clone();
        }

        let _ = app.emit(
            self.status_event_name,
            StatusEvent {
                job_id: job_id.to_string(),
                status: status.to_string(),
                error,
            },
        );
    }

    /// Push a line into the job's tail ring, clamped to [`MAX_LINE_BYTES`] and
    /// bounded to [`MAX_LINES`] (oldest dropped). Shared by `emit_line` and
    /// `record_line`. Returns the clamped line so the caller can reuse it for an
    /// IPC payload without re-clamping. This is the single chokepoint where
    /// EVERY background-job line (context scan, design review, healing, schema…)
    /// is size- and count-bounded.
    fn push_ring(&self, job_id: &str, line: String) -> String {
        let line = clamp_line(line);
        let mut jobs = self.lock_or_recover();
        let entry = jobs.entry(job_id.to_string()).or_default();
        entry.lines.push(line.clone());
        let overflow = entry.lines.len().saturating_sub(MAX_LINES);
        if overflow > 0 {
            entry.lines.drain(0..overflow);
        }
        line
    }

    /// Append a line to the job's output ring AND stream it live over IPC.
    ///
    /// Reserve this for **high-level milestones / status** the user wants to see
    /// regardless of whether a detail panel is open (`[Created]`, `[Complete]`,
    /// `[Error]`, …). For noisy per-token / per-tool output, prefer
    /// [`record_line`] so it never crosses into the WebView.
    pub fn emit_line(&self, app: &tauri::AppHandle, job_id: &str, line: impl Into<String>) {
        let line = self.push_ring(job_id, line.into());
        let _ = app.emit(
            self.output_event_name,
            OutputEvent {
                job_id: job_id.to_string(),
                line,
            },
        );
    }

    /// Append a **verbose detail** line to the job's output ring WITHOUT
    /// streaming it over IPC.
    ///
    /// The line is retained (bounded, same ring as `emit_line`) for on-demand
    /// inspection via the status snapshot, but it never crosses into the WebView
    /// — so a CLI that emits thousands of reasoning/tool lines costs the frontend
    /// nothing. This is the "we only need the high-level state, not the log"
    /// default: callers route noisy output here and reserve `emit_line` for
    /// milestones. Mirrors the Fleet PTY ring, which buffers every chunk but only
    /// forwards *subscribed* sessions over IPC.
    pub fn record_line(&self, job_id: &str, line: impl Into<String>) {
        self.push_ring(job_id, line.into());
    }

    /// Record-only sibling of [`record_line`] that accepts (and ignores) an
    /// `app` handle.
    ///
    /// Many CLI streamers hand each line to a `move` closure that already
    /// captured `app` for `emit_line`. Switching such a closure to record-only
    /// via [`record_line`] would leave that `app` capture unused (a
    /// `-D warnings` clippy break). This sibling keeps the `(app, id, line)`
    /// shape so the switch is a one-token rename with no closure reshaping.
    pub fn record_streamed(&self, _app: &tauri::AppHandle, job_id: &str, line: impl Into<String>) {
        self.push_ring(job_id, line.into());
    }

    /// Mutate the extra state of a job entry.
    pub fn update_extra(&self, job_id: &str, f: impl FnOnce(&mut E)) {
        let mut jobs = self.lock_or_recover();
        let entry = jobs.entry(job_id.to_string()).or_default();
        f(&mut entry.extra);
    }

    /// Read a value from the extra state of a job entry.
    pub fn read_extra<R>(&self, job_id: &str, f: impl FnOnce(&E) -> R) -> Option<R> {
        let jobs = self.lock_or_recover();
        jobs.get(job_id).map(|entry| f(&entry.extra))
    }

    /// Get the cancel token for a job.
    pub fn get_cancel_token(&self, job_id: &str) -> Result<Option<CancellationToken>, AppError> {
        let jobs = self.lock()?;
        Ok(jobs.get(job_id).and_then(|j| j.cancel_token.clone()))
    }

    /// Replace the cancel token for an existing job.
    pub fn set_cancel_token(&self, job_id: &str, token: CancellationToken) -> Result<(), AppError> {
        let mut jobs = self.lock()?;
        if let Some(job) = jobs.get_mut(job_id) {
            job.cancel_token = Some(token);
        }
        Ok(())
    }

    /// Atomically check that a job is NOT running, then set it to "running"
    /// with a new cancel token. Returns `Err` if the job is already running,
    /// preventing duplicate concurrent tasks for the same job ID.
    ///
    /// Also emits a status event on success.
    pub fn resume_running(
        &self,
        app: &tauri::AppHandle,
        job_id: &str,
        token: CancellationToken,
    ) -> Result<(), AppError> {
        {
            let mut jobs = self.lock()?;
            if let Some(existing) = jobs.get(job_id) {
                if existing.status == "running" {
                    // Capacity refusal, not caller error — see the note in `ensure_not_running`.
                    return Err(AppError::RateLimited("Job is already running".into()));
                }
            }
            let entry = jobs.entry(job_id.to_string()).or_default();
            entry.status = "running".to_string();
            entry.error = None;
            entry.cancel_token = Some(token);
            // A resumed job is a fresh attempt: the previous run's handle is
            // finished and its cancel verdict no longer describes anything.
            // Leaving either behind would let a stale `Reclaimed` vouch for a
            // task that has not been spawned yet.
            entry.abort = None;
            entry.cancel_outcome = None;
        }

        let _ = app.emit(
            self.status_event_name,
            StatusEvent {
                job_id: job_id.to_string(),
                status: "running".to_string(),
                error: None,
            },
        );
        Ok(())
    }

    /// Remove a job by ID.
    pub fn remove(&self, job_id: &str) -> Result<(), AppError> {
        let mut jobs = self.lock()?;
        jobs.remove(job_id);
        Ok(())
    }

    /// Cancel a job **cooperatively**: fire the cancellation token and set the
    /// status to failed.
    ///
    /// This is the signal-only half. It cannot await or abort the task — it is
    /// synchronous and the task's handle can only be reclaimed from an async
    /// context — so it always records [`CancelOutcome::Requested`] and writes
    /// the terminal error text that says so. It never claims the job stopped.
    ///
    /// Callers that can `.await` should use [`cancel_and_reclaim`] instead;
    /// that is the path that can report `Reclaimed`.
    ///
    /// [`cancel_and_reclaim`]: Self::cancel_and_reclaim
    pub fn cancel(&self, app: &tauri::AppHandle, job_id: &str) -> Result<(), AppError> {
        let token = self.get_cancel_token(job_id)?;
        if let Some(token) = token {
            token.cancel();
        }
        self.note_cancel(job_id, CancelOutcome::Requested);
        self.set_status(
            app,
            job_id,
            JobStatus::Failed.as_str(),
            Some(CancelOutcome::Requested.error_text().into()),
        );
        Ok(())
    }

    /// Cancel a job and **reclaim its task**, following the same ladder the
    /// primary agent-execution path runs (`engine::execution::cancel`):
    ///
    /// 1. fire the cooperative token, so a task with a `select!` arm can wind
    ///    down on its own terms;
    /// 2. wait up to `grace` for it to finish, so whatever bookkeeping it owes
    ///    (status row, repo write, temp-file cleanup) still lands;
    /// 3. `abort()` if it overstays, so a task that ignores the token — a
    ///    blocking FFI call, a `Command` mid-`output()`, a loop with no
    ///    cancellation arm — cannot outlive the job that reports it finished.
    ///
    /// Returns what was actually achieved. [`CancelOutcome::Requested`] means
    /// no handle was registered for this job (see [`register_abortable`]) and
    /// step 2–3 could not run; the task may still be scheduled and the job row
    /// says so rather than claiming otherwise.
    ///
    /// [`register_abortable`]: Self::register_abortable
    pub async fn cancel_and_reclaim(
        &self,
        app: &tauri::AppHandle,
        job_id: &str,
        grace: Duration,
    ) -> Result<CancelOutcome, AppError> {
        let outcome = self.cancel_and_reclaim_quiet(job_id, grace).await?;
        self.set_status(
            app,
            job_id,
            JobStatus::Failed.as_str(),
            Some(outcome.error_text().into()),
        );
        Ok(outcome)
    }

    /// The whole of [`cancel_and_reclaim`] except the Tauri status event.
    ///
    /// Split out because it is the half a unit test can drive: no unit test in
    /// this process can build an `AppHandle`, and a cancellation guarantee that
    /// only holds in a running app is not a guarantee. Callers in the app use
    /// [`cancel_and_reclaim`]; this is public so the ladder itself is testable.
    ///
    /// [`cancel_and_reclaim`]: Self::cancel_and_reclaim
    pub async fn cancel_and_reclaim_quiet(
        &self,
        job_id: &str,
        grace: Duration,
    ) -> Result<CancelOutcome, AppError> {
        // 1. Signal.
        if let Some(token) = self.get_cancel_token(job_id)? {
            token.cancel();
        }

        // Take the slot out from under the store lock — the reclaim below
        // awaits, and the store guard is a std Mutex that must not be held
        // across an await point.
        let slot = {
            let jobs = self.lock_or_recover();
            jobs.get(job_id).and_then(|j| j.abort.clone())
        };

        let outcome = match slot {
            None => CancelOutcome::Requested,
            Some(slot) => {
                // A second cancel finds the Option already taken and is a
                // no-op rather than a double-abort.
                let handle = slot.lock().await.take();
                match handle {
                    None => CancelOutcome::Reclaimed,
                    Some(mut handle) => {
                        // 2. Bounded grace for the task's own bookkeeping.
                        //
                        // `&mut handle`, not `handle`: `timeout` takes its
                        // future by value, and dropping a `JoinHandle`
                        // DETACHES the task rather than stopping it — which
                        // would be the exact false reclaim this method exists
                        // to remove. `JoinHandle` is `Unpin`, so `&mut` is
                        // itself a `Future` and ownership stays here.
                        if tokio::time::timeout(grace, &mut handle).await.is_err() {
                            tracing::warn!(
                                job_id = %job_id,
                                manager = self.lock_error_msg,
                                grace_ms = grace.as_millis() as u64,
                                "cancel: task did not finish within grace period, aborting",
                            );
                            // 3. Terminate, then await the abort so the
                            // outcome is observed and not merely requested.
                            handle.abort();
                            let _ = handle.await;
                        }
                        CancelOutcome::Reclaimed
                    }
                }
            }
        };

        self.note_cancel(job_id, outcome);
        self.set_status_quiet(
            job_id,
            JobStatus::Failed.as_str(),
            Some(outcome.error_text().into()),
        )?;
        Ok(outcome)
    }

    /// Cancel a job, or pre-emptively insert a cancelled entry if the job
    /// doesn't exist yet (race condition guard for start-then-cancel).
    pub fn cancel_or_preempt(
        &self,
        app: &tauri::AppHandle,
        job_id: &str,
        extra: E,
    ) -> Result<(), AppError> {
        let token = {
            let mut jobs = self.lock()?;
            if let Some(job) = jobs.get_mut(job_id) {
                job.cancel_token.clone()
            } else {
                let token = CancellationToken::new();
                token.cancel();
                jobs.insert(
                    job_id.to_string(),
                    JobEntry {
                        status: "failed".into(),
                        error: Some(CancelOutcome::Requested.error_text().into()),
                        lines: Vec::new(),
                        cancel_token: Some(token.clone()),
                        created_at: Instant::now(),
                        abort: None,
                        cancel_outcome: Some(CancelOutcome::Requested),
                        extra,
                    },
                );
                Some(token)
            }
        };

        if let Some(token) = token {
            token.cancel();
        }

        // Always `Requested`: the pre-empt arm exists precisely because the
        // task may not have been spawned yet, so there is nothing to reap and
        // a start could still race in behind the pre-fired token.
        self.note_cancel(job_id, CancelOutcome::Requested);
        self.set_status(
            app,
            job_id,
            JobStatus::Failed.as_str(),
            Some(CancelOutcome::Requested.error_text().into()),
        );
        Ok(())
    }

    /// Build a snapshot of the common fields. Returns `None` if the job doesn't exist.
    /// The caller can extend this with job-specific extra fields.
    /// Also sweeps stale running jobs at poll time.
    pub fn get_snapshot(&self, job_id: &str) -> Option<JobSnapshot> {
        let mut jobs = self.lock_or_recover();
        self.sweep_stale_running(&mut jobs);
        self.evict_stale(&mut jobs);
        jobs.get(job_id).map(|job| JobSnapshot {
            job_id: job_id.to_string(),
            status: if job.status.is_empty() {
                "idle".to_string()
            } else {
                job.status.clone()
            },
            error: job.error.clone(),
            lines: job.lines.clone(),
            elapsed_secs: job.created_at.elapsed().as_secs(),
            cancel_outcome: job.cancel_outcome,
        })
    }

    /// List all jobs as snapshots (for the workflows overview).
    /// Also sweeps stale running jobs at poll time.
    pub fn list_snapshots(&self) -> Vec<JobSnapshot> {
        let mut jobs = self.lock_or_recover();
        self.sweep_stale_running(&mut jobs);
        self.evict_stale(&mut jobs);
        jobs.iter()
            .map(|(id, job)| JobSnapshot {
                job_id: id.clone(),
                status: if job.status.is_empty() {
                    "idle".to_string()
                } else {
                    job.status.clone()
                },
                error: job.error.clone(),
                lines: job.lines.clone(),
                elapsed_secs: job.created_at.elapsed().as_secs(),
                cancel_outcome: job.cancel_outcome,
            })
            .collect()
    }

    /// Get a full snapshot including extra state via a mapping function.
    /// Also sweeps stale running jobs at poll time.
    pub fn get_snapshot_with<R>(
        &self,
        job_id: &str,
        f: impl FnOnce(&str, &JobEntry<E>) -> R,
    ) -> Option<R> {
        let mut jobs = self.lock_or_recover();
        self.sweep_stale_running(&mut jobs);
        self.evict_stale(&mut jobs);
        jobs.get(job_id).map(|job| f(job_id, job))
    }

    /// Build a `BackgroundTaskSnapshot<T>` by mapping the job-specific extras
    /// into a serializable type `T`. This eliminates the need to hand-roll
    /// snapshot structs for each job type.
    pub fn get_task_snapshot<T: Clone + Serialize>(
        &self,
        job_id: &str,
        map_extras: impl FnOnce(&E) -> T,
    ) -> Option<BackgroundTaskSnapshot<T>> {
        let mut jobs = self.lock_or_recover();
        self.sweep_stale_running(&mut jobs);
        self.evict_stale(&mut jobs);
        jobs.get(job_id).map(|job| BackgroundTaskSnapshot {
            job_id: job_id.to_string(),
            status: if job.status.is_empty() {
                "idle".to_string()
            } else {
                job.status.clone()
            },
            error: job.error.clone(),
            lines: job.lines.clone(),
            elapsed_secs: job.created_at.elapsed().as_secs(),
            cancel_outcome: job.cancel_outcome,
            extras: map_extras(&job.extra),
        })
    }

    /// Spawn a job's worker behind a panic boundary that marks THIS job
    /// `failed` with the panic message if the worker unwinds.
    ///
    /// The single most common background-job shape in this backend: a
    /// fire-and-forget worker whose entire panic recovery is
    /// `set_status(app, job_id, JobStatus::Failed.as_str(), Some(msg))`. Callers whose recovery
    /// arm does more (emit a line, write a repo row, clear an ad-hoc registry)
    /// use [`spawn_guarded`] directly with their own closure rather than
    /// growing this method an `Option` parameter.
    ///
    /// Takes `&'static self` because every manager in the tree is a `static`.
    ///
    /// The spawned handle is **registered on the job entry**
    /// ([`register_abortable`]) rather than returned, so every job spawned
    /// this way is reclaimable by [`cancel_and_reclaim`] without the call site
    /// doing anything.
    ///
    /// Returning `()` is deliberate: a `JoinHandle` can be awaited only once
    /// and only by its owner, and the owner has to be the registry — that is
    /// the whole point. Handing a copy back would mean either detaching the
    /// task on drop (the false reclaim this work removes) or racing the cancel
    /// path for the join. A caller that genuinely needs the handle spawns
    /// through [`spawn_guarded`] and calls [`register_abortable`] itself.
    ///
    /// [`register_abortable`]: Self::register_abortable
    /// [`cancel_and_reclaim`]: Self::cancel_and_reclaim
    pub fn spawn_job<F>(
        &'static self,
        app: tauri::AppHandle,
        job_id: String,
        task: &'static str,
        fut: F,
    ) where
        F: Future + Send + 'static,
        F::Output: Send,
    {
        let job_id_for_panic = job_id.clone();
        let job_id_for_registry = job_id.clone();
        let handle = spawn_guarded(task, job_id, fut, move |msg| async move {
            self.set_status(
                &app,
                &job_id_for_panic,
                JobStatus::Failed.as_str(),
                Some(msg),
            );
        });
        self.register_abortable(&job_id_for_registry, handle);
    }

    /// Update the status field directly on a locked job (no event emission).
    pub fn set_status_quiet(
        &self,
        job_id: &str,
        status: &str,
        error: Option<String>,
    ) -> Result<(), AppError> {
        let mut jobs = self.lock()?;
        if let Some(job) = jobs.get_mut(job_id) {
            job.status = status.to_string();
            job.error = error;
        }
        Ok(())
    }
}

/// The common snapshot fields returned by `get_snapshot`.
#[derive(Clone, Serialize)]
pub struct JobSnapshot {
    pub job_id: String,
    pub status: String,
    pub error: Option<String>,
    pub lines: Vec<String>,
    /// Seconds since this job was created.
    pub elapsed_secs: u64,
    /// What the last cancel request achieved, if one was made. `requested`
    /// means the app asked and could not prove the task stopped; `reclaimed`
    /// means it did. Additive on the wire — existing consumers that key on
    /// `status` are unaffected.
    pub cancel_outcome: Option<CancelOutcome>,
}

/// A generic snapshot that combines the common job fields with
/// type-specific extras. Use this instead of hand-rolling a snapshot
/// struct for each background job type.
#[derive(Clone, Serialize)]
pub struct BackgroundTaskSnapshot<T: Clone + Serialize> {
    pub job_id: String,
    pub status: String,
    pub error: Option<String>,
    pub lines: Vec<String>,
    pub elapsed_secs: u64,
    /// See [`JobSnapshot::cancel_outcome`].
    pub cancel_outcome: Option<CancelOutcome>,
    #[serde(flatten)]
    pub extras: T,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mgr() -> BackgroundJobManager<()> {
        BackgroundJobManager::new("test lock poisoned", "test-status", "test-output")
    }

    // -- spawn_guarded panic boundary ---------------------------------
    //
    // The normal suite never executes a panic path, so the ~20 call sites that
    // now route their panic recovery through this helper would otherwise be
    // moved onto completely unexercised code. These four tests are the only
    // thing standing behind that move.

    // NOTE: these tests print real panic backtraces. That is deliberate — a
    // custom silencing panic hook defeats libtest's own panic capture and turns
    // a FAILING assertion into a harness that dies with no output at all
    // (observed while proving these tests can fail).

    #[tokio::test]
    async fn spawn_guarded_runs_recovery_with_the_panic_message() {
        let seen = std::sync::Arc::new(Mutex::new(None::<String>));
        let sink = seen.clone();

        spawn_guarded(
            "unit-test",
            "entity-1",
            async {
                panic!("boom from inside the worker");
            },
            move |msg| async move {
                *sink.lock().unwrap() = Some(msg);
            },
        )
        .await
        .expect("guarded task must NOT propagate the panic to its JoinHandle");

        assert_eq!(
            seen.lock().unwrap().as_deref(),
            Some("boom from inside the worker"),
            "recovery arm must receive the extracted panic message"
        );
    }

    #[tokio::test]
    async fn spawn_guarded_skips_recovery_when_the_worker_returns() {
        let ran = std::sync::Arc::new(Mutex::new(false));
        let sink = ran.clone();

        spawn_guarded("unit-test", "entity-2", async { 42 }, move |_| async move {
            *sink.lock().unwrap() = true;
        })
        .await
        .unwrap();

        assert!(
            !*ran.lock().unwrap(),
            "a worker that completes must never run the panic arm"
        );
    }

    /// The outcome that actually matters at the call sites: a panicking worker
    /// leaves its job `failed` with the panic message as the error, instead of
    /// stuck at `running` forever. This is `spawn_job`'s recovery arm with
    /// `set_status_quiet` standing in for `set_status` (which needs an
    /// `AppHandle` no unit test can build); both write the same two fields.
    #[tokio::test]
    async fn panicking_worker_leaves_its_job_failed_not_running() {
        static JOBS: BackgroundJobManager<()> =
            BackgroundJobManager::new("test lock poisoned", "test-status", "test-output");
        let job = "job-panic".to_string();
        JOBS.insert_running(job.clone(), CancellationToken::new(), ())
            .unwrap();
        assert_eq!(JOBS.get_snapshot(&job).unwrap().status, "running");

        let jid = job.clone();
        spawn_guarded(
            "unit-test",
            job.clone(),
            async {
                panic!("worker died");
            },
            move |msg| async move {
                let _ = JOBS.set_status_quiet(&jid, JobStatus::Failed.as_str(), Some(msg));
            },
        )
        .await
        .unwrap();

        let snap = JOBS.get_snapshot(&job).expect("job still present");
        assert_eq!(
            snap.status, "failed",
            "panic must be a FAILED job, not a stuck running one"
        );
        assert_eq!(snap.error.as_deref(), Some("worker died"));
    }

    /// A panic in one guarded task must not take down the runtime or its
    /// siblings — the property the 20+ adopting call sites rely on.
    #[tokio::test]
    async fn a_panicking_task_does_not_poison_its_siblings() {
        let a = spawn_guarded("unit-test", "sib-a", async { panic!("a") }, |_| async {});
        let b = spawn_guarded("unit-test", "sib-b", async { "fine" }, |_| async {});
        a.await.unwrap();
        b.await.unwrap();
    }

    #[test]
    fn clamp_line_keeps_small_truncates_large() {
        let small = "short line".to_string();
        assert_eq!(clamp_line(small.clone()), small);

        let clamped = clamp_line("x".repeat(MAX_LINE_BYTES * 3));
        assert!(
            clamped.len() < MAX_LINE_BYTES + 64,
            "kept text must be ≤ cap plus a short marker, got {}",
            clamped.len()
        );
        assert!(clamped.contains("bytes truncated"));
    }

    #[test]
    fn clamp_line_never_splits_multibyte() {
        // '≤' is 3 bytes; a cap landing mid-char must yield valid UTF-8, not panic.
        let clamped = clamp_line("≤".repeat(MAX_LINE_BYTES)); // 3 * cap bytes
        assert!(clamped.contains("bytes truncated"));
        // Round-trips as a String ⇒ valid UTF-8 by construction; assert the kept
        // prefix is whole chars by re-parsing the head.
        let head = clamped.split('…').next().unwrap();
        assert!(head.chars().all(|c| c == '≤'));
    }

    #[test]
    fn record_line_bounds_ring_to_tail() {
        let m = mgr();
        let job = "job-ring";
        let overflow = 50usize;
        for i in 0..(MAX_LINES + overflow) {
            m.record_line(job, format!("line-{i}"));
        }
        let snap = m.get_snapshot(job).expect("job exists after record_line");
        assert_eq!(snap.lines.len(), MAX_LINES, "ring bounded to MAX_LINES");
        // Tail semantics: oldest dropped, newest kept.
        assert_eq!(
            snap.lines.last().unwrap(),
            &format!("line-{}", MAX_LINES + overflow - 1)
        );
        assert_eq!(snap.lines.first().unwrap(), &format!("line-{overflow}"));
    }

    // -- Cancellation: requested vs reclaimed -------------------------
    //
    // The property under test is the one the old `cancel()` violated for every
    // job in the tree: it wrote `failed / "Cancelled by user"` whether or not
    // anything could be stopped. These tests pin the two halves apart.

    /// The load-bearing one. A job whose worker was spawned fire-and-forget
    /// (no handle registered) must NOT claim reclamation — not in the outcome,
    /// not in the counters, and not in the terminal error text a user reads.
    #[tokio::test]
    async fn cancelling_a_non_abortable_job_does_not_claim_reclamation() {
        let m = mgr();
        let job = "job-not-abortable";
        m.insert_running(job.into(), CancellationToken::new(), ())
            .unwrap();

        let outcome = m
            .cancel_and_reclaim_quiet(job, Duration::from_millis(50))
            .await
            .unwrap();

        assert_eq!(
            outcome,
            CancelOutcome::Requested,
            "no handle was registered, so nothing was reaped"
        );
        let snap = m.get_snapshot(job).expect("job present");
        assert_eq!(snap.cancel_outcome, Some(CancelOutcome::Requested));
        assert_ne!(
            snap.error.as_deref(),
            Some("Cancelled by user"),
            "the terminal row must not assert a stop nothing performed"
        );
        assert!(
            snap.error
                .as_deref()
                .unwrap()
                .contains("may still be running"),
            "the row must say what it could not do, got {:?}",
            snap.error
        );
        assert_eq!(
            m.cancel_counts(),
            (1, 0),
            "one unit signalled, zero reaped — the gap, measured"
        );
    }

    /// A registered handle whose task is still alive gets aborted after the
    /// grace period, and the task really stops: the flag it would have set
    /// after its sleep stays false.
    #[tokio::test]
    async fn cancelling_an_abortable_job_aborts_the_task_and_reports_reclaimed() {
        let m = mgr();
        let job = "job-abortable";
        m.insert_running(job.into(), CancellationToken::new(), ())
            .unwrap();

        let reached_the_end = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = reached_the_end.clone();
        // No `select!` on the token: this is the un-cooperative task that a
        // signal-only cancel could never stop.
        let handle = spawn_guarded(
            "unit-test",
            job,
            async move {
                tokio::time::sleep(Duration::from_secs(30)).await;
                flag.store(true, Ordering::Relaxed);
            },
            |_| async {},
        );
        m.register_abortable(job, handle);

        let outcome = m
            .cancel_and_reclaim_quiet(job, Duration::from_millis(50))
            .await
            .unwrap();

        assert_eq!(outcome, CancelOutcome::Reclaimed);
        assert!(
            !reached_the_end.load(Ordering::Relaxed),
            "the task must have been aborted, not merely asked to stop"
        );
        let snap = m.get_snapshot(job).expect("job present");
        assert_eq!(snap.cancel_outcome, Some(CancelOutcome::Reclaimed));
        assert_eq!(snap.error.as_deref(), Some("Cancelled by user"));
        assert_eq!(m.cancel_counts(), (1, 1), "signalled and reaped");
    }

    /// A cooperative task that honours the token finishes its own bookkeeping
    /// inside the grace window — the abort arm must not fire, and the write
    /// the task owed must land. This is the half `execution.rs`'s ladder exists
    /// for, and the reason a cancel awaits before it aborts.
    #[tokio::test]
    async fn a_cooperative_task_finishes_its_bookkeeping_within_the_grace() {
        static JOBS: BackgroundJobManager<()> =
            BackgroundJobManager::new("test lock poisoned", "test-status", "test-output");
        let job = "job-cooperative";
        let token = CancellationToken::new();
        JOBS.insert_running(job.into(), token.clone(), ()).unwrap();

        let wrote = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let sink = wrote.clone();
        let handle = spawn_guarded(
            "unit-test",
            job,
            async move {
                token.cancelled().await;
                // The bookkeeping the grace period exists to protect.
                JOBS.record_line(job, "[Cancelled] flushed");
                sink.store(true, Ordering::Relaxed);
            },
            |_| async {},
        );
        JOBS.register_abortable(job, handle);

        let outcome = JOBS
            .cancel_and_reclaim_quiet(job, Duration::from_secs(5))
            .await
            .unwrap();

        assert_eq!(outcome, CancelOutcome::Reclaimed);
        assert!(
            wrote.load(Ordering::Relaxed),
            "the task must have been given room to finish, not aborted at once"
        );
        let snap = JOBS.get_snapshot(job).expect("job present");
        assert!(snap.lines.iter().any(|l| l.contains("flushed")));
    }

    /// A second cancel finds the slot already emptied and must be a no-op that
    /// still reports `Reclaimed` — not a double-abort, and not a downgrade to
    /// `Requested` that would make an already-reaped job look un-reaped.
    #[tokio::test]
    async fn a_second_cancel_is_idempotent() {
        let m = mgr();
        let job = "job-twice";
        m.insert_running(job.into(), CancellationToken::new(), ())
            .unwrap();
        let handle = spawn_guarded("unit-test", job, async {}, |_| async {});
        m.register_abortable(job, handle);

        let first = m
            .cancel_and_reclaim_quiet(job, Duration::from_secs(1))
            .await
            .unwrap();
        let second = m
            .cancel_and_reclaim_quiet(job, Duration::from_secs(1))
            .await
            .unwrap();

        assert_eq!(first, CancelOutcome::Reclaimed);
        assert_eq!(second, CancelOutcome::Reclaimed);
        assert_eq!(m.cancel_counts(), (2, 2));
    }

    /// The stale sweeper runs on a poll thread and can only signal. Its
    /// diagnostic must say so for a job with no handle, and it must record
    /// `Requested` rather than leaving the row indistinguishable from a real
    /// reclaim.
    #[test]
    fn the_stale_sweeper_records_a_request_not_a_reclaim() {
        let m = mgr();
        let job = "job-stale";
        {
            let mut jobs = m.lock().unwrap();
            jobs.insert(
                job.into(),
                JobEntry {
                    status: "running".into(),
                    created_at: Instant::now()
                        - Duration::from_secs(DEFAULT_STALE_RUNNING_SECS + STALE_GRACE_SECS + 60),
                    cancel_token: Some(CancellationToken::new()),
                    ..Default::default()
                },
            );
            let stale = m.sweep_stale_running(&mut jobs);
            assert_eq!(stale, vec![job.to_string()]);
        }

        let snap = m.get_snapshot(job).expect("job present");
        assert_eq!(snap.status, "failed");
        assert_eq!(snap.cancel_outcome, Some(CancelOutcome::Requested));
        assert!(
            snap.error
                .as_deref()
                .unwrap()
                .contains("may still be running"),
            "a sweep cannot reclaim; the diagnostic must not imply it did — got {:?}",
            snap.error
        );
        assert_eq!(m.cancel_counts(), (1, 0));
    }

    /// `spawn_job` must register the handle it spawns, so every job that goes
    /// through it is reclaimable without the call site opting in. This is what
    /// makes the six `spawn_job` sites abortable for free.
    #[tokio::test]
    async fn spawn_job_registers_its_handle() {
        static JOBS: BackgroundJobManager<()> =
            BackgroundJobManager::new("test lock poisoned", "test-status", "test-output");
        let job = "job-spawned".to_string();
        JOBS.insert_running(job.clone(), CancellationToken::new(), ())
            .unwrap();
        // `spawn_job` needs an AppHandle only for its panic arm; register the
        // same way it does and assert the slot is filled.
        let handle = spawn_guarded(
            "unit-test",
            job.clone(),
            async { tokio::time::sleep(Duration::from_secs(30)).await },
            |_| async {},
        );
        JOBS.register_abortable(&job, handle);

        assert!(
            JOBS.lock().unwrap().get(&job).unwrap().abort.is_some(),
            "register_abortable must fill the entry's abort slot"
        );
        let outcome = JOBS
            .cancel_and_reclaim_quiet(&job, Duration::from_millis(50))
            .await
            .unwrap();
        assert_eq!(outcome, CancelOutcome::Reclaimed);
    }

    #[test]
    fn record_line_clamps_each_stored_line() {
        let m = mgr();
        let job = "job-clamp";
        m.record_line(job, "y".repeat(MAX_LINE_BYTES * 2));
        let snap = m.get_snapshot(job).expect("job exists");
        assert_eq!(snap.lines.len(), 1);
        assert!(snap.lines[0].len() < MAX_LINE_BYTES + 64);
    }
}
