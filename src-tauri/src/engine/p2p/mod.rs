//! P2P networking layer for the Invisible Apps system.
//!
//! Provides LAN peer discovery (mDNS), QUIC transport, connection management,
//! manifest sync, and agent-to-agent messaging.

pub mod types;
pub mod protocol;
pub mod transport;
pub mod mdns;
pub mod connection;
pub mod manifest_sync;
pub mod messaging;
pub mod periodic;

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use crate::db::DbPool;
use crate::engine::event_registry::{emit_event, event_name};
use crate::error::AppError;

use self::connection::ConnectionManager;
use self::manifest_sync::ManifestSync;
use self::mdns::MdnsService;
use self::messaging::MessageRouter;
use self::periodic::PeriodicTask;
use self::transport::QuicTransport;
use self::types::{NetworkConfig, NetworkSnapshot, NetworkStatusInfo};

/// Top-level P2P network service that orchestrates all sub-systems.
pub struct NetworkService {
    pub mdns: Arc<MdnsService>,
    pub transport: Arc<QuicTransport>,
    pub connections: Arc<ConnectionManager>,
    pub manifest_sync: Arc<ManifestSync>,
    pub messages: Arc<MessageRouter>,
    config: Arc<RwLock<NetworkConfig>>,
    running: Arc<RwLock<bool>>,
    cancel: Arc<RwLock<CancellationToken>>,
    pool: DbPool,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
}

impl NetworkService {
    /// Create a new NetworkService (does not start background tasks yet).
    pub fn new(pool: DbPool, peer_id: String, display_name: String) -> Result<Self, AppError> {
        let default_config = NetworkConfig::default();
        let config = Arc::new(RwLock::new(default_config.clone()));
        let transport = Arc::new(QuicTransport::new(peer_id.clone())?);
        let mdns = Arc::new(MdnsService::new(pool.clone()));
        let connections = Arc::new(ConnectionManager::new(
            transport.clone(),
            pool.clone(),
            peer_id.clone(),
            display_name.clone(),
            default_config.max_peers,
        ));
        let manifest_sync = Arc::new(ManifestSync::new(pool.clone(), connections.clone()));
        let messages = Arc::new(MessageRouter::new(connections.clone()));

        // Reset stale is_connected flags from previous app session
        {
            let conn = pool.get().map_err(|e| AppError::Internal(format!("Pool error: {e}")))?;
            conn.execute("UPDATE discovered_peers SET is_connected = 0 WHERE is_connected = 1", [])
                .map_err(|e| AppError::Internal(format!("Failed to reset peer connections: {e}")))?;
        }

        Ok(Self {
            mdns,
            transport,
            connections,
            manifest_sync,
            messages,
            config,
            running: Arc::new(RwLock::new(false)),
            cancel: Arc::new(RwLock::new(CancellationToken::new())),
            pool,
            app_handle: Arc::new(RwLock::new(None)),
        })
    }

    /// Start all background tasks (mDNS, QUIC listener, health checks, manifest sync).
    pub async fn start(
        &self,
        pool: DbPool,
        peer_id: String,
        display_name: String,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<(), AppError> {
        let mut running = self.running.write().await;
        if *running {
            return Ok(());
        }

        // Store app handle for event emission
        if let Some(app) = app_handle {
            *self.app_handle.write().await = Some(app);
        }

        // Mint a fresh CancellationToken so restarts work after a previous stop().
        let token = CancellationToken::new();
        *self.cancel.write().await = token.clone();

        let config = self.config.read().await;
        let port = config.port;
        drop(config);

        // Start QUIC listener
        self.transport.bind(port).await?;

        // Start accepting incoming connections
        let transport = self.transport.clone();
        let connections = self.connections.clone();
        let manifest_sync = self.manifest_sync.clone();
        let messages = self.messages.clone();
        let cancel = token.clone();
        tokio::spawn(async move {
            Self::accept_loop(transport, connections, manifest_sync, messages, cancel).await;
        });

        // Start mDNS registration and browsing
        self.mdns.register(&peer_id, &display_name, port)?;
        let mdns = self.mdns.clone();
        let pool_browse = pool.clone();
        let cancel_browse = token.clone();
        tokio::spawn(async move {
            mdns.browse_loop(pool_browse, cancel_browse).await;
        });

        // Start health check loop via PeriodicTask with live config
        let connections_health = self.connections.clone();
        let config_health = self.config.clone();
        let cancel = token.clone();
        tokio::spawn(async move {
            PeriodicTask::with_dynamic_interval(
                "p2p_health_check",
                move || {
                    let secs = config_health.try_read()
                        .map(|c| c.health_check_interval_secs)
                        .unwrap_or(15);
                    Duration::from_secs(secs)
                },
                cancel,
            )
            .run(|| {
                let conns = connections_health.clone();
                async move { conns.run_health_checks().await.map_err(|e| e.to_string()) }
            })
            .await;
        });

        // Start periodic manifest sync via PeriodicTask with live config
        let manifest_sync = self.manifest_sync.clone();
        let config_manifest = self.config.clone();
        let cancel = token.clone();
        tokio::spawn(async move {
            PeriodicTask::with_dynamic_interval(
                "p2p_manifest_sync",
                move || {
                    let secs = config_manifest.try_read()
                        .map(|c| c.manifest_sync_interval_secs)
                        .unwrap_or(30);
                    Duration::from_secs(secs)
                },
                cancel,
            )
            .run(|| {
                let ms = manifest_sync.clone();
                async move { ms.run_periodic_sync().await.map_err(|e| e.to_string()) }
            })
            .await;
        });

        // Start periodic mDNS peer pruning via PeriodicTask with live config
        let mdns_prune = self.mdns.clone();
        let config_prune = self.config.clone();
        let cancel = token.clone();
        tokio::spawn(async move {
            PeriodicTask::with_dynamic_interval(
                "p2p_mdns_prune",
                move || {
                    let secs = config_prune.try_read()
                        .map(|c| c.stale_peer_timeout_secs)
                        .unwrap_or(60);
                    Duration::from_secs(secs)
                },
                cancel,
            )
            .run(|| {
                let m = mdns_prune.clone();
                async move { m.prune_stale_peers(120).map(|_| ()).map_err(|e| e.to_string()) }
            })
            .await;
        });

        // Start message receiver
        let messages = self.messages.clone();
        let connections_msg = self.connections.clone();
        tokio::spawn(async move {
            messages.receive_loop(connections_msg).await;
        });

        // Start periodic snapshot emitter — pushes network state to the frontend
        // via Tauri events so the UI doesn't need to poll via IPC.
        {
            let app_h = self.app_handle.clone();
            let pool_snap = self.pool.clone();
            let transport_snap = self.transport.clone();
            let mdns_snap = self.mdns.clone();
            let conns_snap = self.connections.clone();
            let msgs_snap = self.messages.clone();
            let ms_snap = self.manifest_sync.clone();
            let config_snap = self.config.clone();
            let cancel = token.clone();
            tokio::spawn(async move {
                PeriodicTask::with_dynamic_interval(
                    "p2p_snapshot_emitter",
                    move || {
                        let secs = config_snap.try_read()
                            .map(|c| c.health_check_interval_secs)
                            .unwrap_or(15);
                        // Emit at health-check cadence (default 15s)
                        Duration::from_secs(secs)
                    },
                    cancel,
                )
                .run(|| {
                    let app_h = app_h.clone();
                    let pool = pool_snap.clone();
                    let transport = transport_snap.clone();
                    let mdns = mdns_snap.clone();
                    let conns = conns_snap.clone();
                    let msgs = msgs_snap.clone();
                    let ms = ms_snap.clone();
                    async move {
                        let guard = app_h.read().await;
                        let app = match guard.as_ref() {
                            Some(a) => a,
                            None => return Ok(()),
                        };
                        let snapshot = build_snapshot(&pool, &transport, &mdns, &conns, &msgs, &ms).await;
                        emit_event(app, event_name::NETWORK_SNAPSHOT_UPDATED, &snapshot);
                        Ok(())
                    }
                })
                .await;
            });
        }

        *running = true;
        tracing::info!(port = port, "P2P NetworkService started");
        Ok(())
    }

    /// Stop all background tasks.
    pub async fn stop(&self) -> Result<(), AppError> {
        let mut running = self.running.write().await;
        if !*running {
            return Ok(());
        }
        // Signal all PeriodicTask loops to shut down
        self.cancel.read().await.cancel();
        self.mdns.unregister();
        self.connections.disconnect_all().await;
        *running = false;
        tracing::info!("P2P NetworkService stopped");
        Ok(())
    }

    /// Check if the network service is running.
    pub async fn is_running(&self) -> bool {
        *self.running.read().await
    }

    /// Get current network config.
    pub async fn get_config(&self) -> NetworkConfig {
        self.config.read().await.clone()
    }

    /// Update network config.
    pub async fn set_config(&self, new_config: NetworkConfig) {
        let mut config = self.config.write().await;
        *config = new_config;
    }

    /// Accept incoming QUIC connections in a loop, exiting when cancelled.
    async fn accept_loop(
        transport: Arc<QuicTransport>,
        connections: Arc<ConnectionManager>,
        manifest_sync: Arc<ManifestSync>,
        messages: Arc<MessageRouter>,
        cancel: CancellationToken,
    ) {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::info!("accept_loop shutting down (cancellation received)");
                    break;
                }
                result = transport.accept() => {
                    match result {
                        Ok(conn) => {
                            let connections = connections.clone();
                            let manifest_sync = manifest_sync.clone();
                            let messages = messages.clone();
                            tokio::spawn(async move {
                                if let Err(e) = connections.handle_incoming(conn, manifest_sync, messages).await {
                                    tracing::warn!("Incoming connection failed: {}", e);
                                }
                            });
                        }
                        Err(e) => {
                            tracing::error!("QUIC accept error: {}", e);
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                        }
                    }
                }
            }
        }
    }

    /// Get the port the QUIC endpoint is listening on.
    pub async fn listening_port(&self) -> Option<u16> {
        self.transport.local_port().await
    }

    /// Build and emit a network snapshot event to the frontend.
    /// Called after state-changing operations (connect, disconnect) for instant UI updates.
    pub async fn emit_snapshot(&self) {
        let guard = self.app_handle.read().await;
        if let Some(app) = guard.as_ref() {
            let snapshot = build_snapshot(
                &self.pool, &self.transport, &self.mdns, &self.connections,
                &self.messages, &self.manifest_sync,
            ).await;
            emit_event(app, event_name::NETWORK_SNAPSHOT_UPDATED, &snapshot);
        }
    }
}

/// Build a [`NetworkSnapshot`] from the current state of all subsystems.
async fn build_snapshot(
    pool: &DbPool,
    transport: &QuicTransport,
    mdns: &MdnsService,
    connections: &ConnectionManager,
    messages: &MessageRouter,
    manifest_sync: &ManifestSync,
) -> NetworkSnapshot {
    let is_running = true; // only called while running
    let listening_port = transport.local_port().await;
    let connected_peer_count = connections.connected_count().await;
    let peers = mdns.get_discovered_peers().unwrap_or_default();
    let discovered_peer_count = peers.len() as u32;

    let local_peer_id = crate::engine::identity::get_or_create_identity(pool)
        .map(|id| id.peer_id)
        .unwrap_or_default();

    let status = NetworkStatusInfo {
        is_running,
        listening_port,
        discovered_peer_count,
        connected_peer_count,
        local_peer_id,
    };

    let health = connections.get_connection_health().await;
    let messaging_metrics = messages.get_metrics();
    let connection_metrics = connections.get_connection_metrics();
    let manifest_sync_metrics = manifest_sync.get_metrics();

    NetworkSnapshot {
        status,
        health,
        discovered_peers: peers,
        messaging_metrics,
        connection_metrics,
        manifest_sync_metrics,
    }
}
