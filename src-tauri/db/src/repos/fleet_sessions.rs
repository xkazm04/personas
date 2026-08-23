//! Repository for the durable fleet session registry (`fleet_sessions`).
//!
//! The Fleet registry ([`crate::commands::fleet::registry::FleetRegistry`]) is
//! an in-memory `HashMap` — an app restart, update or crash used to lose the
//! entire fleet. This table mirrors it so a restart is a non-event: every
//! non-exited row rehydrates on boot as a *dozing tombstone* (state kept,
//! process gone) that the existing `claude --resume` wake path resurrects.
//!
//! Contract:
//! - Only sessions with a BOUND `claude_session_id` are persisted — they are
//!   the only ones that can be resumed.
//! - Writes are best-effort and must never block or fail a PTY/state path
//!   (see [`crate::commands::fleet::persist`], which owns the writer thread).
//! - Exited rows age out on boot ([`prune_exited_before`]); the live registry
//!   remains the source of truth while the app runs.

use rusqlite::params;

use crate::DbPool;
use personas_core::error::AppError;

/// One persisted fleet session — a faithful projection of the registry row's
/// rehydratable fields. PTY handles, the output ring and the child pid are
/// deliberately absent: they die with the process and are re-established by a
/// wake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FleetSessionRow {
    /// Registry id (UUID v4). Stable across a restart so grid identity holds.
    pub id: String,
    /// Claude Code's own conversation id — the `--resume` key.
    pub claude_session_id: String,
    pub cwd: String,
    pub project_label: String,
    pub name: Option<String>,
    pub title: Option<String>,
    /// The spawn argv, JSON-encoded (`["--session-id","…"]`).
    pub args_json: String,
    /// `interactive` | `headless` (matches `FleetSessionMode`'s serde tokens).
    pub mode: String,
    /// State token (matches `types::state_to_token`).
    pub state: String,
    pub state_reason: Option<String>,
    /// Run-harvest grouping key. `None` = ad-hoc spawn.
    pub run_id: Option<String>,
    pub run_label: Option<String>,
    pub created_at_ms: i64,
    pub last_activity_ms: i64,
}

/// Insert-or-replace a session row. Keyed on the registry id, so a state
/// change is a single cheap UPSERT rather than a read-modify-write.
pub fn upsert(pool: &DbPool, row: &FleetSessionRow) -> Result<(), AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::upsert", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO fleet_sessions
                (id, claude_session_id, cwd, project_label, name, title, args_json,
                 mode, state, state_reason, run_id, run_label,
                 created_at_ms, last_activity_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(id) DO UPDATE SET
                claude_session_id = excluded.claude_session_id,
                cwd               = excluded.cwd,
                project_label     = excluded.project_label,
                name              = excluded.name,
                title             = excluded.title,
                args_json         = excluded.args_json,
                mode              = excluded.mode,
                state             = excluded.state,
                state_reason      = excluded.state_reason,
                -- run identity is stamped once at spawn; a later state write
                -- must never null it out.
                run_id            = COALESCE(excluded.run_id, fleet_sessions.run_id),
                run_label         = COALESCE(excluded.run_label, fleet_sessions.run_label),
                created_at_ms     = excluded.created_at_ms,
                last_activity_ms  = excluded.last_activity_ms,
                updated_at_ms     = excluded.updated_at_ms",
            params![
                row.id,
                row.claude_session_id,
                row.cwd,
                row.project_label,
                row.name,
                row.title,
                row.args_json,
                row.mode,
                row.state,
                row.state_reason,
                row.run_id,
                row.run_label,
                row.created_at_ms,
                row.last_activity_ms,
                personas_core::utils::now_ms(),
            ],
        )?;
        Ok(())
    })
}

/// Drop a persisted row (the operator dismissed it, or a wake replaced it with
/// a fresh registry id).
pub fn delete(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::delete", {
        let conn = pool.get()?;
        conn.execute("DELETE FROM fleet_sessions WHERE id = ?1", params![id])?;
        Ok(())
    })
}

/// Every row that could still be resurrected — i.e. not terminal. Newest
/// spawn first (the grid sorts the same way).
pub fn list_rehydratable(pool: &DbPool) -> Result<Vec<FleetSessionRow>, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::list_rehydratable", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, claude_session_id, cwd, project_label, name, title, args_json,
                    mode, state, state_reason, run_id, run_label,
                    created_at_ms, last_activity_ms
             FROM fleet_sessions
             WHERE state <> 'exited'
             ORDER BY created_at_ms DESC",
        )?;
        let rows = stmt.query_map([], map_row)?;
        Ok(rows.filter_map(Result::ok).collect())
    })
}

/// All rows belonging to one run (harvest surface). `run_id` is the batch tag
/// stamped at spawn.
pub fn list_by_run(pool: &DbPool, run_id: &str) -> Result<Vec<FleetSessionRow>, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::list_by_run", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, claude_session_id, cwd, project_label, name, title, args_json,
                    mode, state, state_reason, run_id, run_label,
                    created_at_ms, last_activity_ms
             FROM fleet_sessions
             WHERE run_id = ?1
             ORDER BY created_at_ms ASC",
        )?;
        let rows = stmt.query_map(params![run_id], map_row)?;
        Ok(rows.filter_map(Result::ok).collect())
    })
}

/// Run index for the harvest picker: one entry per `run_id`, newest run first.
/// Rows with no `run_id` (spawned before the run lane existed) are skipped —
/// there is no run to report on.
pub fn list_runs(
    pool: &DbPool,
    limit: u32,
) -> Result<Vec<(String, Option<String>, i64, i32, i32)>, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::list_runs", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT run_id,
                    MAX(run_label)                                       AS label,
                    MIN(created_at_ms)                                   AS started,
                    COUNT(*)                                             AS n,
                    SUM(CASE WHEN state = 'finished' THEN 1 ELSE 0 END)  AS finished
             FROM fleet_sessions
             WHERE run_id IS NOT NULL
             GROUP BY run_id
             ORDER BY started DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    })
}

/// Retention: drop terminal rows last touched before `cutoff_ms`. Called once
/// on boot — a 24h-old exited session has no recovery value.
pub fn prune_exited_before(pool: &DbPool, cutoff_ms: i64) -> Result<usize, AppError> {
    timed_query!("fleet_sessions", "fleet_sessions::prune_exited_before", {
        let conn = pool.get()?;
        let n = conn.execute(
            "DELETE FROM fleet_sessions WHERE state = 'exited' AND updated_at_ms < ?1",
            params![cutoff_ms],
        )?;
        Ok(n)
    })
}

fn map_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<FleetSessionRow> {
    Ok(FleetSessionRow {
        id: r.get(0)?,
        claude_session_id: r.get(1)?,
        cwd: r.get(2)?,
        project_label: r.get(3)?,
        name: r.get(4)?,
        title: r.get(5)?,
        args_json: r.get(6)?,
        mode: r.get(7)?,
        state: r.get(8)?,
        state_reason: r.get(9)?,
        run_id: r.get(10)?,
        run_label: r.get(11)?,
        created_at_ms: r.get(12)?,
        last_activity_ms: r.get(13)?,
    })
}
