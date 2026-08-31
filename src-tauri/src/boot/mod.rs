//! Backend boot sequence.
//!
//! This module is the `.setup(...)` closure that used to live inline in
//! `lib.rs` — roughly 1,200 lines of it. It was moved out whole (Rust refactor
//! W1) and then split into named phase functions, one per comment-delimited
//! phase the closure already carried. Nothing was reordered: `setup` below
//! calls the phases in exactly the sequence the closure ran them, and every
//! `StartupTimer` checkpoint fires at the same point it always did.
//!
//! **Boot order is an invariant.** A reorder here is a startup bug that no test
//! catches — it shows up as a machine behaving differently, weeks later. Add a
//! phase where it belongs in the sequence, never "at the end because that
//! compiles".

mod data;
mod deep_link;
mod finalize;
mod migrations;
mod paths;
mod recovery;
mod seeds;
mod services;
mod test_bridge;
#[cfg(feature = "ml")]
mod vector_kb;
mod workers;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::Manager;

use crate::process_registry::ActiveProcessRegistry;
use crate::{
    commands, engine, freeze_monitor, logging, startup_timing, test_automation, webbuild, AppState,
};

#[cfg(feature = "desktop")]
use crate::tray;

/// The Tauri `setup` hook. Wired as `.setup(boot::setup)` in `lib.rs`.
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Always manage PendingResponses so __test_respond command doesn't panic
    let pending_default: test_automation::PendingResponses =
        Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    app.manage(pending_default);

    let mut st = startup_timing::StartupTimer::new();

    let app_data_dir = paths::resolve_app_data_dir(app)?;

    paths::install_file_logging(&app_data_dir, &mut st);

    let (pool, user_db_pool, cdc_receiver, journal_receiver) =
        data::open_databases(&app_data_dir, &mut st)?;

    seeds::seed_builtin_data(&pool, &mut st)?;

    migrations::encrypt_legacy_secrets(&pool, &mut st);

    migrations::migrate_app_master_mandates(&pool);

    services::init_connector_registry(&pool, &mut st);

    // Install panic crash hook that writes to crash_logs/ before aborting
    logging::install_crash_hook(&app_data_dir);

    // File logging is installed near the top of setup now, before
    // `db_init` — see the note there. The crash hook stays here because
    // it writes its own file and does not depend on the tracing layer.

    let log_dir = app_data_dir.join("logs");

    recovery::recover_interrupted_work(&app_data_dir, &pool, &user_db_pool, &mut st);

    let scheduler = Arc::new(engine::background::SchedulerState::new());
    let engine = Arc::new(engine::ExecutionEngine::new(
        log_dir,
        scheduler.clone(),
        Some(Arc::new(pool.clone())),
    ));

    workers::spawn_requeue_persisted(app, &engine, &pool);

    let auth = Arc::new(tokio::sync::RwLock::new(
        commands::infrastructure::auth::AuthStateInner::default(),
    ));

    let cloud_client_opt = services::restore_cloud_client(&mut st);

    let gitlab_client_opt = services::restore_gitlab_client(&mut st);

    services::init_browser_bridge_pairing_token(&pool);

    services::start_local_http(app, &mut st);

    #[cfg(feature = "p2p")]
    let network_service = services::init_p2p_network_service(&pool);

    st.checkpoint("p2p_network_service");

    // Initialize vector knowledge base infrastructure
    #[cfg(feature = "ml")]
    let embedding_manager = Arc::new(engine::embedder::EmbeddingManager::new(
        app_data_dir.join("models").join("onnx"),
    ));
    #[cfg(feature = "ml")]
    let vector_store = Arc::new(engine::vector_store::SqliteVectorStore::new(
        user_db_pool.clone(),
    ));
    #[cfg(feature = "ml")]
    st.checkpoint("vector_kb_init");

    #[cfg(feature = "ml")]
    vector_kb::init_task_recall_runtime(&pool, &user_db_pool, &embedding_manager, &mut st);

    #[cfg(feature = "ml")]
    vector_kb::reconcile_orphaned_kb(&pool, &user_db_pool, &vector_store, &mut st);

    let smee_notifier = engine::smee_relay::SmeeRelayNotifier::new();

    let state_arc = Arc::new(AppState {
        db: pool.clone(),
        user_db: user_db_pool.clone(),
        engine: engine.clone(),
        scheduler: scheduler.clone(),
        process_registry: Arc::new(ActiveProcessRegistry::new()),
        auth: auth.clone(),
        refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        cloud_client: Arc::new(tokio::sync::Mutex::new(cloud_client_opt)),
        cloud_connecting: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        cloud_exec_ids: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        gitlab_client: Arc::new(tokio::sync::Mutex::new(gitlab_client_opt)),
        gitlab_config_cache: Arc::new(tokio::sync::Mutex::new(None)),
        rate_limiter: Arc::new(engine::rate_limiter::RateLimiter::new()),
        session_key: Arc::new(engine::crypto::SessionKeyPair::generate()?),
        tier_config: Arc::new(Mutex::new(engine::tier::TierConfig::default())),
        tier_usage_cache: Arc::new(Mutex::new(None)),
        system_metrics: Mutex::new(
            commands::infrastructure::system_metrics::SystemMetricsSampler::new(),
        ),
        #[cfg(feature = "desktop")]
        desktop_approvals: Arc::new(engine::desktop_security::DesktopApprovalStore::new()),
        #[cfg(feature = "desktop")]
        desktop_runtime: Arc::new(engine::desktop_runtime::DesktopRuntime::new()),
        #[cfg(feature = "desktop")]
        ambient_context: engine::ambient_context::create_ambient_context(),
        #[cfg(feature = "desktop")]
        context_rule_engine: engine::context_rules::create_context_rule_engine(),
        auth_detect_cache: Arc::new(tokio::sync::Mutex::new(None)),
        #[cfg(feature = "p2p")]
        network: network_service.clone(),
        #[cfg(feature = "ml")]
        embedding_manager: Some(embedding_manager),
        #[cfg(feature = "ml")]
        vector_store: Some(vector_store),
        #[cfg(feature = "ml")]
        kb_ingest_jobs: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        cloud_webhook_relay_state: Arc::new(tokio::sync::Mutex::new(
            engine::cloud_webhook_relay::CloudWebhookRelayState::load_from_db(&pool),
        )),
        shared_event_relay_state: Arc::new(tokio::sync::Mutex::new(
            engine::shared_event_relay::SharedEventRelayState::new(),
        )),
        build_session_manager: Arc::new(engine::build_session::BuildSessionManager::new()),
        composite_state: engine::composite::CompositeState::new(),
        session_pool: Arc::new(engine::session_pool::SessionPool::new()),
        binary_probe_cache: Arc::new(commands::infrastructure::system::BinaryProbeCache::new(
            std::time::Duration::from_secs(60),
        )),
        smee_relay_notifier: smee_notifier,
        #[cfg(feature = "desktop")]
        clipboard_watcher_enabled: Arc::new(std::sync::atomic::AtomicBool::new(true)),
        project_tracking: Arc::new(engine::project_tracking::ProjectTracker::new()),
        leadership: Arc::new(engine::leadership::EngineLeadership::new(
            app_data_dir.clone(),
        )),
        webbuild_servers: Arc::new(webbuild::DevServerRegistry::new()),
        // Cap local voice sidecars at one process per engine so chunked
        // TTS / TTS-while-STT can't stack unbounded piper/whisper procs
        // (combined-scan 2026-06-25 #3). Separate semaphores: one piper
        // and one whisper may still run concurrently.
        companion_tts_semaphore: Arc::new(tokio::sync::Semaphore::new(1)),
        companion_stt_semaphore: Arc::new(tokio::sync::Semaphore::new(1)),
    });
    // Phase 1: spawn the project_tracking scheduler. The master
    // enable flag inside the tracker starts at false; the
    // scheduler ticks every hour but short-circuits each tick
    // when the flag is off. Phase 5 wires the master toggle
    // command that flips the flag.
    state_arc
        .project_tracking
        .start(state_arc.user_db.clone(), app.handle().clone());
    // Phase 3: initialize the push handle so the local_http
    // /project-tracking/cli-event route can resolve projects,
    // insert events, and fire out-of-cadence consolidator runs.
    engine::project_tracking::push::init(state_arc.user_db.clone(), app.handle().clone());
    app.manage(state_arc.clone());

    // Engine-owned handles get their own slots in Tauri's state map, in
    // addition to living on `AppState`. The engine reaches them through
    // these rather than through `AppState`, which is what let it stop
    // depending on the whole application struct (and transitively on
    // `commands`, `cloud` and `gitlab`). Same objects, same `Arc`s — the
    // only thing that changes is which type the engine asks for.
    app.manage(state_arc.engine.clone());
    app.manage(state_arc.scheduler.clone());
    app.manage(state_arc.session_pool.clone());
    app.manage(state_arc.ambient_context.clone());

    // Athena's proactive scheduler — the 5-min autonomy loop (fleet
    // reassess passes, execution review, message triage, stale-approval
    // GC). Started here, alongside the other always-on loops, because
    // it previously hung off `companion_init`, which the frontend calls
    // from a lazily-mounted footer icon: a chunk that never mounted (or
    // failed to) silently meant no autonomy at all, with no retry.
    // Idempotent (`OnceLock`) and still no-ops per tick while
    // autonomous mode is off, so this starts a loop, not autonomy.
    // Must follow `app.manage(state_arc)` — the tick reads
    // `Arc<AppState>` back out of Tauri's state map.
    commands::companion::start_proactive_scheduler(&state_arc, app.handle());

    workers::register_host_hooks();

    workers::start_engine_leadership(&state_arc);

    #[cfg(feature = "desktop")]
    workers::restore_cli_session_gate(&state_arc);

    #[cfg(feature = "desktop")]
    workers::restore_trace_redaction(&state_arc);

    workers::spawn_fix_loop_worker(app);

    workers::init_radio(app, &app_data_dir);

    workers::spawn_cdc_drain(app, cdc_receiver, &pool, &mut st);

    workers::spawn_journal_and_maintenance(&pool, &user_db_pool, journal_receiver);

    workers::spawn_persona_jobs_worker(app, &pool, &state_arc, &mut st);

    workers::spawn_cloud_sync(app, &state_arc, &mut st);

    workers::spawn_cloud_remote_commands(app, &state_arc, &mut st);

    workers::spawn_alert_evaluator(app, &state_arc, &mut st);

    workers::spawn_curation_scheduler(&pool, &state_arc, &mut st);

    workers::spawn_webhook_notifier(app, &pool, &mut st);

    workers::spawn_discord_poller(app, &pool, &state_arc, &mut st);

    workers::spawn_slack_poller(app, &pool, &state_arc, &mut st);

    workers::spawn_team_slack_relay(app, &pool, &mut st);

    test_bridge::start_test_automation_server(app);

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

    deep_link::register_deep_link_handler(app);

    st.checkpoint("app_state_and_handlers");

    finalize::log_startup_report(st, &app_data_dir);

    // Lightweight freeze/OOM monitor — uses Windows API, no external process spawn
    freeze_monitor::start(app.handle().clone(), app_data_dir.join("logs"));

    // Auto-start scheduler / session restore. `restore_handle` and
    // `restore_state` are shared by the p2p autostart and the auth-restore
    // phases below; the other startup_* clones moved into
    // `finalize::spawn_scheduler_autostart`, which is their only consumer.
    let restore_handle = app.handle().clone();
    let restore_state = state_arc.clone();
    finalize::bootstrap_system_api_key(&state_arc);

    finalize::spawn_scheduler_autostart(app, &state_arc, scheduler, pool, engine);

    #[cfg(feature = "p2p")]
    finalize::spawn_p2p_autostart(&state_arc, &restore_handle, network_service);

    finalize::spawn_auth_session_restore(restore_handle, restore_state);

    Ok(())
}
