use rusqlite::{params, Row};

use crate::db::models::{CreateEvalResultInput, LabEvalResult, LabEvalRun, LabRunStatus, row_to_lab_result_base};
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mappers ------------------------------------------------

fn row_to_run(row: &Row) -> rusqlite::Result<LabEvalRun> {
    Ok(LabEvalRun {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        status: LabRunStatus::from_db(&row.get::<_, String>("status")?),
        version_ids: row.get("version_ids")?,
        version_numbers: row.get("version_numbers")?,
        models_tested: row.get("models_tested")?,
        scenarios_count: row.get("scenarios_count")?,
        use_case_filter: row.get("use_case_filter")?,
        test_input: row.get("test_input")?,
        summary: row.get("summary")?,
        llm_summary: row.get("llm_summary").unwrap_or(None),
        progress_json: row.get("progress_json").unwrap_or(None),
        error: row.get("error")?,
        created_at: row.get("created_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn row_to_result(row: &Row) -> rusqlite::Result<LabEvalResult> {
    Ok(LabEvalResult {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        version_id: row.get("version_id")?,
        version_number: row.get("version_number")?,
        base: row_to_lab_result_base(row)?,
    })
}

// -- Generated CRUD (get/update/delete for runs + results) ------

lab_crud! {
    run_table: "lab_eval_runs",
    result_table: "lab_eval_results",
    run_type: LabEvalRun,
    result_type: LabEvalResult,
    run_entity: "LabEvalRun",
    result_entity: "LabEvalResult",
    result_order: "scenario_name, model_id, version_number",
    run_mapper: row_to_run,
    result_mapper: row_to_result,
}

// -- Eval-specific functions ------------------------------------

pub fn create_run(
    pool: &DbPool,
    persona_id: &str,
    version_ids: &str,
    version_numbers: &str,
    models_tested: &str,
    use_case_filter: Option<&str>,
    test_input: Option<&str>,
) -> Result<LabEvalRun, AppError> {
    timed_query!("lab_eval_runs", "lab_eval_runs::create_run", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO lab_eval_runs (id, persona_id, status, version_ids, version_numbers, models_tested, use_case_filter, test_input, created_at)
             VALUES (?1, ?2, 'generating', ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, persona_id, version_ids, version_numbers, models_tested, use_case_filter, test_input, now],
        )?;
        get_run_by_id(pool, &id)
    })
}

pub fn create_result(
    pool: &DbPool,
    input: &CreateEvalResultInput,
) -> Result<LabEvalResult, AppError> {
    timed_query!("lab_eval_results", "lab_eval_results::create_result", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.query_row(
            "INSERT INTO lab_eval_results
                (id, run_id, version_id, version_number, scenario_name, model_id, provider, status,
                 output_preview, tool_calls_expected, tool_calls_actual,
                 tool_accuracy_score, output_quality_score, protocol_compliance,
                 input_tokens, output_tokens, cost_usd, duration_ms,
                 rationale, suggestions, error_message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
             RETURNING *",
            params![
                id,
                input.run_id,
                input.version_id,
                input.version_number,
                input.base.scenario_name,
                input.base.model_id,
                input.base.provider,
                input.base.status,
                input.base.output_preview,
                input.base.tool_calls_expected,
                input.base.tool_calls_actual,
                input.base.tool_accuracy_score,
                input.base.output_quality_score,
                input.base.protocol_compliance,
                input.base.input_tokens,
                input.base.output_tokens,
                input.base.cost_usd,
                input.base.duration_ms,
                input.base.rationale,
                input.base.suggestions,
                input.base.error_message,
                now,
            ],
            row_to_result,
        )
        .map_err(AppError::Database)
    })
}
