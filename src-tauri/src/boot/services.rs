//! Boot phase: process-wide registries, restored clients, and the local HTTP server.

use std::sync::Arc;

use crate::db::{self, DbPool};
use crate::startup_timing::StartupTimer;
use crate::{browser_bridge, cloud, commands, companion, engine, gitlab, local_http};

// Initialise the connector strategy registry (healthcheck + rotation dispatch)
pub fn init_connector_registry(pool: &DbPool, st: &mut StartupTimer) {
    engine::connector_strategy::init_registry();
    // Seed the registry-keyword snapshot consulted by intent-analysis
    // heuristics (gates::intent_implies_connectors, templates::extract_keywords).
    // Without this seed, those heuristics fall back to a hardcoded list and
    // miss any user-added connector until the next CRUD refreshes the snapshot.
    engine::api_proxy::refresh_connector_keyword_snapshot(pool);
    st.checkpoint("connector_registry");
}

// Restore cloud client from keyring if previously connected
pub fn restore_cloud_client(st: &mut StartupTimer) -> Option<Arc<cloud::client::CloudClient>> {
    let cloud_client_opt = cloud::config::load_cloud_config()
        .and_then(|(url, key)| cloud::client::CloudClient::new(url, key).ok().map(Arc::new));
    if cloud_client_opt.is_some() {
        tracing::info!("Cloud orchestrator config restored from keyring");
    }
    st.checkpoint("cloud_restore");

    cloud_client_opt
}

// Restore GitLab client from keyring if previously connected
pub fn restore_gitlab_client(st: &mut StartupTimer) -> Option<Arc<gitlab::client::GitLabClient>> {
    let gitlab_client_opt = gitlab::config::load_gitlab_config().and_then(|token| {
        gitlab::client::GitLabClient::new("https://gitlab.com".to_string(), token)
            .ok()
            .map(Arc::new)
    });
    if gitlab_client_opt.is_some() {
        tracing::info!("GitLab config restored from keyring");
    }
    st.checkpoint("gitlab_restore");

    gitlab_client_opt
}

// Browser-bridge pairing token: persist across runs so the
// extension pairs once. Env override (QA) wins inside
// init_pairing_token; first run mints + stores a token.
pub fn init_browser_bridge_pairing_token(pool: &DbPool) {
    match db::repos::core::settings::get(pool, db::settings_keys::BROWSER_BRIDGE_PAIRING_TOKEN) {
        Ok(Some(t)) if !t.trim().is_empty() => {
            browser_bridge::init_pairing_token(&t);
        }
        _ => {
            let t = browser_bridge::pairing_token();
            if let Err(e) = db::repos::core::settings::set(
                pool,
                db::settings_keys::BROWSER_BRIDGE_PAIRING_TOKEN,
                &t,
            ) {
                tracing::warn!(error = %e, "browser-bridge: pairing token persist failed (runtime token still works)");
            }
        }
    }
}

// Start the in-app HTTP server (binds 127.0.0.1, free port at-or
// above 17400). Hosts authenticated-redirect routes for the
// user's default browser. Register routers BEFORE starting;
// later registrations are dropped with a warn.
pub fn start_local_http(app: &tauri::App, st: &mut StartupTimer) {
    local_http::register_router("project-tracking", engine::project_tracking::push::router());
    // Fleet hook receiver — Claude Code lifecycle hooks POST here.
    local_http::register_router(
        "fleet",
        commands::fleet::hooks::router(app.handle().clone()),
    );
    // Athena MCP server (Direction 3) — Claude Code sessions
    // discover this via per-session `--mcp-config` and call
    // athena.* tools (report_intent, checkpoint,
    // request_guidance, request_approval).
    local_http::register_router(
        "mcp",
        companion::orchestration::mcp::router(app.handle().clone()),
    );
    // Browser bridge (Athena × Chrome tester arc, Phase 1) —
    // /browser-bridge/ws for the extension, /browser-bridge/mcp for
    // browser-test turns' --mcp-config.
    local_http::register_router("browser-bridge", browser_bridge::router());
    // Dev-tools headless bridge — trigger a context-map scan (and
    // register/list projects) from a terminal without the UI:
    //   POST /dev-tools/scan-codebase {"project_id":...} → {scan_id}
    local_http::register_router(
        "dev-tools",
        commands::infrastructure::dev_tools_http::router(app.handle().clone()),
    );
    // Fleet background workers — staleness ticker + JSONL watcher.
    // Both fire-and-forget; the staleness ticker is safe everywhere,
    // the JSONL watcher is desktop-only because `notify` is feature-gated.
    commands::fleet::stale::spawn_ticker(app.handle().clone());
    // Fleet mobile companion — LAN server restarts only when a live
    // device pairing already exists (fleet_pair_device starts it fresh).
    commands::fleet::companion_api::start_if_paired(app.handle().clone());
    #[cfg(feature = "desktop")]
    commands::fleet::transcript::spawn_watcher(app.handle().clone());
    match local_http::start() {
        Ok(port) => {
            tracing::info!(port, "local_http server started");
            // Self-heal Fleet hooks on port drift. local_http picks the
            // first free port in its range, so a restart can bind a
            // DIFFERENT port than the installed Claude Code hooks target
            // — and every hook (SessionStart/Stop/Notification/…) then
            // POSTs into the void, silently stripping spawned sessions of
            // hook-driven state (they fall back to transcript-growth only,
            // which reads "stale" where they should read idle/awaiting).
            // Re-point them to the live port so the fleet stays observable.
            match commands::fleet::hook_install::check_hooks(port) {
                Ok(s) if s.installed && !s.port_matches => {
                    match commands::fleet::hook_install::install_hooks(port) {
                        Ok(_) => tracing::info!(
                            port,
                            "fleet hooks re-pointed to live local_http port (drift self-heal)"
                        ),
                        Err(e) => {
                            tracing::warn!(error = %e, "fleet hook self-heal failed")
                        }
                    }
                }
                _ => {}
            }
        }
        Err(e) => tracing::warn!(error = %e, "local_http server failed to start"),
    }
    st.checkpoint("local_http");
}

// Initialize P2P NetworkService (Phase 2: Invisible Apps)
#[cfg(feature = "p2p")]
pub fn init_p2p_network_service(pool: &DbPool) -> Option<Arc<engine::p2p::NetworkService>> {
    match engine::identity::get_or_create_identity(pool) {
        Ok(identity) => {
            match engine::p2p::NetworkService::new(
                pool.clone(),
                identity.peer_id.clone(),
                identity.display_name.clone(),
            ) {
                Ok(ns) => {
                    tracing::info!("P2P NetworkService initialized");
                    Some(Arc::new(ns))
                }
                Err(e) => {
                    tracing::warn!("P2P NetworkService initialization failed: {}", e);
                    None
                }
            }
        }
        Err(e) => {
            tracing::warn!("P2P identity not available, NetworkService deferred: {}", e);
            None
        }
    }
}
