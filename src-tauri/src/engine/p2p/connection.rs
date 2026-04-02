//! Connection lifecycle management.
//!
//! Tracks active connections by peer_id, handles Hello/HelloAck handshake,
//! health checks (Ping/Pong), and auto-reconnect.

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};

use super::manifest_sync::ManifestSync;
use super::messaging::MessageRouter;
use super::protocol::{self, Message, PROTOCOL_VERSION};
use super::transport::QuicTransport;
use super::types::{
    ConnectionHealth, ConnectionMetricsSnapshot, ConnectionState, DisconnectReason,
    PeerConnectionInfo,
};
use crate::db::DbPool;
use crate::error::AppError;

/// Atomic counters for connection lifecycle observability.
pub struct ConnectionMetrics {
    pub connections_established: AtomicU64,
    pub connections_dropped_health: AtomicU64,
    pub connections_dropped_user: AtomicU64,
    pub connections_dropped_shutdown: AtomicU64,
    pub connections_dropped_protocol: AtomicU64,
    pub connections_rejected_capacity: AtomicU64,
    /// Total outbound connection attempts (including failures).
    pub connection_attempts: AtomicU64,
    /// Cumulative connection establishment time in milliseconds (for averaging).
    pub total_connect_duration_ms: AtomicU64,
}

impl ConnectionMetrics {
    fn new() -> Self {
        Self {
            connections_established: AtomicU64::new(0),
            connections_dropped_health: AtomicU64::new(0),
            connections_dropped_user: AtomicU64::new(0),
            connections_dropped_shutdown: AtomicU64::new(0),
            connections_dropped_protocol: AtomicU64::new(0),
            connections_rejected_capacity: AtomicU64::new(0),
            connection_attempts: AtomicU64::new(0),
            total_connect_duration_ms: AtomicU64::new(0),
        }
    }

    fn record_disconnect(&self, reason: DisconnectReason) {
        match reason {
            DisconnectReason::HealthCheck => {
                self.connections_dropped_health.fetch_add(1, Ordering::Relaxed);
            }
            DisconnectReason::User => {
                self.connections_dropped_user.fetch_add(1, Ordering::Relaxed);
            }
            DisconnectReason::Shutdown => {
                self.connections_dropped_shutdown.fetch_add(1, Ordering::Relaxed);
            }
            DisconnectReason::ProtocolError => {
                self.connections_dropped_protocol.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    pub fn snapshot(&self) -> ConnectionMetricsSnapshot {
        let established = self.connections_established.load(Ordering::Relaxed);
        let total_duration = self.total_connect_duration_ms.load(Ordering::Relaxed);
        let avg_connect_duration_ms = if established > 0 {
            Some(total_duration as f64 / established as f64)
        } else {
            None
        };
        ConnectionMetricsSnapshot {
            connections_established: established,
            connections_dropped_health: self.connections_dropped_health.load(Ordering::Relaxed),
            connections_dropped_user: self.connections_dropped_user.load(Ordering::Relaxed),
            connections_dropped_shutdown: self.connections_dropped_shutdown.load(Ordering::Relaxed),
            connections_dropped_protocol: self.connections_dropped_protocol.load(Ordering::Relaxed),
            connections_rejected_capacity: self
                .connections_rejected_capacity
                .load(Ordering::Relaxed),
            connection_attempts: self.connection_attempts.load(Ordering::Relaxed),
            avg_connect_duration_ms,
        }
    }
}

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
    metrics: ConnectionMetrics,
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
            metrics: ConnectionMetrics::new(),
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
    ///
    /// After the QUIC handshake completes, spawns an inbound dispatch loop so
    /// the remote peer can send Pings, ManifestRequests, and AgentMessages
    /// back through this connection (QUIC connections are bidirectional).
    pub async fn connect_to_peer(
        &self,
        peer_id: &str,
        manifest_sync: Arc<ManifestSync>,
        messages: Arc<MessageRouter>,
    ) -> Result<(), AppError> {
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
            self.metrics
                .connections_rejected_capacity
                .fetch_add(1, Ordering::Relaxed);
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

        let result = self
            .connect_to_peer_inner(peer_id, manifest_sync, messages)
            .await;

        // Always remove from connecting set
        self.connecting.lock().await.remove(peer_id);

        result
    }

    /// Determine whether an outgoing (local-initiated) connection should win
    /// over an incoming (remote-initiated) one when both peers connect
    /// simultaneously. The peer with the lexicographically smaller peer_id is
    /// the canonical initiator — its outgoing connection wins.
    fn outgoing_wins(&self, remote_peer_id: &str) -> bool {
        self.local_peer_id.as_str() < remote_peer_id
    }

    /// Attempt to insert a new connection, applying a deterministic tie-breaker
    /// when a connection to the same peer already exists (simultaneous connect).
    ///
    /// `is_outgoing` – true when we initiated the connection, false for incoming.
    ///
    /// Returns `true` if the new connection was inserted (caller should spawn
    /// the inbound dispatch loop), `false` if the new connection lost the
    /// tie-break and was closed.
    async fn try_insert_connection(
        &self,
        peer_id: &str,
        new_conn: PeerConnection,
        is_outgoing: bool,
    ) -> bool {
        let mut conns = self.connections.write().await;

        if let Some(existing) = conns.get(peer_id) {
            // Simultaneous connect detected — apply tie-breaker.
            let dominated = if self.outgoing_wins(peer_id) {
                // Our outgoing connection wins. If this IS the outgoing one,
                // replace the existing incoming. Otherwise close the new incoming.
                !is_outgoing
            } else {
                // Remote's outgoing (our incoming) wins. If this IS the incoming
                // one, replace the existing outgoing. Otherwise close the new outgoing.
                is_outgoing
            };

            if dominated {
                // The new connection lost — close it and keep the existing one.
                tracing::info!(
                    peer_id = %peer_id,
                    is_outgoing = is_outgoing,
                    "Simultaneous connect tie-break: closing new connection, keeping existing"
                );
                new_conn
                    .quinn_conn
                    .close(quinn::VarInt::from_u32(2), b"simultaneous connect tie-break");
                return false;
            }

            // The new connection won — close the existing one before replacing.
            tracing::info!(
                peer_id = %peer_id,
                is_outgoing = is_outgoing,
                "Simultaneous connect tie-break: replacing existing connection with new one"
            );
            existing
                .quinn_conn
                .close(quinn::VarInt::from_u32(2), b"simultaneous connect tie-break");
        }

        conns.insert(peer_id.to_string(), new_conn);
        true
    }

    /// Inner connection logic, separated so `connect_to_peer` can manage the connecting guard.
    async fn connect_to_peer_inner(
        &self,
        peer_id: &str,
        manifest_sync: Arc<ManifestSync>,
        messages: Arc<MessageRouter>,
    ) -> Result<(), AppError> {
        self.metrics.connection_attempts.fetch_add(1, Ordering::Relaxed);
        let connect_start = std::time::Instant::now();

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

        // Clone the connection handle for the dispatch loop before moving into storage.
        let dispatch_conn = quinn_conn.clone();

        // Build the connection entry
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

        // Insert with tie-breaker to handle simultaneous connect race
        if !self.try_insert_connection(peer_id, conn, true).await {
            // Lost the tie-break — the incoming connection from this peer wins.
            tracing::debug!(peer_id = %peer_id, "Outgoing connection lost tie-break, aborting");
            return Ok(());
        }

        let connect_duration_ms = connect_start.elapsed().as_millis() as u64;
        self.metrics
            .connections_established
            .fetch_add(1, Ordering::Relaxed);
        self.metrics
            .total_connect_duration_ms
            .fetch_add(connect_duration_ms, Ordering::Relaxed);

        // Update discovered_peers DB
        self.update_connection_status(peer_id, true)?;

        tracing::info!(peer_id = %peer_id, connect_duration_ms = connect_duration_ms, "Connected to peer");

        // Spawn inbound dispatch loop so the remote peer can send Pings,
        // ManifestRequests, and AgentMessages back through this connection.
        Self::spawn_inbound_dispatch(dispatch_conn, peer_id.to_string(), manifest_sync, messages);

        Ok(())
    }

    /// Handle an incoming QUIC connection (accept Hello, send HelloAck),
    /// then spawn a stream dispatch loop to process subsequent streams
    /// (Ping, ManifestRequest, AgentMessage) from the remote peer.
    pub async fn handle_incoming(
        &self,
        quinn_conn: quinn::Connection,
        manifest_sync: Arc<ManifestSync>,
        messages: Arc<MessageRouter>,
    ) -> Result<(), AppError> {
        // Enforce max_peers limit for incoming connections
        if self.is_at_capacity().await {
            self.metrics
                .connections_rejected_capacity
                .fetch_add(1, Ordering::Relaxed);
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

        // Clone the connection handle for the dispatch loop before moving into storage.
        let dispatch_conn = quinn_conn.clone();

        // Build the connection entry
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

        // Insert with tie-breaker to handle simultaneous connect race
        if !self.try_insert_connection(&remote_peer_id, conn, false).await {
            // Lost the tie-break — the outgoing connection to this peer wins.
            tracing::debug!(peer_id = %remote_peer_id, "Incoming connection lost tie-break, closing");
            return Ok(());
        }

        self.metrics
            .connections_established
            .fetch_add(1, Ordering::Relaxed);

        self.update_connection_status(&remote_peer_id, true)?;

        tracing::info!(peer_id = %remote_peer_id, "Accepted incoming connection");

        // Spawn a dispatch loop to handle subsequent streams from the remote peer.
        // Without this, Ping/ManifestRequest/AgentMessage streams opened by the
        // connecting peer would be silently dropped.
        Self::spawn_inbound_dispatch(dispatch_conn, remote_peer_id, manifest_sync, messages);

        Ok(())
    }

    /// Spawn a background task that accepts new bidirectional streams on an
    /// inbound QUIC connection and dispatches each message to the appropriate
    /// handler (Pong for Ping, ManifestResponse for ManifestRequest, store
    /// for AgentMessage). Each stream is handled in its own task so slow
    /// operations don't block stream acceptance.
    /// Maximum inbound messages per peer per rate-limit window before disconnecting.
    const PEER_MSG_RATE_LIMIT: u64 = 100;
    /// Rate-limit window duration.
    const PEER_MSG_RATE_WINDOW: std::time::Duration = std::time::Duration::from_secs(10);

    fn spawn_inbound_dispatch(
        quinn_conn: quinn::Connection,
        peer_id: String,
        manifest_sync: Arc<ManifestSync>,
        messages: Arc<MessageRouter>,
    ) {
        tokio::spawn(async move {
            let mut rate_window_start = std::time::Instant::now();
            let mut rate_msg_count: u64 = 0;

            loop {
                let (send, recv) = match quinn_conn.accept_bi().await {
                    Ok(pair) => pair,
                    Err(quinn::ConnectionError::ApplicationClosed(_))
                    | Err(quinn::ConnectionError::LocallyClosed) => {
                        tracing::debug!(
                            peer_id = %peer_id,
                            "Inbound dispatch loop ending: connection closed"
                        );
                        break;
                    }
                    Err(e) => {
                        tracing::warn!(
                            peer_id = %peer_id,
                            "Inbound stream accept error, ending dispatch: {}", e
                        );
                        break;
                    }
                };

                // Per-peer rate limiting: reset window or check threshold
                if rate_window_start.elapsed() > Self::PEER_MSG_RATE_WINDOW {
                    rate_window_start = std::time::Instant::now();
                    rate_msg_count = 0;
                }
                rate_msg_count += 1;
                if rate_msg_count > Self::PEER_MSG_RATE_LIMIT {
                    tracing::warn!(
                        peer_id = %peer_id,
                        msg_count = rate_msg_count,
                        "Peer exceeded message rate limit, disconnecting"
                    );
                    quinn_conn.close(
                        quinn::VarInt::from_u32(3),
                        b"rate limit exceeded",
                    );
                    break;
                }

                let peer_id = peer_id.clone();
                let manifest_sync = manifest_sync.clone();
                let messages = messages.clone();

                tokio::spawn(async move {
                    let mut send = tokio::io::BufWriter::new(send);
                    let mut recv = tokio::io::BufReader::new(recv);

                    let msg = match tokio::time::timeout(
                        std::time::Duration::from_secs(10),
                        protocol::decode(&mut recv),
                    )
                    .await
                    {
                        Ok(Ok(msg)) => msg,
                        Ok(Err(e)) => {
                            tracing::debug!(
                                peer_id = %peer_id,
                                "Inbound stream decode error: {}", e
                            );
                            return;
                        }
                        Err(_) => {
                            tracing::debug!(
                                peer_id = %peer_id,
                                "Inbound stream read timeout"
                            );
                            return;
                        }
                    };

                    if let Err(e) =
                        Self::dispatch_inbound_message(msg, &mut send, &peer_id, &manifest_sync, &messages).await
                    {
                        tracing::debug!(
                            peer_id = %peer_id,
                            "Inbound dispatch error: {}", e
                        );
                    }
                });
            }
        });
    }

    /// Handle a single message received on an inbound stream.
    async fn dispatch_inbound_message(
        msg: Message,
        send: &mut tokio::io::BufWriter<quinn::SendStream>,
        peer_id: &str,
        manifest_sync: &ManifestSync,
        messages: &MessageRouter,
    ) -> Result<(), AppError> {
        match msg {
            Message::Ping => {
                protocol::write_message(send, &Message::Pong).await?;
            }
            Message::ManifestRequest => {
                let resources = manifest_sync.build_local_manifest()?;
                protocol::write_message(send, &Message::ManifestResponse { resources }).await?;
            }
            Message::AgentMessage { envelope } => {
                messages.store_received(peer_id, envelope).await?;
            }
            other => {
                tracing::debug!(
                    peer_id = %peer_id,
                    msg = ?other,
                    "Unexpected message on inbound stream, ignoring"
                );
            }
        }
        Ok(())
    }

    /// Disconnect from a peer, recording the reason for observability.
    pub async fn disconnect_peer(&self, peer_id: &str) -> Result<(), AppError> {
        self.disconnect_peer_with_reason(peer_id, DisconnectReason::User)
            .await
    }

    /// Disconnect with an explicit reason (used internally by health checks, shutdown, etc.).
    async fn disconnect_peer_with_reason(
        &self,
        peer_id: &str,
        reason: DisconnectReason,
    ) -> Result<(), AppError> {
        if let Some(conn) = self.connections.write().await.remove(peer_id) {
            conn.quinn_conn
                .close(quinn::VarInt::from_u32(0), b"disconnect");
            self.metrics.record_disconnect(reason);
            self.update_connection_status(peer_id, false)?;
            tracing::info!(peer_id = %peer_id, reason = ?reason, "Disconnected from peer");
        }
        Ok(())
    }

    /// Disconnect from all peers.
    pub async fn disconnect_all(&self) {
        let mut conns = self.connections.write().await;
        for (peer_id, conn) in conns.drain() {
            conn.quinn_conn
                .close(quinn::VarInt::from_u32(0), b"shutdown");
            self.metrics.record_disconnect(DisconnectReason::Shutdown);
            if let Err(e) = self.update_connection_status(&peer_id, false) {
                tracing::warn!(peer_id = %peer_id, error = %e, "Failed to update connection status during disconnect_all");
            }
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
    /// Collects all ping results, then applies updates in a single write-lock pass.
    pub async fn run_health_checks(&self) -> Result<(), crate::error::AppError> {
        use futures_util::stream::{self, StreamExt};

        let peer_ids: Vec<String> = self
            .connections
            .read()
            .await
            .keys()
            .cloned()
            .collect();

        // Collect ping results without holding the write lock
        let results: Vec<(String, Result<u64, crate::error::AppError>)> = stream::iter(peer_ids)
            .map(|peer_id| async move {
                let result = self.ping_peer_latency(&peer_id).await;
                (peer_id, result)
            })
            .buffer_unordered(8)
            .collect()
            .await;

        // Apply all successful updates in a single write-lock acquisition
        let mut failed_peers = Vec::new();
        {
            let mut conns = self.connections.write().await;
            for (peer_id, result) in &results {
                match result {
                    Ok(latency_ms) => {
                        if let Some(conn) = conns.get_mut(peer_id) {
                            conn.info.last_ping = Some(chrono::Utc::now());
                            conn.info.last_latency_ms = Some(*latency_ms);
                        }
                    }
                    Err(e) => {
                        tracing::warn!(peer_id = %peer_id, "Ping failed: {}", e);
                        failed_peers.push(peer_id.clone());
                    }
                }
            }
        }

        for peer_id in failed_peers {
            let _ = self
                .disconnect_peer_with_reason(&peer_id, DisconnectReason::HealthCheck)
                .await;
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

    /// Send a Ping and wait for a Pong. Returns latency in milliseconds.
    async fn ping_peer_latency(&self, peer_id: &str) -> Result<u64, AppError> {
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
            Message::Pong => Ok(ping_start.elapsed().as_millis() as u64),
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

    /// Get a snapshot of connection lifecycle metrics.
    pub fn get_connection_metrics(&self) -> ConnectionMetricsSnapshot {
        self.metrics.snapshot()
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
