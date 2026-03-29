use std::sync::Arc;
use tauri::State;

use crate::engine::capability_contract::{self, ContractReport};
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::validation::contract::{ValidationRule, all_rules};
use crate::AppState;

#[tauri::command]
pub fn get_validation_rules() -> Vec<ValidationRule> {
    all_rules()
}

/// Validate capability contracts for a persona.
///
/// Returns a report of met/unmet dependency requirements so the UI can surface
/// issues before the user attempts execution.
#[tauri::command]
pub fn validate_persona_contracts(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<ContractReport, AppError> {
    require_auth_sync(&state)?;
    capability_contract::validate_persona_contracts(&state.db, &persona_id)
}
