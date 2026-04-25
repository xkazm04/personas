use rusqlite::params;

use crate::db::models::{CreateRatingInput, LabUserRating};
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mapper -------------------------------------------------

row_mapper!(row_to_rating -> LabUserRating {
    id, run_id, result_id, scenario_name, rating, feedback, created_at,
});

// -- CRUD -------------------------------------------------------

pub fn upsert_rating(pool: &DbPool, input: &CreateRatingInput) -> Result<LabUserRating, AppError> {
    timed_query!("lab_ratings", "lab_ratings::upsert_rating", {
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Single-statement upsert backed by the UNIQUE expression index
        // idx_lab_ratings_unique on (run_id, scenario_name, COALESCE(result_id, '')).
        // On conflict we preserve the original id and created_at; only rating/feedback move.
        conn.execute(
            "INSERT INTO lab_user_ratings (id, run_id, result_id, scenario_name, rating, feedback, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(run_id, scenario_name, COALESCE(result_id, ''))
             DO UPDATE SET rating = excluded.rating, feedback = excluded.feedback",
            params![id, input.run_id, input.result_id, input.scenario_name, input.rating, input.feedback, now],
        )?;

        let row = conn
            .prepare(
                "SELECT * FROM lab_user_ratings
                 WHERE run_id = ?1 AND scenario_name = ?2
                   AND COALESCE(result_id, '') = COALESCE(?3, '')",
            )?
            .query_row(
                params![input.run_id, input.scenario_name, input.result_id],
                row_to_rating,
            )?;
        Ok(row)
    })
}

pub fn get_ratings_for_run(pool: &DbPool, run_id: &str) -> Result<Vec<LabUserRating>, AppError> {
    timed_query!("lab_ratings", "lab_ratings::get_ratings_for_run", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM lab_user_ratings WHERE run_id = ?1 ORDER BY created_at DESC",
        )?;
        let ratings = stmt
            .query_map(params![run_id], row_to_rating)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ratings)
    })
}

pub fn delete_ratings_for_run(pool: &DbPool, run_id: &str) -> Result<bool, AppError> {
    timed_query!("lab_ratings", "lab_ratings::delete_ratings_for_run", {
        let conn = pool.get()?;
        let count = conn.execute(
            "DELETE FROM lab_user_ratings WHERE run_id = ?1",
            params![run_id],
        )?;
        Ok(count > 0)
    })
}
