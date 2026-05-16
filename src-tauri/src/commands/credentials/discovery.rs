use std::collections::HashMap;
use std::sync::Arc;

use tauri::State;

use crate::engine::discovery::{self, DiscoveredItem};
use crate::error::AppError;
use crate::AppState;
use personas_macros::requires;

/// Resolve a discovery op for a credential and return the discovered items
/// (projects, environments, repos, etc.) as `{value, label, sublabel}` triples.
///
/// Used by the template adoption questionnaire to populate dynamic option
/// lists from real connector data instead of asking users to type identifiers.
#[tauri::command]
#[requires(privileged)]
pub async fn discover_connector_resources(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
    service_type: String,
    operation: String,
    params: Option<HashMap<String, String>>,
) -> Result<Vec<DiscoveredItem>, AppError> {
    discovery::discover_resources(
        &state.db,
        &credential_id,
        &service_type,
        &operation,
        params.unwrap_or_default(),
    )
    .await
}
