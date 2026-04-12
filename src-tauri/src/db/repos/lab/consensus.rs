use rusqlite::{params, Row};

use crate::db::models::{CreateConsensusResultInput, LabConsensusResult, LabConsensusRun, LabRunStatus, row_to_lab_result_base};
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mappers ------------------------------------------------

fn row_to_run(row: &Row) -> rusqlite::Result<LabConsensusRun> {
    Ok(LabConsensusRun {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        status: LabRunStatus::from_db(&row.get::<_, String>("status")?),
        num_samples: row.get("num_samples")?,
        model_id: row.get("model_id")?,
        scenarios_count: row.get("scenarios_count")?,
        use_case_filter: row.get("use_case_filter")?,
        agreement_rate: row.get("agreement_rate")?,
        summary: row.get("summary")?,
        llm_summary: row.get("llm_summary").unwrap_or(None),
        progress_json: row.get("progress_json").unwrap_or(None),
        error: row.get("error")?,
        created_at: row.get("created_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn row_to_result(row: &Row) -> rusqlite::Result<LabConsensusResult> {
    Ok(LabConsensusResult {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        sample_index: row.get("sample_index")?,
        base: row_to_lab_result_base(row)?,
    })
}

// -- Generated CRUD (get/update/delete for runs + results) ------

lab_crud! {
    run_table: "lab_consensus_runs",
    result_table: "lab_consensus_results",
    run_type: LabConsensusRun,
    result_type: LabConsensusResult,
    run_entity: "LabConsensusRun",
    result_entity: "LabConsensusResult",
    result_order: "scenario_name, sample_index",
    run_mapper: row_to_run,
    result_mapper: row_to_result,
}

// -- Consensus-specific functions ---------------------------------

pub fn create_run(
    pool: &DbPool,
    persona_id: &str,
    num_samples: i32,
    model_id: &str,
    use_case_filter: Option<&str>,
) -> Result<LabConsensusRun, AppError> {
    timed_query!("lab_consensus_runs", "lab_consensus_runs::create_run", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO lab_consensus_runs (id, persona_id, status, num_samples, model_id, use_case_filter, created_at)
             VALUES (?1, ?2, 'generating', ?3, ?4, ?5, ?6)",
            params![id, persona_id, num_samples, model_id, use_case_filter, now],
        )?;
        get_run_by_id(pool, &id)
    })
}

pub fn update_agreement_rate(pool: &DbPool, id: &str, rate: f64) -> Result<(), AppError> {
    timed_query!("lab_consensus_runs", "lab_consensus_runs::update_agreement_rate", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE lab_consensus_runs SET agreement_rate = ?1 WHERE id = ?2",
            params![rate, id],
        )?;
        Ok(())
    })
}

pub fn update_llm_summary(pool: &DbPool, id: &str, llm_summary: &str) -> Result<(), AppError> {
    timed_query!("lab_consensus_runs", "lab_consensus_runs::update_llm_summary", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE lab_consensus_runs SET llm_summary = ?1 WHERE id = ?2",
            params![llm_summary, id],
        )?;
        Ok(())
    })
}

pub fn create_result(
    pool: &DbPool,
    input: &CreateConsensusResultInput,
) -> Result<LabConsensusResult, AppError> {
    timed_query!("lab_consensus_results", "lab_consensus_results::create_result", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        conn.query_row(
            "INSERT INTO lab_consensus_results
                (id, run_id, sample_index, scenario_name, model_id, provider, status,
                 output_preview, tool_calls_expected, tool_calls_actual,
                 tool_accuracy_score, output_quality_score, protocol_compliance,
                 input_tokens, output_tokens, cost_usd, duration_ms,
                 rationale, suggestions, error_message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
             RETURNING *",
            params![
                id,
                input.run_id,
                input.sample_index,
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
