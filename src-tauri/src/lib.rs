pub mod background_job;
mod cloud;
mod commands;
mod db;
mod engine;
mod error;
mod gitlab;
pub mod ipc_auth;
mod logging;
mod notifications;
#[cfg(feature = "test-automation")]
pub mod test_automation;
#[cfg(feature = "desktop")]
mod tray;
mod utils;
mod validation;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use db::DbPool;
use tauri::{Emitter, Manager};

/// Shared HTTP client for all general-purpose HTTP callsites.
///
/// `reqwest::Client` is backed by an `Arc` internally, so `.clone()` is cheap
/// and all clones share the same connection pool, TLS sessions, and DNS cache.
/// This eliminates the overhead of constructing a fresh TLS connector and
/// connection pool on every request.
pub(crate) static SHARED_HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("Failed to build shared HTTP client")
});

/// Tracks an active CLI-backed process: its task ID and optional child PID.
#[derive(Default)]
pub struct ActiveProcess {
    /// The ID of the currently-running task (e.g. design_id, negotiation_id).
    pub id: Option<String>,
    /// PID of the CLI child process, used to kill on cancel.
    pub child_pid: Option<u32>,
}

/// Unified registry for all active child processes and cancellation flags.
///
/// Consolidates two patterns into a single structure:
///
/// 1. **Single-process domains** (design, credential_design, negotiation,
///    automation_design, auto_cred): one active (id, child_pid) pair per domain.
///
/// 2. **Multi-run domains** (test, pipeline, review, setup): multiple concurrent
///    runs per domain, each with an `AtomicBool` cancellation flag and optional
///    child PID. Keyed by `"{domain}\0{run_id}"` internally.
pub struct ActiveProcessRegistry {
    /// Single-process domains: one active (id, pid) per domain.
    processes: Mutex<HashMap<String, ActiveProcess>>,
    /// Multi-run cancellation flags keyed by `"{domain}\0{run_id}"`.
    run_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Multi-run child PIDs keyed by `"{domain}\0{run_id}"`.
    run_pids: Mutex<HashMap<String, u32>>,
}

impl Default for ActiveProcessRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ActiveProcessRegistry {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
            run_flags: Mutex::new(HashMap::new()),
            run_pids: Mutex::new(HashMap::new()),
        }
    }

    fn run_key(domain: &str, run_id: &str) -> String {
        format!("{domain}\0{run_id}")
    }

    // ── Single-process domain methods ──────────────────────────────

    /// Set the active task ID for a domain.
    pub fn set_id(&self, domain: &str, id: String) {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(domain.to_string()).or_default().id = Some(id);
    }

    /// Get the active task ID for a domain.
    pub fn get_id(&self, domain: &str) -> Option<String> {
        let map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        map.get(domain).and_then(|p| p.id.clone())
    }

    /// Clear the active task ID for a domain (only if it matches the expected value).
    pub fn clear_id_if(&self, domain: &str, expected: &str) {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(proc) = map.get_mut(domain) {
            if proc.id.as_deref() == Some(expected) {
                proc.id = None;
            }
        }
    }

    /// Clear the active task ID unconditionally and return the old value.
    pub fn take_id(&self, domain: &str) -> Option<String> {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        map.get_mut(domain).and_then(|p| p.id.take())
    }

    /// Set the child PID for a domain.
    pub fn set_pid(&self, domain: &str, pid: u32) {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(domain.to_string()).or_default().child_pid = Some(pid);
    }

    /// Take (remove and return) the child PID for a domain.
    pub fn take_pid(&self, domain: &str) -> Option<u32> {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        map.get_mut(domain).and_then(|p| p.child_pid.take())
    }

    /// Clear the child PID for a domain.
    pub fn clear_pid(&self, domain: &str) {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(proc) = map.get_mut(domain) {
            proc.child_pid = None;
        }
    }

    /// Cancel an active process: clear the ID and kill the child process if running.
    pub fn cancel(&self, domain: &str) -> Option<u32> {
        let mut map = self.processes.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(proc) = map.get_mut(domain) {
            proc.id = None;
            proc.child_pid.take()
        } else {
            None
        }
    }

    // ── Multi-run domain methods ───────────────────────────────────

    /// Register a new run and return its cancellation flag (initialised to `false`).
    pub fn register_run(&self, domain: &str, run_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        let key = Self::run_key(domain, run_id);
        let mut map = self.run_flags.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(key, flag.clone());
        flag
    }

    /// Set the cancellation flag for a run to `true`.
    pub fn cancel_run(&self, domain: &str, run_id: &str) {
        let key = Self::run_key(domain, run_id);
        let map = self.run_flags.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(flag) = map.get(&key) {
            flag.store(true, Ordering::Release);
        }
    }

    /// Remove a run's cancellation flag (cleanup after completion).
    pub fn unregister_run(&self, domain: &str, run_id: &str) {
        let key = Self::run_key(domain, run_id);
        let mut flags = self.run_flags.lock().unwrap_or_else(|e| e.into_inner());
        flags.remove(&key);
        let mut pids = self.run_pids.lock().unwrap_or_else(|e| e.into_inner());
        pids.remove(&key);
    }

    /// Store a child PID for a multi-run.
    pub fn set_run_pid(&self, domain: &str, run_id: &str, pid: u32) {
        let key = Self::run_key(domain, run_id);
        let mut map = self.run_pids.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(key, pid);
    }

    /// Take (remove and return) the child PID for a multi-run.
    pub fn take_run_pid(&self, domain: &str, run_id: &str) -> Option<u32> {
        let key = Self::run_key(domain, run_id);
        let mut map = self.run_pids.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(&key)
    }

    /// Remove a multi-run's child PID without returning it.
    pub fn clear_run_pid(&self, domain: &str, run_id: &str) {
        let key = Self::run_key(domain, run_id);
        let mut map = self.run_pids.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(&key);
    }

    /// Register a run and return `(cancellation_flag, guard)`.
    /// The guard calls `unregister_run` on drop — even if the task panics.
    pub fn register_run_guarded(
        self: &Arc<Self>,
        domain: &str,
        run_id: &str,
    ) -> (Arc<AtomicBool>, RunGuard) {
        let flag = self.register_run(domain, run_id);
        let guard = RunGuard {
            registry: Arc::clone(self),
            domain: domain.to_string(),
            run_id: run_id.to_string(),
        };
        (flag, guard)
    }
}

/// RAII guard that calls `unregister_run` when dropped.
/// Move this into a `tokio::spawn` block to guarantee cleanup on both
/// normal completion and task panic.
pub struct RunGuard {
    registry: Arc<ActiveProcessRegistry>,
    domain: String,
    run_id: String,
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        self.registry.unregister_run(&self.domain, &self.run_id);
    }
}

/// Shared application state accessible from all Tauri commands.
#[allow(clippy::type_complexity)]
pub struct AppState {
    pub db: DbPool,
    /// Separate user-facing database (`personas_data.db`).
    /// Agents and users can freely read/write here without affecting app internals.
    pub user_db: db::UserDbPool,
    pub engine: Arc<engine::ExecutionEngine>,
    pub scheduler: Arc<engine::background::SchedulerState>,
    /// Registry of active CLI-backed processes (design, credential_design,
    /// negotiation, automation_design, auto_cred).
    pub process_registry: Arc<ActiveProcessRegistry>,
    /// Authentication state (Supabase OAuth).
    pub auth: Arc<tokio::sync::Mutex<commands::infrastructure::auth::AuthStateInner>>,
    /// Serialises token refresh attempts so that only one in-flight refresh
    /// executes at a time, preventing the race where concurrent callers each
    /// consume the same single-use refresh token (Supabase rotates on use).
    pub refresh_lock: Arc<tokio::sync::Mutex<()>>,
    /// Cloud orchestrator HTTP client (None when not connected).
    pub cloud_client: Arc<tokio::sync::Mutex<Option<Arc<cloud::client::CloudClient>>>>,
    /// Maps local execution ID -> cloud execution ID for active cloud runs.
    pub cloud_exec_ids: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    /// GitLab API client (None when not connected).
    pub gitlab_client: Arc<tokio::sync::Mutex<Option<Arc<gitlab::client::GitLabClient>>>>,
    /// Rate limiter for event publishing and webhook intake.
    pub rate_limiter: Arc<engine::rate_limiter::RateLimiter>,
    /// Session-specific RSA key pair for encrypted IPC.
    pub session_key: Arc<engine::crypto::SessionKeyPair>,
    /// Current tier configuration (rate limits, queue depth).
    pub tier_config: Arc<Mutex<engine::tier::TierConfig>>,
    /// Desktop connector capability approvals.
    #[cfg(feature = "desktop")]
    pub desktop_approvals: Arc<engine::desktop_security::DesktopApprovalStore>,
    /// Local agent runtime for cross-app desktop plan execution.
    #[cfg(feature = "desktop")]
    pub desktop_runtime: Arc<engine::desktop_runtime::DesktopRuntime>,
    /// Ambient context fusion: rolling window of desktop signals for persona senses.
    #[cfg(feature = "desktop")]
    pub ambient_context: engine::ambient_context::AmbientContextHandle,
    /// Context rule engine: pattern-based subscriptions for proactive persona actions.
    #[cfg(feature = "desktop")]
    pub context_rule_engine: engine::context_rules::ContextRuleEngineHandle,
    /// P2P network service (LAN discovery, QUIC transport, manifest sync).
    pub network: Option<Arc<engine::p2p::NetworkService>>,
    /// Cached auth detection results with expiry time.
    /// Avoids re-spawning 9 CLI probes + cookie DB copies on repeated wizard calls.
    pub auth_detect_cache: Arc<tokio::sync::Mutex<Option<(std::time::Instant, Vec<commands::credentials::auth_detect::AuthDetection>)>>>,
    /// Embedding manager for vector knowledge bases (lazy-loaded model).
    pub embedding_manager: Option<Arc<engine::embedder::EmbeddingManager>>,
    /// SQLite-vec vector store for knowledge bases.
    pub vector_store: Option<Arc<engine::vector_store::SqliteVectorStore>>,
    /// Build session manager for multi-turn agent builder sessions.
    pub build_session_manager: Arc<engine::build_session::BuildSessionManager>,
}

/// Hello world IPC command -- verifies the Rust <-> React bridge works.
#[tauri::command]
#[tracing::instrument]
fn greet(name: String) -> String {
    tracing::info!(name = %name, "greet command called");
    format!("Hello from Rust, {}! Personas desktop is alive.", name)
}

/// Called from the WebView to persist frontend errors to the Rust log file.
#[tauri::command]
fn log_frontend_error(level: String, message: String) {
    logging::webview_log(&level, &message);
    match level.as_str() {
        "error" => tracing::error!(target: "webview", "{}", message),
        "warn" => tracing::warn!(target: "webview", "{}", message),
        _ => tracing::info!(target: "webview", "{}", message),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env file (project root) into process environment so that
    // runtime env vars like SUPABASE_URL are available without needing
    // them baked in at compile time.
    dotenvy::dotenv().ok();

    logging::init();

    tracing::info!("Starting Personas Desktop v{}", env!("CARGO_PKG_VERSION"));

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());

    // Desktop-only plugins
    #[cfg(feature = "desktop")]
    {
        // Only enforce single-instance in release builds so dev and production
        // can run side by side on the same machine.
        #[cfg(not(debug_assertions))]
        {
            builder = builder
                .plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
                    tracing::info!("Single-instance callback fired, argv: {:?}", argv);
                }));
        }

        builder = builder
            .plugin(tauri_plugin_window_state::Builder::new().build())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("ipc-auth")
                .js_init_script(ipc_auth::IPC_AUTH_SCRIPT.to_string())
                .build(),
        )
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;

            let pool = db::init_db(&app_data_dir)?;
            tracing::info!("Database pool ready (max_size=8)");

            let user_db_pool = db::init_user_db(&app_data_dir)?;
            tracing::info!("User data database pool ready (max_size=4)");

            // Seed built-in local credentials (database, vector KB, messaging)
            {
                let conn = pool.get().map_err(|e| format!("Failed to get DB connection for credential seed: {e}"))?;
                if let Err(e) = db::seed_builtin_credentials(&conn) {
                    tracing::warn!("Failed to seed built-in credentials: {}", e);
                }
            }

            // Initialize P2P identity (Invisible Apps Phase 1)
            match engine::identity::get_or_create_identity(&pool) {
                Ok(identity) => {
                    tracing::info!(peer_id = %identity.peer_id, "P2P identity ready");
                }
                Err(e) => {
                    tracing::warn!("P2P identity initialization deferred: {}", e);
                }
            }

            // Encrypt any legacy plaintext credentials
            match engine::crypto::migrate_plaintext_credentials(&pool) {
                Ok((migrated, failed)) => {
                    if migrated > 0 || failed > 0 {
                        tracing::info!(
                            "Credential migration: {} encrypted, {} failed (unparseable rows remain unencrypted)",
                            migrated,
                            failed
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!("Credential migration skipped: {}", e);
                }
            }

            // Encrypt any legacy plaintext notification channel secrets
            match engine::crypto::migrate_plaintext_notification_secrets(&pool) {
                Ok((migrated, skipped)) => {
                    if migrated > 0 || skipped > 0 {
                        tracing::info!(
                            "Notification channel secret migration: {} encrypted, {} skipped",
                            migrated,
                            skipped
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!("Notification channel secret migration skipped: {}", e);
                }
            }

            // Initialise the connector strategy registry (healthcheck + rotation dispatch)
            engine::connector_strategy::init_registry();

            // Install panic crash hook that writes to crash_logs/ before aborting
            logging::install_crash_hook(&app_data_dir);

            // Enable file-based logging for production diagnostics
            logging::add_file_layer(&app_data_dir);

            let log_dir = app_data_dir.join("logs");

            // Mark any executions left in running/queued state as failed
            // (their processes died when the app last exited)
            engine::ExecutionEngine::recover_stale_executions(&pool);

            // Mark n8n transform sessions interrupted by app exit as failed
            // and clear their in-memory job entries (dead cancellation tokens,
            // expired status channels) so new transforms aren't shadowed.
            match db::repos::resources::n8n_sessions::recover_interrupted_sessions(&pool) {
                Ok(transform_ids) if !transform_ids.is_empty() => {
                    let n8n_manager = commands::design::n8n_transform::job_state::manager();
                    for tid in &transform_ids {
                        let _ = n8n_manager.remove(tid);
                    }
                    tracing::info!(
                        "Recovered {} interrupted n8n transform session(s), cleared in-memory job state",
                        transform_ids.len()
                    );
                }
                Err(e) => {
                    tracing::warn!("Failed to recover n8n sessions: {}", e);
                }
                _ => {}
            }

            // Purge old completed/failed events to prevent unbounded table growth
            match db::repos::communication::events::cleanup(&pool, Some(7)) {
                Ok(n) if n > 0 => tracing::info!("Startup: cleaned up {} old events", n),
                Err(e) => tracing::warn!("Startup event cleanup failed: {}", e),
                _ => {}
            }

            let scheduler = Arc::new(engine::background::SchedulerState::new());
            let engine = Arc::new(engine::ExecutionEngine::new(log_dir, scheduler.clone()));
            let auth = Arc::new(tokio::sync::Mutex::new(
                commands::infrastructure::auth::AuthStateInner::default(),
            ));

            // Restore cloud client from keyring if previously connected
            let cloud_client_opt = cloud::config::load_cloud_config()
                .and_then(|(url, key)| cloud::client::CloudClient::new(url, key).ok().map(Arc::new));
            if cloud_client_opt.is_some() {
                tracing::info!("Cloud orchestrator config restored from keyring");
            }

            // Restore GitLab client from keyring if previously connected
            let gitlab_client_opt = gitlab::config::load_gitlab_config()
                .and_then(|token| gitlab::client::GitLabClient::new(
                    "https://gitlab.com".to_string(),
                    token,
                ).ok().map(Arc::new));
            if gitlab_client_opt.is_some() {
                tracing::info!("GitLab config restored from keyring");
            }

            // Initialize P2P NetworkService (Phase 2: Invisible Apps)
            let network_service = match engine::identity::get_or_create_identity(&pool) {
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
            };

            // Initialize vector knowledge base infrastructure
            let models_dir = app_data_dir.join("models").join("onnx");
            let embedding_manager = Arc::new(engine::embedder::EmbeddingManager::new(models_dir));
            let vector_store = Arc::new(engine::vector_store::SqliteVectorStore::new(user_db_pool.clone()));

            let state_arc = Arc::new(AppState {
                db: pool.clone(),
                user_db: user_db_pool,
                engine: engine.clone(),
                scheduler: scheduler.clone(),
                process_registry: Arc::new(ActiveProcessRegistry::new()),
                auth: auth.clone(),
                refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
                cloud_client: Arc::new(tokio::sync::Mutex::new(cloud_client_opt)),
                cloud_exec_ids: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
                gitlab_client: Arc::new(tokio::sync::Mutex::new(gitlab_client_opt)),
                rate_limiter: Arc::new(engine::rate_limiter::RateLimiter::new()),
                session_key: Arc::new(engine::crypto::SessionKeyPair::generate()?),
                tier_config: Arc::new(Mutex::new(engine::tier::TierConfig::default())),
                #[cfg(feature = "desktop")]
                desktop_approvals: Arc::new(engine::desktop_security::DesktopApprovalStore::new()),
                #[cfg(feature = "desktop")]
                desktop_runtime: Arc::new(engine::desktop_runtime::DesktopRuntime::new()),
                #[cfg(feature = "desktop")]
                ambient_context: engine::ambient_context::create_ambient_context(),
                #[cfg(feature = "desktop")]
                context_rule_engine: engine::context_rules::create_context_rule_engine(),
                auth_detect_cache: Arc::new(tokio::sync::Mutex::new(None)),
                network: network_service.clone(),
                embedding_manager: Some(embedding_manager),
                vector_store: Some(vector_store),
                build_session_manager: Arc::new(engine::build_session::BuildSessionManager::new()),
            });
            app.manage(state_arc.clone());

            // Test automation HTTP server (feature-gated)
            #[cfg(feature = "test-automation")]
            {
                let pending: test_automation::PendingResponses =
                    Arc::new(tokio::sync::Mutex::new(HashMap::new()));
                app.manage(pending.clone());
                test_automation::start_server(app.handle().clone(), pending);
            }

            // Load desktop connector approvals from database
            #[cfg(feature = "desktop")]
            if let Err(e) = state_arc.desktop_approvals.load_from_db(&state_arc.db) {
                tracing::warn!("Failed to load desktop connector approvals: {}", e);
            }

            // System tray
            #[cfg(feature = "desktop")]
            if let Err(e) = tray::setup_tray(app.handle()) {
                tracing::warn!("Failed to set up system tray: {}", e);
            }

            // Deep-link handler for OAuth callbacks
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let dl_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    tracing::info!("Deep-link on_open_url fired with {} URL(s)", urls.len());
                    for url in urls {
                        let url_str = url.to_string();
                        tracing::info!("Deep-link URL received: {}", url_str);
                        if url_str.starts_with("personas://auth/callback") {
                            let handle = dl_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) =
                                    commands::infrastructure::auth::handle_auth_callback(&handle, &url_str).await
                                {
                                    tracing::error!("Auth callback failed: {}", e);
                                    let _ = handle.emit("auth-error", serde_json::json!({
                                        "error": format!("{}", e)
                                    }));
                                }
                            });
                        }
                    }
                });

                // Register the personas:// protocol handler.
                // Required for OAuth callback deep links in both dev and production.
                #[cfg(feature = "desktop")]
                {
                    match app.deep_link().register_all() {
                        Ok(_) => tracing::info!("Deep-link protocol registered successfully"),
                        Err(e) => tracing::error!("Deep-link protocol registration failed: {}", e),
                    }
                }
            }

            // Auto-start scheduler after a brief delay
            let app_handle = app.handle().clone();
            let restore_handle = app.handle().clone();
            let restore_state = state_arc.clone();
            let startup_cloud_client = state_arc.cloud_client.clone();
            let startup_rate_limiter = state_arc.rate_limiter.clone();
            let startup_tier_config = state_arc.tier_config.clone();
            #[cfg(feature = "desktop")]
            let startup_ambient_ctx = state_arc.ambient_context.clone();
            #[cfg(feature = "desktop")]
            let startup_rule_engine = state_arc.context_rule_engine.clone();
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
                    #[cfg(feature = "desktop")]
                    startup_ambient_ctx,
                    #[cfg(feature = "desktop")]
                    startup_rule_engine,
                );
                tracing::info!("Scheduler auto-started");
                #[cfg(feature = "desktop")]
                tray::refresh_tray(&app_handle);
                // Keep _webhook_shutdown alive for the lifetime of the app.
                // When this task ends (app shutdown), the sender is dropped,
                // triggering graceful webhook server shutdown.
                futures_util::future::pending::<()>().await;
            });

            // Auto-start P2P network service after a brief delay
            if let Some(ns) = network_service {
                let ns_pool = state_arc.db.clone();
                let p2p_app_handle = restore_handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    if let Ok(identity) = engine::identity::get_or_create_identity(&ns_pool) {
                        if let Err(e) = ns.start(ns_pool, identity.peer_id, identity.display_name, Some(p2p_app_handle)).await {
                            tracing::warn!("P2P network service start failed: {}", e);
                        }
                    }
                });
            }

            // Attempt auth session restore from keyring
            tauri::async_runtime::spawn(async move {
                commands::infrastructure::auth::try_restore_session(&restore_handle, &restore_state).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Phase 1
            greet,
            log_frontend_error,
            // Test automation (feature-gated)
            #[cfg(feature = "test-automation")]
            test_automation::__test_respond,
            // Core -- Personas
            commands::core::personas::list_personas,
            commands::core::personas::get_persona,
            commands::core::personas::create_persona,
            commands::core::personas::update_persona,
            commands::core::personas::duplicate_persona,
            commands::core::personas::persona_blast_radius,
            commands::core::personas::delete_persona,
            commands::core::personas::get_persona_summaries,
            commands::core::personas::get_persona_detail,
            // Core -- Groups
            commands::core::groups::list_groups,
            commands::core::groups::create_group,
            commands::core::groups::update_group,
            commands::core::groups::delete_group,
            commands::core::groups::reorder_groups,
            // Core -- Memories
            commands::core::memories::list_memories,
            commands::core::memories::list_memories_with_stats,
            commands::core::memories::get_memory_count,
            commands::core::memories::get_memory_stats,
            commands::core::memories::list_memories_by_execution,
            commands::core::memories::create_memory,
            commands::core::memories::delete_memory,
            commands::core::memories::update_memory_importance,
            commands::core::memories::batch_delete_memories,
            commands::core::memories::review_memories_with_cli,
            // Core -- Import/Export
            commands::core::import_export::export_persona,
            commands::core::import_export::import_persona,
            // Core -- Data Portability
            commands::core::data_portability::get_export_stats,
            commands::core::data_portability::export_full,
            commands::core::data_portability::export_selective,
            commands::core::data_portability::import_portability_bundle,
            commands::core::data_portability::preview_competitive_import,
            commands::core::data_portability::export_credentials,
            commands::core::data_portability::import_credentials,
            // Core -- Saved Views
            commands::core::saved_views::create_saved_view,
            commands::core::saved_views::list_saved_views,
            commands::core::saved_views::list_saved_views_by_type,
            commands::core::saved_views::delete_saved_view,
            // Core -- Chat
            commands::core::chat::list_chat_sessions,
            commands::core::chat::get_chat_messages,
            commands::core::chat::create_chat_message,
            commands::core::chat::delete_chat_session,
            // Execution -- Executions
            commands::execution::executions::list_executions,
            commands::execution::executions::list_all_executions,
            commands::execution::executions::get_execution,
            commands::execution::executions::create_execution,
            commands::execution::executions::execute_persona,
            commands::execution::executions::cancel_execution,
            commands::execution::executions::list_executions_for_use_case,
            commands::execution::executions::get_execution_log,
            commands::execution::executions::get_execution_trace,
            commands::execution::executions::get_chain_trace,
            commands::execution::executions::get_dream_replay,
            commands::execution::executions::get_circuit_breaker_status,
            // Execution -- Scheduler
            commands::execution::scheduler::get_scheduler_status,
            commands::execution::scheduler::start_scheduler,
            commands::execution::scheduler::stop_scheduler,
            commands::execution::scheduler::get_subscription_health,
            // Execution -- Tests
            commands::execution::tests::start_test_run,
            commands::execution::tests::list_test_runs,
            commands::execution::tests::get_test_results,
            commands::execution::tests::delete_test_run,
            commands::execution::tests::cancel_test_run,
            commands::execution::tests::validate_n8n_draft,
            commands::execution::tests::test_n8n_draft,
            // Execution -- Test Suites
            commands::execution::test_suites::list_test_suites,
            commands::execution::test_suites::get_test_suite,
            commands::execution::test_suites::create_test_suite,
            commands::execution::test_suites::update_test_suite,
            commands::execution::test_suites::delete_test_suite,
            // Execution -- Output Assertions
            commands::execution::assertions::list_output_assertions,
            commands::execution::assertions::get_output_assertion,
            commands::execution::assertions::create_output_assertion,
            commands::execution::assertions::update_output_assertion,
            commands::execution::assertions::delete_output_assertion,
            commands::execution::assertions::get_assertion_results_for_execution,
            commands::execution::assertions::get_assertion_result_history,
            // Execution -- Lab
            commands::execution::lab::lab_start_arena,
            commands::execution::lab::lab_list_arena_runs,
            commands::execution::lab::lab_get_arena_results,
            commands::execution::lab::lab_delete_arena_run,
            commands::execution::lab::lab_cancel_arena,
            commands::execution::lab::lab_start_ab,
            commands::execution::lab::lab_list_ab_runs,
            commands::execution::lab::lab_get_ab_results,
            commands::execution::lab::lab_delete_ab_run,
            commands::execution::lab::lab_cancel_ab,
            commands::execution::lab::lab_start_matrix,
            commands::execution::lab::lab_list_matrix_runs,
            commands::execution::lab::lab_get_matrix_results,
            commands::execution::lab::lab_delete_matrix_run,
            commands::execution::lab::lab_cancel_matrix,
            commands::execution::lab::lab_accept_matrix_draft,
            commands::execution::lab::lab_start_eval,
            commands::execution::lab::lab_list_eval_runs,
            commands::execution::lab::lab_get_eval_results,
            commands::execution::lab::lab_delete_eval_run,
            commands::execution::lab::lab_cancel_eval,
            commands::execution::lab::lab_get_versions,
            commands::execution::lab::lab_tag_version,
            commands::execution::lab::lab_rollback_version,
            commands::execution::lab::lab_get_error_rate,
            // Execution -- Genome Breeding
            commands::execution::genome::genome_extract,
            commands::execution::genome::genome_fitness,
            commands::execution::genome::genome_start_breeding,
            commands::execution::genome::genome_list_breeding_runs,
            commands::execution::genome::genome_get_breeding_results,
            commands::execution::genome::genome_delete_breeding_run,
            commands::execution::genome::genome_adopt_offspring,
            // Execution -- Evolution (auto-evolving personas)
            commands::execution::evolution::evolution_get_policy,
            commands::execution::evolution::evolution_upsert_policy,
            commands::execution::evolution::evolution_toggle,
            commands::execution::evolution::evolution_delete_policy,
            commands::execution::evolution::evolution_list_cycles,
            commands::execution::evolution::evolution_trigger_cycle,
            commands::execution::evolution::evolution_check_eligibility,
            // Execution -- Healing
            commands::execution::healing::list_healing_issues,
            commands::execution::healing::get_healing_issue,
            commands::execution::healing::update_healing_status,
            commands::execution::healing::run_healing_analysis,
            commands::execution::healing::get_retry_chain,
            commands::execution::healing::list_healing_knowledge,
            commands::execution::healing::trigger_ai_healing,
            commands::execution::healing::get_healing_timeline,
            // Execution -- Knowledge Graph
            commands::execution::knowledge::list_execution_knowledge,
            commands::execution::knowledge::get_knowledge_injection,
            commands::execution::knowledge::get_knowledge_summary,
            commands::execution::knowledge::list_scoped_knowledge,
            commands::execution::knowledge::upsert_knowledge_annotation,
            commands::execution::knowledge::verify_knowledge_annotation,
            commands::execution::knowledge::dismiss_knowledge_annotation,
            commands::execution::knowledge::get_shared_knowledge_injection,
            // Design -- Analysis
            commands::design::analysis::start_design_analysis,
            commands::design::analysis::refine_design,
            commands::design::analysis::test_design_feasibility,
            commands::design::analysis::cancel_design_analysis,
            commands::design::analysis::compile_from_intent,
            commands::design::analysis::preview_prompt,
            // Design -- Build Sessions
            commands::design::build_sessions::start_build_session,
            commands::design::build_sessions::answer_build_question,
            commands::design::build_sessions::cancel_build_session,
            commands::design::build_sessions::get_active_build_session,
            commands::design::build_sessions::list_build_sessions,
            commands::design::build_sessions::test_build_draft,
            commands::design::build_sessions::promote_build_draft,
            // Design -- Conversations
            commands::design::conversations::list_design_conversations,
            commands::design::conversations::get_design_conversation,
            commands::design::conversations::get_active_design_conversation,
            commands::design::conversations::create_design_conversation,
            commands::design::conversations::append_design_conversation_message,
            commands::design::conversations::update_design_conversation_status,
            commands::design::conversations::delete_design_conversation,
            // Design -- N8n Transform
            commands::design::n8n_transform::cli_runner::start_n8n_transform_background,
            commands::design::n8n_transform::job_state::get_n8n_transform_snapshot,
            commands::design::n8n_transform::job_state::clear_n8n_transform_snapshot,
            commands::design::n8n_transform::job_state::cancel_n8n_transform,
            commands::design::n8n_transform::confirmation::confirm_n8n_persona_draft,
            commands::design::n8n_transform::cli_runner::continue_n8n_transform,
            // Design -- N8n Sessions
            commands::design::n8n_sessions::create_n8n_session,
            commands::design::n8n_sessions::get_n8n_session,
            commands::design::n8n_sessions::list_n8n_sessions,
            commands::design::n8n_sessions::list_n8n_session_summaries,
            commands::design::n8n_sessions::update_n8n_session,
            commands::design::n8n_sessions::delete_n8n_session,
            // Design -- Template Adopt
            commands::design::template_adopt::start_template_adopt_background,
            commands::design::template_adopt::get_template_adopt_snapshot,
            commands::design::template_adopt::clear_template_adopt_snapshot,
            commands::design::template_adopt::cancel_template_adopt,
            commands::design::template_adopt::confirm_template_adopt_draft,
            commands::design::template_adopt::generate_template_adopt_questions,
            commands::design::template_adopt::continue_template_adopt,
            commands::design::template_adopt::instant_adopt_template,
            commands::design::template_adopt::generate_template_background,
            commands::design::template_adopt::get_template_generate_snapshot,
            commands::design::template_adopt::clear_template_generate_snapshot,
            commands::design::template_adopt::cancel_template_generate,
            commands::design::template_adopt::save_custom_template,
            // Design -- Template Feedback
            commands::design::template_feedback::create_template_feedback,
            commands::design::template_feedback::list_template_feedback,
            commands::design::template_feedback::get_template_performance,
            // Design -- Team Synthesis
            commands::design::team_synthesis::synthesize_team_from_templates,
            // Design -- Platform Definitions
            commands::design::platform_definitions::list_platform_definitions,
            commands::design::platform_definitions::get_platform_definition,
            // Design -- Reviews
            commands::design::reviews::list_design_reviews,
            commands::design::reviews::list_design_reviews_paginated,
            commands::design::reviews::list_review_connectors,
            commands::design::reviews::list_review_categories,
            commands::design::reviews::cleanup_duplicate_reviews,
            commands::design::reviews::backfill_review_categories,
            commands::design::reviews::backfill_service_flow,
            commands::design::reviews::backfill_related_tools,
            commands::design::reviews::get_trending_templates,
            commands::design::reviews::get_design_review,
            commands::design::reviews::delete_design_review,
            commands::design::reviews::start_design_review_run,
            commands::design::reviews::import_design_review,
            commands::design::reviews::cancel_design_review_run,
            commands::design::reviews::rebuild_design_review,
            commands::design::reviews::get_rebuild_snapshot,
            commands::design::reviews::cancel_rebuild,
            commands::design::reviews::list_manual_reviews,
            commands::design::reviews::update_manual_review_status,
            commands::design::reviews::get_pending_review_count,
            commands::design::reviews::list_review_messages,
            commands::design::reviews::add_review_message,
            commands::design::reviews::seed_mock_manual_review,
            commands::core::memories::seed_mock_memory,
            commands::execution::knowledge::seed_mock_knowledge,
            commands::tools::triggers::seed_mock_cron_agent,
            commands::communication::messages::seed_mock_message,
            commands::communication::events::seed_mock_event,
            // Design -- Smart Search
            commands::design::smart_search::smart_search_templates,
            // Credentials -- CRUD
            commands::credentials::crud::list_credentials,
            commands::credentials::crud::get_session_public_key,
            commands::credentials::crud::create_credential,
            commands::credentials::crud::update_credential,
            commands::credentials::crud::patch_credential_metadata,
            commands::credentials::crud::credential_blast_radius,
            commands::credentials::crud::delete_credential,
            commands::credentials::crud::list_credential_events,
            commands::credentials::crud::list_all_credential_events,
            commands::credentials::crud::create_credential_event,
            commands::credentials::crud::update_credential_event,
            commands::credentials::crud::delete_credential_event,
            commands::credentials::crud::healthcheck_credential,
            commands::credentials::crud::healthcheck_credential_preview,
            commands::credentials::crud::vault_status,
            commands::credentials::crud::migrate_plaintext_credentials,
            commands::credentials::crud::list_credential_fields,
            commands::credentials::crud::update_credential_field,
            // Credentials -- Connectors
            commands::credentials::connectors::list_connectors,
            commands::credentials::connectors::get_connector,
            commands::credentials::connectors::create_connector,
            commands::credentials::connectors::update_connector,
            commands::credentials::connectors::delete_connector,
            // Credentials -- Credential Design
            commands::credentials::credential_design::start_credential_design,
            commands::credentials::credential_design::cancel_credential_design,
            commands::credentials::credential_design::test_credential_design_healthcheck,
            // Credentials -- Negotiator
            commands::credentials::negotiator::start_credential_negotiation,
            commands::credentials::negotiator::cancel_credential_negotiation,
            commands::credentials::negotiator::get_negotiation_step_help,
            // Credentials -- Intelligence
            commands::credentials::intelligence::credential_audit_log,
            commands::credentials::intelligence::credential_audit_log_global,
            commands::credentials::intelligence::credential_usage_stats,
            commands::credentials::intelligence::credential_dependents,
            // Credentials -- OAuth
            commands::credentials::oauth::start_google_credential_oauth,
            commands::credentials::oauth::get_google_credential_oauth_status,
            // Credentials -- Universal OAuth
            commands::credentials::oauth::list_oauth_providers,
            commands::credentials::oauth::start_oauth,
            commands::credentials::oauth::get_oauth_status,
            commands::credentials::oauth::refresh_oauth_token,
            // Credentials -- Auto-Credential Browser
            commands::credentials::auto_cred_browser::start_auto_cred_browser,
            commands::credentials::auto_cred_browser::save_playwright_procedure,
            commands::credentials::auto_cred_browser::get_playwright_procedure,
            commands::credentials::auto_cred_browser::check_auto_cred_playwright_available,
            commands::credentials::auto_cred_browser::cancel_auto_cred_browser,
            // Credentials -- Auth Detection
            commands::credentials::auth_detect::detect_authenticated_services,
            // Credentials -- Foraging
            commands::credentials::foraging::scan_credential_sources,
            commands::credentials::foraging::import_foraged_credential,
            // Credentials -- Rotation
            commands::credentials::rotation::list_rotation_policies,
            commands::credentials::rotation::create_rotation_policy,
            commands::credentials::rotation::update_rotation_policy,
            commands::credentials::rotation::delete_rotation_policy,
            commands::credentials::rotation::get_rotation_history,
            commands::credentials::rotation::get_rotation_status,
            commands::credentials::rotation::rotate_credential_now,
            commands::credentials::rotation::refresh_credential_oauth_now,
            commands::credentials::rotation::get_oauth_token_metrics,
            commands::credentials::rotation::get_oauth_token_lifetime_summary,
            // Credentials -- Database Schema & Queries
            commands::credentials::db_schema::list_db_schema_tables,
            commands::credentials::db_schema::create_db_schema_table,
            commands::credentials::db_schema::update_db_schema_table,
            commands::credentials::db_schema::delete_db_schema_table,
            commands::credentials::db_schema::list_db_saved_queries,
            commands::credentials::db_schema::create_db_saved_query,
            commands::credentials::db_schema::update_db_saved_query,
            commands::credentials::db_schema::delete_db_saved_query,
            commands::credentials::db_schema::execute_db_query,
            commands::credentials::db_schema::introspect_db_tables,
            commands::credentials::db_schema::introspect_db_columns,
            // Credentials -- Query Debug (AI-assisted)
            commands::credentials::query_debug::start_query_debug,
            commands::credentials::query_debug::cancel_query_debug,
            // Credentials -- Schema Proposal (AI-assisted)
            commands::credentials::schema_proposal::start_schema_proposal,
            commands::credentials::schema_proposal::get_schema_proposal_snapshot,
            commands::credentials::schema_proposal::cancel_schema_proposal,
            commands::credentials::schema_proposal::validate_db_schema,
            // Credentials -- API Proxy
            commands::credentials::api_proxy::execute_api_request,
            commands::credentials::api_proxy::get_api_proxy_metrics,
            commands::credentials::api_proxy::parse_api_definition,
            commands::credentials::api_proxy::save_api_definition,
            commands::credentials::api_proxy::load_api_definition,
            // Credentials -- MCP Tools
            commands::credentials::mcp_tools::list_mcp_tools,
            commands::credentials::mcp_tools::execute_mcp_tool,
            commands::credentials::mcp_tools::healthcheck_mcp_preview,
            commands::credentials::mcp_tools::get_mcp_pool_metrics,
            // Credentials -- Desktop Discovery & Security (desktop only)
            #[cfg(feature = "desktop")]
            commands::credentials::desktop::discover_desktop_apps,
            #[cfg(feature = "desktop")]
            commands::credentials::desktop::import_claude_mcp_servers,
            #[cfg(feature = "desktop")]
            commands::credentials::desktop::get_desktop_connector_manifest,
            #[cfg(feature = "desktop")]
            commands::credentials::desktop::get_pending_desktop_capabilities,
            #[cfg(feature = "desktop")]
            commands::credentials::desktop::approve_desktop_capabilities,
            #[cfg(feature = "desktop")]
            commands::credentials::desktop::revoke_desktop_approvals,
            #[cfg(feature = "desktop")]
            commands::credentials::desktop::is_desktop_connector_approved,
            #[cfg(feature = "desktop")]
            commands::credentials::desktop::register_imported_mcp_server,
            // Credentials -- Desktop Bridges & Runtime (desktop only)
            #[cfg(feature = "desktop")]
            commands::credentials::desktop_bridges::execute_desktop_bridge,
            #[cfg(feature = "desktop")]
            commands::credentials::desktop_bridges::execute_desktop_plan,
            #[cfg(feature = "desktop")]
            commands::credentials::desktop_bridges::get_desktop_runtime_status,
            #[cfg(feature = "desktop")]
            commands::credentials::desktop_bridges::get_desktop_plan_result,
            // Execution -- Ambient Context Fusion (desktop only)
            #[cfg(feature = "desktop")]
            commands::execution::ambient::get_ambient_context_snapshot,
            #[cfg(feature = "desktop")]
            commands::execution::ambient::set_ambient_context_enabled,
            #[cfg(feature = "desktop")]
            commands::execution::ambient::get_ambient_context_enabled,
            #[cfg(feature = "desktop")]
            commands::execution::ambient::set_ambient_sensory_policy,
            #[cfg(feature = "desktop")]
            commands::execution::ambient::get_ambient_sensory_policy,
            #[cfg(feature = "desktop")]
            commands::execution::ambient::remove_ambient_sensory_policy,
            // Execution -- Context Rules (pattern-based ambient subscriptions)
            #[cfg(feature = "desktop")]
            commands::execution::ambient::add_context_rule,
            #[cfg(feature = "desktop")]
            commands::execution::ambient::remove_context_rule,
            #[cfg(feature = "desktop")]
            commands::execution::ambient::list_context_rules,
            #[cfg(feature = "desktop")]
            commands::execution::ambient::get_context_rule_matches,
            #[cfg(feature = "desktop")]
            commands::execution::ambient::get_context_stream_stats,
            // Credential Recipes -- shared discovery cache
            commands::credentials::credential_recipes::get_credential_recipe,
            commands::credentials::credential_recipes::list_credential_recipes,
            commands::credentials::credential_recipes::upsert_credential_recipe,
            commands::credentials::credential_recipes::use_credential_recipe,
            // Recipes -- CRUD & Linking
            commands::recipes::crud::list_recipes,
            commands::recipes::crud::get_recipe,
            commands::recipes::crud::create_recipe,
            commands::recipes::crud::update_recipe,
            commands::recipes::crud::delete_recipe,
            commands::recipes::crud::link_recipe_to_persona,
            commands::recipes::crud::unlink_recipe_from_persona,
            commands::recipes::crud::get_persona_recipes,
            commands::recipes::crud::execute_recipe,
            commands::recipes::crud::start_recipe_execution,
            commands::recipes::crud::cancel_recipe_execution,
            commands::recipes::crud::get_credential_recipes,
            commands::recipes::crud::start_recipe_generation,
            commands::recipes::crud::cancel_recipe_generation,
            commands::recipes::crud::get_use_case_recipes,
            commands::recipes::crud::promote_use_case_to_recipe,
            commands::recipes::crud::get_recipe_versions,
            commands::recipes::crud::start_recipe_versioning,
            commands::recipes::crud::cancel_recipe_versioning,
            commands::recipes::crud::accept_recipe_version,
            commands::recipes::crud::revert_recipe_version,
            // Communication -- Events
            commands::communication::events::list_events,
            commands::communication::events::list_events_in_range,
            commands::communication::events::publish_event,
            commands::communication::events::list_subscriptions,
            commands::communication::events::list_all_subscriptions,
            commands::communication::events::create_subscription,
            commands::communication::events::update_subscription,
            commands::communication::events::delete_subscription,
            commands::communication::events::test_event_flow,
            // Communication -- Messages
            commands::communication::messages::list_messages,
            commands::communication::messages::get_message,
            commands::communication::messages::mark_message_read,
            commands::communication::messages::mark_all_messages_read,
            commands::communication::messages::delete_message,
            commands::communication::messages::get_unread_message_count,
            commands::communication::messages::get_message_count,
            commands::communication::messages::get_message_deliveries,
            // Communication -- Observability
            commands::communication::observability::get_metrics_summary,
            commands::communication::observability::get_metrics_chart_data,
            commands::communication::observability::get_prompt_versions,
            commands::communication::observability::get_all_monthly_spend,
            // Communication -- Prompt Performance Dashboard
            commands::communication::observability::get_prompt_performance,
            // Communication -- Execution Metrics Dashboard
            commands::communication::observability::get_execution_dashboard,
            // Communication -- Prompt Lab
            commands::communication::observability::tag_prompt_version,
            commands::communication::observability::rollback_prompt_version,
            commands::communication::observability::get_prompt_error_rate,
            commands::communication::observability::run_prompt_ab_test,
            // Communication -- SLA Dashboard
            commands::communication::sla::get_sla_dashboard,
            // Teams
            commands::teams::teams::list_teams,
            commands::teams::teams::get_team_counts,
            commands::teams::teams::get_team,
            commands::teams::teams::create_team,
            commands::teams::teams::update_team,
            commands::teams::teams::delete_team,
            commands::teams::teams::clone_team,
            commands::teams::teams::list_team_members,
            commands::teams::teams::add_team_member,
            commands::teams::teams::update_team_member,
            commands::teams::teams::remove_team_member,
            commands::teams::teams::list_team_connections,
            commands::teams::teams::create_team_connection,
            commands::teams::teams::update_team_connection,
            commands::teams::teams::delete_team_connection,
            commands::teams::teams::list_pipeline_runs,
            commands::teams::teams::get_pipeline_run,
            commands::teams::teams::execute_team,
            commands::teams::teams::cancel_pipeline,
            commands::teams::teams::get_pipeline_analytics,
            commands::teams::teams::suggest_topology,
            commands::teams::teams::suggest_topology_llm,
            commands::teams::teams::compile_workflow,
            // Team Memories
            commands::teams::team_memories::list_team_memories,
            commands::teams::team_memories::create_team_memory,
            commands::teams::team_memories::delete_team_memory,
            commands::teams::team_memories::update_team_memory,
            commands::teams::team_memories::update_team_memory_importance,
            commands::teams::team_memories::batch_delete_team_memories,
            commands::teams::team_memories::get_team_memory_count,
            commands::teams::team_memories::get_team_memory_stats,
            commands::teams::team_memories::list_team_memories_by_run,
            // Tools
            commands::tools::tools::list_tool_definitions,
            commands::tools::tools::get_tool_definition,
            commands::tools::tools::get_tool_definitions_by_category,
            commands::tools::tools::create_tool_definition,
            commands::tools::tools::update_tool_definition,
            commands::tools::tools::delete_tool_definition,
            commands::tools::tools::assign_tool,
            commands::tools::tools::unassign_tool,
            commands::tools::tools::bulk_assign_tools,
            commands::tools::tools::bulk_unassign_tools,
            commands::tools::tools::get_tool_usage_summary,
            commands::tools::tools::get_tool_usage_over_time,
            commands::tools::tools::get_tool_usage_by_persona,
            commands::tools::tools::invoke_tool_direct,
            // Tools -- Automations
            commands::tools::automations::list_automations,
            commands::tools::automations::get_automation,
            commands::tools::automations::create_automation,
            commands::tools::automations::update_automation,
            commands::tools::automations::automation_blast_radius,
            commands::tools::automations::delete_automation,
            commands::tools::automations::trigger_automation,
            commands::tools::automations::test_automation_webhook,
            commands::tools::automations::get_automation_runs,
            // Tools -- Automation Design (AI)
            commands::tools::automation_design::start_automation_design,
            commands::tools::automation_design::cancel_automation_design,
            // Tools -- n8n Platform
            commands::tools::n8n_platform::n8n_list_workflows,
            commands::tools::n8n_platform::n8n_activate_workflow,
            commands::tools::n8n_platform::n8n_deactivate_workflow,
            commands::tools::n8n_platform::n8n_create_workflow,
            commands::tools::n8n_platform::n8n_trigger_webhook,
            // Tools -- GitHub Platform
            commands::tools::github_platform::github_list_repos,
            commands::tools::github_platform::github_check_permissions,
            // Tools -- Deploy Automation
            commands::tools::deploy_automation::deploy_automation,
            // Tools -- Triggers
            commands::tools::triggers::list_all_triggers,
            commands::tools::triggers::list_triggers,
            commands::tools::triggers::create_trigger,
            commands::tools::triggers::update_trigger,
            commands::tools::triggers::delete_trigger,
            commands::tools::triggers::validate_trigger,
            commands::tools::triggers::get_trigger_health_map,
            commands::tools::triggers::list_trigger_chains,
            commands::tools::triggers::get_webhook_status,
            commands::tools::triggers::preview_cron_schedule,
            commands::tools::triggers::dry_run_trigger,
            commands::tools::triggers::list_cron_agents,
            // Tools -- Webhook Request Inspector
            commands::tools::triggers::list_webhook_request_logs,
            commands::tools::triggers::clear_webhook_request_logs,
            commands::tools::triggers::replay_webhook_request,
            commands::tools::triggers::webhook_request_to_curl,
            commands::tools::triggers::get_persona_config_warnings,
            commands::tools::triggers::get_composite_partial_matches,
            commands::tools::triggers::get_composite_partial_match,
            // Infrastructure -- Auth
            commands::infrastructure::auth::login_with_google,
            commands::infrastructure::auth::get_auth_state,
            commands::infrastructure::auth::logout,
            commands::infrastructure::auth::refresh_session,
            // Infrastructure -- System
            commands::infrastructure::system::system_health_check,
            commands::infrastructure::system::health_check_local,
            commands::infrastructure::system::health_check_agents,
            commands::infrastructure::system::health_check_cloud,
            commands::infrastructure::system::health_check_account,
            commands::infrastructure::system::health_check_circuit_breaker,
            commands::infrastructure::system::health_check_subscriptions,
            commands::infrastructure::system::open_external_url,
            commands::infrastructure::system::get_crash_logs,
            commands::infrastructure::system::clear_crash_logs,
            commands::infrastructure::system::report_frontend_crash,
            commands::infrastructure::system::get_frontend_crashes,
            commands::infrastructure::system::clear_frontend_crashes,
            commands::infrastructure::system::get_frontend_crash_count,
            // Infrastructure -- Setup / Auto-install
            commands::infrastructure::setup::start_setup_install,
            commands::infrastructure::setup::cancel_setup_install,
            // Infrastructure -- Settings
            commands::infrastructure::settings::get_app_setting,
            commands::infrastructure::settings::set_app_setting,
            commands::infrastructure::settings::delete_app_setting,
            // Infrastructure -- BYOM (Bring Your Own Model)
            commands::infrastructure::byom::get_byom_policy,
            commands::infrastructure::byom::set_byom_policy,
            commands::infrastructure::byom::delete_byom_policy,
            commands::infrastructure::byom::list_provider_audit_log,
            commands::infrastructure::byom::list_provider_audit_by_persona,
            commands::infrastructure::byom::get_provider_usage_stats,
            // Infrastructure -- Cloud
            commands::infrastructure::cloud::cloud_connect,
            commands::infrastructure::cloud::cloud_reconnect_from_keyring,
            commands::infrastructure::cloud::cloud_disconnect,
            commands::infrastructure::cloud::cloud_get_config,
            commands::infrastructure::cloud::cloud_status,
            commands::infrastructure::cloud::cloud_execute_persona,
            commands::infrastructure::cloud::cloud_cancel_execution,
            commands::infrastructure::cloud::cloud_oauth_authorize,
            commands::infrastructure::cloud::cloud_oauth_callback,
            commands::infrastructure::cloud::cloud_oauth_status,
            commands::infrastructure::cloud::cloud_oauth_refresh,
            commands::infrastructure::cloud::cloud_oauth_disconnect,
            commands::infrastructure::cloud::cloud_deploy_persona,
            commands::infrastructure::cloud::cloud_list_deployments,
            commands::infrastructure::cloud::cloud_pause_deployment,
            commands::infrastructure::cloud::cloud_resume_deployment,
            commands::infrastructure::cloud::cloud_undeploy,
            commands::infrastructure::cloud::cloud_get_base_url,
            commands::infrastructure::cloud::cloud_list_pending_reviews,
            commands::infrastructure::cloud::cloud_respond_to_review,
            commands::infrastructure::cloud::cloud_list_executions,
            commands::infrastructure::cloud::cloud_execution_stats,
            commands::infrastructure::cloud::cloud_list_triggers,
            commands::infrastructure::cloud::cloud_create_trigger,
            commands::infrastructure::cloud::cloud_update_trigger,
            commands::infrastructure::cloud::cloud_delete_trigger,
            commands::infrastructure::cloud::cloud_list_trigger_firings,
            commands::infrastructure::cloud::cloud_webhook_relay_status,
            commands::infrastructure::cloud::smee_get_channel_url,
            commands::infrastructure::cloud::smee_set_channel_url,
            commands::infrastructure::cloud::smee_disconnect,
            commands::infrastructure::cloud::smee_relay_list,
            commands::infrastructure::cloud::smee_relay_create,
            commands::infrastructure::cloud::smee_relay_update,
            commands::infrastructure::cloud::smee_relay_set_status,
            commands::infrastructure::cloud::smee_relay_delete,
            // Infrastructure -- GitLab
            commands::infrastructure::gitlab::gitlab_connect,
            commands::infrastructure::gitlab::gitlab_connect_from_vault,
            commands::infrastructure::gitlab::gitlab_disconnect,
            commands::infrastructure::gitlab::gitlab_get_config,
            commands::infrastructure::gitlab::gitlab_list_projects,
            commands::infrastructure::gitlab::gitlab_deploy_persona,
            commands::infrastructure::gitlab::gitlab_list_agents,
            commands::infrastructure::gitlab::gitlab_undeploy_agent,
            commands::infrastructure::gitlab::gitlab_revoke_credentials,
            // Workflows
            commands::infrastructure::workflows::get_workflows_overview,
            commands::infrastructure::workflows::get_workflow_job_output,
            commands::infrastructure::workflows::cancel_workflow_job,
            // Tier usage
            commands::infrastructure::tier_usage::get_tier_usage,
            // Dev Tools -- Projects
            commands::infrastructure::dev_tools::dev_tools_list_projects,
            commands::infrastructure::dev_tools::dev_tools_get_project,
            commands::infrastructure::dev_tools::dev_tools_create_project,
            commands::infrastructure::dev_tools::dev_tools_update_project,
            commands::infrastructure::dev_tools::dev_tools_delete_project,
            commands::infrastructure::dev_tools::dev_tools_get_active_project,
            commands::infrastructure::dev_tools::dev_tools_set_active_project,
            // Dev Tools -- Goals
            commands::infrastructure::dev_tools::dev_tools_list_goals,
            commands::infrastructure::dev_tools::dev_tools_get_goal,
            commands::infrastructure::dev_tools::dev_tools_create_goal,
            commands::infrastructure::dev_tools::dev_tools_update_goal,
            commands::infrastructure::dev_tools::dev_tools_delete_goal,
            commands::infrastructure::dev_tools::dev_tools_reorder_goals,
            // Dev Tools -- Goal Signals
            commands::infrastructure::dev_tools::dev_tools_list_goal_signals,
            commands::infrastructure::dev_tools::dev_tools_create_goal_signal,
            // Dev Tools -- Context Groups
            commands::infrastructure::dev_tools::dev_tools_list_context_groups,
            commands::infrastructure::dev_tools::dev_tools_create_context_group,
            commands::infrastructure::dev_tools::dev_tools_update_context_group,
            commands::infrastructure::dev_tools::dev_tools_delete_context_group,
            commands::infrastructure::dev_tools::dev_tools_reorder_context_groups,
            // Dev Tools -- Contexts
            commands::infrastructure::dev_tools::dev_tools_list_contexts,
            commands::infrastructure::dev_tools::dev_tools_get_context,
            commands::infrastructure::dev_tools::dev_tools_create_context,
            commands::infrastructure::dev_tools::dev_tools_update_context,
            commands::infrastructure::dev_tools::dev_tools_delete_context,
            commands::infrastructure::dev_tools::dev_tools_move_context_to_group,
            // Dev Tools -- Context Generation (LLM-powered codebase scan)
            commands::infrastructure::context_generation::dev_tools_scan_codebase,
            commands::infrastructure::context_generation::dev_tools_cancel_scan_codebase,
            commands::infrastructure::context_generation::dev_tools_get_scan_codebase_status,
            // Dev Tools -- Context Group Relationships
            commands::infrastructure::dev_tools::dev_tools_list_context_group_relationships,
            commands::infrastructure::dev_tools::dev_tools_create_context_group_relationship,
            commands::infrastructure::dev_tools::dev_tools_delete_context_group_relationship,
            // Dev Tools -- Ideas
            commands::infrastructure::dev_tools::dev_tools_list_ideas,
            commands::infrastructure::dev_tools::dev_tools_get_idea,
            commands::infrastructure::dev_tools::dev_tools_create_idea,
            commands::infrastructure::dev_tools::dev_tools_update_idea,
            commands::infrastructure::dev_tools::dev_tools_delete_idea,
            commands::infrastructure::dev_tools::dev_tools_bulk_delete_ideas,
            // Dev Tools -- Scans
            commands::infrastructure::dev_tools::dev_tools_list_scans,
            commands::infrastructure::dev_tools::dev_tools_get_scan,
            commands::infrastructure::dev_tools::dev_tools_create_scan,
            commands::infrastructure::dev_tools::dev_tools_update_scan,
            // Dev Tools -- Idea Scanner (LLM-powered)
            commands::infrastructure::idea_scanner::dev_tools_list_scan_agents,
            commands::infrastructure::idea_scanner::dev_tools_run_scan,
            commands::infrastructure::idea_scanner::dev_tools_cancel_scan,
            // Dev Tools -- Tasks
            commands::infrastructure::dev_tools::dev_tools_list_tasks,
            commands::infrastructure::dev_tools::dev_tools_get_task,
            commands::infrastructure::dev_tools::dev_tools_create_task,
            commands::infrastructure::dev_tools::dev_tools_update_task,
            commands::infrastructure::dev_tools::dev_tools_delete_task,
            // Dev Tools -- Triage Rules
            commands::infrastructure::dev_tools::dev_tools_list_triage_rules,
            commands::infrastructure::dev_tools::dev_tools_create_triage_rule,
            commands::infrastructure::dev_tools::dev_tools_update_triage_rule,
            commands::infrastructure::dev_tools::dev_tools_delete_triage_rule,
            // Notifications
            notifications::send_app_notification,
            notifications::test_notification_channel,
            // Network -- Identity (Invisible Apps Phase 1)
            commands::network::identity::get_local_identity,
            commands::network::identity::set_display_name,
            commands::network::identity::export_identity_card,
            commands::network::identity::list_trusted_peers,
            commands::network::identity::import_trusted_peer,
            commands::network::identity::update_trusted_peer,
            commands::network::identity::revoke_peer_trust,
            commands::network::identity::delete_trusted_peer,
            // Network -- Exposure Manifest (Invisible Apps Phase 1)
            commands::network::exposure::list_exposed_resources,
            commands::network::exposure::get_exposed_resource,
            commands::network::exposure::create_exposed_resource,
            commands::network::exposure::update_exposed_resource,
            commands::network::exposure::delete_exposed_resource,
            commands::network::exposure::get_exposure_manifest,
            commands::network::exposure::list_provenance,
            commands::network::exposure::get_resource_provenance,
            // Network -- Bundle (Invisible Apps Phase 1)
            commands::network::bundle::export_persona_bundle,
            commands::network::bundle::preview_bundle_import,
            commands::network::bundle::apply_bundle_import,
            commands::network::bundle::verify_bundle,
            // Network -- Sovereign Enclaves
            commands::network::enclave::seal_enclave,
            commands::network::enclave::verify_enclave,
            // Network -- P2P Discovery (Invisible Apps Phase 2)
            commands::network::discovery::get_discovered_peers,
            commands::network::discovery::connect_to_peer,
            commands::network::discovery::disconnect_peer,
            commands::network::discovery::get_peer_manifest,
            commands::network::discovery::sync_peer_manifest,
            commands::network::discovery::get_connection_status,
            commands::network::discovery::get_network_status,
            commands::network::discovery::get_connection_health,
            commands::network::discovery::get_network_snapshot,
            commands::network::discovery::get_messaging_metrics,
            commands::network::discovery::send_agent_message,
            commands::network::discovery::get_received_messages,
            commands::network::discovery::set_network_config,
            // Vector Knowledge Base
            commands::credentials::vector_kb::create_knowledge_base,
            commands::credentials::vector_kb::list_knowledge_bases,
            commands::credentials::vector_kb::get_knowledge_base,
            commands::credentials::vector_kb::delete_knowledge_base,
            commands::credentials::vector_kb::kb_ingest_files,
            commands::credentials::vector_kb::kb_ingest_text,
            commands::credentials::vector_kb::kb_ingest_directory,
            commands::credentials::vector_kb::kb_search,
            commands::credentials::vector_kb::kb_list_documents,
            commands::credentials::vector_kb::kb_delete_document,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("Fatal: Tauri application failed to start: {e}");
            std::process::exit(1);
        });
}
