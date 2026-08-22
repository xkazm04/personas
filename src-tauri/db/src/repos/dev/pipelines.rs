use crate::models::DevPipeline;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};

// ============================================================================
// Pipelines (Idea-to-Execution)
// ============================================================================

fn row_to_pipeline(row: &Row) -> rusqlite::Result<DevPipeline> {
    Ok(DevPipeline {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        idea_id: row.get("idea_id")?,
        task_id: row.get("task_id")?,
        stage: row.get("stage")?,
        auto_execute: row.get::<_, i32>("auto_execute")? != 0,
        verify_after: row.get::<_, i32>("verify_after")? != 0,
        verification_scan_id: row.get("verification_scan_id")?,
        error: row.get("error")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn create_pipeline(
    pool: &DbPool,
    project_id: &str,
    idea_id: &str,
    auto_execute: bool,
    verify_after: bool,
) -> Result<DevPipeline, AppError> {
    timed_query!("dev_pipelines", "dev_pipelines::create_pipeline", {
        let conn = pool.get()?;
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO dev_pipelines (id, project_id, idea_id, stage, auto_execute, verify_after)
             VALUES (?1, ?2, ?3, 'triaged', ?4, ?5)",
            params![
                id,
                project_id,
                idea_id,
                auto_execute as i32,
                verify_after as i32
            ],
        )?;
        get_pipeline_by_id(pool, &id)
    })
}

pub fn get_pipeline_by_id(pool: &DbPool, id: &str) -> Result<DevPipeline, AppError> {
    timed_query!("dev_pipelines", "dev_pipelines::get_pipeline_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_pipelines WHERE id = ?1",
            params![id],
            row_to_pipeline,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Pipeline not found: {id}"))
            }
            other => AppError::from(other),
        })
    })
}

pub fn list_pipelines(
    pool: &DbPool,
    project_id: &str,
    stage: Option<&str>,
) -> Result<Vec<DevPipeline>, AppError> {
    timed_query!("dev_pipelines", "dev_pipelines::list_pipelines", {
        let conn = pool.get()?;
        if let Some(s) = stage {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_pipelines WHERE project_id = ?1 AND stage = ?2 ORDER BY created_at DESC"
            )?;
            let rows = stmt.query_map(params![project_id, s], row_to_pipeline)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        } else {
            let mut stmt = conn.prepare(
                "SELECT * FROM dev_pipelines WHERE project_id = ?1 ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map(params![project_id], row_to_pipeline)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        }
    })
}

pub fn advance_pipeline_stage(
    pool: &DbPool,
    id: &str,
    new_stage: &str,
    task_id: Option<&str>,
    error: Option<&str>,
) -> Result<DevPipeline, AppError> {
    timed_query!("dev_pipelines", "dev_pipelines::advance_pipeline_stage", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_pipelines SET stage = ?2, task_id = COALESCE(?3, task_id), error = ?4, updated_at = datetime('now') WHERE id = ?1",
            params![id, new_stage, task_id, error],
        )?;
        get_pipeline_by_id(pool, id)
    })
}

pub fn delete_pipeline(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_pipelines", "dev_pipelines::delete_pipeline", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_pipelines WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}
