use std::sync::Arc;
use tauri::State;

use crate::db::models::{PeerIdentity, TrustedPeer, UpdateTrustedPeerInput};
use crate::db::repos::resources::identity as identity_repo;
use crate::engine::identity as identity_engine;
use crate::error::AppError;
use crate::AppState;

// ── Local Identity ──────────────────────────────────────────────────────

#[tauri::command]
pub fn get_local_identity(
    state: State<'_, Arc<AppState>>,
) -> Result<PeerIdentity, AppError> {
    identity_engine::get_or_create_identity(&state.db)
}

#[tauri::command]
pub fn set_display_name(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<PeerIdentity, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Display name cannot be empty".into()));
    }
    if name.len() > 64 {
        return Err(AppError::Validation("Display name too long (max 64 chars)".into()));
    }
    identity_repo::update_display_name(&state.db, name.trim())
}

#[tauri::command]
pub fn export_identity_card(
    state: State<'_, Arc<AppState>>,
) -> Result<String, AppError> {
    identity_engine::export_identity_card(&state.db)
}

// ── Trusted Peers ───────────────────────────────────────────────────────

#[tauri::command]
pub fn list_trusted_peers(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<TrustedPeer>, AppError> {
    identity_repo::list_trusted_peers(&state.db)
}

#[tauri::command]
pub fn import_trusted_peer(
    state: State<'_, Arc<AppState>>,
    identity_card: String,
    notes: Option<String>,
) -> Result<TrustedPeer, AppError> {
    let card = identity_engine::parse_identity_card(&identity_card)?;

    // Prevent adding self as trusted peer
    if let Some(local) = identity_repo::get_local_identity(&state.db)? {
        if local.peer_id == card.peer_id {
            return Err(AppError::Validation("Cannot add yourself as a trusted peer".into()));
        }
    }

    let pk_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &card.public_key_b64,
    )
    .map_err(|e| AppError::Validation(format!("Invalid public key: {e}")))?;

    identity_repo::add_trusted_peer(
        &state.db,
        &card.peer_id,
        &pk_bytes,
        &card.display_name,
        notes.as_deref(),
    )
}

#[tauri::command]
pub fn update_trusted_peer(
    state: State<'_, Arc<AppState>>,
    peer_id: String,
    input: UpdateTrustedPeerInput,
) -> Result<TrustedPeer, AppError> {
    identity_repo::update_trusted_peer(&state.db, &peer_id, input)
}

#[tauri::command]
pub fn revoke_peer_trust(
    state: State<'_, Arc<AppState>>,
    peer_id: String,
) -> Result<bool, AppError> {
    identity_repo::revoke_peer_trust(&state.db, &peer_id)?;
    Ok(true)
}

#[tauri::command]
pub fn delete_trusted_peer(
    state: State<'_, Arc<AppState>>,
    peer_id: String,
) -> Result<bool, AppError> {
    identity_repo::delete_trusted_peer(&state.db, &peer_id)?;
    Ok(true)
}
