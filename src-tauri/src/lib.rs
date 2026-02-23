mod cloud;
mod commands;
mod db;
mod engine;
mod error;
mod gitlab;
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
    /// PID of the CLI child process for the active design analysis.
    /// Used to kill the process when the user cancels.
    pub active_design_child_pid: Arc<Mutex<Option<u32>>>,
    /// Tracks the currently active credential design ID.
    pub active_credential_design_id: Arc<Mutex<Option<String>>>,
    /// PID of the CLI child process for the active credential design/negotiation.
    /// Used to kill the process when the user cancels.
    pub active_credential_design_child_pid: Arc<Mutex<Option<u32>>>,
    /// Authentication state (Supabase OAuth).
    pub auth: Arc<tokio::sync::Mutex<commands::infrastructure::auth::AuthStateInner>>,
    /// Cloud orchestrator HTTP client (None when not connected).
    pub cloud_client: Arc<tokio::sync::Mutex<Option<Arc<cloud::client::CloudClient>>>>,
    /// Maps local execution ID → cloud execution ID for active cloud runs.
    pub cloud_exec_ids: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    /// Cancellation flag for the auto-installer (setup commands).
    pub active_setup_cancelled: Arc<Mutex<bool>>,
    /// Cancellation flags for active test runs, keyed by run ID.
    pub active_test_run_cancelled: Arc<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>>,
    /// PID of the currently-running CLI child process for each design review run.
    /// Used to kill the process immediately when the user cancels a batch review.
    pub active_review_child_pids: Arc<Mutex<HashMap<String, u32>>>,
    /// GitLab API client (None when not connected).
    pub gitlab_client: Arc<tokio::sync::Mutex<Option<Arc<gitlab::client::GitLabClient>>>>,
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

            // Install panic crash hook that writes to crash_logs/ before aborting
            logging::install_crash_hook(&app_data_dir);

            let log_dir = app_data_dir.join("logs");

            // Mark any executions left in running/queued state as failed
            // (their processes died when the app last exited)
            engine::ExecutionEngine::recover_stale_executions(&pool);

            // Mark n8n transform sessions interrupted by app exit as failed
            match db::repos::resources::n8n_sessions::recover_interrupted_sessions(&pool) {
                Ok(count) if count > 0 => {
                    tracing::info!("Recovered {} interrupted n8n transform session(s)", count);
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

            // Restore GitLab client from keyring if previously connected
            let gitlab_client_opt = gitlab::config::load_gitlab_config()
                .map(|token| Arc::new(gitlab::client::GitLabClient::new(
                    "https://gitlab.com".to_string(),
                    token,
                )));
            if gitlab_client_opt.is_some() {
                tracing::info!("GitLab config restored from keyring");
            }

            let state_arc = Arc::new(AppState {
                db: pool.clone(),
                engine: engine.clone(),
                scheduler: scheduler.clone(),
                active_design_id: Arc::new(Mutex::new(None)),
                active_design_child_pid: Arc::new(Mutex::new(None)),
                active_credential_design_id: Arc::new(Mutex::new(None)),
                active_credential_design_child_pid: Arc::new(Mutex::new(None)),
                auth: auth.clone(),
                cloud_client: Arc::new(tokio::sync::Mutex::new(cloud_client_opt)),
                cloud_exec_ids: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
                active_setup_cancelled: Arc::new(Mutex::new(false)),
                active_test_run_cancelled: Arc::new(Mutex::new(HashMap::new())),
                active_review_child_pids: Arc::new(Mutex::new(HashMap::new())),
                gitlab_client: Arc::new(tokio::sync::Mutex::new(gitlab_client_opt)),
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
                let _webhook_shutdown = engine::background::start_loops(
                    scheduler,
                    app_handle.clone(),
                    pool,
                    engine,
                );
                tracing::info!("Scheduler auto-started (with webhook server on port 9420)");
                tray::refresh_tray(&app_handle);
                // Keep _webhook_shutdown alive for the lifetime of the app.
                // When this task ends (app shutdown), the sender is dropped,
                // triggering graceful webhook server shutdown.
                futures_util::future::pending::<()>().await;
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
            commands::core::personas::get_persona_summaries,
            // Core — Groups
            commands::core::groups::list_groups,
            commands::core::groups::create_group,
            commands::core::groups::update_group,
            commands::core::groups::delete_group,
            commands::core::groups::reorder_groups,
            // Core — Memories
            commands::core::memories::list_memories,
            commands::core::memories::get_memory_count,
            commands::core::memories::get_memory_stats,
            commands::core::memories::list_memories_by_execution,
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
            // Execution — Tests
            commands::execution::tests::start_test_run,
            commands::execution::tests::list_test_runs,
            commands::execution::tests::get_test_results,
            commands::execution::tests::delete_test_run,
            commands::execution::tests::cancel_test_run,
            commands::execution::tests::validate_n8n_draft,
            commands::execution::tests::test_n8n_draft,
            // Execution — Healing
            commands::execution::healing::list_healing_issues,
            commands::execution::healing::get_healing_issue,
            commands::execution::healing::update_healing_status,
            commands::execution::healing::run_healing_analysis,
            commands::execution::healing::get_retry_chain,
            commands::execution::healing::list_healing_knowledge,
            // Design — Analysis
            commands::design::analysis::start_design_analysis,
            commands::design::analysis::refine_design,
            commands::design::analysis::test_design_feasibility,
            commands::design::analysis::cancel_design_analysis,
            // Design — N8n Transform
            commands::design::n8n_transform::cli_runner::start_n8n_transform_background,
            commands::design::n8n_transform::job_state::get_n8n_transform_snapshot,
            commands::design::n8n_transform::job_state::clear_n8n_transform_snapshot,
            commands::design::n8n_transform::job_state::cancel_n8n_transform,
            commands::design::n8n_transform::confirmation::confirm_n8n_persona_draft,
            commands::design::n8n_transform::cli_runner::continue_n8n_transform,
            // Design — N8n Sessions
            commands::design::n8n_sessions::create_n8n_session,
            commands::design::n8n_sessions::get_n8n_session,
            commands::design::n8n_sessions::list_n8n_sessions,
            commands::design::n8n_sessions::update_n8n_session,
            commands::design::n8n_sessions::delete_n8n_session,
            // Design — Template Adopt
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
            // Design — Reviews
            commands::design::reviews::list_design_reviews,
            commands::design::reviews::list_design_reviews_paginated,
            commands::design::reviews::list_review_connectors,
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
            // Credentials — CRUD
            commands::credentials::crud::list_credentials,
            commands::credentials::crud::create_credential,
            commands::credentials::crud::update_credential,
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
            // Credentials — Negotiator
            commands::credentials::negotiator::start_credential_negotiation,
            commands::credentials::negotiator::cancel_credential_negotiation,
            commands::credentials::negotiator::get_negotiation_step_help,
            // Credentials — Intelligence
            commands::credentials::intelligence::credential_audit_log,
            commands::credentials::intelligence::credential_usage_stats,
            commands::credentials::intelligence::credential_dependents,
            // Credentials — OAuth
            commands::credentials::oauth::start_google_credential_oauth,
            commands::credentials::oauth::get_google_credential_oauth_status,
            // Credentials — Universal OAuth
            commands::credentials::oauth::list_oauth_providers,
            commands::credentials::oauth::start_oauth,
            commands::credentials::oauth::get_oauth_status,
            commands::credentials::oauth::refresh_oauth_token,
            // Credentials — Rotation
            commands::credentials::rotation::list_rotation_policies,
            commands::credentials::rotation::create_rotation_policy,
            commands::credentials::rotation::update_rotation_policy,
            commands::credentials::rotation::delete_rotation_policy,
            commands::credentials::rotation::get_rotation_history,
            commands::credentials::rotation::get_rotation_status,
            commands::credentials::rotation::rotate_credential_now,
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
            commands::communication::observability::get_metrics_chart_data,
            commands::communication::observability::get_prompt_versions,
            commands::communication::observability::get_all_monthly_spend,
            // Communication — Prompt Lab
            commands::communication::observability::tag_prompt_version,
            commands::communication::observability::rollback_prompt_version,
            commands::communication::observability::get_prompt_error_rate,
            commands::communication::observability::run_prompt_ab_test,
            // Teams
            commands::teams::teams::list_teams,
            commands::teams::teams::get_team_counts,
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
            commands::teams::teams::update_team_connection,
            commands::teams::teams::delete_team_connection,
            commands::teams::teams::list_pipeline_runs,
            commands::teams::teams::get_pipeline_run,
            commands::teams::teams::execute_team,
            commands::teams::teams::get_pipeline_analytics,
            commands::teams::teams::suggest_topology,
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
            commands::tools::triggers::validate_trigger,
            commands::tools::triggers::get_trigger_health_map,
            commands::tools::triggers::list_trigger_chains,
            commands::tools::triggers::get_webhook_status,
            // Infrastructure — Auth
            commands::infrastructure::auth::login_with_google,
            commands::infrastructure::auth::get_auth_state,
            commands::infrastructure::auth::logout,
            commands::infrastructure::auth::refresh_session,
            // Infrastructure — System
            commands::infrastructure::system::system_health_check,
            commands::infrastructure::system::open_external_url,
            commands::infrastructure::system::get_crash_logs,
            commands::infrastructure::system::clear_crash_logs,
            // Infrastructure — Setup / Auto-install
            commands::infrastructure::setup::start_setup_install,
            commands::infrastructure::setup::cancel_setup_install,
            // Infrastructure — Settings
            commands::infrastructure::settings::get_app_setting,
            commands::infrastructure::settings::set_app_setting,
            commands::infrastructure::settings::delete_app_setting,
            // Infrastructure — Cloud
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
            // Infrastructure — GitLab
            commands::infrastructure::gitlab::gitlab_connect,
            commands::infrastructure::gitlab::gitlab_disconnect,
            commands::infrastructure::gitlab::gitlab_get_config,
            commands::infrastructure::gitlab::gitlab_list_projects,
            commands::infrastructure::gitlab::gitlab_deploy_persona,
            commands::infrastructure::gitlab::gitlab_list_agents,
            commands::infrastructure::gitlab::gitlab_undeploy_agent,
            commands::infrastructure::gitlab::gitlab_revoke_credentials,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
