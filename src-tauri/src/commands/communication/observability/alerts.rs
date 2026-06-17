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
        // Guard the degenerate always-true case when this update sets both the
        // operator and the threshold. (A threshold-only edit can't be validated
        // here without the existing operator; create-time validation covers the
        // common path.)
        if let Some(op) = input.operator {
            reject_always_true_rule(op, t)?;
        }
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

#[tauri::command]
#[instrument(skip(state))]
pub fn create_fired_alert(
    state: State<'_, Arc<AppState>>,
    alert: FiredAlert,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    alert_repo::create_fired_alert(&state.db, &alert)
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
