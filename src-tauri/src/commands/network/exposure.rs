use std::sync::Arc;
use tauri::State;

use crate::db::models::{
    CreateExposedResourceInput, ExposedResource, ExposureManifest,
    ResourceProvenance, UpdateExposedResourceInput,
};
use crate::db::repos::resources::exposure as exposure_repo;
use crate::engine::identity as identity_engine;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

// -- Exposed Resources CRUD ----------------------------------------------

#[tauri::command]
pub fn list_exposed_resources(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ExposedResource>, AppError> {
    require_auth_sync(&state)?;
    exposure_repo::list_exposed_resources(&state.db)
}

#[tauri::command]
pub fn get_exposed_resource(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<ExposedResource, AppError> {
    require_auth_sync(&state)?;
    exposure_repo::get_exposed_resource(&state.db, &id)
}

#[tauri::command]
pub fn create_exposed_resource(
    state: State<'_, Arc<AppState>>,
    input: CreateExposedResourceInput,
) -> Result<ExposedResource, AppError> {
    require_auth_sync(&state)?;
    // access_level and resource_type are validated at deserialization via enum types.
    // Check for duplicate exposure
    if let Some(_existing) =
        exposure_repo::get_by_resource(&state.db, input.resource_type.as_str(), &input.resource_id)?
    {
        return Err(AppError::Validation(
            "This resource is already exposed".into(),
        ));
    }

    let result = exposure_repo::create_exposed_resource(&state.db, input)?;
    tracing::info!(
        id = %result.id,
        resource_type = %result.resource_type,
        resource_id = %result.resource_id,
        access_level = %result.access_level,
        action = "exposure_created",
        "Exposed resource created"
    );
    Ok(result)
}

#[tauri::command]
pub fn update_exposed_resource(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateExposedResourceInput,
) -> Result<ExposedResource, AppError> {
    require_auth_sync(&state)?;
    // access_level validated at deserialization via AccessLevel enum.
    let result = exposure_repo::update_exposed_resource(&state.db, &id, input)?;
    tracing::info!(
        id = %id,
        resource_type = %result.resource_type,
        resource_id = %result.resource_id,
        access_level = %result.access_level,
        action = "exposure_updated",
        "Exposed resource updated"
    );
    Ok(result)
}

#[tauri::command]
pub fn delete_exposed_resource(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    let deleted = exposure_repo::delete_exposed_resource(&state.db, &id)?;
    tracing::info!(id = %id, deleted = %deleted, action = "exposure_deleted", "Exposed resource deleted");
    Ok(deleted)
}

// -- Manifest ------------------------------------------------------------

#[tauri::command]
pub fn get_exposure_manifest(
    state: State<'_, Arc<AppState>>,
) -> Result<ExposureManifest, AppError> {
    require_auth_sync(&state)?;
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

// -- Provenance ----------------------------------------------------------

#[tauri::command]
pub fn list_provenance(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ResourceProvenance>, AppError> {
    require_auth_sync(&state)?;
    exposure_repo::list_provenance(&state.db)
}

#[tauri::command]
pub fn get_resource_provenance(
    state: State<'_, Arc<AppState>>,
    resource_type: String,
    resource_id: String,
) -> Result<Option<ResourceProvenance>, AppError> {
    require_auth_sync(&state)?;
    exposure_repo::get_provenance(&state.db, &resource_type, &resource_id)
}
