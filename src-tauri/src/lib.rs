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
    pub auth: Arc<tokio::sync::Mutex<commands::infrastructure::auth::AuthStateInner>>,
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
                commands::infrastructure::auth::AuthStateInner::default(),
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
                                    commands::infrastructure::auth::handle_auth_callback(&handle, &url_str).await
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
                commands::infrastructure::auth::try_restore_session(&restore_handle, &restore_state).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Phase 1
            greet,
            // Core — Personas
            commands::core::personas::list_personas,
            commands::core::personas::get_persona,
            commands::core::personas::create_persona,
            commands::core::personas::update_persona,
            commands::core::personas::delete_persona,
            // Core — Groups
            commands::core::groups::list_groups,
            commands::core::groups::create_group,
            commands::core::groups::update_group,
            commands::core::groups::delete_group,
            commands::core::groups::reorder_groups,
            // Core — Memories
            commands::core::memories::list_memories,
            commands::core::memories::create_memory,
            commands::core::memories::delete_memory,
            // Core — Import/Export
            commands::core::import_export::export_persona,
            commands::core::import_export::import_persona,
            // Execution — Executions
            commands::execution::executions::list_executions,
            commands::execution::executions::get_execution,
            commands::execution::executions::create_execution,
            commands::execution::executions::execute_persona,
            commands::execution::executions::cancel_execution,
            commands::execution::executions::get_execution_log,
            // Execution — Scheduler
            commands::execution::scheduler::get_scheduler_status,
            commands::execution::scheduler::start_scheduler,
            commands::execution::scheduler::stop_scheduler,
            // Execution — Healing
            commands::execution::healing::list_healing_issues,
            commands::execution::healing::get_healing_issue,
            commands::execution::healing::update_healing_status,
            commands::execution::healing::run_healing_analysis,
            // Design — Analysis
            commands::design::analysis::start_design_analysis,
            commands::design::analysis::refine_design,
            commands::design::analysis::test_design_feasibility,
            commands::design::analysis::cancel_design_analysis,
            // Design — N8n Transform
            commands::design::n8n_transform::transform_n8n_to_persona,
            commands::design::n8n_transform::start_n8n_transform_background,
            commands::design::n8n_transform::get_n8n_transform_snapshot,
            commands::design::n8n_transform::clear_n8n_transform_snapshot,
            commands::design::n8n_transform::confirm_n8n_persona_draft,
            // Design — Reviews
            commands::design::reviews::list_design_reviews,
            commands::design::reviews::get_design_review,
            commands::design::reviews::delete_design_review,
            commands::design::reviews::start_design_review_run,
            commands::design::reviews::import_design_review,
            commands::design::reviews::adopt_design_review,
            commands::design::reviews::list_manual_reviews,
            commands::design::reviews::update_manual_review_status,
            commands::design::reviews::get_pending_review_count,
            // Credentials — CRUD
            commands::credentials::crud::list_credentials,
            commands::credentials::crud::create_credential,
            commands::credentials::crud::update_credential,
            commands::credentials::crud::delete_credential,
            commands::credentials::crud::list_credential_events,
            commands::credentials::crud::create_credential_event,
            commands::credentials::crud::update_credential_event,
            commands::credentials::crud::healthcheck_credential,
            commands::credentials::crud::healthcheck_credential_preview,
            commands::credentials::crud::vault_status,
            // Credentials — Connectors
            commands::credentials::connectors::list_connectors,
            commands::credentials::connectors::get_connector,
            commands::credentials::connectors::create_connector,
            commands::credentials::connectors::update_connector,
            commands::credentials::connectors::delete_connector,
            // Credentials — Credential Design
            commands::credentials::credential_design::start_credential_design,
            commands::credentials::credential_design::cancel_credential_design,
            commands::credentials::credential_design::test_credential_design_healthcheck,
            // Credentials — OAuth
            commands::credentials::oauth::start_google_credential_oauth,
            commands::credentials::oauth::get_google_credential_oauth_status,
            // Communication — Events
            commands::communication::events::list_events,
            commands::communication::events::publish_event,
            commands::communication::events::list_subscriptions,
            commands::communication::events::create_subscription,
            commands::communication::events::update_subscription,
            commands::communication::events::delete_subscription,
            commands::communication::events::test_event_flow,
            // Communication — Messages
            commands::communication::messages::list_messages,
            commands::communication::messages::get_message,
            commands::communication::messages::mark_message_read,
            commands::communication::messages::mark_all_messages_read,
            commands::communication::messages::delete_message,
            commands::communication::messages::get_unread_message_count,
            commands::communication::messages::get_message_count,
            commands::communication::messages::get_message_deliveries,
            // Communication — Observability
            commands::communication::observability::get_metrics_summary,
            commands::communication::observability::get_metrics_snapshots,
            commands::communication::observability::get_prompt_versions,
            commands::communication::observability::get_all_monthly_spend,
            // Teams
            commands::teams::teams::list_teams,
            commands::teams::teams::get_team,
            commands::teams::teams::create_team,
            commands::teams::teams::update_team,
            commands::teams::teams::delete_team,
            commands::teams::teams::list_team_members,
            commands::teams::teams::add_team_member,
            commands::teams::teams::update_team_member,
            commands::teams::teams::remove_team_member,
            commands::teams::teams::list_team_connections,
            commands::teams::teams::create_team_connection,
            commands::teams::teams::delete_team_connection,
            commands::teams::teams::list_pipeline_runs,
            commands::teams::teams::get_pipeline_run,
            commands::teams::teams::execute_team,
            // Tools
            commands::tools::tools::list_tool_definitions,
            commands::tools::tools::get_tool_definition,
            commands::tools::tools::get_tool_definitions_by_category,
            commands::tools::tools::create_tool_definition,
            commands::tools::tools::update_tool_definition,
            commands::tools::tools::delete_tool_definition,
            commands::tools::tools::assign_tool,
            commands::tools::tools::unassign_tool,
            commands::tools::tools::get_tool_usage_summary,
            commands::tools::tools::get_tool_usage_over_time,
            commands::tools::tools::get_tool_usage_by_persona,
            // Tools — Triggers
            commands::tools::triggers::list_all_triggers,
            commands::tools::triggers::list_triggers,
            commands::tools::triggers::create_trigger,
            commands::tools::triggers::update_trigger,
            commands::tools::triggers::delete_trigger,
            // Infrastructure — Auth
            commands::infrastructure::auth::login_with_google,
            commands::infrastructure::auth::get_auth_state,
            commands::infrastructure::auth::logout,
            commands::infrastructure::auth::refresh_session,
            // Infrastructure — System
            commands::infrastructure::system::system_health_check,
            commands::infrastructure::system::open_external_url,
            // Infrastructure — Setup / Auto-install
            commands::infrastructure::setup::start_setup_install,
            commands::infrastructure::setup::cancel_setup_install,
            // Infrastructure — Settings
            commands::infrastructure::settings::get_app_setting,
            commands::infrastructure::settings::set_app_setting,
            commands::infrastructure::settings::delete_app_setting,
            // Infrastructure — Cloud
            commands::infrastructure::cloud::cloud_connect,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
