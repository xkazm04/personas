//! F5: persistent index of dev-tools git checkpoints (stage → SHA per run).
//!
//! `engine::git_checkpoint` creates the actual git commits; this table records
//! the stage→SHA mapping so a run's checkpoints are queryable (and a future UI /
//! auto-checkpoint-on-stage wiring can list and roll back to them).

use serde::Serialize;
use ts_rs::TS;

use crate::db::DbPool;
use crate::error::AppError;

/// One recorded checkpoint of a dev-tools run.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DevRunCheckpoint {
    pub id: String,
    pub run_id: String,
    pub stage: String,
    pub sha: String,
    pub status: String,
    pub created_at: String,
}

/// Record a checkpoint's stage→SHA in the index.
pub fn insert(
    pool: &DbPool,
    run_id: &str,
    stage: &str,
    sha: &str,
    status: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO dev_run_checkpoints (id, run_id, stage, sha, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, run_id, stage, sha, status, now],
    )?;
    Ok(())
}

/// List a run's checkpoints, oldest first.
pub fn list(pool: &DbPool, run_id: &str) -> Result<Vec<DevRunCheckpoint>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, run_id, stage, sha, status, created_at
         FROM dev_run_checkpoints WHERE run_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![run_id], |r| {
            Ok(DevRunCheckpoint {
                id: r.get(0)?,
                run_id: r.get(1)?,
                stage: r.get(2)?,
                sha: r.get(3)?,
                status: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(AppError::Database)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
}
