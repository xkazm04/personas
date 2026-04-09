use rusqlite::{params, Row};

use crate::db::models::{CreateMatrixResultInput, LabMatrixResult, LabMatrixRun, LabRunStatus, row_to_lab_result_base};
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mappers ------------------------------------------------

fn row_to_run(row: &Row) -> rusqlite::Result<LabMatrixRun> {
    Ok(LabMatrixRun {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        status: LabRunStatus::from_db(&row.get::<_, String>("status")?),
        user_instruction: row.get("user_instruction")?,
        draft_prompt_json: row.get("draft_prompt_json")?,
        draft_change_summary: row.get("draft_change_summary")?,
        models_tested: row.get("models_tested")?,
        scenarios_count: row.get("scenarios_count")?,
        use_case_filter: row.get("use_case_filter")?,
        summary: row.get("summary")?,
        llm_summary: row.get("llm_summary").unwrap_or(None),
        progress_json: row.get("progress_json").unwrap_or(None),
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
        base: row_to_lab_result_base(row)?,
    })
}

// -- Generated CRUD (get/update/delete for runs + results) ------

lab_crud! {
    run_table: "lab_matrix_runs",
    result_table: "lab_matrix_results",
    run_type: LabMatrixRun,
    result_type: LabMatrixResult,
    run_entity: "LabMatrixRun",
    result_entity: "LabMatrixResult",
    result_order: "variant, scenario_name, model_id",
    run_mapper: row_to_run,
    result_mapper: row_to_result,
}

// -- Matrix-specific functions ----------------------------------

pub fn create_run(
    pool: &DbPool,
    persona_id: &str,
    user_instruction: &str,
    models_tested: &str,
    use_case_filter: Option<&str>,
) -> Result<LabMatrixRun, AppError> {
    timed_query!("lab_matrix_runs", "lab_matrix_runs::create_run", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO lab_matrix_runs (id, persona_id, status, user_instruction, models_tested, use_case_filter, created_at)
             VALUES (?1, ?2, 'drafting', ?3, ?4, ?5, ?6)",
            params![id, persona_id, user_instruction, models_tested, use_case_filter, now],
        )?;
        get_run_by_id(pool, &id)
    })
}

pub fn update_run_draft(
    pool: &DbPool,
    id: &str,
    draft_prompt_json: &str,
    draft_change_summary: &str,
) -> Result<(), AppError> {
    timed_query!("lab_matrix_runs", "lab_matrix_runs::update_run_draft", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE lab_matrix_runs SET draft_prompt_json = ?1, draft_change_summary = ?2 WHERE id = ?3",
            params![draft_prompt_json, draft_change_summary, id],
        )?;
        Ok(())
    })
}

pub fn accept_draft(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("lab_matrix_runs", "lab_matrix_runs::accept_draft", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE lab_matrix_runs SET draft_accepted = 1 WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    })
}

pub fn update_llm_summary(pool: &DbPool, id: &str, llm_summary: &str) -> Result<(), AppError> {
    timed_query!("lab_matrix_runs", "lab_matrix_runs::update_llm_summary", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE lab_matrix_runs SET llm_summary = ?1 WHERE id = ?2",
            params![llm_summary, id],
        )?;
        Ok(())
    })
}

pub fn create_result(
    pool: &DbPool,
    input: &CreateMatrixResultInput,
) -> Result<LabMatrixResult, AppError> {
    timed_query!("lab_matrix_runs", "lab_matrix_runs::create_result", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.query_row(
            "INSERT INTO lab_matrix_results
                (id, run_id, variant, scenario_name, model_id, provider, status,
                 output_preview, tool_calls_expected, tool_calls_actual,
                 tool_accuracy_score, output_quality_score, protocol_compliance,
                 input_tokens, output_tokens, cost_usd, duration_ms,
                 rationale, suggestions, error_message, eval_method, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
             RETURNING *",
            params![
                id,
                input.run_id,
                input.variant,
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
                input.base.eval_method,
                now,
            ],
            row_to_result,
        )
        .map_err(AppError::Database)
    })
}
