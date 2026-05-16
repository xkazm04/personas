use std::sync::Arc;
use tauri::State;

use crate::engine::platforms::deploy::{self, DeployAutomationInput, DeployAutomationResult};
use crate::error::AppError;
use crate::AppState;
use personas_macros::requires;

/// Deploy an automation to the target platform and save to DB on success.
#[tauri::command]
#[requires(privileged)]
pub async fn deploy_automation(
    state: State<'_, Arc<AppState>>,
    input: DeployAutomationInput,
) -> Result<DeployAutomationResult, AppError> {
    deploy::deploy_automation(&state.db, input).await
}
