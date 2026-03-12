//! Tauri commands for P2P LAN discovery, connection management,
//! manifest sync, and agent messaging (Phase 2: Invisible Apps).

use tauri::State;

use crate::engine::p2p::protocol::AgentEnvelope;
use crate::engine::p2p::types::{
    ConnectionState, DiscoveredPeer, NetworkConfig, NetworkStatusInfo, PeerManifestEntry,
};
use crate::error::AppError;
use crate::AppState;

// ── Discovery ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_discovered_peers(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<Vec<DiscoveredPeer>, AppError> {
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    net.mdns.get_discovered_peers()
}

// ── Connection Management ────────────────────────────────────────────

#[tauri::command]
pub async fn connect_to_peer(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<(), AppError> {
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    net.connections.connect_to_peer(&peer_id).await
}

#[tauri::command]
pub async fn disconnect_peer(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<(), AppError> {
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    net.connections.disconnect_peer(&peer_id).await
}

#[tauri::command]
pub async fn get_connection_status(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<ConnectionState, AppError> {
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    Ok(net.connections.get_state(&peer_id).await)
}

// ── Manifest Sync ────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_peer_manifest(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<Vec<PeerManifestEntry>, AppError> {
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    net.manifest_sync.get_peer_manifest(&peer_id)
}

#[tauri::command]
pub async fn sync_peer_manifest(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<(), AppError> {
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    net.manifest_sync.sync_manifest(&peer_id).await
}

// ── Network Status ───────────────────────────────────────────────────

#[tauri::command]
pub async fn get_network_status(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<NetworkStatusInfo, AppError> {
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;

    let is_running = net.is_running().await;
    let listening_port = net.listening_port().await;
    let connected_peer_count = net.connections.connected_count().await;

    let discovered_peer_count = net
        .mdns
        .get_discovered_peers()
        .map(|p| p.len() as u32)
        .unwrap_or(0);

    // Get local peer_id from identity
    let local_peer_id = crate::engine::identity::get_or_create_identity(&state.db)
        .map(|id| id.peer_id)
        .unwrap_or_default();

    Ok(NetworkStatusInfo {
        is_running,
        listening_port,
        discovered_peer_count,
        connected_peer_count,
        local_peer_id,
    })
}

// ── Agent Messaging ──────────────────────────────────────────────────

#[tauri::command]
pub async fn send_agent_message(
    state: State<'_, std::sync::Arc<AppState>>,
    target_peer: String,
    source_persona: String,
    target_persona: String,
    payload: Vec<u8>,
) -> Result<(), AppError> {
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;

    let envelope = AgentEnvelope {
        id: uuid::Uuid::new_v4().to_string(),
        source_persona_id: source_persona,
        target_persona_id: target_persona,
        payload,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    net.messages.send_message(&target_peer, envelope).await
}

#[tauri::command]
pub async fn get_received_messages(
    state: State<'_, std::sync::Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<AgentEnvelope>, AppError> {
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    Ok(net.messages.get_messages(&persona_id).await)
}

// ── Network Config ───────────────────────────────────────────────────

#[tauri::command]
pub async fn set_network_config(
    state: State<'_, std::sync::Arc<AppState>>,
    config: NetworkConfig,
) -> Result<(), AppError> {
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    net.set_config(config).await;
    Ok(())
}
