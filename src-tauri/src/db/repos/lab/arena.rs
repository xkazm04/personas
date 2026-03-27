use rusqlite::{params, Row};

use crate::db::models::{CreateArenaResultInput, LabArenaResult, LabArenaRun, LabRunStatus};
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mappers ------------------------------------------------

fn row_to_run(row: &Row) -> rusqlite::Result<LabArenaRun> {
    Ok(LabArenaRun {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        status: LabRunStatus::from_db(&row.get::<_, String>("status")?),
        models_tested: row.get("models_tested")?,
        scenarios_count: row.get("scenarios_count")?,
        use_case_filter: row.get("use_case_filter")?,
        summary: row.get("summary")?,
        llm_summary: row.get("llm_summary").unwrap_or(None),
        progress_json: row.get("progress_json").unwrap_or(None),
        error: row.get("error")?,
        created_at: row.get("created_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn row_to_result(row: &Row) -> rusqlite::Result<LabArenaResult> {
    Ok(LabArenaResult {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        scenario_name: row.get("scenario_name")?,
        model_id: row.get("model_id")?,
        provider: row.get("provider")?,
        status: row.get("status")?,
        output_preview: row.get("output_preview")?,
        tool_calls_expected: row.get("tool_calls_expected")?,
        tool_calls_actual: row.get("tool_calls_actual")?,
        tool_accuracy_score: row.get("tool_accuracy_score")?,
        output_quality_score: row.get("output_quality_score")?,
        protocol_compliance: row.get("protocol_compliance")?,
        input_tokens: row.get::<_, Option<i64>>("input_tokens")?.unwrap_or(0),
        output_tokens: row.get::<_, Option<i64>>("output_tokens")?.unwrap_or(0),
        cost_usd: row.get::<_, Option<f64>>("cost_usd")?.unwrap_or(0.0),
        duration_ms: row.get::<_, Option<i64>>("duration_ms")?.unwrap_or(0),
        rationale: row.get("rationale")?,
        suggestions: row.get("suggestions")?,
        error_message: row.get("error_message")?,
        created_at: row.get("created_at")?,
    })
}

// -- Arena Runs -------------------------------------------------

pub fn create_run(
    pool: &DbPool,
    persona_id: &str,
    models_tested: &str,
    use_case_filter: Option<&str>,
) -> Result<LabArenaRun, AppError> {
    timed_query!("lab_arena_runs", "lab_arena_runs::create_run", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO lab_arena_runs (id, persona_id, status, models_tested, use_case_filter, created_at)
             VALUES (?1, ?2, 'generating', ?3, ?4, ?5)",
            params![id, persona_id, models_tested, use_case_filter, now],
        )?;
        get_run_by_id(pool, &id)
    })
}

pub fn get_run_by_id(pool: &DbPool, id: &str) -> Result<LabArenaRun, AppError> {
    timed_query!("lab_arena_runs", "lab_arena_runs::get_run_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM lab_arena_runs WHERE id = ?1",
            params![id],
            row_to_run,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("LabArenaRun {id}")),
            other => AppError::Database(other),
        })
    })
}

pub fn get_runs_by_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<LabArenaRun>, AppError> {
    timed_query!("lab_arena_runs", "lab_arena_runs::get_runs_by_persona", {
        let limit = limit.unwrap_or(20);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM lab_arena_runs WHERE persona_id = ?1
             ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![persona_id, limit], row_to_run)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn update_run_status(
    pool: &DbPool,
    id: &str,
    status: LabRunStatus,
    scenarios_count: Option<i32>,
    summary: Option<&str>,
    error: Option<&str>,
    completed_at: Option<&str>,
) -> Result<(), AppError> {
    timed_query!("lab_arena_runs", "lab_arena_runs::update_run_status", {
        let conn = pool.get()?;
        let current: String = conn
            .query_row(
                "SELECT status FROM lab_arena_runs WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("LabArenaRun {id}")),
                other => AppError::Database(other),
            })?;
        let current_status = LabRunStatus::from_db(&current);
        current_status
            .validate_transition(status)
            .map_err(AppError::Validation)?;
        conn.execute(
            "UPDATE lab_arena_runs SET
                status = ?1,
                scenarios_count = COALESCE(?2, scenarios_count),
                summary = COALESCE(?3, summary),
                error = COALESCE(?4, error),
                completed_at = COALESCE(?5, completed_at)
             WHERE id = ?6",
            params![status.as_str(), scenarios_count, summary, error, completed_at, id],
        )?;
        Ok(())
    })
}

pub fn update_llm_summary(pool: &DbPool, id: &str, llm_summary: &str) -> Result<(), AppError> {
    timed_query!("lab_arena_runs", "lab_arena_runs::update_llm_summary", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE lab_arena_runs SET llm_summary = ?1 WHERE id = ?2",
            params![llm_summary, id],
        )?;
        Ok(())
    })
}

pub fn update_progress(pool: &DbPool, run_id: &str, progress_json: &str) -> Result<(), AppError> {
    timed_query!("lab_arena_runs", "lab_arena_runs::update_progress", {
        let conn = pool.get().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "UPDATE lab_arena_runs SET progress_json = ?1 WHERE id = ?2",
            rusqlite::params![progress_json, run_id],
        ).map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    })
}

pub fn delete_run(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("lab_arena_runs", "lab_arena_runs::delete_run", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM lab_arena_runs WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

// -- Arena Results ----------------------------------------------

pub fn create_result(
    pool: &DbPool,
    input: &CreateArenaResultInput,
) -> Result<LabArenaResult, AppError> {
    timed_query!("lab_arena_results", "lab_arena_results::create_result", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.query_row(
            "INSERT INTO lab_arena_results
                (id, run_id, scenario_name, model_id, provider, status,
                 output_preview, tool_calls_expected, tool_calls_actual,
                 tool_accuracy_score, output_quality_score, protocol_compliance,
                 input_tokens, output_tokens, cost_usd, duration_ms,
                 rationale, suggestions, error_message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
             RETURNING *",
            params![
                id,
                input.run_id,
                input.scenario_name,
                input.model_id,
                input.provider,
                input.status,
                input.output_preview,
                input.tool_calls_expected,
                input.tool_calls_actual,
                input.tool_accuracy_score,
                input.output_quality_score,
                input.protocol_compliance,
                input.input_tokens,
                input.output_tokens,
                input.cost_usd,
                input.duration_ms,
                input.rationale,
                input.suggestions,
                input.error_message,
                now,
            ],
            row_to_result,
        )
        .map_err(AppError::Database)
    })
}

pub fn get_result_by_id(pool: &DbPool, id: &str) -> Result<LabArenaResult, AppError> {
    timed_query!("lab_arena_results", "lab_arena_results::get_result_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM lab_arena_results WHERE id = ?1",
            params![id],
            row_to_result,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("LabArenaResult {id}")),
            other => AppError::Database(other),
        })
    })
}

pub fn get_results_by_run(
    pool: &DbPool,
    run_id: &str,
) -> Result<Vec<LabArenaResult>, AppError> {
    timed_query!("lab_arena_results", "lab_arena_results::get_results_by_run", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM lab_arena_results WHERE run_id = ?1
             ORDER BY scenario_name, model_id",
        )?;
        let rows = stmt.query_map(params![run_id], row_to_result)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}
