use rusqlite::{params, Row};

use crate::db::models::{
    AssertionFailureAction, AssertionResult, AssertionType, ExecutionAssertionSummary,
    OutputAssertion,
};
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mappers -----------------------------------------------

// row_to_assertion uses custom enum conversions, so it stays manual.
fn row_to_assertion(row: &Row) -> rusqlite::Result<OutputAssertion> {
    let assertion_type_str: String = row.get("assertion_type")?;
    let on_failure_str: String = row.get("on_failure")?;

    Ok(OutputAssertion {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        assertion_type: parse_assertion_type(&assertion_type_str),
        config: row.get("config")?,
        severity: row.get("severity")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        on_failure: parse_failure_action(&on_failure_str),
        pass_count: row.get("pass_count")?,
        fail_count: row.get("fail_count")?,
        last_evaluated_at: row.get("last_evaluated_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

row_mapper!(row_to_result -> AssertionResult {
    id, assertion_id, execution_id, persona_id,
    passed [bool],
    explanation, matched_value, evaluation_ms, created_at,
});

fn parse_assertion_type(s: &str) -> AssertionType {
    match s {
        "regex" => AssertionType::Regex,
        "json_path" => AssertionType::JsonPath,
        "contains" => AssertionType::Contains,
        "not_contains" => AssertionType::NotContains,
        "json_schema" => AssertionType::JsonSchema,
        "length" => AssertionType::Length,
        _ => AssertionType::Contains, // fallback
    }
}

fn parse_failure_action(s: &str) -> AssertionFailureAction {
    match s {
        "review" => AssertionFailureAction::Review,
        "heal" => AssertionFailureAction::Heal,
        _ => AssertionFailureAction::Log,
    }
}

// -- Assertion CRUD -------------------------------------------

#[allow(clippy::too_many_arguments)]
pub fn create(
    pool: &DbPool,
    persona_id: &str,
    name: &str,
    description: Option<&str>,
    assertion_type: &str,
    config: &str,
    severity: Option<&str>,
    on_failure: Option<&str>,
) -> Result<OutputAssertion, AppError> {
    timed_query!("output_assertions", "output_assertions::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let severity = severity.unwrap_or("warning");
        let on_failure = on_failure.unwrap_or("log");

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO output_assertions
             (id, persona_id, name, description, assertion_type, config, severity, on_failure, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![id, persona_id, name, description, assertion_type, config, severity, on_failure, now],
        )?;

        get_by_id(pool, &id)
    })
}

crud_get_by_id!(OutputAssertion, "output_assertions", "OutputAssertion", row_to_assertion);

pub fn list_by_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<OutputAssertion>, AppError> {
    timed_query!("output_assertions", "output_assertions::list_by_persona", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM output_assertions WHERE persona_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![persona_id], row_to_assertion)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn list_enabled_by_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<OutputAssertion>, AppError> {
    timed_query!("output_assertions", "output_assertions::list_enabled_by_persona", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM output_assertions WHERE persona_id = ?1 AND enabled = 1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![persona_id], row_to_assertion)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

#[allow(clippy::too_many_arguments)]
pub fn update(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    config: Option<&str>,
    severity: Option<&str>,
    on_failure: Option<&str>,
    enabled: Option<bool>,
) -> Result<OutputAssertion, AppError> {
    timed_query!("output_assertions", "output_assertions::update", {
        let now = chrono::Utc::now().to_rfc3339();
        let enabled_int = enabled.map(|e| if e { 1i32 } else { 0i32 });

        let conn = pool.get()?;
        conn.execute(
            "UPDATE output_assertions SET
                name = COALESCE(?1, name),
                description = COALESCE(?2, description),
                config = COALESCE(?3, config),
                severity = COALESCE(?4, severity),
                on_failure = COALESCE(?5, on_failure),
                enabled = COALESCE(?6, enabled),
                updated_at = ?7
             WHERE id = ?8",
            params![name, description, config, severity, on_failure, enabled_int, now, id],
        )?;

        get_by_id(pool, id)
    })
}

crud_delete!("output_assertions");

// -- Result operations ----------------------------------------

pub fn insert_result(pool: &DbPool, result: &AssertionResult) -> Result<(), AppError> {
    timed_query!("output_assertions", "output_assertions::insert_result", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO assertion_results
             (id, assertion_id, execution_id, persona_id, passed, explanation, matched_value, evaluation_ms, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                result.id,
                result.assertion_id,
                result.execution_id,
                result.persona_id,
                result.passed as i32,
                result.explanation,
                result.matched_value,
                result.evaluation_ms,
                result.created_at,
            ],
        )?;
        Ok(())
    })
}

pub fn get_results_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<AssertionResult>, AppError> {
    timed_query!("output_assertions", "output_assertions::get_results_by_execution", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM assertion_results WHERE execution_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![execution_id], row_to_result)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

pub fn get_summary_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<ExecutionAssertionSummary, AppError> {
    timed_query!("output_assertions", "output_assertions::get_summary_by_execution", {
        let results = get_results_by_execution(pool, execution_id)?;
        let total = results.len() as i64;
        let passed = results.iter().filter(|r| r.passed).count() as i64;
        let failed = total - passed;

        // `critical_failures` and `first_critical_failure` aren't stored
        // alongside results today — they're only meaningful in the live
        // evaluation summary emitted by `evaluate_assertions`. Historical
        // summaries read back from the DB leave them zeroed/None.
        Ok(ExecutionAssertionSummary {
            execution_id: execution_id.to_string(),
            total,
            passed,
            failed,
            critical_failures: 0,
            first_critical_failure: None,
            results,
        })
    })
}

pub fn get_results_by_assertion(
    pool: &DbPool,
    assertion_id: &str,
    limit: Option<i64>,
) -> Result<Vec<AssertionResult>, AppError> {
    timed_query!("output_assertions", "output_assertions::get_results_by_assertion", {
        let limit = limit.unwrap_or(50);
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM assertion_results WHERE assertion_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![assertion_id, limit], row_to_result)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    })
}

/// Increment pass/fail counter and update last_evaluated_at on an assertion.
pub fn increment_counter(pool: &DbPool, assertion_id: &str, passed: bool) -> Result<(), AppError> {
    timed_query!("output_assertions", "output_assertions::increment_counter", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let col = if passed { "pass_count" } else { "fail_count" };
        conn.execute(
            &format!(
                "UPDATE output_assertions SET {col} = {col} + 1, last_evaluated_at = ?1 WHERE id = ?2"
            ),
            params![now, assertion_id],
        )?;
        Ok(())
    })
}
