//! P2P networking layer for the Invisible Apps system.
//!
//! Provides LAN peer discovery (mDNS), QUIC transport, connection management,
//! manifest sync, and agent-to-agent messaging.

pub mod connection;
pub mod device_pairing;
pub mod manifest_sync;
pub mod mdns;
pub mod messaging;
pub mod periodic;
pub mod protocol;
pub mod remote_jobs;
pub mod remote_sessions;
pub mod transport;
pub mod types;

#[cfg(test)]
mod loopback_tests;

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use crate::event_registry::{emit_event, event_name};
use personas_core::error::AppError;
use personas_db::models::{DeviceReachability, DispatchDevice};
use personas_db::repos::resources::owned_devices as owned_devices_repo;
use personas_db::repos::resources::remote_jobs as remote_jobs_repo;
use personas_db::DbPool;

use self::connection::ConnectionManager;
use self::device_pairing::DevicePairing;
use self::manifest_sync::ManifestSync;
use self::mdns::MdnsService;
use self::messaging::MessageRouter;
use self::periodic::PeriodicTask;
use self::remote_jobs::RemoteJobs;
use self::transport::QuicTransport;
use self::types::{NetworkConfig, NetworkSnapshot, NetworkStatusInfo};

/// Top-level P2P network service that orchestrates all sub-systems.
pub struct NetworkService {
    pub mdns: Arc<MdnsService>,
    pub transport: Arc<QuicTransport>,
    pub connections: Arc<ConnectionManager>,
    pub manifest_sync: Arc<ManifestSync>,
    pub messages: Arc<MessageRouter>,
    pub pairing: Arc<DevicePairing>,
    /// Cross-device instruction dispatch. The companion layer installs its
    /// executor here at startup via `remote_jobs.set_executor(...)`; until it
    /// does, accepted jobs fail immediately with a stated reason.
    pub remote_jobs: Arc<RemoteJobs>,
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
        let transport = Arc::new(QuicTransport::new(peer_id.clone())?);
        let connections = Arc::new(ConnectionManager::new(
            transport.clone(),
            pool.clone(),
            peer_id,
            display_name,
            default_config.max_peers,
        ));
        Self::assemble(pool, default_config, transport, connections)
    }

    /// A service whose handshake identity is `key` rather than the process
    /// identity, so two of them can live in one test process. Test-only; see
    /// `connection::LocalSigner`.
    #[cfg(test)]
    pub(crate) fn new_with_test_identity(
        pool: DbPool,
        key: ed25519_dalek::SigningKey,
        display_name: String,
    ) -> Result<Self, AppError> {
        let default_config = NetworkConfig::default();
        let peer_id = crate::identity::public_key_to_peer_id(&key.verifying_key());
        let transport = Arc::new(QuicTransport::new(peer_id)?);
        let connections = Arc::new(ConnectionManager::with_test_identity(
            transport.clone(),
            pool.clone(),
            key,
            display_name,
            default_config.max_peers,
        ));
        Self::assemble(pool, default_config, transport, connections)
    }

    fn assemble(
        pool: DbPool,
        default_config: NetworkConfig,
        transport: Arc<QuicTransport>,
        connections: Arc<ConnectionManager>,
    ) -> Result<Self, AppError> {
        let config = Arc::new(RwLock::new(default_config));
        let mdns = Arc::new(MdnsService::new(pool.clone()));
        let manifest_sync = Arc::new(ManifestSync::new(pool.clone(), connections.clone()));
        let messages = Arc::new(MessageRouter::new(connections.clone()));
        // Created here (rather than inline in the struct literal) so the same
        // handle cell is shared with `DevicePairing`, which needs it to emit
        // pairing events without a second copy that `start()` would forget.
        let app_handle: Arc<RwLock<Option<tauri::AppHandle>>> = Arc::new(RwLock::new(None));
        let pairing = Arc::new(DevicePairing::new(
            pool.clone(),
            connections.clone(),
            app_handle.clone(),
        ));
        let remote_jobs = Arc::new(RemoteJobs::new(
            pool.clone(),
            connections.clone(),
            app_handle.clone(),
        ));

        // Reset stale is_connected flags from previous app session
        {
            let conn = pool
                .get()
                .map_err(|e| AppError::Internal(format!("Pool error: {e}")))?;
            conn.execute(
                "UPDATE discovered_peers SET is_connected = 0 WHERE is_connected = 1",
                [],
            )
            .map_err(|e| AppError::Internal(format!("Failed to reset peer connections: {e}")))?;
        }
        // Likewise nothing can be mid-send across a restart: an outbound job
        // left `pending` goes back to the outbox, or it would be stranded.
        let requeued = remote_jobs_repo::requeue_stranded_pending(&pool)?;
        if requeued > 0 {
            tracing::info!(requeued, "Returned stranded remote-job sends to the outbox");
        }

        Ok(Self {
            mdns,
            transport,
            connections,
            manifest_sync,
            messages,
            pairing,
            remote_jobs,
            config,
            running: Arc::new(RwLock::new(false)),
            cancel: Arc::new(RwLock::new(CancellationToken::new())),
            pool,
            app_handle,
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
        let pairing = self.pairing.clone();
        let remote_jobs = self.remote_jobs.clone();
        let cancel = token.clone();
        tokio::spawn(async move {
            Self::accept_loop(
                transport,
                connections,
                manifest_sync,
                messages,
                pairing,
                remote_jobs,
                cancel,
            )
            .await;
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
                    let secs = config_health
                        .try_read()
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
                    let secs = config_manifest
                        .try_read()
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
                    let secs = config_prune
                        .try_read()
                        .map(|c| c.stale_peer_timeout_secs)
                        .unwrap_or(60);
                    Duration::from_secs(secs)
                },
                cancel,
            )
            .run(|| {
                let m = mdns_prune.clone();
                async move {
                    m.prune_stale_peers(120)
                        .map(|_| ())
                        .map_err(|e| e.to_string())
                }
            })
            .await;
        });

        // Auto-connect owned devices: once now (for devices discovered in an
        // earlier session), again whenever mDNS writes new peers, and on every
        // health-check tick (a device that dropped and came back). This is the
        // reader `NetworkConfig.auto_connect` never had: owned devices ALWAYS
        // connect; `auto_connect` additionally opts trusted (non-owned) peers in.
        {
            let this = self.auto_connector();
            let signal = self.mdns.discovery_signal();
            let config_ac = self.config.clone();
            let cancel = token.clone();
            tokio::spawn(async move {
                loop {
                    this.sweep().await;
                    let secs = config_ac
                        .try_read()
                        .map(|c| c.health_check_interval_secs)
                        .unwrap_or(15);
                    tokio::select! {
                        _ = cancel.cancelled() => break,
                        _ = signal.notified() => {}
                        _ = tokio::time::sleep(Duration::from_secs(secs)) => {}
                    }
                }
                tracing::info!("p2p auto-connect loop stopped");
            });
        }

        // Start periodic rate-tracker cleanup via PeriodicTask so it honors
        // the shutdown cancel token (the previous receive_loop ignored cancel
        // and leaked the task on stop()).
        let messages = self.messages.clone();
        let cancel = token.clone();
        tokio::spawn(async move {
            PeriodicTask::with_dynamic_interval(
                "p2p_rate_tracker_cleanup",
                || Duration::from_secs(60),
                cancel,
            )
            .run(|| {
                let m = messages.clone();
                async move {
                    m.cleanup_stale_rate_entries();
                    Ok(())
                }
            })
            .await;
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
                        let secs = config_snap
                            .try_read()
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
                        let snapshot =
                            build_snapshot(&pool, &transport, &mdns, &conns, &msgs, &ms).await;
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
    #[allow(clippy::too_many_arguments)]
    async fn accept_loop(
        transport: Arc<QuicTransport>,
        connections: Arc<ConnectionManager>,
        manifest_sync: Arc<ManifestSync>,
        messages: Arc<MessageRouter>,
        pairing: Arc<DevicePairing>,
        remote_jobs: Arc<RemoteJobs>,
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
                            let pairing = pairing.clone();
                            let remote_jobs = remote_jobs.clone();
                            tokio::spawn(async move {
                                if let Err(e) = connections
                                    .handle_incoming(
                                        conn,
                                        manifest_sync,
                                        messages,
                                        pairing,
                                        remote_jobs,
                                    )
                                    .await
                                {
                                    tracing::warn!("Incoming connection failed: {}", e);
                                }
                            });
                        }
                        Err(e) => {
                            tracing::error!("QUIC accept error: {}", e);
                            // Honor cancellation during the 1s back-off so shutdown is snappy.
                            tokio::select! {
                                _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {}
                                _ = cancel.cancelled() => {
                                    tracing::info!("accept_loop shutting down during accept-error backoff");
                                    break;
                                }
                            }
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

    /// Dial one peer by the address in its `discovered_peers` row.
    pub async fn connect_peer(&self, peer_id: &str) -> Result<(), AppError> {
        self.connections
            .connect_to_peer(
                peer_id,
                self.manifest_sync.clone(),
                self.messages.clone(),
                self.pairing.clone(),
                self.remote_jobs.clone(),
            )
            .await
    }

    /// How reachable one device is right now: `Connected` when an
    /// authenticated connection is up, `Stale` when this device has seen it on
    /// the LAN (a `discovered_peers` row exists, however old) but no connection
    /// is up, `Offline` otherwise.
    pub async fn device_reachability(&self, peer_id: &str) -> DeviceReachability {
        reachability(&self.connections, &self.mdns, peer_id).await
    }

    /// Every paired device except this one, as a dispatch target with its
    /// reachability right now. Home device first, then by name.
    pub async fn dispatch_devices(&self) -> Result<Vec<DispatchDevice>, AppError> {
        let local = self.connections.local_peer_id().to_string();
        let mut out = Vec::new();
        for device in owned_devices_repo::list_owned_devices(&self.pool)? {
            if device.peer_id == local {
                continue;
            }
            let reachability = self.device_reachability(&device.peer_id).await;
            out.push(DispatchDevice {
                peer_id: device.peer_id,
                display_name: device.display_name,
                is_home: device.is_home,
                reachability,
            });
        }
        out.sort_by(|a, b| {
            b.is_home.cmp(&a.is_home).then_with(|| {
                a.display_name
                    .to_lowercase()
                    .cmp(&b.display_name.to_lowercase())
            })
        });
        Ok(out)
    }

    fn auto_connector(&self) -> AutoConnector {
        AutoConnector {
            pool: self.pool.clone(),
            mdns: self.mdns.clone(),
            config: self.config.clone(),
            connections: self.connections.clone(),
            manifest_sync: self.manifest_sync.clone(),
            messages: self.messages.clone(),
            pairing: self.pairing.clone(),
            remote_jobs: self.remote_jobs.clone(),
        }
    }

    /// Run one auto-connect pass now. Returns how many dials were attempted.
    pub async fn auto_connect_sweep(&self) -> usize {
        self.auto_connector().sweep().await
    }

    /// Bind the QUIC endpoint on an ephemeral port and accept connections, with
    /// NO mDNS and none of the periodic loops. Test-only: the loopback test
    /// drives two services by `127.0.0.1:<port>` in one process.
    #[cfg(test)]
    pub(crate) async fn start_transport_for_test(&self) -> Result<u16, AppError> {
        self.transport.bind(0).await?;
        let token = CancellationToken::new();
        *self.cancel.write().await = token.clone();
        tokio::spawn(Self::accept_loop(
            self.transport.clone(),
            self.connections.clone(),
            self.manifest_sync.clone(),
            self.messages.clone(),
            self.pairing.clone(),
            self.remote_jobs.clone(),
            token,
        ));
        self.transport
            .local_port()
            .await
            .ok_or_else(|| AppError::Internal("endpoint bound without a port".into()))
    }

    /// Build and emit a network snapshot event to the frontend.
    /// Called after state-changing operations (connect, disconnect) for instant UI updates.
    pub async fn emit_snapshot(&self) {
        let guard = self.app_handle.read().await;
        if let Some(app) = guard.as_ref() {
            let snapshot = build_snapshot(
                &self.pool,
                &self.transport,
                &self.mdns,
                &self.connections,
                &self.messages,
                &self.manifest_sync,
            )
            .await;
            emit_event(app, event_name::NETWORK_SNAPSHOT_UPDATED, &snapshot);
        }
    }
}

/// `Connected` / `Stale` / `Offline` for one device; see
/// [`NetworkService::device_reachability`].
async fn reachability(
    connections: &ConnectionManager,
    mdns: &MdnsService,
    peer_id: &str,
) -> DeviceReachability {
    if connections.is_connected(peer_id).await {
        return DeviceReachability::Connected;
    }
    match mdns.has_discovered_row(peer_id) {
        Ok(true) => DeviceReachability::Stale,
        Ok(false) => DeviceReachability::Offline,
        Err(e) => {
            tracing::warn!(peer_id = %peer_id, "Could not read discovered peers: {e}");
            DeviceReachability::Offline
        }
    }
}

/// Everything one auto-connect pass needs, cloned out of the service so the
/// loop owns it.
struct AutoConnector {
    pool: DbPool,
    mdns: Arc<MdnsService>,
    config: Arc<RwLock<NetworkConfig>>,
    connections: Arc<ConnectionManager>,
    manifest_sync: Arc<ManifestSync>,
    messages: Arc<MessageRouter>,
    pairing: Arc<DevicePairing>,
    remote_jobs: Arc<RemoteJobs>,
}

impl AutoConnector {
    /// Dial every candidate that is known on the LAN, not connected, and on the
    /// dialling side of the deterministic tie-break. Candidates are the owned
    /// devices, always, plus the trusted peers when `auto_connect` is on. Dials
    /// run concurrently (at most 4 at once) and each failure is logged and
    /// forgotten: the next pass tries again, so there is no retry budget.
    async fn sweep(&self) -> usize {
        use futures_util::stream::{self, StreamExt};

        let mut candidates: Vec<String> = match owned_devices_repo::list_owned_devices(&self.pool) {
            Ok(devices) => devices.into_iter().map(|d| d.peer_id).collect(),
            Err(e) => {
                tracing::warn!("auto-connect: could not list owned devices: {e}");
                Vec::new()
            }
        };
        if self.config.read().await.auto_connect {
            candidates.extend(mdns::load_trusted_peer_ids(&self.pool));
        }
        candidates.sort();
        candidates.dedup();

        let mut targets = Vec::new();
        for peer_id in candidates {
            if peer_id == self.connections.local_peer_id()
                || !self.connections.should_dial(&peer_id)
                || self.connections.is_connected(&peer_id).await
            {
                continue;
            }
            if self.mdns.has_discovered_row(&peer_id).unwrap_or(false) {
                targets.push(peer_id);
            }
        }

        let attempted = targets.len();
        stream::iter(targets)
            .for_each_concurrent(4, |peer_id| async move {
                if let Err(e) = self
                    .connections
                    .connect_to_peer(
                        &peer_id,
                        self.manifest_sync.clone(),
                        self.messages.clone(),
                        self.pairing.clone(),
                        self.remote_jobs.clone(),
                    )
                    .await
                {
                    tracing::debug!(peer_id = %peer_id, "auto-connect dial failed: {e}");
                }
            })
            .await;
        attempted
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

    let (local_peer_id, identity_degraded) = crate::identity::local_peer_id_for_status(pool);

    let status = NetworkStatusInfo {
        is_running,
        listening_port,
        discovered_peer_count,
        connected_peer_count,
        local_peer_id,
        identity_degraded,
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
