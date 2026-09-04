use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, OptionalExtension, Row};

// ============================================================================
// Auto-runs (durable record of a backlog-draining wave)
// ============================================================================

/// One durable auto-run row. The in-memory `AUTO_RUN_JOBS` map is the live
/// view; this table is what survives a restart, so the Run Desk banner can
/// rehydrate instead of silently forgetting an in-flight run.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DevAutoRun {
    pub id: String,
    pub project_id: Option<String>,
    pub status: String,
    pub snapshot_size: u32,
    pub completed: u32,
    pub failed: u32,
    pub skipped: u32,
    pub iterations: u32,
    pub termination_reason: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

fn row_to_auto_run(row: &Row) -> rusqlite::Result<DevAutoRun> {
    let num = |v: Option<i64>| v.unwrap_or(0).max(0) as u32;
    Ok(DevAutoRun {
        id: row.get("id")?,
        project_id: row.get("project_id").unwrap_or(None),
        status: row
            .get::<_, Option<String>>("status")?
            .unwrap_or_else(|| "running".to_string()),
        snapshot_size: num(row.get("snapshot_size")?),
        completed: num(row.get("completed")?),
        failed: num(row.get("failed")?),
        skipped: num(row.get("skipped")?),
        iterations: num(row.get("iterations")?),
        termination_reason: row.get("termination_reason").unwrap_or(None),
        started_at: row.get("started_at").unwrap_or(None),
        finished_at: row.get("finished_at").unwrap_or(None),
    })
}

/// Record the start of an auto-run. Best-effort by contract at the call site:
/// a failed bookkeeping write must never abort the run itself.
pub fn start_auto_run(
    pool: &DbPool,
    run_id: &str,
    project_id: &str,
    snapshot_size: u32,
) -> Result<(), AppError> {
    timed_query!("dev_auto_runs", "dev_auto_runs::start_auto_run", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT OR REPLACE INTO dev_auto_runs
                (id, project_id, status, snapshot_size, completed, failed, skipped, iterations, termination_reason, started_at, finished_at)
             VALUES (?1, ?2, 'running', ?3, 0, 0, 0, 0, NULL, ?4, NULL)",
            params![
                run_id,
                project_id,
                snapshot_size,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    })
}

#[allow(clippy::too_many_arguments)]
pub fn finish_auto_run(
    pool: &DbPool,
    run_id: &str,
    status: &str,
    completed: u32,
    failed: u32,
    skipped: u32,
    iterations: u32,
    termination_reason: &str,
) -> Result<(), AppError> {
    timed_query!("dev_auto_runs", "dev_auto_runs::finish_auto_run", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_auto_runs
                SET status = ?2, completed = ?3, failed = ?4, skipped = ?5,
                    iterations = ?6, termination_reason = ?7, finished_at = ?8
              WHERE id = ?1",
            params![
                run_id,
                status,
                completed,
                failed,
                skipped,
                iterations,
                termination_reason,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    })
}

/// Flip only the status of an auto-run row (cancel / panic arms), leaving the
/// tallies for the completion arm to fill in if it still gets to run. A panic
/// or a cancel that never reaches completion must not leave the row `running`
/// forever — a stuck `running` row is what makes the banner lie after restart.
pub fn set_auto_run_status(pool: &DbPool, run_id: &str, status: &str) -> Result<(), AppError> {
    timed_query!("dev_auto_runs", "dev_auto_runs::set_auto_run_status", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_auto_runs SET status = ?2, finished_at = COALESCE(finished_at, ?3) WHERE id = ?1",
            params![run_id, status, chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(())
    })
}

/// One auto-run row by id.
///
/// Added for the checkpoint rollback path, which has to resolve a run's
/// workspace from the run itself: the checkpoint index carries no repository
/// column, so `run -> project -> root_path` is the only binding between a
/// checkpoint SHA and the tree it means something in. `latest_auto_run` is not
/// a substitute -- a rollback is usually offered for a run that has since been
/// overtaken by a newer one.
pub fn get_auto_run(pool: &DbPool, run_id: &str) -> Result<Option<DevAutoRun>, AppError> {
    timed_query!("dev_auto_runs", "dev_auto_runs::get_auto_run", {
        let conn = pool.get()?;
        let row = conn
            .query_row(
                "SELECT * FROM dev_auto_runs WHERE id = ?1",
                params![run_id],
                row_to_auto_run,
            )
            .optional()?;
        Ok(row)
    })
}

/// Most recent auto-run row, optionally scoped to a project.
pub fn latest_auto_run(
    pool: &DbPool,
    project_id: Option<&str>,
) -> Result<Option<DevAutoRun>, AppError> {
    timed_query!("dev_auto_runs", "dev_auto_runs::latest_auto_run", {
        let conn = pool.get()?;
        let row = match project_id {
            Some(pid) => conn
                .query_row(
                    "SELECT * FROM dev_auto_runs WHERE project_id = ?1 ORDER BY started_at DESC LIMIT 1",
                    params![pid],
                    row_to_auto_run,
                )
                .optional()?,
            None => conn
                .query_row(
                    "SELECT * FROM dev_auto_runs ORDER BY started_at DESC LIMIT 1",
                    [],
                    row_to_auto_run,
                )
                .optional()?,
        };
        Ok(row)
    })
}
