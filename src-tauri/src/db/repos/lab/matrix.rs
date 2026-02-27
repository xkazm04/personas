use rusqlite::{params, Row};

use crate::db::models::{CreateMatrixResultInput, LabMatrixResult, LabMatrixRun};
use crate::db::DbPool;
use crate::error::AppError;

// ── Row mappers ────────────────────────────────────────────────

fn row_to_run(row: &Row) -> rusqlite::Result<LabMatrixRun> {
    Ok(LabMatrixRun {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        status: row.get("status")?,
        user_instruction: row.get("user_instruction")?,
        draft_prompt_json: row.get("draft_prompt_json")?,
        draft_change_summary: row.get("draft_change_summary")?,
        models_tested: row.get("models_tested")?,
        scenarios_count: row.get("scenarios_count")?,
        use_case_filter: row.get("use_case_filter")?,
        summary: row.get("summary")?,
        error: row.get("error")?,
        draft_accepted: row.get::<_, i32>("draft_accepted")? != 0,
        created_at: row.get("created_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn row_to_result(row: &Row) -> rusqlite::Result<LabMatrixResult> {
    Ok(LabMatrixResult {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        variant: row.get("variant")?,
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
        error_message: row.get("error_message")?,
        created_at: row.get("created_at")?,
    })
}

// ── Matrix Runs ────────────────────────────────────────────────

pub fn create_run(
    pool: &DbPool,
    persona_id: &str,
    user_instruction: &str,
    models_tested: &str,
    use_case_filter: Option<&str>,
) -> Result<LabMatrixRun, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO lab_matrix_runs (id, persona_id, status, user_instruction, models_tested, use_case_filter, created_at)
         VALUES (?1, ?2, 'drafting', ?3, ?4, ?5, ?6)",
        params![id, persona_id, user_instruction, models_tested, use_case_filter, now],
    )?;
    get_run_by_id(pool, &id)
}

pub fn get_run_by_id(pool: &DbPool, id: &str) -> Result<LabMatrixRun, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM lab_matrix_runs WHERE id = ?1",
        params![id],
        row_to_run,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("LabMatrixRun {id}")),
        other => AppError::Database(other),
    })
}

pub fn get_runs_by_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<LabMatrixRun>, AppError> {
    let limit = limit.unwrap_or(20);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM lab_matrix_runs WHERE persona_id = ?1
         ORDER BY created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![persona_id, limit], row_to_run)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn update_run_status(
    pool: &DbPool,
    id: &str,
    status: &str,
    scenarios_count: Option<i32>,
    summary: Option<&str>,
    error: Option<&str>,
    completed_at: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE lab_matrix_runs SET
            status = ?1,
            scenarios_count = COALESCE(?2, scenarios_count),
            summary = COALESCE(?3, summary),
            error = COALESCE(?4, error),
            completed_at = COALESCE(?5, completed_at)
         WHERE id = ?6",
        params![status, scenarios_count, summary, error, completed_at, id],
    )?;
    Ok(())
}

pub fn update_run_draft(
    pool: &DbPool,
    id: &str,
    draft_prompt_json: &str,
    draft_change_summary: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE lab_matrix_runs SET draft_prompt_json = ?1, draft_change_summary = ?2 WHERE id = ?3",
        params![draft_prompt_json, draft_change_summary, id],
    )?;
    Ok(())
}

pub fn accept_draft(pool: &DbPool, id: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE lab_matrix_runs SET draft_accepted = 1 WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn delete_run(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM lab_matrix_runs WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ── Matrix Results ─────────────────────────────────────────────

pub fn create_result(
    pool: &DbPool,
    input: &CreateMatrixResultInput,
) -> Result<LabMatrixResult, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO lab_matrix_results
            (id, run_id, variant, scenario_name, model_id, provider, status,
             output_preview, tool_calls_expected, tool_calls_actual,
             tool_accuracy_score, output_quality_score, protocol_compliance,
             input_tokens, output_tokens, cost_usd, duration_ms,
             error_message, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        params![
            id,
            input.run_id,
            input.variant,
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
            input.error_message,
            now,
        ],
    )?;
    get_result_by_id(pool, &id)
}

pub fn get_result_by_id(pool: &DbPool, id: &str) -> Result<LabMatrixResult, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM lab_matrix_results WHERE id = ?1",
        params![id],
        row_to_result,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("LabMatrixResult {id}")),
        other => AppError::Database(other),
    })
}

pub fn get_results_by_run(
    pool: &DbPool,
    run_id: &str,
) -> Result<Vec<LabMatrixResult>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM lab_matrix_results WHERE run_id = ?1
         ORDER BY variant, scenario_name, model_id",
    )?;
    let rows = stmt.query_map(params![run_id], row_to_result)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}
