//! Boot phase: the startup report, and the loops that start after it.

use std::path::Path;
use std::sync::Arc;

use crate::db::DbPool;
use crate::startup_timing::{self, StartupTimer};
use crate::{commands, engine, AppState};

#[cfg(feature = "p2p")]
use crate::companion;

#[cfg(feature = "desktop")]
use crate::tray;

// Finalize startup timing and log the report
pub fn log_startup_report(st: StartupTimer, app_data_dir: &Path) {
    let total_ms = st.finalize();
    tracing::info!(total_ms, "Backend setup completed");
    if let Some(report) = startup_timing::get_report() {
        let timing_text = startup_timing::format_boot_log(report);
        tracing::info!("{}", timing_text);
        // Append timing to last_boot.log
        let boot_log = app_data_dir.join("logs").join("last_boot.log");
        let _ = std::fs::OpenOptions::new()
            .append(true)
            .open(&boot_log)
            .and_then(|mut f| {
                use std::io::Write;
                f.write_all(timing_text.as_bytes())
            });
    }
}

// Bootstrap the process-scoped "system" API key now so the
// management HTTP API has a credential ready when the desktop
// frontend or any in-process consumer first hits an /api/* route.
// Fire-and-forget: if this fails the user can still mint a key
// via the Tauri commands later, and the management API will reject
// calls until they do.
pub fn bootstrap_system_api_key(state_arc: &Arc<AppState>) {
    {
        let bootstrap_pool = state_arc.db.clone();
        tauri::async_runtime::spawn_blocking(move || {
            match engine::management_api::get_or_create_system_api_key(&bootstrap_pool) {
                Ok(key) => {
                    // Also export the connector-bridge env in THIS process
                    // so the split engine's in-process connector tools can
                    // reach the :9420 credential proxy (same vars the CLI
                    // path injects into the personas-mcp sidecar). Set once
                    // at startup; edition 2021 → set_var is safe.
                    std::env::set_var("PERSONAS_API_KEY", &key);
                    std::env::set_var("PERSONAS_BRIDGE_URL", "http://127.0.0.1:9420");
                    tracing::info!("System API key bootstrapped");
                }
                Err(e) => tracing::warn!(
                    "Failed to bootstrap system API key: {} (management API \
                     routes will reject requests until a key is created)",
                    e
                ),
            }
        });
    }
}

pub fn spawn_scheduler_autostart(
    app: &tauri::App,
    state_arc: &Arc<AppState>,
    scheduler: Arc<engine::background::SchedulerState>,
    pool: DbPool,
    engine: Arc<engine::ExecutionEngine>,
) {
    let app_handle = app.handle().clone();
    let startup_cloud_client = state_arc.cloud_client.clone();
    let startup_relay_state = state_arc.cloud_webhook_relay_state.clone();
    let startup_shared_relay_state = state_arc.shared_event_relay_state.clone();
    let startup_rate_limiter = state_arc.rate_limiter.clone();
    let startup_tier_config = state_arc.tier_config.clone();
    #[cfg(feature = "desktop")]
    let startup_ambient_ctx = state_arc.ambient_context.clone();
    #[cfg(feature = "desktop")]
    let startup_rule_engine = state_arc.context_rule_engine.clone();
    let startup_composite_state = state_arc.composite_state.clone();
    let startup_smee_notifier = state_arc.smee_relay_notifier.clone();

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let _webhook_shutdown = engine::background::start_loops(
            scheduler,
            app_handle.clone(),
            pool,
            engine,
            startup_rate_limiter,
            startup_tier_config,
            startup_cloud_client,
            startup_relay_state,
            startup_shared_relay_state,
            #[cfg(feature = "desktop")]
            startup_ambient_ctx,
            #[cfg(feature = "desktop")]
            startup_rule_engine,
            startup_composite_state,
            startup_smee_notifier,
        );
        tracing::info!("Scheduler auto-started");
        #[cfg(feature = "desktop")]
        tray::refresh_tray(&app_handle);
        // Keep _webhook_shutdown alive for the lifetime of the app.
        // When this task ends (app shutdown), the sender is dropped,
        // triggering graceful webhook server shutdown.
        futures_util::future::pending::<()>().await;
    });
}

// Auto-start P2P network service after a brief delay
#[cfg(feature = "p2p")]
pub fn spawn_p2p_autostart(
    state_arc: &Arc<AppState>,
    restore_handle: &tauri::AppHandle,
    network_service: Option<Arc<engine::p2p::NetworkService>>,
) {
    if let Some(ns) = network_service {
        let ns_pool = state_arc.db.clone();
        let p2p_app_handle = restore_handle.clone();
        tauri::async_runtime::spawn(async move {
            // Athena takes over the remote-job seam BEFORE the network
            // starts listening. Until it is installed, an arriving job
            // is answered by `UnhandledRemoteJobs` — accepted, then
            // immediately failed with "no assistant configured" — so
            // installing after `start()` would leave a real window in
            // which a paired device's request is refused by a device
            // that can, in fact, run it.
            companion::remote_jobs::install(&p2p_app_handle, &ns).await;
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            if let Ok(identity) = engine::identity::get_or_create_identity(&ns_pool) {
                if let Err(e) = ns
                    .start(
                        ns_pool,
                        identity.peer_id,
                        identity.display_name,
                        Some(p2p_app_handle),
                    )
                    .await
                {
                    tracing::warn!("P2P network service start failed: {}", e);
                }
            }
        });
    }
}

// Attempt auth session restore from keyring, then keep the session
// refreshed proactively. The Supabase JWT lives ~1h; without this
// loop it was only minted at startup and never renewed, so a
// long-running session 401'd ~1h after launch.
pub fn spawn_auth_session_restore(restore_handle: tauri::AppHandle, restore_state: Arc<AppState>) {
    let refresh_loop_handle = restore_handle.clone();
    let refresh_loop_state = restore_state.clone();
    tauri::async_runtime::spawn(async move {
        commands::infrastructure::auth::try_restore_session(&restore_handle, &restore_state).await;
        commands::infrastructure::auth::spawn_session_refresh_loop(
            refresh_loop_handle,
            refresh_loop_state,
        );
    });
}
