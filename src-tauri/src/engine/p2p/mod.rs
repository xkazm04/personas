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
use crate::error::AppError;

use self::connection::ConnectionManager;
use self::manifest_sync::ManifestSync;
use self::mdns::MdnsService;
use self::messaging::MessageRouter;
use self::periodic::PeriodicTask;
use self::transport::QuicTransport;
use self::types::NetworkConfig;

/// Top-level P2P network service that orchestrates all sub-systems.
pub struct NetworkService {
    pub mdns: Arc<MdnsService>,
    pub transport: Arc<QuicTransport>,
    pub connections: Arc<ConnectionManager>,
    pub manifest_sync: Arc<ManifestSync>,
    pub messages: Arc<MessageRouter>,
    config: Arc<RwLock<NetworkConfig>>,
    running: Arc<RwLock<bool>>,
    cancel: CancellationToken,
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
            cancel: CancellationToken::new(),
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

        // Provide app handle to manifest sync for progress events
        if let Some(app) = app_handle {
            self.manifest_sync.set_app_handle(app).await;
        }

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
        let cancel = self.cancel.clone();
        tokio::spawn(async move {
            Self::accept_loop(transport, connections, manifest_sync, messages, cancel).await;
        });

        // Start mDNS registration and browsing
        self.mdns.register(&peer_id, &display_name, port)?;
        let mdns = self.mdns.clone();
        let pool_browse = pool.clone();
        tokio::spawn(async move {
            mdns.browse_loop(pool_browse).await;
        });

        // Start health check loop via PeriodicTask with live config
        let connections_health = self.connections.clone();
        let config_health = self.config.clone();
        let cancel = self.cancel.clone();
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
        let cancel = self.cancel.clone();
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
        let cancel = self.cancel.clone();
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
        self.cancel.cancel();
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
                                if let Err(e) = connections.handle_incoming(conn, &manifest_sync, &messages).await {
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
}
