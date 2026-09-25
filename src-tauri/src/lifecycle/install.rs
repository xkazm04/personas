//! "Install into repo": create a Run Desk dev task that writes the missing
//! repo bindings (managed CLAUDE.md block, lefthook commands, CI workflow) and
//! execute it through `dev_tools_execute_task`, so the install follows the
//! project's own lifecycle. The task id is stored on the version row
//! (`db::repos::dev::lifecycle::set_install_task`).
//!
//! STUB (WP1): final signature, returns `Ok(None)`. WP2 implements it.

use std::sync::Arc;

use crate::error::AppError;
use crate::AppState;

/// Dispatch the install task for the project's latest version. Returns the
/// task id, or `None` when no repo binding is missing.
pub async fn dispatch_install(
    state: &Arc<AppState>,
    app: &tauri::AppHandle,
    project_id: &str,
) -> Result<Option<String>, AppError> {
    let _ = (state, app, project_id);
    Ok(None)
}
