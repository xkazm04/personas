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
pub mod scan_codebase;

use std::sync::Arc;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

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
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
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

pub fn enqueue(
    pool: &UserDbPool,
    kind: &str,
    params: &serde_json::Value,
    project_id: Option<&str>,
) -> Result<String, AppError> {
    let id = format!("job_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    let params_str = params.to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_background_job (id, kind, status, params_json, project_id, created_at)
         VALUES (?1, ?2, 'queued', ?3, ?4, ?5)",
        params![id, kind, params_str, project_id, now],
    )?;
    tracing::info!(job_id = %id, kind, "background job enqueued");
    Ok(id)
}

pub fn get(pool: &UserDbPool, id: &str) -> Result<Option<BackgroundJob>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT id, kind, status, params_json, result_text, error_text, project_id,
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
        "SELECT id, kind, status, params_json, result_text, error_text, project_id,
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
            "SELECT id, kind, status, params_json, result_text, error_text, project_id,
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
    #[cfg(feature = "ml")] embedder: Option<&Arc<EmbeddingManager>>,
    app: &AppHandle,
) -> Result<(), AppError> {
    let job = match pop_next_queued(pool)? {
        Some(j) => j,
        None => return Ok(()),
    };

    // Tell the panel the job started — its indicator can switch from
    // "queued" to "running" without polling.
    let _ = app.emit(JOB_EVENT, &job);

    let result = dispatch_handler(pool, &job).await;

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
        }
    }

    // Re-emit so the panel updates the indicator with terminal status.
    if let Ok(Some(updated)) = get(pool, &job.id) {
        let _ = app.emit(JOB_EVENT, &updated);
    }

    Ok(())
}

async fn dispatch_handler(pool: &UserDbPool, job: &BackgroundJob) -> Result<String, AppError> {
    let params: serde_json::Value =
        serde_json::from_str(&job.params_json).unwrap_or(serde_json::json!({}));
    match job.kind.as_str() {
        "scan_codebase" => scan_codebase::run(pool, job.project_id.as_deref(), &params).await,
        "connector_use" => connector_use::run(pool, &params).await,
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
        created_at: row.get(7)?,
        started_at: row.get(8)?,
        completed_at: row.get(9)?,
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
