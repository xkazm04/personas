//! Generic background job infrastructure.
//!
//! Provides `BackgroundJobManager<S>` -- a thread-safe, evicting job store
//! that manages lifecycle (insert, status update, line emission, snapshot,
//! cancel) for any job state type `S: BackgroundJobState`.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;

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

// -- Core job fields shared by every background job -------------

/// The common fields every background job must have.
/// Job-specific data lives in the `extra` field.
#[derive(Clone)]
pub struct JobEntry<E: Clone> {
    pub status: String,
    pub error: Option<String>,
    pub lines: Vec<String>,
    pub cancel_token: Option<CancellationToken>,
    pub created_at: Instant,
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
        }
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
                job.error = Some(format!(
                    "Job timed out after {}s without completing (stale job detection)",
                    elapsed
                ));
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
                return Err(AppError::Validation("Job is already running".into()));
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
                return Err(AppError::Validation("Job is already running".into()));
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
    pub fn record_streamed(
        &self,
        _app: &tauri::AppHandle,
        job_id: &str,
        line: impl Into<String>,
    ) {
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
                    return Err(AppError::Validation("Job is already running".into()));
                }
            }
            let entry = jobs.entry(job_id.to_string()).or_default();
            entry.status = "running".to_string();
            entry.error = None;
            entry.cancel_token = Some(token);
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

    /// Cancel a job: fire the cancellation token and set status to failed.
    pub fn cancel(&self, app: &tauri::AppHandle, job_id: &str) -> Result<(), AppError> {
        let token = self.get_cancel_token(job_id)?;
        if let Some(token) = token {
            token.cancel();
        }
        self.set_status(app, job_id, "failed", Some("Cancelled by user".into()));
        Ok(())
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
                        error: Some("Cancelled by user".into()),
                        lines: Vec::new(),
                        cancel_token: Some(token.clone()),
                        created_at: Instant::now(),
                        extra,
                    },
                );
                Some(token)
            }
        };

        if let Some(token) = token {
            token.cancel();
        }

        self.set_status(app, job_id, "failed", Some("Cancelled by user".into()));
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
            extras: map_extras(&job.extra),
        })
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
    #[serde(flatten)]
    pub extras: T,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mgr() -> BackgroundJobManager<()> {
        BackgroundJobManager::new("test lock poisoned", "test-status", "test-output")
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
