//! Credential resource-scoping commands.
//!
//! After a credential is saved and healthchecked, the frontend may optionally
//! call a service API to list "sub-resources" (repos, projects, tables, folders,
//! …) and persist the user's picks as a JSON blob on the credential row.
//!
//! This module handles the two persistence ends of that flow:
//!   - `get_scoped_resources`   — return the current JSON blob
//!   - `save_scoped_resources`  — replace the blob (after the picker commits)
//!
//! The HTTP listing itself (`list_connector_resources`) dispatches based on the
//! connector's `resources[]` spec from its JSON definition — implemented in a
//! sibling module to keep this command file narrow.
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

use crate::db::repos::resources::connectors as connector_repo;
use crate::db::repos::resources::credentials as repo;
use crate::engine::resource_listing::{self, ResourceItem};
use crate::error::AppError;
use crate::ipc_auth::{require_privileged, require_privileged_sync};
use crate::AppState;

/// Read the `scoped_resources` JSON blob for a credential.
///
/// Returns `None` (JSON null on the wire) when the credential has broad scope.
/// Empty object `{}` means the picker was opened and skipped.
#[tauri::command]
pub fn get_scoped_resources(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Option<String>, AppError> {
    repo::get_scoped_resources(&state.db, &credential_id)
}

/// Replace the `scoped_resources` JSON blob for a credential.
///
/// Pass `None` (JSON null) to reset to broad-scope. The payload is validated
/// as JSON before persist so malformed input is rejected at the boundary.
///
/// Requires IPC privilege because it modifies credential state — though the
/// resource identifiers themselves are not secrets, they control which data
/// an agent is allowed to reach, so they sit on the privileged surface.
#[tauri::command]
pub fn save_scoped_resources(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    scoped_resources: Option<String>,
) -> Result<(), AppError> {
    require_privileged_sync(&state, "save_scoped_resources")?;
    if let Some(payload) = scoped_resources.as_deref() {
        // Cross-check the payload against the connector's resources[] spec so
        // unknown keys, malformed picks, or single-selection violations are
        // rejected here rather than surfacing later as silent broken state.
        let cred = repo::get_by_id(&state.db, &credential_id)?;
        let connector = connector_repo::get_by_name(&state.db, &cred.service_type)?
            .ok_or_else(|| AppError::NotFound(format!("Connector {}", cred.service_type)))?;
        resource_listing::validate_scoped_resources_payload(
            connector.resources.as_deref(),
            payload,
        )?;
    }
    repo::set_scoped_resources(&state.db, &credential_id, scoped_resources.as_deref())
}

/// Set the credential's runtime scope-enforcement mode. `"warn"` (default)
/// logs out-of-scope API calls; `"block"` rejects them at the proxy boundary.
/// Stored under `metadata.scope_enforcement` so the api_proxy can read it on
/// every request without an extra DB column.
#[tauri::command]
pub fn set_credential_scope_enforcement(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    mode: String,
) -> Result<(), AppError> {
    require_privileged_sync(&state, "set_credential_scope_enforcement")?;
    let normalized = match mode.as_str() {
        "warn" | "block" => mode,
        other => {
            return Err(AppError::Validation(format!(
                "scope_enforcement mode must be 'warn' or 'block', got '{other}'"
            )));
        }
    };
    let mut patch = serde_json::Map::new();
    patch.insert(
        "scope_enforcement".into(),
        serde_json::Value::String(normalized),
    );
    repo::patch_metadata_atomic(&state.db, &credential_id, patch)?;
    Ok(())
}

/// Invoke the connector's list endpoint for a given resource id, return
/// mapped picker items. `depends_on_context` carries prior selections keyed
/// by the resource id they came from (so `{{selected.<id>.<prop>}}` templates
/// can resolve).
///
/// This is a privileged command because it decrypts credential fields and
/// makes an outbound HTTP call using them.
#[tauri::command]
pub async fn list_connector_resources(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    resource_id: String,
    depends_on_context: Option<HashMap<String, serde_json::Value>>,
    bypass_cache: Option<bool>,
) -> Result<Vec<ResourceItem>, AppError> {
    // Async variant: thread-local privilege flag isn't reliable across tokio
    // task migration, so we use the async helper which verifies init only.
    // The actual privilege gating is enforced by the invoke handler wrapper.
    require_privileged(&state, "list_connector_resources").await?;
    let ctx = depends_on_context.unwrap_or_default();
    resource_listing::list_resources(
        &state.db,
        &credential_id,
        &resource_id,
        &ctx,
        bypass_cache.unwrap_or(false),
    )
    .await
}
