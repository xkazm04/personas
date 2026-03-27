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

        conn.execute(
            "INSERT INTO lab_user_ratings (id, run_id, result_id, scenario_name, rating, feedback, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET rating = excluded.rating, feedback = excluded.feedback",
            params![id, input.run_id, input.result_id, input.scenario_name, input.rating, input.feedback, now],
        )?;

        // If there's already a rating for this run+scenario+result, replace it
        // First try to find existing
        let existing: Option<LabUserRating> = conn
            .prepare(
                "SELECT * FROM lab_user_ratings WHERE run_id = ?1 AND scenario_name = ?2 AND (result_id = ?3 OR (result_id IS NULL AND ?3 IS NULL)) ORDER BY created_at DESC LIMIT 1",
            )?
            .query_map(params![input.run_id, input.scenario_name, input.result_id], row_to_rating)?
            .filter_map(|r| r.ok())
            .next();

        // Delete duplicates if more than one rating for same run+scenario+result
        if let Some(existing_item) = &existing {
            conn.execute(
                "DELETE FROM lab_user_ratings WHERE run_id = ?1 AND scenario_name = ?2 AND (result_id = ?3 OR (result_id IS NULL AND ?3 IS NULL)) AND id != ?4",
                params![input.run_id, input.scenario_name, input.result_id, existing_item.id],
            )?;
        }

        // Return the latest
        if let Some(r) = existing {
            // Update the existing one instead
            conn.execute(
                "UPDATE lab_user_ratings SET rating = ?1, feedback = ?2 WHERE id = ?3",
                params![input.rating, input.feedback, r.id],
            )?;
            let updated = conn
                .prepare("SELECT * FROM lab_user_ratings WHERE id = ?1")?
                .query_row(params![r.id], row_to_rating)?;
            Ok(updated)
        } else {
            let created = conn
                .prepare("SELECT * FROM lab_user_ratings WHERE id = ?1")?
                .query_row(params![id], row_to_rating)?;
            Ok(created)
        }
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
