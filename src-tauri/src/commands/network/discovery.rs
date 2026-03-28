//! Tauri commands for P2P LAN discovery, connection management,
//! manifest sync, and agent messaging (Phase 2: Invisible Apps).

use tauri::State;

use crate::engine::p2p::protocol::AgentEnvelope;
use crate::engine::p2p::types::{
    ConnectionHealth, ConnectionState, DiscoveredPeer, NetworkConfig, NetworkSnapshot,
    NetworkStatusInfo, PeerManifestEntry,
};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

// -- Discovery --------------------------------------------------------

#[tauri::command]
pub async fn get_discovered_peers(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<Vec<DiscoveredPeer>, AppError> {
    require_auth(&state).await?;
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    net.mdns.get_discovered_peers()
}

// -- Connection Management --------------------------------------------

#[tauri::command]
pub async fn connect_to_peer(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    let result = net
        .connections
        .connect_to_peer(&peer_id, net.manifest_sync.clone(), net.messages.clone())
        .await;
    // Push updated snapshot for instant UI feedback
    net.emit_snapshot().await;
    result
}

#[tauri::command]
pub async fn disconnect_peer(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    let result = net.connections.disconnect_peer(&peer_id).await;
    // Push updated snapshot for instant UI feedback
    net.emit_snapshot().await;
    result
}

#[tauri::command]
pub async fn get_connection_status(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<ConnectionState, AppError> {
    require_auth(&state).await?;
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    Ok(net.connections.get_state(&peer_id).await)
}

// -- Manifest Sync ----------------------------------------------------

#[tauri::command]
pub async fn get_peer_manifest(
    state: State<'_, std::sync::Arc<AppState>>,
    peer_id: String,
) -> Result<Vec<PeerManifestEntry>, AppError> {
    require_auth(&state).await?;
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
    require_auth(&state).await?;
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    net.manifest_sync.sync_manifest(&peer_id).await
}

// -- Network Status ---------------------------------------------------

#[tauri::command]
pub async fn get_network_status(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<NetworkStatusInfo, AppError> {
    require_auth(&state).await?;
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

// -- Connection Health ------------------------------------------------

#[tauri::command]
pub async fn get_connection_health(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<ConnectionHealth, AppError> {
    require_auth(&state).await?;
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    Ok(net.connections.get_connection_health().await)
}

// -- Network Snapshot (batched) ---------------------------------------

#[tauri::command]
pub async fn get_network_snapshot(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<NetworkSnapshot, AppError> {
    require_auth(&state).await?;
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;

    let is_running = net.is_running().await;
    let listening_port = net.listening_port().await;
    let connected_peer_count = net.connections.connected_count().await;

    let peers = net.mdns.get_discovered_peers()?;
    let discovered_peer_count = peers.len() as u32;

    let local_peer_id = crate::engine::identity::get_or_create_identity(&state.db)
        .map(|id| id.peer_id)
        .unwrap_or_default();

    let status = NetworkStatusInfo {
        is_running,
        listening_port,
        discovered_peer_count,
        connected_peer_count,
        local_peer_id,
    };

    let health = net.connections.get_connection_health().await;
    let messaging_metrics = net.messages.get_metrics();
    let connection_metrics = net.connections.get_connection_metrics();
    let manifest_sync_metrics = net.manifest_sync.get_metrics();

    Ok(NetworkSnapshot {
        status,
        health,
        discovered_peers: peers,
        messaging_metrics,
        connection_metrics,
        manifest_sync_metrics,
    })
}

// -- Messaging Metrics ------------------------------------------------

#[tauri::command]
pub async fn get_messaging_metrics(
    state: State<'_, std::sync::Arc<AppState>>,
) -> Result<crate::engine::p2p::messaging::MessagingMetrics, AppError> {
    require_auth(&state).await?;
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    Ok(net.messages.get_metrics())
}

// -- Agent Messaging --------------------------------------------------

#[tauri::command]
pub async fn send_agent_message(
    state: State<'_, std::sync::Arc<AppState>>,
    target_peer: String,
    source_persona: String,
    target_persona: String,
    payload: Vec<u8>,
) -> Result<(), AppError> {
    require_auth(&state).await?;
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
    require_auth(&state).await?;
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    Ok(net.messages.get_messages(&persona_id).await)
}

// -- Network Config ---------------------------------------------------

#[tauri::command]
pub async fn set_network_config(
    state: State<'_, std::sync::Arc<AppState>>,
    config: NetworkConfig,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    let net = state.network.as_ref().ok_or_else(|| {
        AppError::Internal("Network service not initialized".into())
    })?;
    net.set_config(config).await;
    Ok(())
}
