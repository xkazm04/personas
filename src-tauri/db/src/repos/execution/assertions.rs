use rusqlite::{params, Row, Transaction};

use crate::models::{
    AssertionFailureAction, AssertionResult, AssertionSeverity, AssertionType,
    ExecutionAssertionSummary, OutputAssertion,
};
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

// -- Projections -----------------------------------------------

/// One projection for every full-row read of `output_assertions`, in the order
/// `row_to_assertion` below consumes it. Mirrors
/// `CREATE TABLE output_assertions` (`migrations/incremental/e03_p2p_and_telemetry.rs:172`).
///
/// Not a stylistic preference: `SELECT *` binds the read to whatever the table
/// happens to hold, so an `ALTER TABLE ADD COLUMN` widens every row this module
/// fetches without a single call site changing, and a column the mapper reads
/// but the SELECT stops carrying fails at RUNTIME on the first row rather than
/// at compile time. `every_projection_prepares_against_the_real_schema` is the
/// gate that keeps this const and the schema in step.
const ASSERTION_COLUMNS: &str = "id, persona_id, name, description, assertion_type, \
     config, severity, enabled, on_failure, pass_count, fail_count, \
     last_evaluated_at, created_at, updated_at";

/// The same, for `assertion_results` and `row_to_result`
/// (`e03_p2p_and_telemetry.rs:191`).
const RESULT_COLUMNS: &str = "id, assertion_id, execution_id, persona_id, passed, \
     explanation, matched_value, evaluation_ms, created_at";

// -- Row mappers -----------------------------------------------

// row_to_assertion uses custom enum conversions, so it stays manual.
fn row_to_assertion(row: &Row) -> rusqlite::Result<OutputAssertion> {
    let assertion_type_str: String = row.get("assertion_type")?;
    let on_failure_str: String = row.get("on_failure")?;
    let severity_str: String = row.get("severity")?;

    Ok(OutputAssertion {
        id: row.get("id")?,
        persona_id: row.get("persona_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        assertion_type: parse_assertion_type(&assertion_type_str)?,
        config: row.get("config")?,
        // Canonicalised, never echoed raw: the struct's wire type is `String`
        // (`OutputAssertion` is `#[ts(export)]`; `AssertionSeverity` deliberately
        // is not), but every reader downstream — the engine's critical-failure
        // branch included — compares it against a token, so the token is what
        // must come out of the mapper.
        severity: parse_severity(&severity_str).as_token().to_string(),
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

/// Severity is the ONE closed vocabulary here that does not get the
/// `unknown_token` treatment, and the asymmetry is deliberate.
///
/// An unparseable `assertion_type` or `on_failure` changes WHAT runs — a
/// different check under the user's name, or a disarmed healing workflow — so
/// refusing the row is the honest answer. Severity changes only how loudly a
/// failure is escalated; the assertion itself still evaluates correctly. Erroring
/// the read would take a working assertion out of service over a label, which is
/// strictly worse than what it replaced. So: case is normalised (rows written
/// before the write door was typed carry `"Critical"`), an unrecognised token
/// falls back to the vocabulary's default and says so, and the caller gets a
/// canonical token either way — which is what lets the engine drop its
/// `eq_ignore_ascii_case` compensation.
fn parse_severity(s: &str) -> AssertionSeverity {
    match AssertionSeverity::parse_token(&s.to_ascii_lowercase()) {
        Some(sev) => sev,
        None => {
            tracing::warn!(
                value = s,
                default = AssertionSeverity::default().as_token(),
                "output_assertions.severity: unknown token — reading at the default severity"
            );
            AssertionSeverity::default()
        }
    }
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
        let mut stmt = conn.prepare(&format!(
            "SELECT {ASSERTION_COLUMNS} FROM output_assertions \
             WHERE persona_id = ?1 ORDER BY created_at DESC"
        ))?;
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
            let mut stmt = conn.prepare(&format!(
                "SELECT {ASSERTION_COLUMNS} FROM output_assertions \
                 WHERE persona_id = ?1 AND enabled = 1 ORDER BY created_at DESC"
            ))?;
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

/// Insert one assertion result. The `_in` form is the only place this SQL
/// lives; both the standalone door below and [`record_result_in`] go through it,
/// so the two can never write a different row shape.
pub(crate) fn insert_result_in(
    tx: &Transaction<'_>,
    result: &AssertionResult,
) -> Result<(), AppError> {
    tx.execute(
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
}

pub fn insert_result(pool: &DbPool, result: &AssertionResult) -> Result<(), AppError> {
    timed_query!("output_assertions", "output_assertions::insert_result", {
        let mut conn = pool.conn("assertions::insert_result")?;
        let tx = conn.transaction()?;
        insert_result_in(&tx, result)?;
        tx.commit()?;
        Ok(())
    })
}

/// Insert an assertion's result AND move that assertion's pass/fail counter as
/// ONE atomic step.
///
/// This exists because the two writes were previously issued on two different
/// pooled connections, each failure only `warn!`ed and neither able to undo the
/// other: `output_assertions.pass_count + fail_count` and
/// `COUNT(*) FROM assertion_results` are two recordings of the same event, and
/// nothing in the system compared them — so a dropped write left the persona's
/// assertion badge quoting a tally its own rows did not support, permanently,
/// with no error anywhere.
///
/// The counter UPDATE asserts it moved exactly one row. An assertion deleted
/// between the read and this write would otherwise leave a result row behind
/// with a counter nobody incremented, which is the drift this function exists to
/// make impossible; failing the transaction rolls the result row back with it.
pub(crate) fn record_result_in(
    tx: &Transaction<'_>,
    result: &AssertionResult,
) -> Result<(), AppError> {
    insert_result_in(tx, result)?;
    let moved = increment_counter_in(tx, &result.assertion_id, result.passed)?;
    if moved != 1 {
        return Err(AppError::NotFound(format!(
            "OutputAssertion {} (counter update matched {moved} rows)",
            result.assertion_id
        )));
    }
    Ok(())
}

/// The pooled door for [`record_result_in`]. `Immediate` because the UPDATE is a
/// read-modify-write of a counter: a deferred transaction that reads first fails
/// `SQLITE_BUSY_SNAPSHOT` in 0 ms under concurrency and ignores `busy_timeout`.
pub fn record_result(pool: &DbPool, result: &AssertionResult) -> Result<(), AppError> {
    timed_query!("output_assertions", "output_assertions::record_result", {
        let mut conn = pool.conn("assertions::record_result")?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        record_result_in(&tx, result)?;
        tx.commit()?;
        Ok(())
    })
}

/// Every assertion result for one execution, oldest first.
///
/// `id` is the tiebreak, not decoration: `created_at` is written by the engine
/// at second-ish resolution and two results of the same execution routinely
/// share it, so `created_at` alone is not a total order — the same read can
/// return them in a different order twice running, and under the LIMIT its
/// sibling `get_results_by_assertion` uses, a tie at a page boundary serves a
/// row twice or never.
pub fn get_results_by_execution(
    pool: &DbPool,
    execution_id: &str,
) -> Result<Vec<AssertionResult>, AppError> {
    timed_query!(
        "output_assertions",
        "output_assertions::get_results_by_execution",
        {
            let conn = pool.conn("assertions::get_results_by_execution")?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {RESULT_COLUMNS} FROM assertion_results WHERE execution_id = ?1 ORDER BY created_at ASC, id ASC"
            ))?;
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
            let mut stmt = conn.prepare(&format!(
                "SELECT {RESULT_COLUMNS} FROM assertion_results WHERE assertion_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2"
            ))?;
            let rows = stmt.query_map(params![assertion_id, limit], row_to_result)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)
        }
    )
}

/// Move one pass/fail counter and stamp `last_evaluated_at`, returning how many
/// rows the UPDATE matched so a caller that requires the assertion to still
/// exist can say so. `col` comes from a two-value literal vocabulary, never from
/// caller text.
pub(crate) fn increment_counter_in(
    tx: &Transaction<'_>,
    assertion_id: &str,
    passed: bool,
) -> Result<usize, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let col = if passed { "pass_count" } else { "fail_count" };
    let moved = tx.execute(
        &format!(
            "UPDATE output_assertions SET {col} = {col} + 1, last_evaluated_at = ?1 WHERE id = ?2"
        ),
        params![now, assertion_id],
    )?;
    Ok(moved)
}

/// Increment pass/fail counter and update last_evaluated_at on an assertion.
///
/// Prefer [`record_result`] whenever a result row is written alongside: this
/// door on its own is exactly how the counters and the rows drifted apart.
pub fn increment_counter(pool: &DbPool, assertion_id: &str, passed: bool) -> Result<(), AppError> {
    timed_query!(
        "output_assertions",
        "output_assertions::increment_counter",
        {
            let mut conn = pool.conn("assertions::increment_counter")?;
            let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            increment_counter_in(&tx, assertion_id, passed)?;
            tx.commit()?;
            Ok(())
        }
    )
}

/// Recompute every assertion's pass/fail counters from the result rows that are
/// supposed to back them, and report how many assertions were wrong.
///
/// A repair, not a routine: with [`record_result`] in place the counters cannot
/// drift going forward, but nothing has ever repaired a database that drifted
/// while the two writes were independent. Touches only rows that actually
/// disagree, so a clean database is a no-op that writes nothing and returns 0.
pub fn recount_counters(pool: &DbPool) -> Result<usize, AppError> {
    timed_query!(
        "output_assertions",
        "output_assertions::recount_counters",
        {
            let mut conn = pool.conn("assertions::recount_counters")?;
            let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let repaired = tx.execute(
                "UPDATE output_assertions SET
                 pass_count = (SELECT COUNT(*) FROM assertion_results r
                               WHERE r.assertion_id = output_assertions.id AND r.passed = 1),
                 fail_count = (SELECT COUNT(*) FROM assertion_results r
                               WHERE r.assertion_id = output_assertions.id AND r.passed = 0)
             WHERE pass_count <> (SELECT COUNT(*) FROM assertion_results r
                                  WHERE r.assertion_id = output_assertions.id AND r.passed = 1)
                OR fail_count <> (SELECT COUNT(*) FROM assertion_results r
                                  WHERE r.assertion_id = output_assertions.id AND r.passed = 0)",
                [],
            )?;
            tx.commit()?;
            if repaired > 0 {
                tracing::warn!(
                repaired,
                "output_assertions: repaired counters that disagreed with their own result rows"
            );
            }
            Ok(repaired)
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

    fn make_execution(pool: &DbPool, persona_id: &str) -> String {
        crate::repos::execution::executions::create(pool, persona_id, None, None, None, None)
            .unwrap()
            .id
    }

    fn make_result(
        id: &str,
        assertion_id: &str,
        execution_id: &str,
        persona_id: &str,
        passed: bool,
    ) -> AssertionResult {
        AssertionResult {
            id: id.to_string(),
            assertion_id: assertion_id.to_string(),
            execution_id: execution_id.to_string(),
            persona_id: persona_id.to_string(),
            passed,
            explanation: if passed { "ok".into() } else { "nope".into() },
            matched_value: None,
            evaluation_ms: 1,
            created_at: chrono::Utc::now().to_rfc3339(),
        }
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

    /// Both projections must PREPARE against the real migrated schema. A
    /// by-name read of a column the table does not have compiles fine and fails
    /// at runtime on the first row — the failure mode `SELECT *` hid by
    /// construction, because a wildcard always "matches".
    #[test]
    fn every_projection_prepares_against_the_real_schema() {
        let pool = init_test_db().unwrap();
        let conn = pool.conn("assertions::test").unwrap();
        for (columns, table) in [
            (ASSERTION_COLUMNS, "output_assertions"),
            (RESULT_COLUMNS, "assertion_results"),
        ] {
            conn.prepare(&format!("SELECT {columns} FROM {table} LIMIT 0"))
                .unwrap_or_else(|e| panic!("{table} projection does not match schema: {e}"));
        }
    }

    /// The other half of the gate: every field the mappers read must actually
    /// arrive. Preparing proves the SQL is legal; only a round trip proves the
    /// projection is complete.
    #[test]
    fn projections_cover_every_field_the_mappers_read() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);
        let created = create(
            &pool,
            &persona_id,
            "Covers",
            Some("every column"),
            AssertionType::Length,
            r#"{"min":1}"#,
            AssertionSeverity::Critical,
            AssertionFailureAction::Review,
        )
        .unwrap();

        let listed = list_by_persona(&pool, &persona_id).unwrap();
        assert_eq!(listed.len(), 1);
        let a = &listed[0];
        assert_eq!(a.id, created.id);
        assert_eq!(a.persona_id, persona_id);
        assert_eq!(a.name, "Covers");
        assert_eq!(a.description.as_deref(), Some("every column"));
        assert_eq!(a.assertion_type, AssertionType::Length);
        assert_eq!(a.config, r#"{"min":1}"#);
        assert_eq!(a.severity, "critical");
        assert!(a.enabled);
        assert_eq!(a.on_failure, AssertionFailureAction::Review);
        assert_eq!(a.pass_count, 0);
        assert_eq!(a.fail_count, 0);
        assert!(a.last_evaluated_at.is_none());
        assert!(!a.created_at.is_empty());
        assert!(!a.updated_at.is_empty());

        // The enabled-only door reads through the same projection.
        assert_eq!(
            list_enabled_by_persona(&pool, &persona_id).unwrap().len(),
            1
        );

        // And the results projection, through both of its readers.
        let exec_id = make_execution(&pool, &persona_id);
        let result = AssertionResult {
            id: "res-1".into(),
            assertion_id: created.id.clone(),
            execution_id: exec_id.clone(),
            persona_id: persona_id.clone(),
            passed: false,
            explanation: "too short".into(),
            matched_value: Some("x".into()),
            evaluation_ms: 7,
            created_at: "2026-07-10T00:00:01Z".into(),
        };
        insert_result(&pool, &result).unwrap();

        let by_exec = get_results_by_execution(&pool, &exec_id).unwrap();
        assert_eq!(by_exec.len(), 1);
        let r = &by_exec[0];
        assert_eq!(r.id, "res-1");
        assert_eq!(r.assertion_id, created.id);
        assert_eq!(r.execution_id, exec_id);
        assert_eq!(r.persona_id, persona_id);
        assert!(!r.passed, "INTEGER 0 must read back as false");
        assert_eq!(r.explanation, "too short");
        assert_eq!(r.matched_value.as_deref(), Some("x"));
        assert_eq!(r.evaluation_ms, 7);
        assert_eq!(r.created_at, "2026-07-10T00:00:01Z");

        let by_assertion = get_results_by_assertion(&pool, &created.id, None).unwrap();
        assert_eq!(by_assertion.len(), 1);
        assert_eq!(by_assertion[0].id, "res-1");
    }

    /// Severity comes back as a canonical token, whatever case the row holds.
    ///
    /// This is what lets `engine::output_assertions` compare against
    /// `AssertionSeverity::Critical.as_token()` instead of carrying an
    /// `eq_ignore_ascii_case` compensation for a reader that echoed the column
    /// verbatim. A row written before the write door was typed can hold
    /// `"Critical"`; that assertion IS critical and must escalate.
    #[test]
    fn stored_severity_reads_back_as_a_canonical_token() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);
        let created = create(
            &pool,
            &persona_id,
            "Legacy severity",
            None,
            AssertionType::Contains,
            "{}",
            AssertionSeverity::Warning,
            AssertionFailureAction::Log,
        )
        .unwrap();

        for (stored, expected) in [
            ("critical", "critical"),
            ("Critical", "critical"),
            ("INFO", "info"),
            // Not a value the vocabulary knows: the assertion still runs, at
            // the default severity, rather than the whole row failing to read.
            ("urgent", AssertionSeverity::default().as_token()),
        ] {
            pool.conn("assertions::test")
                .unwrap()
                .execute(
                    "UPDATE output_assertions SET severity = ?1 WHERE id = ?2",
                    params![stored, created.id],
                )
                .unwrap();
            let read = get_by_id(&pool, &created.id)
                .unwrap_or_else(|e| panic!("severity '{stored}' must not fail the read: {e}"));
            assert_eq!(read.severity, expected, "stored '{stored}'");
        }
    }

    /// The invariant V2 exists to create: the result row and the counter move
    /// together or not at all.
    ///
    /// Rolling the transaction back must leave BOTH untouched. Before this
    /// change the two writes went out on two different pooled connections, so
    /// the counter was already committed by the time anything could roll the
    /// row back — this test could not have passed, and no test could have
    /// failed, because nothing compared them.
    #[test]
    fn a_result_and_its_counter_share_one_transaction() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);
        let created = create(
            &pool,
            &persona_id,
            "Atomic",
            None,
            AssertionType::Contains,
            "{}",
            AssertionSeverity::Warning,
            AssertionFailureAction::Log,
        )
        .unwrap();
        let exec_id = make_execution(&pool, &persona_id);

        let mut conn = pool.conn("assertions::test").unwrap();
        let tx = conn.transaction().unwrap();
        record_result_in(
            &tx,
            &make_result("r-1", &created.id, &exec_id, &persona_id, true),
        )
        .unwrap();
        let inside: i64 = tx
            .query_row(
                "SELECT pass_count FROM output_assertions WHERE id = ?1",
                params![created.id],
                |r| r.get("pass_count"),
            )
            .unwrap();
        assert_eq!(inside, 1, "the counter must move inside the transaction");
        tx.rollback().unwrap();
        drop(conn);

        let after = get_by_id(&pool, &created.id).unwrap();
        assert_eq!(
            after.pass_count, 0,
            "a rolled-back counter must not survive"
        );
        assert!(
            get_results_by_execution(&pool, &exec_id)
                .unwrap()
                .is_empty(),
            "a rolled-back result row must not survive"
        );
    }

    /// After N recorded results the counters equal the rows they claim to count
    /// — the equality the two-connection version could not promise.
    #[test]
    fn counters_equal_the_rows_they_count() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);
        let created = create(
            &pool,
            &persona_id,
            "Tally",
            None,
            AssertionType::Contains,
            "{}",
            AssertionSeverity::Warning,
            AssertionFailureAction::Log,
        )
        .unwrap();
        let exec_id = make_execution(&pool, &persona_id);

        for i in 0..7 {
            record_result(
                &pool,
                &make_result(
                    &format!("r-{i}"),
                    &created.id,
                    &exec_id,
                    &persona_id,
                    i % 3 != 0,
                ),
            )
            .unwrap();
        }

        let rows = get_results_by_assertion(&pool, &created.id, Some(100)).unwrap();
        let passed = rows.iter().filter(|r| r.passed).count() as i64;
        let failed = rows.len() as i64 - passed;
        let assertion = get_by_id(&pool, &created.id).unwrap();
        assert_eq!(assertion.pass_count, passed);
        assert_eq!(assertion.fail_count, failed);
        assert_eq!(assertion.pass_count + assertion.fail_count, 7);
        assert!(assertion.last_evaluated_at.is_some());
    }

    /// A result whose assertion no longer exists must not half-land: nothing is
    /// left behind on either table.
    #[test]
    fn a_result_for_a_missing_assertion_lands_nowhere() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);
        let exec_id = make_execution(&pool, &persona_id);

        record_result(
            &pool,
            &make_result("r-orphan", "no-such-assertion", &exec_id, &persona_id, true),
        )
        .expect_err("a result with no owning assertion must not be stored");
        assert!(get_results_by_execution(&pool, &exec_id)
            .unwrap()
            .is_empty());
    }

    /// The repair door, against drift built by hand exactly the way the pre-V2
    /// engine built it: a result row written with no counter move, and a counter
    /// inflated past its rows.
    #[test]
    fn recount_counters_repairs_existing_drift_and_is_idempotent() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool);
        let created = create(
            &pool,
            &persona_id,
            "Drifted",
            None,
            AssertionType::Contains,
            "{}",
            AssertionSeverity::Warning,
            AssertionFailureAction::Log,
        )
        .unwrap();
        let exec_id = make_execution(&pool, &persona_id);

        insert_result(
            &pool,
            &make_result("d-1", &created.id, &exec_id, &persona_id, true),
        )
        .unwrap();
        insert_result(
            &pool,
            &make_result("d-2", &created.id, &exec_id, &persona_id, false),
        )
        .unwrap();
        pool.conn("assertions::test")
            .unwrap()
            .execute(
                "UPDATE output_assertions SET fail_count = 9 WHERE id = ?1",
                params![created.id],
            )
            .unwrap();

        assert_eq!(
            recount_counters(&pool).unwrap(),
            1,
            "one assertion disagreed"
        );
        let fixed = get_by_id(&pool, &created.id).unwrap();
        assert_eq!(fixed.pass_count, 1);
        assert_eq!(fixed.fail_count, 1);

        assert_eq!(
            recount_counters(&pool).unwrap(),
            0,
            "a clean database is a no-op"
        );
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
