use rusqlite::{params, Row};

use crate::models::{
    AssertionFailureAction, AssertionResult, AssertionSeverity, AssertionType,
    ExecutionAssertionSummary, OutputAssertion,
};
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

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
        assertion_type: parse_assertion_type(&assertion_type_str)?,
        config: row.get("config")?,
        severity: row.get("severity")?,
        enabled: row.get::<_, i32>("enabled")? != 0,
        on_failure: parse_failure_action(&on_failure_str)?,
        pass_count: row.get("pass_count")?,
        fail_count: row.get("fail_count")?,
        last_evaluated_at: row.get("last_evaluated_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Turn an unrecognised stored token into a read error rather than a value.
///
/// Deliberately NOT the lenient treatment the token counters get in
/// `executions.rs`: a token count nobody can parse is honestly 0, but an
/// assertion type nobody can parse is not honestly `Contains`. Coercing it
/// runs a DIFFERENT check under the user's name and reports it as passing.
/// The write door (`create` / `update` below) is the only producer of these
/// columns and now refuses anything outside the vocabulary, so a row that
/// trips this is corruption and should be loud.
fn unknown_token(column: &'static str, value: &str, allowed: &[&str]) -> rusqlite::Error {
    tracing::error!(
        column,
        value,
        "output_assertions: unknown stored token — refusing to coerce"
    );
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "output_assertions.{column}: unknown token '{value}' (expected one of {})",
                allowed.join(", ")
            ),
        )),
    )
}

row_mapper!(row_to_result -> AssertionResult {
    id, assertion_id, execution_id, persona_id,
    passed [bool],
    explanation, matched_value, evaluation_ms, created_at,
});

fn parse_assertion_type(s: &str) -> rusqlite::Result<AssertionType> {
    AssertionType::parse_token(s)
        .ok_or_else(|| unknown_token("assertion_type", s, AssertionType::TOKENS))
}

fn parse_failure_action(s: &str) -> rusqlite::Result<AssertionFailureAction> {
    AssertionFailureAction::parse_token(s)
        .ok_or_else(|| unknown_token("on_failure", s, AssertionFailureAction::TOKENS))
}

// -- Assertion CRUD -------------------------------------------

/// Insert an assertion. Every closed-vocabulary column arrives as its typed
/// enum, so this function cannot persist a token the reader would then have to
/// guess at — the parsing happens once, at the command door.
#[allow(clippy::too_many_arguments)]
pub fn create(
    pool: &DbPool,
    persona_id: &str,
    name: &str,
    description: Option<&str>,
    assertion_type: AssertionType,
    config: &str,
    severity: AssertionSeverity,
    on_failure: AssertionFailureAction,
) -> Result<OutputAssertion, AppError> {
    timed_query!("output_assertions", "output_assertions::create", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let assertion_type = assertion_type.as_token();
        let severity = severity.as_token();
        let on_failure = on_failure.as_token();

        let conn = pool.conn("assertions::create")?;
        conn.execute(
            "INSERT INTO output_assertions
             (id, persona_id, name, description, assertion_type, config, severity, on_failure, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![id, persona_id, name, description, assertion_type, config, severity, on_failure, now],
        )?;

        get_by_id(pool, &id)
    })
}

crud_get_by_id!(
    OutputAssertion,
    "output_assertions",
    "OutputAssertion",
    row_to_assertion
);

pub fn list_by_persona(pool: &DbPool, persona_id: &str) -> Result<Vec<OutputAssertion>, AppError> {
    timed_query!("output_assertions", "output_assertions::list_by_persona", {
        let conn = pool.conn("assertions::list_by_persona")?;
        let mut stmt = conn.prepare(
            "SELECT * FROM output_assertions WHERE persona_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![persona_id], row_to_assertion)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

pub fn list_enabled_by_persona(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<OutputAssertion>, AppError> {
    timed_query!(
        "output_assertions",
        "output_assertions::list_enabled_by_persona",
        {
            let conn = pool.conn("assertions::list_enabled_by_persona")?;
            let mut stmt = conn.prepare(
            "SELECT * FROM output_assertions WHERE persona_id = ?1 AND enabled = 1 ORDER BY created_at DESC",
        )?;
            let rows = stmt.query_map(params![persona_id], row_to_assertion)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

#[allow(clippy::too_many_arguments)]
pub fn update(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    config: Option<&str>,
    severity: Option<AssertionSeverity>,
    on_failure: Option<AssertionFailureAction>,
    enabled: Option<bool>,
) -> Result<OutputAssertion, AppError> {
    timed_query!("output_assertions", "output_assertions::update", {
        let now = chrono::Utc::now().to_rfc3339();
        let enabled_int = enabled.map(|e| if e { 1i32 } else { 0i32 });
        let severity = severity.map(AssertionSeverity::as_token);
        let on_failure = on_failure.map(AssertionFailureAction::as_token);

        let conn = pool.conn("assertions::update")?;
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
            params![
                name,
                description,
                config,
                severity,
                on_failure,
                enabled_int,
                now,
                id
            ],
        )?;

        get_by_id(pool, id)
    })
}

crud_delete!("output_assertions");

// -- Result operations ----------------------------------------

pub fn insert_result(pool: &DbPool, result: &AssertionResult) -> Result<(), AppError> {
    timed_query!("output_assertions", "output_assertions::insert_result", {
        let conn = pool.conn("assertions::insert_result")?;
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
    timed_query!(
        "output_assertions",
        "output_assertions::get_results_by_execution",
        {
            let conn = pool.conn("assertions::get_results_by_execution")?;
            let mut stmt = conn.prepare(
                "SELECT * FROM assertion_results WHERE execution_id = ?1 ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map(params![execution_id], row_to_result)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

pub fn get_summary_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<ExecutionAssertionSummary, AppError> {
    timed_query!(
        "output_assertions",
        "output_assertions::get_summary_by_execution",
        {
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
        }
    )
}

pub fn get_results_by_assertion(
    pool: &DbPool,
    assertion_id: &str,
    limit: Option<i64>,
) -> Result<Vec<AssertionResult>, AppError> {
    timed_query!(
        "output_assertions",
        "output_assertions::get_results_by_assertion",
        {
            let limit = limit.unwrap_or(50);
            let conn = pool.conn("assertions::get_results_by_assertion")?;
            let mut stmt = conn.prepare(
            "SELECT * FROM assertion_results WHERE assertion_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
            let rows = stmt.query_map(params![assertion_id, limit], row_to_result)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Increment pass/fail counter and update last_evaluated_at on an assertion.
pub fn increment_counter(pool: &DbPool, assertion_id: &str, passed: bool) -> Result<(), AppError> {
    timed_query!(
        "output_assertions",
        "output_assertions::increment_counter",
        {
            let now = chrono::Utc::now().to_rfc3339();
            let conn = pool.conn("assertions::increment_counter")?;
            let col = if passed { "pass_count" } else { "fail_count" };
            conn.execute(
            &format!(
                "UPDATE output_assertions SET {col} = {col} + 1, last_evaluated_at = ?1 WHERE id = ?2"
            ),
            params![now, assertion_id],
        )?;
            Ok(())
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;
    use crate::models::CreatePersonaInput;

    fn make_persona(pool: &DbPool) -> String {
        crate::repos::core::personas::create(
            pool,
            CreatePersonaInput {
                name: "Assertion Agent".into(),
                system_prompt: "You are a test agent.".into(),
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
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap()
        .id
    }

    /// The valid path: a typed vocabulary goes in and the SAME value comes
    /// back. Before this change the door took `&str` and the reader guessed.
    #[test]
    fn create_round_trips_the_typed_vocabulary() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);

        let created = create(
            &pool,
            &persona_id,
            "No secrets",
            Some("must not leak keys"),
            AssertionType::NotContains,
            r#"{"phrases":["sk-"]}"#,
            AssertionSeverity::Critical,
            AssertionFailureAction::Heal,
        )
        .expect("a well-formed assertion must be creatable");

        assert_eq!(created.assertion_type, AssertionType::NotContains);
        assert_eq!(created.on_failure, AssertionFailureAction::Heal);
        assert_eq!(created.severity, "critical");

        // And through the list mapper, not just the get-by-id one.
        let listed = list_by_persona(&pool, &persona_id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].assertion_type, AssertionType::NotContains);
        assert_eq!(listed[0].on_failure, AssertionFailureAction::Heal);
    }

    /// The invalid path, and the whole point of the change: a stored token
    /// outside the vocabulary is an ERROR, not a silent `Contains`. The old
    /// mapper's `_ => AssertionType::Contains` turned this row into a
    /// different check that reported itself as passing.
    #[test]
    fn unknown_stored_assertion_type_is_an_error_not_a_coercion() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);
        let created = create(
            &pool,
            &persona_id,
            "Legit",
            None,
            AssertionType::Regex,
            "{}",
            AssertionSeverity::Warning,
            AssertionFailureAction::Log,
        )
        .unwrap();

        // Simulate a row written before the door was closed (or by hand).
        pool.conn("assertions::test")
            .unwrap()
            .execute(
                "UPDATE output_assertions SET assertion_type = 'contian' WHERE id = ?1",
                params![created.id],
            )
            .unwrap();

        let err = get_by_id(&pool, &created.id)
            .expect_err("an unknown stored assertion_type must not be coerced into a real check");
        let msg = err.to_string();
        assert!(
            msg.contains("contian") || msg.contains("assertion_type"),
            "the error must name the offending column/token: {msg}"
        );
    }

    /// Same contract for the failure action — its old fallback was `Log`, so a
    /// mistyped `heel` quietly disarmed the healing workflow.
    #[test]
    fn unknown_stored_failure_action_is_an_error_not_a_coercion() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);
        let created = create(
            &pool,
            &persona_id,
            "Legit",
            None,
            AssertionType::Contains,
            "{}",
            AssertionSeverity::Warning,
            AssertionFailureAction::Heal,
        )
        .unwrap();

        pool.conn("assertions::test")
            .unwrap()
            .execute(
                "UPDATE output_assertions SET on_failure = 'heel' WHERE id = ?1",
                params![created.id],
            )
            .unwrap();

        assert!(
            get_by_id(&pool, &created.id).is_err(),
            "an unknown stored on_failure must not be coerced into Log"
        );
    }
}
