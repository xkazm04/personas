use rusqlite::{params, Row};

use crate::db::models::{CreateTestResultInput, PersonaTestResult, PersonaTestRun};
use crate::db::DbPool;
use crate::error::AppError;

// ── Row mappers ────────────────────────────────────────────────

fn row_to_run(row: &Row) -> rusqlite::Result<PersonaTestRun> {
    Ok(PersonaTestRun {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        status: row.get("status")?,
        models_tested: row.get("models_tested")?,
        scenarios_count: row.get("scenarios_count")?,
        summary: row.get("summary")?,
        error: row.get("error")?,
        created_at: row.get("created_at")?,
        completed_at: row.get("completed_at")?,
    })
}

fn row_to_result(row: &Row) -> rusqlite::Result<PersonaTestResult> {
    Ok(PersonaTestResult {
        id: row.get("id")?,
        test_run_id: row.get("test_run_id")?,
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

// ── Test Runs ──────────────────────────────────────────────────

pub fn create_run(
    pool: &DbPool,
    persona_id: &str,
    models_tested: &str,
) -> Result<PersonaTestRun, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_test_runs (id, persona_id, status, models_tested, created_at)
         VALUES (?1, ?2, 'generating', ?3, ?4)",
        params![id, persona_id, models_tested, now],
    )?;
    get_run_by_id(pool, &id)
}

pub fn get_run_by_id(pool: &DbPool, id: &str) -> Result<PersonaTestRun, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_test_runs WHERE id = ?1",
        params![id],
        row_to_run,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("TestRun {id}")),
        other => AppError::Database(other),
    })
}

pub fn get_runs_by_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaTestRun>, AppError> {
    let limit = limit.unwrap_or(20);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_test_runs WHERE persona_id = ?1
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
        "UPDATE persona_test_runs SET
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
    let rows = conn.execute("DELETE FROM persona_test_runs WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ── Test Results ───────────────────────────────────────────────

pub fn create_result(
    pool: &DbPool,
    input: &CreateTestResultInput,
) -> Result<PersonaTestResult, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO persona_test_results
            (id, test_run_id, scenario_name, model_id, provider, status,
             output_preview, tool_calls_expected, tool_calls_actual,
             tool_accuracy_score, output_quality_score, protocol_compliance,
             input_tokens, output_tokens, cost_usd, duration_ms,
             error_message, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            id,
            input.test_run_id,
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

pub fn get_result_by_id(pool: &DbPool, id: &str) -> Result<PersonaTestResult, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM persona_test_results WHERE id = ?1",
        params![id],
        row_to_result,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("TestResult {id}")),
        other => AppError::Database(other),
    })
}

pub fn get_results_by_run(
    pool: &DbPool,
    test_run_id: &str,
) -> Result<Vec<PersonaTestResult>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM persona_test_results WHERE test_run_id = ?1
         ORDER BY scenario_name, model_id",
    )?;
    let rows = stmt.query_map(params![test_run_id], row_to_result)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::CreatePersonaInput;
    use crate::db::repos::core::personas;

    fn setup() -> (DbPool, String) {
        let pool = init_test_db().unwrap();
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Test Persona".into(),
                system_prompt: "Test prompt".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                group_id: None,
                notification_channels: None,
            },
        )
        .unwrap();
        (pool, persona.id)
    }

    #[test]
    fn test_run_crud() {
        let (pool, persona_id) = setup();

        // Create
        let run = create_run(&pool, &persona_id, r#"["haiku","sonnet"]"#).unwrap();
        assert_eq!(run.status, "generating");
        assert_eq!(run.persona_id, persona_id);

        // Get by id
        let fetched = get_run_by_id(&pool, &run.id).unwrap();
        assert_eq!(fetched.id, run.id);

        // Update
        update_run_status(&pool, &run.id, "completed", Some(3), None, None, None).unwrap();
        let updated = get_run_by_id(&pool, &run.id).unwrap();
        assert_eq!(updated.status, "completed");
        assert_eq!(updated.scenarios_count, 3);

        // List
        let runs = get_runs_by_persona(&pool, &persona_id, None).unwrap();
        assert_eq!(runs.len(), 1);

        // Delete
        let deleted = delete_run(&pool, &run.id).unwrap();
        assert!(deleted);
        assert!(get_run_by_id(&pool, &run.id).is_err());
    }

    #[test]
    fn test_result_crud() {
        let (pool, persona_id) = setup();
        let run = create_run(&pool, &persona_id, "[]").unwrap();

        let result = create_result(
            &pool,
            &CreateTestResultInput {
                test_run_id: run.id.clone(),
                scenario_name: "Email processing".into(),
                model_id: "haiku".into(),
                provider: "anthropic".into(),
                status: "passed".into(),
                output_preview: Some("Processed 3 emails".into()),
                tool_calls_expected: Some(r#"["gmail_read","http_request"]"#.into()),
                tool_calls_actual: Some(r#"["gmail_read","http_request"]"#.into()),
                tool_accuracy_score: Some(100),
                output_quality_score: Some(85),
                protocol_compliance: Some(90),
                input_tokens: 1500,
                output_tokens: 500,
                cost_usd: 0.003,
                duration_ms: 1200,
                error_message: None,
            },
        )
        .unwrap();
        assert_eq!(result.status, "passed");
        assert_eq!(result.model_id, "haiku");

        let results = get_results_by_run(&pool, &run.id).unwrap();
        assert_eq!(results.len(), 1);

        // Cascade delete
        delete_run(&pool, &run.id).unwrap();
        let results_after = get_results_by_run(&pool, &run.id).unwrap();
        assert!(results_after.is_empty());
    }
}
