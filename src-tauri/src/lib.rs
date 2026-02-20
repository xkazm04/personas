mod cloud;
mod commands;
mod db;
mod engine;
mod error;
mod logging;
mod notifications;
mod tray;
mod validation;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use db::DbPool;
use tauri::Manager;

/// Shared application state accessible from all Tauri commands.
pub struct AppState {
    pub db: DbPool,
    pub engine: Arc<engine::ExecutionEngine>,
    pub scheduler: Arc<engine::background::SchedulerState>,
    /// Tracks the currently active design analysis ID.
    /// Set when analysis starts, cleared on cancel or completion.
    pub active_design_id: Arc<Mutex<Option<String>>>,
    /// Tracks the currently active credential design ID.
    pub active_credential_design_id: Arc<Mutex<Option<String>>>,
    /// Authentication state (Supabase OAuth).
    pub auth: Arc<tokio::sync::Mutex<commands::auth::AuthStateInner>>,
    /// Cloud orchestrator HTTP client (None when not connected).
    pub cloud_client: Arc<tokio::sync::Mutex<Option<Arc<cloud::client::CloudClient>>>>,
    /// Maps local execution ID → cloud execution ID for active cloud runs.
    pub cloud_exec_ids: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    /// Cancellation flag for the auto-installer (setup commands).
    pub active_setup_cancelled: Arc<Mutex<bool>>,
}

/// Hello world IPC command — verifies the Rust ↔ React bridge works.
#[tauri::command]
#[tracing::instrument]
fn greet(name: String) -> String {
    tracing::info!(name = %name, "greet command called");
    format!("Hello from Rust, {}! Personas desktop is alive.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();

    tracing::info!("Starting Personas Desktop v{}", env!("CARGO_PKG_VERSION"));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");

            let pool = db::init_db(&app_data_dir)?;
            tracing::info!("Database pool ready (max_size=8)");

            // Encrypt any legacy plaintext credentials
            match engine::crypto::migrate_plaintext_credentials(&pool) {
                Ok((migrated, failed)) => {
                    if migrated > 0 || failed > 0 {
                        tracing::info!(
                            "Credential migration: {} encrypted, {} failed",
                            migrated,
                            failed
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!("Credential migration skipped: {}", e);
                }
            }

            let log_dir = app_data_dir.join("logs");

            // Mark any executions left in running/queued state as failed
            // (their processes died when the app last exited)
            engine::ExecutionEngine::recover_stale_executions(&pool);

            let engine = Arc::new(engine::ExecutionEngine::new(log_dir));
            let scheduler = Arc::new(engine::background::SchedulerState::new());
            let auth = Arc::new(tokio::sync::Mutex::new(
                commands::auth::AuthStateInner::default(),
            ));

            // Restore cloud client from keyring if previously connected
            let cloud_client_opt = cloud::config::load_cloud_config()
                .map(|(url, key)| Arc::new(cloud::client::CloudClient::new(url, key)));
            if cloud_client_opt.is_some() {
                tracing::info!("Cloud orchestrator config restored from keyring");
            }

            let state_arc = Arc::new(AppState {
                db: pool.clone(),
                engine: engine.clone(),
                scheduler: scheduler.clone(),
                active_design_id: Arc::new(Mutex::new(None)),
                active_credential_design_id: Arc::new(Mutex::new(None)),
                auth: auth.clone(),
                cloud_client: Arc::new(tokio::sync::Mutex::new(cloud_client_opt)),
                cloud_exec_ids: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
                active_setup_cancelled: Arc::new(Mutex::new(false)),
            });
            app.manage(state_arc.clone());

            // System tray
            if let Err(e) = tray::setup_tray(app.handle()) {
                tracing::warn!("Failed to set up system tray: {}", e);
            }

            // Deep-link handler for OAuth callbacks
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let dl_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        let url_str = url.to_string();
                        if url_str.starts_with("personas://auth/callback") {
                            let handle = dl_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) =
                                    commands::auth::handle_auth_callback(&handle, &url_str).await
                                {
                                    tracing::error!("Auth callback failed: {}", e);
                                }
                            });
                        }
                    }
                });

                // Register protocol during development
                #[cfg(debug_assertions)]
                {
                    let _ = app.deep_link().register_all();
                }
            }

            // Auto-start scheduler after a brief delay
            let app_handle = app.handle().clone();
            let restore_handle = app.handle().clone();
            let restore_state = state_arc.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                engine::background::start_loops(
                    scheduler,
                    app_handle.clone(),
                    pool,
                    engine,
                );
                tracing::info!("Scheduler auto-started");
                tray::refresh_tray(&app_handle);
            });

            // Attempt auth session restore from keyring
            tauri::async_runtime::spawn(async move {
                commands::auth::try_restore_session(&restore_handle, &restore_state).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Phase 1
            greet,
            // Personas
            commands::personas::list_personas,
            commands::personas::get_persona,
            commands::personas::create_persona,
            commands::personas::update_persona,
            commands::personas::delete_persona,
            // Tools
            commands::tools::list_tool_definitions,
            commands::tools::get_tool_definition,
            commands::tools::get_tool_definitions_by_category,
            commands::tools::create_tool_definition,
            commands::tools::update_tool_definition,
            commands::tools::delete_tool_definition,
            commands::tools::assign_tool,
            commands::tools::unassign_tool,
            commands::tools::get_tool_usage_summary,
            commands::tools::get_tool_usage_over_time,
            commands::tools::get_tool_usage_by_persona,
            // Triggers
            commands::triggers::list_all_triggers,
            commands::triggers::list_triggers,
            commands::triggers::create_trigger,
            commands::triggers::update_trigger,
            commands::triggers::delete_trigger,
            // Executions
            commands::executions::list_executions,
            commands::executions::get_execution,
            commands::executions::create_execution,
            commands::executions::execute_persona,
            commands::executions::cancel_execution,
            commands::executions::get_execution_log,
            // Credentials
            commands::credentials::list_credentials,
            commands::credentials::create_credential,
            commands::credentials::update_credential,
            commands::credentials::delete_credential,
            commands::credentials::list_credential_events,
            commands::credentials::create_credential_event,
            commands::credentials::update_credential_event,
            commands::credentials::healthcheck_credential,
            commands::credentials::vault_status,
            // Events
            commands::events::list_events,
            commands::events::publish_event,
            commands::events::list_subscriptions,
            commands::events::create_subscription,
            commands::events::update_subscription,
            commands::events::delete_subscription,
            commands::events::test_event_flow,
            // Messages
            commands::messages::list_messages,
            commands::messages::get_message,
            commands::messages::mark_message_read,
            commands::messages::mark_all_messages_read,
            commands::messages::delete_message,
            commands::messages::get_unread_message_count,
            commands::messages::get_message_count,
            commands::messages::get_message_deliveries,
            // Design
            commands::design::start_design_analysis,
            commands::design::refine_design,
            commands::design::test_design_feasibility,
            commands::design::cancel_design_analysis,
            // Credential Design
            commands::credential_design::start_credential_design,
            commands::credential_design::cancel_credential_design,
            commands::credential_design::test_credential_design_healthcheck,
            commands::credential_design::start_google_credential_oauth,
            commands::credential_design::get_google_credential_oauth_status,
            // Design Reviews
            commands::design_reviews::list_design_reviews,
            commands::design_reviews::get_design_review,
            commands::design_reviews::delete_design_review,
            commands::design_reviews::start_design_review_run,
            // Manual Reviews
            commands::design_reviews::list_manual_reviews,
            commands::design_reviews::update_manual_review_status,
            commands::design_reviews::get_pending_review_count,
            // Observability
            commands::observability::get_metrics_summary,
            commands::observability::get_metrics_snapshots,
            commands::observability::get_prompt_versions,
            commands::observability::get_all_monthly_spend,
            // Groups
            commands::groups::list_groups,
            commands::groups::create_group,
            commands::groups::update_group,
            commands::groups::delete_group,
            commands::groups::reorder_groups,
            // Memories
            commands::memories::list_memories,
            commands::memories::create_memory,
            commands::memories::delete_memory,
            // Healing
            commands::healing::list_healing_issues,
            commands::healing::get_healing_issue,
            commands::healing::update_healing_status,
            commands::healing::run_healing_analysis,
            // Teams
            commands::teams::list_teams,
            commands::teams::get_team,
            commands::teams::create_team,
            commands::teams::update_team,
            commands::teams::delete_team,
            commands::teams::list_team_members,
            commands::teams::add_team_member,
            commands::teams::update_team_member,
            commands::teams::remove_team_member,
            commands::teams::list_team_connections,
            commands::teams::create_team_connection,
            commands::teams::delete_team_connection,
            commands::teams::list_pipeline_runs,
            commands::teams::get_pipeline_run,
            commands::teams::execute_team,
            // Connectors
            commands::connectors::list_connectors,
            commands::connectors::get_connector,
            commands::connectors::create_connector,
            commands::connectors::update_connector,
            commands::connectors::delete_connector,
            // Scheduler (stubs — Phase 6)
            commands::scheduler::get_scheduler_status,
            commands::scheduler::start_scheduler,
            commands::scheduler::stop_scheduler,
            // Auth
            commands::auth::login_with_google,
            commands::auth::get_auth_state,
            commands::auth::logout,
            commands::auth::refresh_session,
            // System
            commands::system::system_health_check,
            commands::system::open_external_url,
            // Setup / Auto-install
            commands::setup::start_setup_install,
            commands::setup::cancel_setup_install,
            // Settings
            commands::settings::get_app_setting,
            commands::settings::set_app_setting,
            commands::settings::delete_app_setting,
            // Import/Export
            commands::import_export::export_persona,
            commands::import_export::import_persona,
            // Cloud
            commands::cloud::cloud_connect,
            commands::cloud::cloud_disconnect,
            commands::cloud::cloud_get_config,
            commands::cloud::cloud_status,
            commands::cloud::cloud_execute_persona,
            commands::cloud::cloud_cancel_execution,
            commands::cloud::cloud_oauth_authorize,
            commands::cloud::cloud_oauth_callback,
            commands::cloud::cloud_oauth_status,
            commands::cloud::cloud_oauth_refresh,
            commands::cloud::cloud_oauth_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
