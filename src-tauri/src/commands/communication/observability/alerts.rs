use std::sync::Arc;
use tauri::State;
use tracing::instrument;

use crate::db::models::{
    AlertOperator, AlertRule, CreateAlertRuleInput, FiredAlert, UpdateAlertRuleInput,
};
use crate::db::repos::communication::alert_rules as alert_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Reject a rule whose operator + threshold are trivially always-true. Every
/// alert metric is non-negative (rates 0-100, executions/cost >= 0), so `>= 0`
/// (or `> negative`) fires on every evaluation — a constantly-firing alert is
/// useless spam (bug-hunt: default threshold 0 + `>=`).
fn reject_always_true_rule(operator: AlertOperator, threshold: f64) -> Result<(), AppError> {
    let always_true = (operator == AlertOperator::Gte && threshold <= 0.0)
        || (operator == AlertOperator::Gt && threshold < 0.0);
    if always_true {
        return Err(AppError::Validation(
            "This rule would fire on every evaluation — metrics are non-negative, so a `>=` (or `>`) rule at/below 0 is always true. Use a threshold above 0.".into(),
        ));
    }
    Ok(())
}

/// The operator + threshold an update would leave stored, run through
/// `reject_always_true_rule`.
fn check_merged_rule(existing: &AlertRule, input: &UpdateAlertRuleInput) -> Result<(), AppError> {
    reject_always_true_rule(
        input.operator.unwrap_or(existing.operator),
        input.threshold.unwrap_or(existing.threshold),
    )
}

#[tauri::command]
#[instrument(skip(state))]
pub fn list_alert_rules(state: State<'_, Arc<AppState>>) -> Result<Vec<AlertRule>, AppError> {
    require_auth_sync(&state)?;
    alert_repo::list_alert_rules(&state.db)
}

#[tauri::command]
#[instrument(skip(state))]
pub fn create_alert_rule(
    state: State<'_, Arc<AppState>>,
    input: CreateAlertRuleInput,
) -> Result<AlertRule, AppError> {
    require_auth_sync(&state)?;
    if !input.threshold.is_finite() {
        return Err(AppError::Validation(
            "Threshold must be a finite number".into(),
        ));
    }
    reject_always_true_rule(input.operator, input.threshold)?;
    alert_repo::create_alert_rule(&state.db, input)
}

#[tauri::command]
#[instrument(skip(state))]
pub fn update_alert_rule(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateAlertRuleInput,
) -> Result<AlertRule, AppError> {
    require_auth_sync(&state)?;
    if let Some(t) = input.threshold {
        if !t.is_finite() {
            return Err(AppError::Validation(
                "Threshold must be a finite number".into(),
            ));
        }
    }
    // Validate the rule as it will be STORED: an edit carrying only the operator
    // or only the threshold (the inline-edit path) is checked against the saved
    // other half, so no single-field edit can create an always-firing rule.
    if input.operator.is_some() || input.threshold.is_some() {
        let existing = alert_repo::get_alert_rule(&state.db, &id)?;
        check_merged_rule(&existing, &input)?;
    }
    alert_repo::update_alert_rule(&state.db, &id, input)
}

#[tauri::command]
#[instrument(skip(state))]
pub fn delete_alert_rule(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    alert_repo::delete_alert_rule(&state.db, &id)
}

#[tauri::command]
#[instrument(skip(state))]
pub fn toggle_alert_rule(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<AlertRule, AppError> {
    require_auth_sync(&state)?;
    alert_repo::toggle_alert_rule(&state.db, &id)
}

// =============================================================================
// Fired Alerts (backend-persisted history)
// =============================================================================

#[tauri::command]
#[instrument(skip(state))]
pub fn list_fired_alerts(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
) -> Result<Vec<FiredAlert>, AppError> {
    require_auth_sync(&state)?;
    alert_repo::list_fired_alerts(&state.db, limit)
}

/// Persist an alert the FRONTEND evaluator fired, and route it the same way the
/// server-side evaluator routes its own.
///
/// The backend loop (`commands::execution::alert_evaluator`) has published an
/// `alert_fired` persona event since it was written, which is what the webhook
/// notifier relays to Slack/Discord with the UI closed. This path - the one the
/// in-app `alertSlice` uses - only ever wrote the row, so an alert the client
/// evaluated reached the fired-alerts list and nothing else. Two evaluators,
/// one table, and only one of them left the desktop.
///
/// Publishing is best-effort by design: the alert is the product and the
/// notification is delivery, so a failed publish is logged and never turns a
/// recorded alert into an error the UI has to handle.
#[tauri::command]
#[instrument(skip(state))]
pub fn create_fired_alert(
    state: State<'_, Arc<AppState>>,
    alert: FiredAlert,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    alert_repo::create_fired_alert(&state.db, &alert)?;
    if let Err(e) =
        crate::commands::execution::alert_evaluator::publish_alert_fired(&state.db, &alert)
    {
        tracing::warn!(
            alert_id = %alert.id,
            error = %e,
            "create_fired_alert: alert persisted but alert_fired event was not published"
        );
    }
    Ok(())
}

#[tauri::command]
#[instrument(skip(state))]
pub fn dismiss_fired_alert(state: State<'_, Arc<AppState>>, id: String) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    alert_repo::dismiss_fired_alert(&state.db, &id)
}

#[tauri::command]
#[instrument(skip(state))]
pub fn clear_fired_alerts(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    alert_repo::clear_fired_alerts(&state.db)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{AlertMetric, AlertSeverity};

    fn rule(operator: AlertOperator, threshold: f64) -> AlertRule {
        AlertRule {
            id: "r1".into(),
            name: "rule".into(),
            metric: AlertMetric::Executions,
            operator,
            threshold,
            severity: AlertSeverity::Warning,
            persona_id: None,
            enabled: true,
            created_at: "2026-10-20T00:00:00Z".into(),
            updated_at: "2026-10-20T00:00:00Z".into(),
        }
    }

    fn edit(operator: Option<AlertOperator>, threshold: Option<f64>) -> UpdateAlertRuleInput {
        UpdateAlertRuleInput {
            name: None,
            metric: None,
            operator,
            threshold,
            severity: None,
            persona_id: None,
            enabled: None,
        }
    }

    #[test]
    fn a_threshold_only_edit_is_checked_against_the_saved_operator() {
        let saved = rule(AlertOperator::Gte, 5.0);
        assert!(check_merged_rule(&saved, &edit(None, Some(0.0))).is_err());
        assert!(check_merged_rule(&saved, &edit(None, Some(7.0))).is_ok());
    }

    #[test]
    fn an_operator_only_edit_is_checked_against_the_saved_threshold() {
        let saved = rule(AlertOperator::Lt, 0.0);
        assert!(check_merged_rule(&saved, &edit(Some(AlertOperator::Gte), None)).is_err());
        assert!(check_merged_rule(&saved, &edit(Some(AlertOperator::Gt), None)).is_ok());
    }
}
