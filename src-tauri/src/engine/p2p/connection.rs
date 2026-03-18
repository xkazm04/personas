//! Connection lifecycle management.
//!
//! Tracks active connections by peer_id, handles Hello/HelloAck handshake,
//! health checks (Ping/Pong), and auto-reconnect.

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};

use super::manifest_sync::ManifestSync;
use super::messaging::MessageRouter;
use super::protocol::{self, Message, PROTOCOL_VERSION};
use super::transport::QuicTransport;
use super::types::{ConnectionHealth, ConnectionState, PeerConnectionInfo};
use crate::db::DbPool;
use crate::error::AppError;

/// Active QUIC connection handle to a peer.
pub struct PeerConnection {
    pub info: PeerConnectionInfo,
    pub quinn_conn: quinn::Connection,
}

/// Manages all active peer connections.
pub struct ConnectionManager {
    transport: Arc<QuicTransport>,
    pool: DbPool,
    local_peer_id: String,
    local_display_name: String,
    connections: RwLock<HashMap<String, PeerConnection>>,
    /// Tracks peer_ids with in-progress connection attempts to prevent duplicates.
    connecting: Mutex<HashSet<String>>,
    max_peers: usize,
    #[allow(dead_code)]
    max_retries: u32,
}

impl ConnectionManager {
    pub fn new(
        transport: Arc<QuicTransport>,
        pool: DbPool,
        local_peer_id: String,
        local_display_name: String,
        max_peers: usize,
    ) -> Self {
        Self {
            transport,
            pool,
            local_peer_id,
            local_display_name,
            connections: RwLock::new(HashMap::new()),
            connecting: Mutex::new(HashSet::new()),
            max_peers,
            max_retries: 3,
        }
    }

    /// Update the max_peers limit.
    pub fn set_max_peers(&mut self, max_peers: usize) {
        self.max_peers = max_peers;
    }

    /// Check if the connection capacity has been reached.
    async fn is_at_capacity(&self) -> bool {
        self.connections.read().await.len() >= self.max_peers
    }

    /// Connect to a peer by peer_id (looks up address from discovered_peers).
    pub async fn connect_to_peer(&self, peer_id: &str) -> Result<(), AppError> {
        // Don't connect to ourselves
        if peer_id == self.local_peer_id {
            return Err(AppError::Validation("Cannot connect to self".into()));
        }

        // Check if already connected
        if self.connections.read().await.contains_key(peer_id) {
            return Ok(());
        }

        // Enforce max_peers limit
        if self.is_at_capacity().await {
            return Err(AppError::Validation(format!(
                "Connection limit reached ({} peers). Disconnect a peer first.",
                self.max_peers
            )));
        }

        // Serialize concurrent connect attempts for the same peer_id.
        // If another task is already connecting, return early.
        {
            let mut connecting = self.connecting.lock().await;
            if !connecting.insert(peer_id.to_string()) {
                tracing::debug!(peer_id = %peer_id, "Connection attempt already in progress, skipping");
                return Ok(());
            }
        }

        let result = self.connect_to_peer_inner(peer_id).await;

        // Always remove from connecting set
        self.connecting.lock().await.remove(peer_id);

        result
    }

    /// Inner connection logic, separated so `connect_to_peer` can manage the connecting guard.
    async fn connect_to_peer_inner(&self, peer_id: &str) -> Result<(), AppError> {
        // Look up the peer's address from the discovered_peers table
        let addr = self.resolve_peer_address(peer_id)?;

        // Establish QUIC connection
        tracing::info!(peer_id = %peer_id, addr = %addr, "Connecting to peer");

        let quinn_conn = self.transport.connect(addr).await?;

        // Perform Hello handshake
        let (send, recv) = quinn_conn.open_bi().await.map_err(|e| {
            AppError::Internal(format!("Failed to open stream: {e}"))
        })?;

        let mut send = tokio::io::BufWriter::new(send);
        let mut recv = tokio::io::BufReader::new(recv);

        // Send Hello
        protocol::write_message(
            &mut send,
            &Message::Hello {
                peer_id: self.local_peer_id.clone(),
                display_name: self.local_display_name.clone(),
                version: PROTOCOL_VERSION,
            },
        )
        .await?;

        // Wait for HelloAck (with timeout to prevent hanging on unresponsive peers)
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            protocol::decode(&mut recv),
        )
        .await
        .map_err(|_| AppError::Internal("HelloAck timeout: peer did not respond within 10s".into()))??;
        let (remote_peer_id, remote_display_name) = match response {
            Message::HelloAck {
                peer_id: remote_id,
                display_name,
                version,
            } => {
                if version != PROTOCOL_VERSION {
                    return Err(AppError::Validation(format!(
                        "Incompatible protocol version: peer {} has v{}, we have v{}",
                        remote_id, version, PROTOCOL_VERSION
                    )));
                }
                (remote_id, display_name)
            }
            _ => {
                return Err(AppError::Internal(
                    "Expected HelloAck, got different message".into(),
                ));
            }
        };

        // Verify peer_id matches what we expected
        if remote_peer_id != peer_id {
            return Err(AppError::Validation(format!(
                "Peer ID mismatch: expected {}, got {}",
                peer_id, remote_peer_id
            )));
        }

        // Store the connection
        let conn = PeerConnection {
            info: PeerConnectionInfo {
                peer_id: peer_id.to_string(),
                display_name: remote_display_name,
                state: ConnectionState::Connected,
                connected_at: Some(chrono::Utc::now()),
                last_ping: None,
                last_latency_ms: None,
                retry_count: 0,
            },
            quinn_conn,
        };

        self.connections
            .write()
            .await
            .insert(peer_id.to_string(), conn);

        // Update discovered_peers DB
        self.update_connection_status(peer_id, true)?;

        tracing::info!(peer_id = %peer_id, "Connected to peer");
        Ok(())
    }

    /// Handle an incoming QUIC connection (accept Hello, send HelloAck).
    pub async fn handle_incoming(
        &self,
        quinn_conn: quinn::Connection,
        _manifest_sync: &ManifestSync,
        _messages: &MessageRouter,
    ) -> Result<(), AppError> {
        // Enforce max_peers limit for incoming connections
        if self.is_at_capacity().await {
            quinn_conn.close(quinn::VarInt::from_u32(1), b"capacity exceeded");
            return Err(AppError::Validation(format!(
                "Rejecting incoming connection: at capacity ({} peers)",
                self.max_peers
            )));
        }

        let (send, recv) = quinn_conn.accept_bi().await.map_err(|e| {
            AppError::Internal(format!("Failed to accept stream: {e}"))
        })?;

        let mut send = tokio::io::BufWriter::new(send);
        let mut recv = tokio::io::BufReader::new(recv);

        // Read Hello (with timeout to prevent hanging on unresponsive peers)
        let hello = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            protocol::decode(&mut recv),
        )
        .await
        .map_err(|_| AppError::Internal("Hello timeout: peer did not send Hello within 10s".into()))??;
        let (remote_peer_id, remote_display_name) = match hello {
            Message::Hello {
                peer_id,
                display_name,
                version,
            } => {
                if version != PROTOCOL_VERSION {
                    return Err(AppError::Validation(format!(
                        "Incompatible protocol version: peer {} has v{}, we have v{}",
                        peer_id, version, PROTOCOL_VERSION
                    )));
                }
                (peer_id, display_name)
            }
            _ => {
                return Err(AppError::Internal(
                    "Expected Hello, got different message".into(),
                ));
            }
        };

        // Don't accept connections from ourselves
        if remote_peer_id == self.local_peer_id {
            return Err(AppError::Validation("Rejecting self-connection".into()));
        }

        // Send HelloAck
        protocol::write_message(
            &mut send,
            &Message::HelloAck {
                peer_id: self.local_peer_id.clone(),
                display_name: self.local_display_name.clone(),
                version: PROTOCOL_VERSION,
            },
        )
        .await?;

        // Store the connection
        let conn = PeerConnection {
            info: PeerConnectionInfo {
                peer_id: remote_peer_id.clone(),
                display_name: remote_display_name,
                state: ConnectionState::Connected,
                connected_at: Some(chrono::Utc::now()),
                last_ping: None,
                last_latency_ms: None,
                retry_count: 0,
            },
            quinn_conn,
        };

        self.connections
            .write()
            .await
            .insert(remote_peer_id.clone(), conn);

        self.update_connection_status(&remote_peer_id, true)?;

        tracing::info!(peer_id = %remote_peer_id, "Accepted incoming connection");
        Ok(())
    }

    /// Disconnect from a peer.
    pub async fn disconnect_peer(&self, peer_id: &str) -> Result<(), AppError> {
        if let Some(conn) = self.connections.write().await.remove(peer_id) {
            conn.quinn_conn
                .close(quinn::VarInt::from_u32(0), b"disconnect");
            self.update_connection_status(peer_id, false)?;
            tracing::info!(peer_id = %peer_id, "Disconnected from peer");
        }
        Ok(())
    }

    /// Disconnect from all peers.
    pub async fn disconnect_all(&self) {
        let mut conns = self.connections.write().await;
        for (peer_id, conn) in conns.drain() {
            conn.quinn_conn
                .close(quinn::VarInt::from_u32(0), b"shutdown");
            let _ = self.update_connection_status(&peer_id, false);
        }
    }

    /// Get the connection state for a peer.
    pub async fn get_state(&self, peer_id: &str) -> ConnectionState {
        self.connections
            .read()
            .await
            .get(peer_id)
            .map(|c| c.info.state)
            .unwrap_or(ConnectionState::Disconnected)
    }

    /// Get count of connected peers.
    pub async fn connected_count(&self) -> u32 {
        self.connections.read().await.len() as u32
    }

    /// Get the QUIC connection for a peer (for sending messages/requests).
    pub async fn get_quinn_conn(&self, peer_id: &str) -> Option<quinn::Connection> {
        self.connections
            .read()
            .await
            .get(peer_id)
            .map(|c| c.quinn_conn.clone())
    }

    /// Open a buffered bidirectional stream to a peer.
    ///
    /// Centralizes the open_bi → BufWriter/BufReader pattern used by ping,
    /// manifest sync, and messaging. This makes it trivial to add stream
    /// pooling later if profiling shows open_bi overhead is significant.
    pub async fn open_stream(
        &self,
        peer_id: &str,
    ) -> Result<
        (
            tokio::io::BufWriter<quinn::SendStream>,
            tokio::io::BufReader<quinn::RecvStream>,
        ),
        AppError,
    > {
        let quinn_conn = self.get_quinn_conn(peer_id).await.ok_or_else(|| {
            AppError::NotFound(format!("Not connected to peer {}", peer_id))
        })?;

        let (send, recv) = quinn_conn.open_bi().await.map_err(|e| {
            AppError::Internal(format!("Failed to open stream to {}: {e}", peer_id))
        })?;

        Ok((
            tokio::io::BufWriter::new(send),
            tokio::io::BufReader::new(recv),
        ))
    }

    /// Run a single health check pass: ping all connected peers concurrently
    /// (up to 8 at a time) and disconnect dead ones.
    pub async fn run_health_checks(&self) -> Result<(), crate::error::AppError> {
        use futures_util::stream::{self, StreamExt};

        let peer_ids: Vec<String> = self
            .connections
            .read()
            .await
            .keys()
            .cloned()
            .collect();

        let failed: Vec<String> = stream::iter(peer_ids)
            .map(|peer_id| async move {
                match self.ping_peer(&peer_id).await {
                    Ok(()) => None,
                    Err(e) => {
                        tracing::warn!(peer_id = %peer_id, "Ping failed: {}", e);
                        Some(peer_id)
                    }
                }
            })
            .buffer_unordered(8)
            .filter_map(|opt| async { opt })
            .collect()
            .await;

        for peer_id in failed {
            let _ = self.disconnect_peer(&peer_id).await;
        }
        Ok(())
    }

    /// Periodic health check loop (Ping/Pong).
    /// Prefer using `PeriodicTask` + `run_health_checks` for new code.
    pub async fn health_check_loop(&self) {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
            let _ = self.run_health_checks().await;
        }
    }

    /// Send a Ping and wait for a Pong.
    async fn ping_peer(&self, peer_id: &str) -> Result<(), AppError> {
        let (mut send, mut recv) = self.open_stream(peer_id).await?;

        let ping_start = std::time::Instant::now();
        protocol::write_message(&mut send, &Message::Ping).await?;

        let response = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            protocol::decode(&mut recv),
        )
        .await
        .map_err(|_| AppError::Internal("Ping timeout".into()))??;

        match response {
            Message::Pong => {
                let latency_ms = ping_start.elapsed().as_millis() as u64;
                // Update last_ping timestamp and latency
                if let Some(conn) = self.connections.write().await.get_mut(peer_id) {
                    conn.info.last_ping = Some(chrono::Utc::now());
                    conn.info.last_latency_ms = Some(latency_ms);
                }
                Ok(())
            }
            _ => Err(AppError::Internal("Expected Pong response".into())),
        }
    }

    /// Get aggregate connection health across all peers.
    pub async fn get_connection_health(&self) -> ConnectionHealth {
        let conns = self.connections.read().await;
        let connected_count = conns.len() as u32;

        if connected_count == 0 {
            return ConnectionHealth {
                avg_latency_ms: None,
                missed_ping_count: 0,
                connected_count: 0,
            };
        }

        let now = chrono::Utc::now();
        let stale_threshold = chrono::Duration::seconds(30);
        let mut latencies = Vec::new();
        let mut missed = 0u32;

        for conn in conns.values() {
            if let Some(latency) = conn.info.last_latency_ms {
                latencies.push(latency as f64);
            }
            // A peer that has been connected but never pinged, or whose last
            // ping is older than 2× the health-check interval, counts as missed.
            match conn.info.last_ping {
                None => missed += 1,
                Some(ts) if now - ts > stale_threshold => missed += 1,
                _ => {}
            }
        }

        let avg_latency_ms = if latencies.is_empty() {
            None
        } else {
            Some(latencies.iter().sum::<f64>() / latencies.len() as f64)
        };

        ConnectionHealth {
            avg_latency_ms,
            missed_ping_count: missed,
            connected_count,
        }
    }

    /// Resolve a peer_id to a socket address from the discovered_peers table.
    fn resolve_peer_address(&self, peer_id: &str) -> Result<SocketAddr, AppError> {
        let conn = self.pool.get()?;
        let addresses_json: String = conn
            .prepare("SELECT addresses FROM discovered_peers WHERE peer_id = ?1")?
            .query_row(rusqlite::params![peer_id], |row| row.get(0))
            .map_err(|_| {
                AppError::NotFound(format!("Peer {} not found in discovered peers", peer_id))
            })?;

        let addresses: Vec<String> = serde_json::from_str(&addresses_json)?;
        let addr_str = addresses.first().ok_or_else(|| {
            AppError::NotFound(format!("No addresses for peer {}", peer_id))
        })?;

        addr_str
            .parse()
            .map_err(|e| AppError::Internal(format!("Invalid address {}: {}", addr_str, e)))
    }

    /// Update is_connected flag in discovered_peers.
    fn update_connection_status(&self, peer_id: &str, connected: bool) -> Result<(), AppError> {
        let conn = self.pool.get()?;
        conn.execute(
            "UPDATE discovered_peers SET is_connected = ?1 WHERE peer_id = ?2",
            rusqlite::params![connected as i32, peer_id],
        )?;
        Ok(())
    }
}
