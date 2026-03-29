use rusqlite::{params, Row};

use crate::db::models::{CreateAbResultInput, LabAbResult, LabAbRun, LabRunStatus, row_to_lab_result_base};
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mappers ------------------------------------------------

fn row_to_run(row: &Row) -> rusqlite::Result<LabAbRun> {
    Ok(LabAbRun {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        status: LabRunStatus::from_db(&row.get::<_, String>("status")?),
        version_a_id: row.get("version_a_id")?,
        version_b_id: row.get("version_b_id")?,
        version_a_num: row.get("version_a_num")?,
        version_b_num: row.get("version_b_num")?,
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

fn row_to_result(row: &Row) -> rusqlite::Result<LabAbResult> {
    Ok(LabAbResult {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        version_id: row.get("version_id")?,
        version_number: row.get("version_number")?,
        base: row_to_lab_result_base(row)?,
    })
}

// -- Generated CRUD (get/update/delete for runs + results) ------

lab_crud! {
    run_table: "lab_ab_runs",
    result_table: "lab_ab_results",
    run_type: LabAbRun,
    result_type: LabAbResult,
    run_entity: "LabAbRun",
    result_entity: "LabAbResult",
    result_order: "scenario_name, model_id, version_number",
    run_mapper: row_to_run,
    result_mapper: row_to_result,
}

// -- A/B-specific functions -------------------------------------

#[allow(clippy::too_many_arguments)]
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
    timed_query!("lab_ab_runs", "lab_ab_runs::create_run", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO lab_ab_runs (id, persona_id, status, version_a_id, version_b_id, version_a_num, version_b_num, models_tested, use_case_filter, test_input, created_at)
             VALUES (?1, ?2, 'generating', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![id, persona_id, version_a_id, version_b_id, version_a_num, version_b_num, models_tested, use_case_filter, test_input, now],
        )?;
        get_run_by_id(pool, &id)
    })
}

pub fn create_result(
    pool: &DbPool,
    input: &CreateAbResultInput,
) -> Result<LabAbResult, AppError> {
    timed_query!("lab_ab_results", "lab_ab_results::create_result", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.query_row(
            "INSERT INTO lab_ab_results
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
