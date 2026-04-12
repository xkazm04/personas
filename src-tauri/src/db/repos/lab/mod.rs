pub mod arena;
pub mod ab;
pub mod consensus;
pub mod matrix;
pub mod eval;
pub mod ratings;
pub mod genome;
pub mod evolution;
pub mod versions;

use crate::db::DbPool;
use crate::error::AppError;
use rusqlite::params;

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
