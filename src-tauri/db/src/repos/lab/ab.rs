use rusqlite::{params, Row};

use crate::models::{
    row_to_lab_result_base, CreateAbResultInput, LabAbExperiment, LabAbResult, LabAbRun,
    LabRunStatus,
};
use crate::DbPool;
use personas_core::error::AppError;

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

pub fn update_llm_summary(pool: &DbPool, id: &str, llm_summary: &str) -> Result<(), AppError> {
    timed_query!("lab_ab_runs", "lab_ab_runs::update_llm_summary", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE lab_ab_runs SET llm_summary = ?1 WHERE id = ?2",
            params![llm_summary, id],
        )?;
        Ok(())
    })
}

pub fn create_result(pool: &DbPool, input: &CreateAbResultInput) -> Result<LabAbResult, AppError> {
    timed_query!("lab_ab_results", "lab_ab_results::create_result", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let conn = pool.get()?;
        let result = conn.query_row(
            // Tool calls now write only to the lab_tool_calls child table
            // (see write_tool_calls_child_rows below). The parent-table JSON
            // columns are dropped in step 7 of this ADR.
            "INSERT INTO lab_ab_results
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
            "ab",
            &result.id,
            input.base.tool_calls_expected.as_ref(),
            input.base.tool_calls_actual.as_ref(),
        );
        Ok(result)
    })
}

// -- Director-commissioned experiments (lab_ab_experiments) -----
//
// Batch-3 Director's Lab v1: an approved coaching verdict with a typed
// hypothesis compiles into one of these rows. Provenance-first (review_id +
// provenance_json), honest states (awaiting_variant / declined_budget are
// first-class, not errors swallowed).

fn row_to_experiment(row: &Row) -> rusqlite::Result<LabAbExperiment> {
    Ok(LabAbExperiment {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        review_id: row.get("review_id")?,
        hypothesis_json: row.get("hypothesis_json")?,
        provenance_json: row.get("provenance_json")?,
        status: row.get("status")?,
        status_detail: row.get("status_detail")?,
        variant_prompt: row.get("variant_prompt")?,
        variant_source: row.get("variant_source")?,
        spend_usd: row.get("spend_usd")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Input for registering a Director experiment. `status` must be one of the
/// vocabulary the table CHECK enforces.
#[derive(Debug, Clone)]
pub struct CreateExperimentInput {
    pub persona_id: String,
    pub review_id: Option<String>,
    pub hypothesis_json: String,
    pub provenance_json: Option<String>,
    pub status: String,
    pub status_detail: Option<String>,
    pub variant_prompt: Option<String>,
    pub variant_source: Option<String>,
    pub spend_usd: f64,
}

pub fn create_experiment(
    pool: &DbPool,
    input: &CreateExperimentInput,
) -> Result<LabAbExperiment, AppError> {
    timed_query!("lab_ab_experiments", "lab_ab_experiments::create_experiment", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.query_row(
            "INSERT INTO lab_ab_experiments
                (id, persona_id, review_id, hypothesis_json, provenance_json,
                 status, status_detail, variant_prompt, variant_source, spend_usd,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
             RETURNING *",
            params![
                id,
                input.persona_id,
                input.review_id,
                input.hypothesis_json,
                input.provenance_json,
                input.status,
                input.status_detail,
                input.variant_prompt,
                input.variant_source,
                input.spend_usd,
                now,
            ],
            row_to_experiment,
        )
        .map_err(AppError::Database)
    })
}

/// Re-resolve an experiment (e.g. a `declined_budget` row retried once the
/// ledger refills, or an `awaiting_variant` row once a variant materializes).
pub fn update_experiment_outcome(
    pool: &DbPool,
    id: &str,
    status: &str,
    status_detail: Option<&str>,
    variant_prompt: Option<&str>,
    variant_source: Option<&str>,
    spend_usd: f64,
) -> Result<LabAbExperiment, AppError> {
    timed_query!("lab_ab_experiments", "lab_ab_experiments::update_experiment_outcome", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.query_row(
            "UPDATE lab_ab_experiments
                SET status = ?2, status_detail = ?3, variant_prompt = ?4,
                    variant_source = ?5, spend_usd = ?6, updated_at = ?7
              WHERE id = ?1
              RETURNING *",
            params![id, status, status_detail, variant_prompt, variant_source, spend_usd, now],
            row_to_experiment,
        )
        .map_err(AppError::Database)
    })
}

/// The experiment commissioned from a given Director verdict, if any (the
/// unique partial index makes review_id one-to-one).
pub fn get_experiment_by_review(
    pool: &DbPool,
    review_id: &str,
) -> Result<Option<LabAbExperiment>, AppError> {
    timed_query!("lab_ab_experiments", "lab_ab_experiments::get_experiment_by_review", {
        let conn = pool.get()?;
        match conn.query_row(
            "SELECT * FROM lab_ab_experiments WHERE review_id = ?1",
            params![review_id],
            row_to_experiment,
        ) {
            Ok(e) => Ok(Some(e)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    })
}

/// Newest-first experiment list, optionally scoped to one persona.
pub fn list_experiments(
    pool: &DbPool,
    persona_id: Option<&str>,
    limit: i64,
) -> Result<Vec<LabAbExperiment>, AppError> {
    timed_query!("lab_ab_experiments", "lab_ab_experiments::list_experiments", {
        let conn = pool.get()?;
        let limit = limit.clamp(1, 500);
        let rows: Vec<LabAbExperiment> = match persona_id {
            Some(pid) => {
                let mut stmt = conn.prepare(
                    "SELECT * FROM lab_ab_experiments WHERE persona_id = ?1
                     ORDER BY created_at DESC LIMIT ?2",
                )?;
                let mapped = stmt.query_map(params![pid, limit], row_to_experiment)?;
                mapped.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?
            }
            None => {
                let mut stmt = conn.prepare(
                    "SELECT * FROM lab_ab_experiments
                     ORDER BY created_at DESC LIMIT ?1",
                )?;
                let mapped = stmt.query_map(params![limit], row_to_experiment)?;
                mapped.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)?
            }
        };
        Ok(rows)
    })
}

/// `(status, count)` pairs across all experiments — the campaign report's
/// headline numbers. Statuses with zero rows are absent (caller defaults 0).
pub fn experiment_status_counts(pool: &DbPool) -> Result<Vec<(String, i64)>, AppError> {
    timed_query!("lab_ab_experiments", "lab_ab_experiments::experiment_status_counts", {
        let conn = pool.get()?;
        let mut stmt =
            conn.prepare("SELECT status, COUNT(*) FROM lab_ab_experiments GROUP BY status")?;
        let mapped = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        mapped.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}
