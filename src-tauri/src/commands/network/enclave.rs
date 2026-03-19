use std::sync::Arc;
use tauri::State;

use crate::engine::enclave::{self, EnclaveSealResult, EnclavePolicy, EnclaveVerifyResult};
use crate::error::AppError;
use crate::ipc_auth::{require_auth_sync, require_privileged_sync};
use crate::AppState;

// -- Seal -----------------------------------------------------------------

#[tauri::command]
pub fn seal_enclave(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    policy: EnclavePolicy,
    save_path: String,
) -> Result<EnclaveSealResult, AppError> {
    require_privileged_sync(&state, "seal_enclave")?;

    let (bytes, result) = enclave::seal(&state.db, &persona_id, policy)?;

    std::fs::write(&save_path, &bytes).map_err(AppError::Io)?;

    tracing::info!(
        enclave_id = %result.enclave_id,
        persona = %result.persona_name,
        bytes = bytes.len(),
        action = "enclave_sealed",
        "Enclave sealed"
    );

    Ok(result)
}

// -- Verify ---------------------------------------------------------------

#[tauri::command]
pub fn verify_enclave(
    state: State<'_, Arc<AppState>>,
    file_path: String,
) -> Result<EnclaveVerifyResult, AppError> {
    require_auth_sync(&state)?;

    let bytes = std::fs::read(&file_path).map_err(AppError::Io)?;
    enclave::verify(&state.db, &bytes)
}
