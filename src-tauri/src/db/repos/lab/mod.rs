pub mod arena;
pub mod ab;
pub mod consensus;
pub mod matrix;
pub mod eval;
pub mod events;
pub mod ratings;
pub mod genome;
pub mod evolution;
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
    timed_query!("lab_tool_calls", "lab_tool_calls::list_tool_calls_for_result", {
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
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
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
                params![id, result_kind, result_id, sequence as i64, tool_name, variant],
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
