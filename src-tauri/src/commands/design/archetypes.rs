//! Persona Foundry — archetype palette IPC surface.
//!
//! Read-only accessor over the embedded foundation catalog
//! (`engine::archetype_catalog`). Creation itself does NOT go through a
//! dedicated command: the Foundry frontend synthesizes a v3 template
//! payload (archetype persona + selected recipe_refs + persona_meta) and
//! drives the standard adoption pipeline (`create_adoption_session` →
//! `promote_build_draft`), so there is deliberately no `adopt_archetype`
//! twin to keep in sync with promote.

use std::sync::Arc;

use tauri::State;

use crate::engine::archetype_catalog::{self, ArchetypeCatalog};
use crate::error::AppError;
use crate::AppState;

/// List the full foundation palette (archetypes + memory strategies).
/// Static embedded data — cheap enough to return whole; the frontend
/// caches it in the store for the session.
#[tauri::command]
pub fn list_archetypes(state: State<'_, Arc<AppState>>) -> Result<ArchetypeCatalog, AppError> {
    crate::ipc_auth::require_auth_sync(&state)?;
    Ok(archetype_catalog::catalog().clone())
}
