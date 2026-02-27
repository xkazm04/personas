use rusqlite::{params, Row};

use crate::db::models::{CreateAbResultInput, LabAbResult, LabAbRun};
use crate::db::DbPool;
use crate::error::AppError;

// ── Row mappers ────────────────────────────────────────────────

fn row_to_run(row: &Row) -> rusqlite::Result<LabAbRun> {
    Ok(LabAbRun {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        status: row.get("status")?,
        version_a_id: row.get("version_a_id")?,
        version_b_id: row.get("version_b_id")?,
        version_a_num: row.get("version_a_num")?,
        version_b_num: row.get("version_b_num")?,
        models_tested: row.get("models_tested")?,
        scenarios_count: row.get("scenarios_count")?,
        use_case_filter: row.get("use_case_filter")?,
        test_input: row.get("test_input")?,
        summary: row.get("summary")?,
        error: row.get("error")?,
        created_at: row.get("created_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn row_to_result(row: &Row) -> rusqlite::Result<LabAbResult> {
    Ok(LabAbResult {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        version_id: row.get("version_id")?,
        version_number: row.get("version_number")?,
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

// ── A/B Runs ───────────────────────────────────────────────────

pub fn create_run(
    pool: &DbPool,
    persona_id: &str,
    version_a_id: &str,
    version_b_id: &str,
    version_a_num: i32,
    version_b_num: i32,
    models_tested: &str,
    use_case_filter: Option<&str>,
    test_input: Option<&str>,
) -> Result<LabAbRun, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO lab_ab_runs (id, persona_id, status, version_a_id, version_b_id, version_a_num, version_b_num, models_tested, use_case_filter, test_input, created_at)
         VALUES (?1, ?2, 'generating', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, persona_id, version_a_id, version_b_id, version_a_num, version_b_num, models_tested, use_case_filter, test_input, now],
    )?;
    get_run_by_id(pool, &id)
}

pub fn get_run_by_id(pool: &DbPool, id: &str) -> Result<LabAbRun, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM lab_ab_runs WHERE id = ?1",
        params![id],
        row_to_run,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("LabAbRun {id}")),
        other => AppError::Database(other),
    })
}

pub fn get_runs_by_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<LabAbRun>, AppError> {
    let limit = limit.unwrap_or(20);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM lab_ab_runs WHERE persona_id = ?1
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
        "UPDATE lab_ab_runs SET
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

pub fn delete_run(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM lab_ab_runs WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ── A/B Results ────────────────────────────────────────────────

pub fn create_result(
    pool: &DbPool,
    input: &CreateAbResultInput,
) -> Result<LabAbResult, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO lab_ab_results
            (id, run_id, version_id, version_number, scenario_name, model_id, provider, status,
             output_preview, tool_calls_expected, tool_calls_actual,
             tool_accuracy_score, output_quality_score, protocol_compliance,
             input_tokens, output_tokens, cost_usd, duration_ms,
             error_message, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
        params![
            id,
            input.run_id,
            input.version_id,
            input.version_number,
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

pub fn get_result_by_id(pool: &DbPool, id: &str) -> Result<LabAbResult, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM lab_ab_results WHERE id = ?1",
        params![id],
        row_to_result,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("LabAbResult {id}")),
        other => AppError::Database(other),
    })
}

pub fn get_results_by_run(
    pool: &DbPool,
    run_id: &str,
) -> Result<Vec<LabAbResult>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM lab_ab_results WHERE run_id = ?1
         ORDER BY scenario_name, model_id, version_number",
    )?;
    let rows = stmt.query_map(params![run_id], row_to_result)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}
