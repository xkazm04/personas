use rusqlite::{params, Row};

use crate::db::models::{
    row_to_lab_result_base, CreateArenaResultInput, LabArenaResult, LabArenaRun, LabRunStatus,
};
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mappers ------------------------------------------------

fn row_to_run(row: &Row) -> rusqlite::Result<LabArenaRun> {
    Ok(LabArenaRun {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        status: LabRunStatus::from_db(&row.get::<_, String>("status")?),
        version_id: row.get("version_id").unwrap_or(None),
        version_number: row.get("version_number").unwrap_or(None),
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
        version_id: row.get("version_id").unwrap_or(None),
        version_number: row.get("version_number").unwrap_or(None),
        base: row_to_lab_result_base(row)?,
    })
}

// -- Generated CRUD (get/update/delete for runs + results) ------

lab_crud! {
    run_table: "lab_arena_runs",
    result_table: "lab_arena_results",
    run_type: LabArenaRun,
    result_type: LabArenaResult,
    run_entity: "LabArenaRun",
    result_entity: "LabArenaResult",
    result_order: "scenario_name, model_id",
    run_mapper: row_to_run,
    result_mapper: row_to_result,
}

// -- Arena-specific functions -----------------------------------

#[allow(clippy::too_many_arguments)]
pub fn create_run(
    pool: &DbPool,
    persona_id: &str,
    models_tested: &str,
    use_case_filter: Option<&str>,
    version_id: Option<&str>,
    version_number: Option<i32>,
) -> Result<LabArenaRun, AppError> {
    timed_query!("lab_arena_runs", "lab_arena_runs::create_run", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO lab_arena_runs (id, persona_id, status, models_tested, use_case_filter, version_id, version_number, created_at)
             VALUES (?1, ?2, 'generating', ?3, ?4, ?5, ?6, ?7)",
            params![id, persona_id, models_tested, use_case_filter, version_id, version_number, now],
        )?;
        get_run_by_id(pool, &id)
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

pub fn create_result(
    pool: &DbPool,
    input: &CreateArenaResultInput,
) -> Result<LabArenaResult, AppError> {
    timed_query!("lab_arena_results", "lab_arena_results::create_result", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        let result = conn.query_row(
            // Tool calls now write only to the lab_tool_calls child table
            // (see write_tool_calls_child_rows below). The parent-table JSON
            // columns are dropped in step 7 of this ADR.
            "INSERT INTO lab_arena_results
                (id, run_id, version_id, version_number, scenario_name, model_id, provider, status,
                 output_preview,
                 tool_accuracy_score, output_quality_score, protocol_compliance,
                 input_tokens, output_tokens, cost_usd, duration_ms,
                 rationale, suggestions, error_message, eval_method, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
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
        .map_err(AppError::Database)?;
        super::write_tool_calls_child_rows(
            &conn,
            "arena",
            &result.id,
            input.base.tool_calls_expected.as_ref(),
            input.base.tool_calls_actual.as_ref(),
        );
        Ok(result)
    })
}
