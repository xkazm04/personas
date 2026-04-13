use std::collections::HashMap;
use std::sync::Arc;

use tauri::State;

use crate::engine::discovery::{self, DiscoveredItem};
use crate::error::AppError;
use crate::ipc_auth::require_privileged;
use crate::AppState;

/// Resolve a discovery op for a credential and return the discovered items
/// (projects, environments, repos, etc.) as `{value, label, sublabel}` triples.
///
/// Used by the template adoption questionnaire to populate dynamic option
/// lists from real connector data instead of asking users to type identifiers.
#[tauri::command]
pub async fn discover_connector_resources(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    service_type: String,
    operation: String,
    params: Option<HashMap<String, String>>,
) -> Result<Vec<DiscoveredItem>, AppError> {
    require_privileged(&state, "discover_connector_resources").await?;
    discovery::discover_resources(
        &state.db,
        &credential_id,
        &service_type,
        &operation,
        params.unwrap_or_default(),
    )
    .await
}
