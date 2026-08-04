use std::sync::Arc;

use tauri::State;

use crate::db::models::PersonaTestSuite;
use crate::db::repos::execution::test_suites as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

#[tauri::command]
pub fn list_test_suites(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<PersonaTestSuite>, AppError> {
    require_auth_sync(&state)?;
    repo::list_by_persona(&state.db, &persona_id)
}

#[tauri::command]
pub fn get_test_suite(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<PersonaTestSuite, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_id(&state.db, &id)
}

/// Validate a suite's `scenarios` payload at the IPC trust boundary and return
/// the authoritative scenario count.
///
/// `scenarios` is stored as an opaque JSON string and only parsed much later —
/// `start_test_run` does `serde_json::from_str::<Vec<TestScenario>>(&suite
/// .scenarios)` (commands/execution/tests.rs) — so a malformed or non-array
/// payload used to save cleanly and then fail at run time with "Failed to parse
/// suite scenarios", long after the user could connect it to the save. Reject
/// it where it enters instead.
///
/// The count is DERIVED from the array rather than trusted from the caller: the
/// client-supplied `scenario_count` is what the suite list renders, so a drifted
/// value silently mislabels every row.
fn validate_scenarios(scenarios: &str) -> Result<i32, AppError> {
    let value: serde_json::Value = serde_json::from_str(scenarios).map_err(|e| {
        AppError::Validation(format!("scenarios is not valid JSON: {e}"))
    })?;
    match value.as_array() {
        Some(arr) => Ok(arr.len() as i32),
        None => Err(AppError::Validation(
            "scenarios must be a JSON array of test scenarios".into(),
        )),
    }
}

#[tauri::command]
pub fn create_test_suite(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    name: String,
    description: Option<String>,
    scenarios: String,
    // Accepted for wire compatibility but not trusted — the stored count is
    // derived from `scenarios` itself (see `validate_scenarios`).
    #[allow(unused_variables)] scenario_count: i32,
    source_run_id: Option<String>,
) -> Result<PersonaTestSuite, AppError> {
    require_auth_sync(&state)?;
    let derived_count = validate_scenarios(&scenarios)?;
    repo::create(
        &state.db,
        &persona_id,
        &name,
        description.as_deref(),
        &scenarios,
        derived_count,
        source_run_id.as_deref(),
    )
}

#[tauri::command]
pub fn update_test_suite(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    scenarios: Option<String>,
    scenario_count: Option<i32>,
) -> Result<PersonaTestSuite, AppError> {
    require_auth_sync(&state)?;
    // When the scenarios payload is being replaced, validate it and re-derive
    // the count; when it is not, leave the stored count alone (the caller's
    // `scenario_count` cannot be reconciled against anything).
    let scenario_count = match scenarios.as_deref() {
        Some(s) => Some(validate_scenarios(s)?),
        None => scenario_count,
    };
    repo::update(
        &state.db,
        &id,
        name.as_deref(),
        description.as_deref(),
        scenarios.as_deref(),
        scenario_count,
    )
}

#[tauri::command]
pub fn delete_test_suite(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_count_from_the_array() {
        let json = r#"[{"name":"a"},{"name":"b"},{"name":"c"}]"#;
        assert_eq!(validate_scenarios(json).unwrap(), 3);
        assert_eq!(validate_scenarios("[]").unwrap(), 0);
    }

    #[test]
    fn rejects_malformed_json_at_save_time() {
        // Regression: this used to save fine and only blow up later inside
        // start_test_run's `from_str::<Vec<TestScenario>>`.
        let err = validate_scenarios("[{not json").expect_err("must reject");
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn rejects_a_non_array_payload() {
        let err = validate_scenarios(r#"{"name":"a"}"#).expect_err("must reject");
        assert!(format!("{err:?}").contains("array"));
    }
}
