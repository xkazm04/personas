use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    AssertionFailureAction, AssertionResult, AssertionSeverity, AssertionType,
    ExecutionAssertionSummary, OutputAssertion,
};
use crate::db::repos::execution::assertions as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Reject an out-of-vocabulary token at the door.
///
/// These three columns are closed vocabularies (`AssertionType`,
/// `AssertionSeverity`, `AssertionFailureAction`) that the evaluator matches on
/// exhaustively. They used to arrive as free `String`s, get stored verbatim,
/// and be coerced back by the reader onto `Contains` / `Log` — so a mistyped
/// assertion silently ran a different check and reported it as passing.
/// Unknown is not a value: it is a `Validation` error naming the vocabulary.
fn require_token<T>(
    field: &str,
    raw: &str,
    parsed: Option<T>,
    allowed: &[&str],
) -> Result<T, AppError> {
    parsed.ok_or_else(|| {
        AppError::Validation(format!(
            "Unknown {field} '{raw}' — expected one of: {}",
            allowed.join(", ")
        ))
    })
}

fn parse_assertion_type(raw: &str) -> Result<AssertionType, AppError> {
    require_token(
        "assertion_type",
        raw,
        AssertionType::parse_token(raw),
        AssertionType::TOKENS,
    )
}

fn parse_severity(raw: &str) -> Result<AssertionSeverity, AppError> {
    require_token(
        "severity",
        raw,
        AssertionSeverity::parse_token(raw),
        AssertionSeverity::TOKENS,
    )
}

fn parse_failure_action(raw: &str) -> Result<AssertionFailureAction, AppError> {
    require_token(
        "on_failure",
        raw,
        AssertionFailureAction::parse_token(raw),
        AssertionFailureAction::TOKENS,
    )
}

// -- Assertion Definition CRUD --

#[tauri::command]
pub fn list_output_assertions(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<OutputAssertion>, AppError> {
    require_auth_sync(&state)?;
    repo::list_by_persona(&state.db, &persona_id)
}

#[tauri::command]
pub fn get_output_assertion(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<OutputAssertion, AppError> {
    require_auth_sync(&state)?;
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_output_assertion(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    name: String,
    description: Option<String>,
    assertion_type: String,
    config: String,
    severity: Option<String>,
    on_failure: Option<String>,
) -> Result<OutputAssertion, AppError> {
    require_auth_sync(&state)?;
    let assertion_type = parse_assertion_type(&assertion_type)?;
    // Omitted is allowed and means the documented default; PRESENT-but-unknown
    // is a caller mistake and never a default.
    let severity = severity
        .as_deref()
        .map(parse_severity)
        .transpose()?
        .unwrap_or_default();
    let on_failure = on_failure
        .as_deref()
        .map(parse_failure_action)
        .transpose()?
        .unwrap_or(AssertionFailureAction::Log);
    repo::create(
        &state.db,
        &persona_id,
        &name,
        description.as_deref(),
        assertion_type,
        &config,
        severity,
        on_failure,
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_output_assertion(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    config: Option<String>,
    severity: Option<String>,
    on_failure: Option<String>,
    enabled: Option<bool>,
) -> Result<OutputAssertion, AppError> {
    require_auth_sync(&state)?;
    let severity = severity.as_deref().map(parse_severity).transpose()?;
    let on_failure = on_failure
        .as_deref()
        .map(parse_failure_action)
        .transpose()?;
    repo::update(
        &state.db,
        &id,
        name.as_deref(),
        description.as_deref(),
        config.as_deref(),
        severity,
        on_failure,
        enabled,
    )
}

#[tauri::command]
pub fn delete_output_assertion(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete(&state.db, &id)
}

// -- Assertion Results --

#[tauri::command]
pub fn get_assertion_results_for_execution(
    state: State<'_, Arc<AppState>>,
    execution_id: String,
) -> Result<ExecutionAssertionSummary, AppError> {
    require_auth_sync(&state)?;
    repo::get_summary_by_execution(&state.db, &execution_id)
}

#[tauri::command]
pub fn get_assertion_result_history(
    state: State<'_, Arc<AppState>>,
    assertion_id: String,
    limit: Option<i64>,
) -> Result<Vec<AssertionResult>, AppError> {
    require_auth_sync(&state)?;
    repo::get_results_by_assertion(&state.db, &assertion_id, limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The valid half of the door: every token the vocabulary publishes is
    /// accepted and round-trips to itself.
    #[test]
    fn valid_tokens_are_accepted() {
        for token in AssertionType::TOKENS {
            assert_eq!(parse_assertion_type(token).unwrap().as_token(), *token);
        }
        for token in AssertionSeverity::TOKENS {
            assert_eq!(parse_severity(token).unwrap().as_token(), *token);
        }
        for token in AssertionFailureAction::TOKENS {
            assert_eq!(parse_failure_action(token).unwrap().as_token(), *token);
        }
    }

    /// The invalid half: an unknown token is a `Validation` error naming the
    /// vocabulary — NOT a silent coercion onto `Contains` / `Log`.
    #[test]
    fn unknown_tokens_are_rejected_with_validation() {
        let err = parse_assertion_type("contain").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
        assert!(
            err.to_string().contains("not_contains"),
            "the error must name the vocabulary: {err}"
        );

        assert!(matches!(
            parse_severity("urgent").unwrap_err(),
            AppError::Validation(_)
        ));
        assert!(matches!(
            parse_failure_action("LOG").unwrap_err(),
            AppError::Validation(_)
        ));
    }
}
