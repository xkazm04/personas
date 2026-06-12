//! Phase G: background jobs — long-running ops (codebase scan, lab
//! pass) that Athena enqueues and a worker runs while the chat stays
//! responsive.
//!
//! Lifecycle:
//!   queued → running → completed | failed
//!
//! The worker (a tokio task spawned in `companion_init`) polls every
//! 3s for queued rows, dispatches to a per-kind handler, and on
//! completion appends a system episode to the chat transcript so
//! Athena sees the result on her next turn. The user is never
//! blocked; she can keep talking while a scan runs.
//!
//! v1 ships one kind: `scan_codebase`. New kinds are a match arm in
//! `dispatch_handler` + a sibling module here.

pub mod connector_use;
pub mod curation_run;
pub mod operations_views;
pub mod scan_codebase;

use std::sync::Arc;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// Where a job-status event lands. The desktop binary wires this to a
/// Tauri `AppHandle.emit(...)` so the chat panel updates its
/// indicator; the headless daemon binary wires it to `Noop` because
/// it has no UI listener. Extending to a Tokio channel for in-process
/// IPC (desktop ↔ daemon) is a future variant that slots in here.
///
/// Kept as an enum (not `dyn Trait`) so worker_tick can stay non-
/// generic and the `JOB_EVENT` const has a single point-of-truth for
/// the channel name.
#[derive(Clone)]
pub enum JobEventSink {
    /// Desktop: emit to the Tauri webview.
    App(AppHandle),
    /// Daemon or test: drop the event on the floor.
    Noop,
}

impl JobEventSink {
    /// Best-effort emit. Errors are intentionally swallowed — a failed
    /// emit must never abort the job that triggered it. Tauri returns
    /// `Err` only when the runtime is shutting down or no listeners
    /// are attached; neither is a job correctness issue.
    pub fn emit(&self, payload: &BackgroundJob) {
        match self {
            JobEventSink::App(app) => {
                let _ = app.emit(JOB_EVENT, payload);
            }
            JobEventSink::Noop => {}
        }
    }
}

use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::session::DEFAULT_SESSION_ID;
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// Tauri event channel for job status changes — the panel listens and
/// updates its in-flight indicator. Payload: the full BackgroundJob row.
pub const JOB_EVENT: &str = "companion://job";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundJob {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub params_json: String,
    pub result_text: Option<String>,
    pub error_text: Option<String>,
    pub project_id: Option<String>,
    /// Human one-liner for the in-chat task tag / activity tray
    /// (e.g. "Scanning ai-paralegal"). Persisted; set at enqueue. Falls back
    /// to a kind-derived label when absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_title: Option<String>,
    /// The conversation turn/episode that spawned this task, so the frontend
    /// can render the task tag under the message that started it (Athena
    /// async-UX milestone). Persisted; set at enqueue. `None` for tasks not
    /// tied to a turn (scheduled curation, etc.).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_turn_id: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    /// Live, in-flight progress note set only on `companion://job` events
    /// emitted by a running handler (see [`JobProgress`]). Never persisted —
    /// `map_row` always reads it as `None`, so the terminal re-emit from the
    /// DB clears it. Lets a long job report "still working — here's where I
    /// am" between `running` and the terminal status instead of going silent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_text: Option<String>,
    /// Structured progress for a determinate task (e.g. files scanned). Like
    /// `progress_text`, these are event-only (never persisted) — they ride the
    /// `companion://job` event so the task tag can render a progress bar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_current: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_total: Option<u32>,
}

/// Live progress reporter handed to a job handler so it can publish
/// intermediate updates on the same `companion://job` channel while it runs.
/// Each `report` re-emits the running job row with `progress_text` set; the
/// field is event-only, so callers never touch the DB. Cloneable + `Send` so
/// it can move into a `spawn_blocking` walk.
#[derive(Clone)]
pub struct JobProgress {
    sink: JobEventSink,
    job: BackgroundJob,
}

impl JobProgress {
    /// Report a free-text progress note ("Calling Sentry…").
    pub fn report(&self, message: impl Into<String>) {
        let mut snapshot = self.job.clone();
        snapshot.status = "running".into();
        snapshot.progress_text = Some(message.into());
        self.sink.emit(&snapshot);
    }

    /// Report determinate progress (current/total) plus a note, so the task
    /// tag can render a progress bar (e.g. files scanned). Event-only.
    pub fn report_progress(&self, current: u32, total: u32, message: impl Into<String>) {
        let mut snapshot = self.job.clone();
        snapshot.status = "running".into();
        snapshot.progress_text = Some(message.into());
        snapshot.progress_current = Some(current);
        snapshot.progress_total = Some(total);
        self.sink.emit(&snapshot);
    }
}

/// Recover orphaned `running` jobs on startup. A job in `running`
/// status when the process restarts means the worker died mid-walk —
/// without recovery the row sits in `running` forever and re-runs
/// won't pick it up (it's no longer queued). Called once from
/// `companion_init`.
pub fn recover_orphans(pool: &UserDbPool) -> Result<usize, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let n = conn.execute(
        "UPDATE companion_background_job
         SET status = 'failed',
             error_text = COALESCE(error_text, '') || ' [orphaned by process restart]',
             completed_at = ?1
         WHERE status = 'running'",
        params![now],
    )?;
    if n > 0 {
        tracing::info!(
            orphans = n,
            "background-job worker: recovered orphaned running jobs"
        );
    }
    Ok(n)
}

/// Delete terminal background-job rows older than the retention window.
/// The worker polls frequently, so keeping this table bounded prevents
/// completed history from slowing every queued-job lookup over time.
pub fn prune_terminal_jobs(pool: &UserDbPool) -> Result<usize, AppError> {
    const RETENTION_DAYS: i64 = 30;

    let cutoff = (chrono::Utc::now() - chrono::Duration::days(RETENTION_DAYS)).to_rfc3339();
    let conn = pool.get()?;
    let n = conn.execute(
        "DELETE FROM companion_background_job
         WHERE status IN ('completed', 'failed')
           AND created_at < ?1",
        params![cutoff],
    )?;
    if n > 0 {
        tracing::info!(
            pruned = n,
            retention_days = RETENTION_DAYS,
            "background-job worker: pruned terminal job history"
        );
    }
    Ok(n)
}

/// Back-compat enqueue (no task metadata). Prefer [`enqueue_task`] for new
/// callers so the task carries a `short_title` + `parent_turn_id`.
pub fn enqueue(
    pool: &UserDbPool,
    kind: &str,
    params: &serde_json::Value,
    project_id: Option<&str>,
) -> Result<String, AppError> {
    enqueue_task(pool, kind, params, project_id, None, None)
}

/// Enqueue a background task with optional `short_title` (the human one-liner
/// shown in the in-chat task tag / activity tray) and `parent_turn_id` (the
/// conversation turn that spawned it, for tag grouping). Athena async-UX.
pub fn enqueue_task(
    pool: &UserDbPool,
    kind: &str,
    params: &serde_json::Value,
    project_id: Option<&str>,
    short_title: Option<&str>,
    parent_turn_id: Option<&str>,
) -> Result<String, AppError> {
    let id = format!("job_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    let params_str = params.to_string();
    let title = short_title.map(|s| s.to_string()).unwrap_or_else(|| default_title(kind));
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_background_job
            (id, kind, status, params_json, project_id, short_title, parent_turn_id, created_at)
         VALUES (?1, ?2, 'queued', ?3, ?4, ?5, ?6, ?7)",
        params![id, kind, params_str, project_id, title, parent_turn_id, now],
    )?;
    tracing::info!(job_id = %id, kind, parent_turn = ?parent_turn_id, "background task enqueued");
    Ok(id)
}

/// Kind → default human title for the task tag when an explicit one isn't given.
fn default_title(kind: &str) -> String {
    match kind {
        "connector_use" => "Calling a connector".to_string(),
        "scan_codebase" => "Scanning codebase".to_string(),
        curation_run::KIND => "Curating memory".to_string(),
        other => other.replace('_', " "),
    }
}

pub fn get(pool: &UserDbPool, id: &str) -> Result<Option<BackgroundJob>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT id, kind, status, params_json, result_text, error_text, project_id, short_title, parent_turn_id,
                    created_at, started_at, completed_at
             FROM companion_background_job WHERE id = ?1",
            params![id],
            map_row,
        )
        .optional()?;
    Ok(row)
}

pub fn list(
    pool: &UserDbPool,
    only_unresolved: bool,
    limit: u32,
) -> Result<Vec<BackgroundJob>, AppError> {
    let conn = pool.get()?;
    let where_clause = if only_unresolved {
        "WHERE status IN ('queued', 'running')"
    } else {
        ""
    };
    let sql = format!(
        "SELECT id, kind, status, params_json, result_text, error_text, project_id, short_title, parent_turn_id,
                created_at, started_at, completed_at
         FROM companion_background_job
         {where_clause}
         ORDER BY created_at DESC
         LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![limit], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn pop_next_queued(pool: &UserDbPool) -> Result<Option<BackgroundJob>, AppError> {
    let conn = pool.get()?;
    let now = Utc::now().to_rfc3339();
    let row = conn
        .query_row(
            "SELECT id, kind, status, params_json, result_text, error_text, project_id, short_title, parent_turn_id,
                    created_at, started_at, completed_at
             FROM companion_background_job
             WHERE status = 'queued'
             ORDER BY created_at ASC
             LIMIT 1",
            params![],
            map_row,
        )
        .optional()?;
    if let Some(ref job) = row {
        // Atomic transition queued → running keyed on current status
        // so two concurrent workers can't double-claim the same job.
        let updated = conn.execute(
            "UPDATE companion_background_job
             SET status = 'running', started_at = ?1
             WHERE id = ?2 AND status = 'queued'",
            params![now, job.id],
        )?;
        if updated == 0 {
            // Lost the race; another worker took it.
            return Ok(None);
        }
    }
    Ok(row.map(|mut j| {
        j.status = "running".into();
        j.started_at = Some(now);
        j
    }))
}

fn mark_completed(pool: &UserDbPool, id: &str, result: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_background_job
         SET status = 'completed', result_text = ?1, completed_at = ?2
         WHERE id = ?3",
        params![result, now, id],
    )?;
    Ok(())
}

fn mark_failed(pool: &UserDbPool, id: &str, error: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_background_job
         SET status = 'failed', error_text = ?1, completed_at = ?2
         WHERE id = ?3",
        params![error, now, id],
    )?;
    Ok(())
}

/// Single worker tick. Pulls one queued job, dispatches by kind,
/// records result/error, and appends a system episode summarizing
/// the outcome so Athena's next turn sees what happened.
///
/// Public so `companion_init`'s scheduler can call it directly. Errors
/// at the dispatch level are caught and logged inside the kind handler;
/// this function returns Err only on infrastructure failures (DB
/// unreachable, etc.).
pub async fn worker_tick(
    pool: &UserDbPool,
    cred_pool: &crate::db::DbPool,
    #[cfg(feature = "ml")] embedder: Option<&Arc<EmbeddingManager>>,
    sink: &JobEventSink,
) -> Result<(), AppError> {
    let job = match pop_next_queued(pool)? {
        Some(j) => j,
        None => return Ok(()),
    };

    // Tell the panel the job started — its indicator can switch from
    // "queued" to "running" without polling. Noop under daemon.
    sink.emit(&job);

    // Hand the handler a reporter so it can publish intermediate progress
    // on the same channel while it runs (e.g. "Calling Sentry…").
    let progress = JobProgress {
        sink: sink.clone(),
        job: job.clone(),
    };
    let result = dispatch_handler(pool, cred_pool, &job, &progress).await;

    match result {
        Ok(report) => {
            if let Err(e) = mark_completed(pool, &job.id, &report) {
                tracing::warn!(job_id = %job.id, error = %e, "job: mark_completed failed");
            }
            // Append a system episode so Athena's next turn reads it.
            let summary = format!(
                "[Background job `{kind}` completed — id `{id}`]\n\n{report}",
                kind = job.kind,
                id = job.id,
                report = report
            );
            append_system_episode(
                pool,
                #[cfg(feature = "ml")]
                embedder,
                &summary,
            )
            .await;
        }
        Err(e) => {
            let err_text = e.to_string();
            if let Err(e2) = mark_failed(pool, &job.id, &err_text) {
                tracing::warn!(job_id = %job.id, error = %e2, "job: mark_failed failed");
            }
            // Job-kind-aware noise reduction: `connector_use` failures
            // already surface to the user via the inline ConnectorCallCard
            // (it reads error_text directly from the BackgroundJob row).
            // Writing a parallel `[FAILED]` system episode just double-
            // surfaces the same error AND drags the raw stderr into
            // Athena's prompt next turn for no benefit. Skip the system
            // episode for connector failures; other job kinds
            // (scan_codebase, memory_curation_run) have no inline UI
            // and still need the system episode so Athena is aware.
            if job.kind != "connector_use" {
                let summary = format!(
                    "[Background job `{kind}` FAILED — id `{id}`]\n\n{err}",
                    kind = job.kind,
                    id = job.id,
                    err = err_text
                );
                append_system_episode(
                    pool,
                    #[cfg(feature = "ml")]
                    embedder,
                    &summary,
                )
                .await;
            } else {
                tracing::info!(
                    job_id = %job.id,
                    "connector_use failure — skipping system-episode write; card surfaces the error inline"
                );
            }
        }
    }

    // Re-emit so the panel updates the indicator with terminal status.
    if let Ok(Some(updated)) = get(pool, &job.id) {
        sink.emit(&updated);
    }

    Ok(())
}

async fn dispatch_handler(
    pool: &UserDbPool,
    cred_pool: &crate::db::DbPool,
    job: &BackgroundJob,
    progress: &JobProgress,
) -> Result<String, AppError> {
    let params: serde_json::Value =
        serde_json::from_str(&job.params_json).unwrap_or(serde_json::json!({}));
    match job.kind.as_str() {
        "scan_codebase" => {
            scan_codebase::run(pool, job.project_id.as_deref(), &params, progress).await
        }
        "connector_use" => connector_use::run(pool, cred_pool, &params, progress).await,
        curation_run::KIND => curation_run::run(pool, &params, progress).await,
        other => Err(AppError::Internal(format!(
            "unknown background job kind `{other}`"
        ))),
    }
}

#[cfg(feature = "ml")]
async fn append_system_episode(
    pool: &UserDbPool,
    embedder: Option<&Arc<EmbeddingManager>>,
    content: &str,
) {
    let res = match embedder {
        Some(emb) => {
            episodic::append_episode_and_embed(
                pool,
                emb,
                DEFAULT_SESSION_ID,
                EpisodeRole::System,
                content,
            )
            .await
        }
        None => episodic::append_episode(pool, DEFAULT_SESSION_ID, EpisodeRole::System, content),
    };
    if let Err(e) = res {
        tracing::warn!(error = %e, "job: failed to append system episode");
    }
}

#[cfg(not(feature = "ml"))]
async fn append_system_episode(pool: &UserDbPool, content: &str) {
    if let Err(e) = episodic::append_episode(pool, DEFAULT_SESSION_ID, EpisodeRole::System, content)
    {
        tracing::warn!(error = %e, "job: failed to append system episode");
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BackgroundJob> {
    Ok(BackgroundJob {
        id: row.get(0)?,
        kind: row.get(1)?,
        status: row.get(2)?,
        params_json: row.get(3)?,
        result_text: row.get(4)?,
        error_text: row.get(5)?,
        project_id: row.get(6)?,
        short_title: row.get(7)?,
        parent_turn_id: row.get(8)?,
        created_at: row.get(9)?,
        started_at: row.get(10)?,
        completed_at: row.get(11)?,
        progress_text: None,
        progress_current: None,
        progress_total: None,
    })
}

fn short_uuid() -> String {
    Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(10)
        .collect()
}
