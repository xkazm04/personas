//! Generic background job infrastructure.
//!
//! Provides `BackgroundJobManager<S>` — a thread-safe, evicting job store
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

/// Maximum number of output lines stored per job.
const MAX_LINES: usize = 500;

// ── Core job fields shared by every background job ─────────────

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

// ── Event payloads (generic) ───────────────────────────────────

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

// ── BackgroundJobManager ───────────────────────────────────────

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

    /// Remove non-running entries older than 30 minutes.
    pub fn evict_stale(&self, jobs: &mut HashMap<String, JobEntry<E>>) {
        let cutoff = Duration::from_secs(JOB_TTL_SECS);
        jobs.retain(|_, job| job.status == "running" || job.created_at.elapsed() < cutoff);
    }

    /// Check whether a job is currently running. Returns `Err` if already running.
    pub fn ensure_not_running(&self, job_id: &str) -> Result<(), AppError> {
        let jobs = self.lock()?;
        if let Some(existing) = jobs.get(job_id) {
            if existing.status == "running" {
                return Err(AppError::Validation(
                    "Job is already running".into(),
                ));
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
        if let Ok(mut jobs) = self.lock() {
            let entry = jobs
                .entry(job_id.to_string())
                .or_insert_with(JobEntry::default);
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

    /// Append a line to the job's output buffer and emit a Tauri output event.
    pub fn emit_line(&self, app: &tauri::AppHandle, job_id: &str, line: impl Into<String>) {
        let line = line.into();
        if let Ok(mut jobs) = self.lock() {
            let entry = jobs
                .entry(job_id.to_string())
                .or_insert_with(JobEntry::default);
            if entry.lines.len() < MAX_LINES {
                entry.lines.push(line.clone());
            }
        }

        let _ = app.emit(
            self.output_event_name,
            OutputEvent {
                job_id: job_id.to_string(),
                line,
            },
        );
    }

    /// Mutate the extra state of a job entry.
    pub fn update_extra(&self, job_id: &str, f: impl FnOnce(&mut E)) {
        if let Ok(mut jobs) = self.lock() {
            let entry = jobs
                .entry(job_id.to_string())
                .or_insert_with(JobEntry::default);
            f(&mut entry.extra);
        }
    }

    /// Read a value from the extra state of a job entry.
    pub fn read_extra<R>(&self, job_id: &str, f: impl FnOnce(&E) -> R) -> Option<R> {
        let jobs = self.lock().ok()?;
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
    pub fn cancel_or_preempt(&self, app: &tauri::AppHandle, job_id: &str, extra: E) -> Result<(), AppError> {
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
    pub fn get_snapshot(&self, job_id: &str) -> Option<JobSnapshot> {
        let jobs = self.lock().ok()?;
        jobs.get(job_id).map(|job| JobSnapshot {
            job_id: job_id.to_string(),
            status: if job.status.is_empty() {
                "idle".to_string()
            } else {
                job.status.clone()
            },
            error: job.error.clone(),
            lines: job.lines.clone(),
        })
    }

    /// Get a full snapshot including extra state via a mapping function.
    pub fn get_snapshot_with<R>(
        &self,
        job_id: &str,
        f: impl FnOnce(&str, &JobEntry<E>) -> R,
    ) -> Option<R> {
        let jobs = self.lock().ok()?;
        jobs.get(job_id).map(|job| f(job_id, job))
    }

    /// Update the status field directly on a locked job (no event emission).
    pub fn set_status_quiet(&self, job_id: &str, status: &str, error: Option<String>) -> Result<(), AppError> {
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
}
