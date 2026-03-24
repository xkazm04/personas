use rusqlite::params;

use crate::db::models::{
    CreateBreedingResultInput, CreateBreedingRunInput, GenomeBreedingResult, GenomeBreedingRun,
    LabRunStatus,
};
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mappers ------------------------------------------------

// row_to_run uses LabRunStatus::from_db() -- keep manual
fn row_to_run(row: &rusqlite::Row) -> rusqlite::Result<GenomeBreedingRun> {
    Ok(GenomeBreedingRun {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        status: LabRunStatus::from_db(&row.get::<_, String>("status")?),
        parent_ids: row.get("parent_ids")?,
        fitness_objective: row.get("fitness_objective")?,
        mutation_rate: row.get("mutation_rate")?,
        generations: row.get("generations")?,
        offspring_count: row.get("offspring_count")?,
        summary: row.get("summary")?,
        error: row.get("error")?,
        created_at: row.get("created_at")?,
        completed_at: row.get("completed_at")?,
    })
}

row_mapper!(row_to_result -> GenomeBreedingResult {
    id, run_id, genome_json, parent_ids,
    generation, fitness_json, fitness_overall,
    adopted [bool], adopted_persona_id, created_at,
});

// -- Breeding Runs -------------------------------------------------

pub fn create_run(
    pool: &DbPool,
    input: &CreateBreedingRunInput,
) -> Result<GenomeBreedingRun, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let parent_ids_json = serde_json::to_string(&input.parent_ids).unwrap_or_default();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO genome_breeding_runs
            (id, project_id, status, parent_ids, fitness_objective, mutation_rate, generations, created_at)
         VALUES (?1, ?2, 'generating', ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            input.project_id,
            parent_ids_json,
            input.fitness_objective,
            input.mutation_rate,
            input.generations,
            now,
        ],
    )?;
    get_run_by_id(pool, &id)
}

pub fn get_run_by_id(pool: &DbPool, id: &str) -> Result<GenomeBreedingRun, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM genome_breeding_runs WHERE id = ?1",
        params![id],
        row_to_run,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("GenomeBreedingRun {id}"))
        }
        other => AppError::Database(other),
    })
}

pub fn get_runs_by_project(
    pool: &DbPool,
    project_id: &str,
    limit: Option<i64>,
) -> Result<Vec<GenomeBreedingRun>, AppError> {
    let limit = limit.unwrap_or(20);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM genome_breeding_runs WHERE project_id = ?1
         ORDER BY created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![project_id, limit], row_to_run)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn update_run_status(
    pool: &DbPool,
    id: &str,
    status: LabRunStatus,
    offspring_count: Option<i32>,
    summary: Option<&str>,
    error: Option<&str>,
    completed_at: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let current: String = conn
        .query_row(
            "SELECT status FROM genome_breeding_runs WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("GenomeBreedingRun {id}"))
            }
            other => AppError::Database(other),
        })?;
    let current_status = LabRunStatus::from_db(&current);
    current_status
        .validate_transition(status)
        .map_err(AppError::Validation)?;
    conn.execute(
        "UPDATE genome_breeding_runs SET
            status = ?1,
            offspring_count = COALESCE(?2, offspring_count),
            summary = COALESCE(?3, summary),
            error = COALESCE(?4, error),
            completed_at = COALESCE(?5, completed_at)
         WHERE id = ?6",
        params![
            status.as_str(),
            offspring_count,
            summary,
            error,
            completed_at,
            id,
        ],
    )?;
    Ok(())
}

pub fn delete_run(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM genome_breeding_runs WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

// -- Breeding Results ------------------------------------------

pub fn create_result(
    pool: &DbPool,
    input: &CreateBreedingResultInput,
) -> Result<GenomeBreedingResult, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.query_row(
        "INSERT INTO genome_breeding_results
            (id, run_id, genome_json, parent_ids, generation,
             fitness_json, fitness_overall, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         RETURNING *",
        params![
            id,
            input.run_id,
            input.genome_json,
            input.parent_ids,
            input.generation,
            input.fitness_json,
            input.fitness_overall,
            now,
        ],
        row_to_result,
    )
    .map_err(AppError::Database)
}

pub fn get_results_by_run(
    pool: &DbPool,
    run_id: &str,
) -> Result<Vec<GenomeBreedingResult>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM genome_breeding_results WHERE run_id = ?1
         ORDER BY fitness_overall DESC NULLS LAST, generation, created_at",
    )?;
    let rows = stmt.query_map(params![run_id], row_to_result)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn mark_adopted(
    pool: &DbPool,
    result_id: &str,
    persona_id: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE genome_breeding_results SET adopted = 1, adopted_persona_id = ?1 WHERE id = ?2",
        params![persona_id, result_id],
    )?;
    Ok(())
}
