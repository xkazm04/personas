pub mod ab;
pub mod arena;
pub mod consensus;
pub mod eval;
pub mod events;
pub mod evolution;
pub mod genome;
pub mod matrix;
pub mod ratings;
pub mod versions;

use crate::db::models::{Json, LabResultKind, LabToolCall};
use crate::db::DbPool;
use crate::error::AppError;
use rusqlite::params;

/// List the tool calls captured for a single lab result row, ordered by
/// variant then sequence so the frontend can render `expected` above `actual`
/// without re-sorting. Replaces the legacy `tool_calls_expected/actual` JSON
/// columns. ADR: 2026-05-02-lab-tool-calls-child-table.
pub fn list_tool_calls_for_result(
    pool: &DbPool,
    result_id: &str,
    result_kind: LabResultKind,
) -> Result<Vec<LabToolCall>, AppError> {
    timed_query!(
        "lab_tool_calls",
        "lab_tool_calls::list_tool_calls_for_result",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT id, result_kind, result_id, sequence, tool_name, variant, created_at
             FROM lab_tool_calls
             WHERE result_id = ?1 AND result_kind = ?2
             ORDER BY variant, sequence",
            )?;
            let rows = stmt
                .query_map(params![result_id, result_kind.as_str()], |row| {
                    Ok(LabToolCall {
                        id: row.get(0)?,
                        result_kind: row.get(1)?,
                        result_id: row.get(2)?,
                        sequence: row.get(3)?,
                        tool_name: row.get(4)?,
                        variant: row.get(5)?,
                        created_at: row.get(6)?,
                    })
                })
                .map_err(AppError::Database)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Dual-write tool calls into the `lab_tool_calls` child table alongside the
/// JSON-array column writes inside each lab repo's `create_result`. Failures
/// are logged and swallowed during this transition phase: the JSON column
/// remains the canonical source until the cutover step (step 6), so a partial
/// child-table write does not corrupt user data — analytics simply underreport
/// until the next backfill or run replay.
///
/// `result_kind` must match the CHECK constraint on `lab_tool_calls`: one of
/// `'arena'`, `'ab'`, `'matrix'`, `'consensus'`, `'eval'`, `'test_run'`.
///
/// ADR: 2026-05-02-lab-tool-calls-child-table.
pub(crate) fn write_tool_calls_child_rows(
    conn: &rusqlite::Connection,
    result_kind: &str,
    result_id: &str,
    tool_calls_expected: Option<&Json<Vec<String>>>,
    tool_calls_actual: Option<&Json<Vec<String>>>,
) {
    for (variant, tools_opt) in [
        ("expected", tool_calls_expected),
        ("actual", tool_calls_actual),
    ] {
        let Some(tools) = tools_opt else { continue };
        for (sequence, tool_name) in tools.iter().enumerate() {
            let id = uuid::Uuid::new_v4().to_string();
            if let Err(e) = conn.execute(
                "INSERT OR IGNORE INTO lab_tool_calls
                    (id, result_kind, result_id, sequence, tool_name, variant)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    id,
                    result_kind,
                    result_id,
                    sequence as i64,
                    tool_name,
                    variant
                ],
            ) {
                tracing::warn!(
                    result_kind = %result_kind,
                    result_id = %result_id,
                    variant = %variant,
                    error = %e,
                    "Failed to dual-write lab_tool_calls; JSON column remains canonical"
                );
            }
        }
    }
}

/// Single-query active progress lookup across all 4 lab run tables.
/// Returns all (mode, run_id, progress_json) tuples for non-terminal runs
/// with progress data, ordered by most recent first.
pub fn get_all_active_progress(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<(String, String, String)>, AppError> {
    timed_query!("lab_runs", "lab_runs::get_all_active_progress", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT mode, id, progress_json FROM (
                SELECT 'arena' AS mode, id, progress_json, created_at
                FROM lab_arena_runs
                WHERE persona_id = ?1
                  AND status NOT IN ('completed', 'failed', 'cancelled')
                  AND progress_json IS NOT NULL
                UNION ALL
                SELECT 'ab' AS mode, id, progress_json, created_at
                FROM lab_ab_runs
                WHERE persona_id = ?1
                  AND status NOT IN ('completed', 'failed', 'cancelled')
                  AND progress_json IS NOT NULL
                UNION ALL
                SELECT 'matrix' AS mode, id, progress_json, created_at
                FROM lab_matrix_runs
                WHERE persona_id = ?1
                  AND status NOT IN ('completed', 'failed', 'cancelled')
                  AND progress_json IS NOT NULL
                UNION ALL
                SELECT 'eval' AS mode, id, progress_json, created_at
                FROM lab_eval_runs
                WHERE persona_id = ?1
                  AND status NOT IN ('completed', 'failed', 'cancelled')
                  AND progress_json IS NOT NULL
            ) ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map(params![persona_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(AppError::Database)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Fail any lab run left non-terminal by an unclean shutdown.
///
/// The four `lab_*_runs` tables are driven by tokio tasks that die with the
/// process, but their rows keep `status='running'` with populated
/// `progress_json`. On next launch `get_all_active_progress` re-hydrates them as
/// phantom active runs — launch buttons disabled, cancel shown, orbit dot lit —
/// and the 30-min frontend timeout only resets in-memory flags, never the row,
/// so every re-selection re-hydrates the phantom. No lab task survives a
/// restart, so it is always safe to fail these at startup (mirrors
/// `recover_stale_executions`). Returns the total number of runs reset.
pub fn recover_interrupted_lab_runs(pool: &DbPool) -> Result<usize, AppError> {
    timed_query!("lab_runs", "lab_runs::recover_interrupted_lab_runs", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut total = 0usize;
        for table in [
            "lab_arena_runs",
            "lab_ab_runs",
            "lab_matrix_runs",
            "lab_eval_runs",
        ] {
            let sql = format!(
                "UPDATE {table}
                    SET status = 'failed',
                        error = 'Interrupted by app restart',
                        completed_at = ?1
                  WHERE status NOT IN ('completed', 'failed', 'cancelled')"
            );
            total += conn.execute(&sql, params![now])?;
        }
        Ok(total)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Acceptance for the lab-run boot reaper. Mirrors the live orphan
    /// `fd2c96c4` (an arena run left `status='running'` with 8 cells when the
    /// app died mid-arena): a non-terminal lab run whose driving tokio task did
    /// not survive the restart must be flipped to `failed` at boot so
    /// `get_all_active_progress` stops re-hydrating it as a phantom active run
    /// (which wedges `isArenaRunning`). Terminal rows and other personas'
    /// completed runs must be untouched.
    #[test]
    fn recover_interrupted_lab_runs_reaps_only_orphans() {
        let pool = crate::db::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        // FK checks off so we don't have to materialise a full persona row.
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        // The orphan: an arena run wedged at `running` with populated progress
        // (the fd2c96c4 equivalent). This is the row that must be reaped.
        conn.execute(
            "INSERT INTO lab_arena_runs (id, persona_id, status, models_tested, created_at, progress_json)
             VALUES ('orphan-arena', 'p1', 'running', '[]', ?1, '{\"phase\":\"executing\"}')",
            params![now],
        )
        .unwrap();
        // A second orphan in a different run table (eval) at a non-`running`
        // non-terminal phase — proves the sweep is not keyed to one status string.
        conn.execute(
            "INSERT INTO lab_eval_runs (id, persona_id, status, created_at, progress_json)
             VALUES ('orphan-eval', 'p1', 'generating', ?1, '{\"phase\":\"generating\"}')",
            params![now],
        )
        .unwrap();
        // A control: an already-completed arena run must never be touched.
        conn.execute(
            "INSERT INTO lab_arena_runs (id, persona_id, status, models_tested, created_at, completed_at)
             VALUES ('done-arena', 'p1', 'completed', '[]', ?1, ?1)",
            params![now],
        )
        .unwrap();
        drop(conn);

        // Boot sweep flips both orphans, leaves the completed run alone.
        let reaped = recover_interrupted_lab_runs(&pool).unwrap();
        assert_eq!(reaped, 2, "both non-terminal orphans should be reaped");

        let conn = pool.get().unwrap();
        let (arena_status, arena_error): (String, Option<String>) = conn
            .query_row(
                "SELECT status, error FROM lab_arena_runs WHERE id = 'orphan-arena'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(arena_status, "failed", "orphan arena run must be failed");
        assert_eq!(
            arena_error.as_deref(),
            Some("Interrupted by app restart"),
            "reaped run must carry an explicit restart reason",
        );

        let eval_status: String = conn
            .query_row(
                "SELECT status FROM lab_eval_runs WHERE id = 'orphan-eval'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(eval_status, "failed", "orphan eval run must be failed");

        let done_status: String = conn
            .query_row(
                "SELECT status FROM lab_arena_runs WHERE id = 'done-arena'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(done_status, "completed", "completed run must be untouched");
        drop(conn);

        // Hydration must no longer surface the reaped runs as active.
        let active = get_all_active_progress(&pool, "p1").unwrap();
        assert!(
            active.is_empty(),
            "reaped runs must not re-hydrate as active, got {active:?}",
        );
    }

    /// A run that is *already* terminal is a no-op — the sweep is idempotent, so
    /// a second boot (or a re-run within one boot) never re-touches it.
    #[test]
    fn recover_interrupted_lab_runs_is_idempotent() {
        let pool = crate::db::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO lab_arena_runs (id, persona_id, status, models_tested, created_at, progress_json)
             VALUES ('orphan', 'p1', 'running', '[]', ?1, '{}')",
            params![now],
        )
        .unwrap();
        drop(conn);

        assert_eq!(recover_interrupted_lab_runs(&pool).unwrap(), 1);
        // Second pass finds nothing left non-terminal.
        assert_eq!(recover_interrupted_lab_runs(&pool).unwrap(), 0);
    }
}
