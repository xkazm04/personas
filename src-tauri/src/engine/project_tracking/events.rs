//! Raw CLI event log — write path for the watchers, prune path for the
//! scheduler. Reads happen via the consolidator (Phase 2) and chat
//! drill-in (Phase 5).

use chrono::{DateTime, Utc};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::UserDbPool;
use crate::error::AppError;

/// Hard retention window. Events older than this are dropped on each
/// scheduler tick. The consolidated [`engine_project_pulse`] rows are the
/// long-term record; the raw log only needs to cover "what happened
/// since the last consolidator tick" plus a few days of safety margin
/// for drill-in queries.
pub const RETENTION_DAYS: i64 = 7;

/// Discriminated payload for one CLI event. Stored as `payload_json` in
/// `engine_cli_event`; serde tag is `kind` so the column shape mirrors
/// what watchers emit and the consolidator can match-case cleanly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventPayload {
    Commit {
        hash: String,
        author: String,
        author_date: String,
        subject: String,
    },
    RunStarted {
        slug: String,
        timestamp: String,
        source: Option<String>,
    },
    RunCompleted {
        slug: String,
        commit_sha: Option<String>,
        status: String,
    },
    Note {
        path: String,
        title: Option<String>,
        summary: Option<String>,
    },
}

impl EventPayload {
    /// Database `kind` column value — short discriminator suitable for
    /// indexing and group-by aggregation.
    pub fn kind(&self) -> &'static str {
        match self {
            EventPayload::Commit { .. } => "commit",
            EventPayload::RunStarted { .. } => "run_started",
            EventPayload::RunCompleted { .. } => "run_completed",
            EventPayload::Note { .. } => "note",
        }
    }
}

/// Insert one event row. Called per-event from each watcher pass.
/// Returns the new row id.
pub fn insert_event(
    pool: &UserDbPool,
    project_id: &str,
    payload: &EventPayload,
) -> Result<String, AppError> {
    let id = Uuid::new_v4().to_string();
    let payload_json = serde_json::to_string(payload)?;

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO engine_cli_event (id, project_id, kind, payload_json)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, project_id, payload.kind(), payload_json],
    )?;
    Ok(id)
}

/// Drop events older than [`RETENTION_DAYS`]. Returns the count of rows
/// removed. Called once per scheduler tick.
pub fn prune_old_events(pool: &UserDbPool) -> Result<usize, AppError> {
    let conn = pool.get()?;
    let removed = conn.execute(
        "DELETE FROM engine_cli_event
         WHERE created_at < datetime('now', ?1)",
        params![format!("-{} days", RETENTION_DAYS)],
    )?;
    Ok(removed)
}

/// Count events for a given project since a cutoff. Used by the
/// scheduler to decide whether a tick has anything to consolidate
/// (Phase 2 short-circuits empty ticks).
pub fn count_events_since(
    pool: &UserDbPool,
    project_id: &str,
    since: DateTime<Utc>,
) -> Result<usize, AppError> {
    let conn = pool.get()?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM engine_cli_event
         WHERE project_id = ?1 AND created_at >= ?2",
        params![project_id, since.to_rfc3339()],
        |row| row.get(0),
    )?;
    Ok(count as usize)
}
