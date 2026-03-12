use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    CreateExposedResourceInput, ExposedResource, ExposureManifest,
    ResourceProvenance, UpdateExposedResourceInput,
};
use crate::db::repos::resources::exposure as exposure_repo;
use crate::engine::identity as identity_engine;
use crate::error::AppError;
use crate::AppState;

// ── Exposed Resources CRUD ──────────────────────────────────────────────

#[tauri::command]
pub fn list_exposed_resources(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ExposedResource>, AppError> {
    exposure_repo::list_exposed_resources(&state.db)
}

#[tauri::command]
pub fn get_exposed_resource(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<ExposedResource, AppError> {
    exposure_repo::get_exposed_resource(&state.db, &id)
}

#[tauri::command]
pub fn create_exposed_resource(
    state: State<'_, Arc<AppState>>,
    input: CreateExposedResourceInput,
) -> Result<ExposedResource, AppError> {
    // Validate access_level
    if !["read", "execute", "fork"].contains(&input.access_level.as_str()) {
        return Err(AppError::Validation(
            "access_level must be 'read', 'execute', or 'fork'".into(),
        ));
    }
    // Validate resource_type
    if !["persona", "template", "execution_result", "knowledge", "connector"]
        .contains(&input.resource_type.as_str())
    {
        return Err(AppError::Validation(
            "resource_type must be one of: persona, template, execution_result, knowledge, connector".into(),
        ));
    }
    // Check for duplicate exposure
    if let Some(_existing) =
        exposure_repo::get_by_resource(&state.db, &input.resource_type, &input.resource_id)?
    {
        return Err(AppError::Validation(
            "This resource is already exposed".into(),
        ));
    }

    exposure_repo::create_exposed_resource(&state.db, input)
}

#[tauri::command]
pub fn update_exposed_resource(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateExposedResourceInput,
) -> Result<ExposedResource, AppError> {
    if let Some(ref level) = input.access_level {
        if !["read", "execute", "fork"].contains(&level.as_str()) {
            return Err(AppError::Validation(
                "access_level must be 'read', 'execute', or 'fork'".into(),
            ));
        }
    }
    exposure_repo::update_exposed_resource(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_exposed_resource(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    exposure_repo::delete_exposed_resource(&state.db, &id)
}

// ── Manifest ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_exposure_manifest(
    state: State<'_, Arc<AppState>>,
) -> Result<ExposureManifest, AppError> {
    let identity = identity_engine::get_or_create_identity(&state.db)?;
    let resources = exposure_repo::list_exposed_resources(&state.db)?;

    Ok(ExposureManifest {
        version: 1,
        owner_peer_id: identity.peer_id,
        owner_display_name: identity.display_name,
        updated_at: chrono::Utc::now().to_rfc3339(),
        resources,
    })
}

// ── Provenance ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_provenance(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ResourceProvenance>, AppError> {
    exposure_repo::list_provenance(&state.db)
}

#[tauri::command]
pub fn get_resource_provenance(
    state: State<'_, Arc<AppState>>,
    resource_type: String,
    resource_id: String,
) -> Result<Option<ResourceProvenance>, AppError> {
    exposure_repo::get_provenance(&state.db, &resource_type, &resource_id)
}
