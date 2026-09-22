//! IPC handler shard 2 — see `super` (`ipc_shards/mod.rs`) for why the list is split
//! and how to add a command.

use super::Shard;
#[allow(unused_imports)] // not every shard names every root module
use crate::{cloud, commands, notifications, test_automation};

pub(super) fn shard(
) -> Shard<impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static> {
    personas_macros::ipc_shard!(tauri::generate_handler![
        // Credentials -- OAuth
        commands::credentials::oauth::start_google_credential_oauth,
        commands::credentials::oauth::get_google_credential_oauth_status,
        // Credentials -- Universal OAuth
        commands::credentials::oauth::list_oauth_providers,
        commands::credentials::oauth::start_oauth,
        commands::credentials::oauth::get_oauth_status,
        // NOTE(token-hygiene 2026-07-16): refresh_oauth_token retired — it was
        // the only OAuth command taking a raw refresh_token over IPC and had no
        // live caller (runtime refresh is server-side in engine/runner).
        // Credentials -- Auto-Credential Browser
        commands::credentials::auto_cred_browser::start_auto_cred_browser,
        commands::credentials::auto_cred_browser::save_playwright_procedure,
        commands::credentials::auto_cred_browser::get_playwright_procedure,
        commands::credentials::auto_cred_browser::check_auto_cred_playwright_available,
        commands::credentials::auto_cred_browser::cancel_auto_cred_browser,
        // Credentials -- Auth Detection
        commands::credentials::auth_detect::detect_authenticated_services,
        // Credentials -- CLI Capture
        commands::credentials::cli_capture::list_cli_capturable_services,
        commands::credentials::cli_capture::cli_capture_run,
        commands::credentials::cli_capture::list_cli_specs,
        commands::credentials::cli_capture::cli_check_installed,
        commands::credentials::cli_capture::cli_verify_auth,
        commands::credentials::cli_capture::cli_capture_save,
        // Credentials -- Foraging
        commands::credentials::foraging::scan_credential_sources,
        commands::credentials::foraging::import_foraged_credential,
        // Credentials -- Rotation
        commands::credentials::rotation::list_rotation_policies,
        commands::credentials::rotation::create_rotation_policy,
        commands::credentials::rotation::update_rotation_policy,
        commands::credentials::rotation::delete_rotation_policy,
        commands::credentials::rotation::get_rotation_history,
        commands::credentials::rotation::get_rotation_history_bulk,
        commands::credentials::rotation::get_rotation_status,
        commands::credentials::rotation::get_all_rotation_statuses,
        commands::credentials::rotation::rotate_credential_now,
        commands::credentials::rotation::refresh_credential_oauth_now,
        commands::credentials::rotation::refresh_credential_cli_now,
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
        commands::credentials::db_schema::cancel_db_query,
        commands::credentials::db_schema::classify_db_query,
        commands::credentials::db_schema::db_connector_capability,
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
        // Credentials -- NL Query (conversational database console)
        commands::credentials::nl_query::start_nl_query,
        commands::credentials::nl_query::get_nl_query_snapshot,
        commands::credentials::nl_query::cancel_nl_query,
        // Credentials -- API Proxy
        commands::credentials::api_proxy::execute_api_request,
        commands::credentials::api_proxy::get_api_proxy_metrics,
        commands::credentials::api_proxy::parse_api_definition,
        commands::credentials::api_proxy::save_api_definition,
        commands::credentials::api_proxy::load_api_definition,
        // Credentials -- Dynamic discovery (for adoption questionnaire)
        commands::credentials::discovery::discover_connector_resources,
        // Credentials -- MCP Tools
        commands::credentials::mcp_tools::list_mcp_tools,
        commands::credentials::mcp_tools::execute_mcp_tool,
        commands::credentials::mcp_tools::healthcheck_mcp_preview,
        commands::credentials::mcp_tools::get_mcp_pool_metrics,
        commands::credentials::mcp_tools::probe_mcp_server,
        // Credentials -- MCP Gateway membership (bundles multiple MCP servers under one credential)
        commands::credentials::mcp_gateways::add_mcp_gateway_member,
        commands::credentials::mcp_gateways::remove_mcp_gateway_member,
        commands::credentials::mcp_gateways::list_mcp_gateway_members,
        commands::credentials::mcp_gateways::set_mcp_gateway_member_enabled,
        // Credentials -- Desktop Discovery & Security (desktop only)
        #[cfg(feature = "desktop")]
        commands::credentials::desktop::discover_desktop_apps,
        #[cfg(feature = "desktop")]
        commands::credentials::desktop::discover_desktop_clis,
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
        #[cfg(feature = "desktop")]
        commands::execution::ambient::capture_validation_screenshot,
        // Credential Recipes -- shared discovery cache
        //
        // The `#[cfg(all(feature = "desktop", feature = "ml"))]` that used to
        // sit here belonged to the Clipboard Intelligence commands, which are
        // gone. A comment line separated it from its item, so it silently
        // re-attached to `get_credential_recipe` — leaving that ONE command
        // unregistered in every build without `ml` (CI's `--features desktop`,
        // tauri:dev:lite, tauri:build:lite, tauri:dev:test) while
        // src/api/vault/credentialRecipes.ts:8 invokes it unconditionally.
        // Its three siblings below were never gated.
        // `generate_handler_has_no_orphaned_cfg_attributes` (lib.rs:3916) misses
        // this shape: it only fires when the next non-comment line is another
        // `#[cfg(`. Found because a hand parser counted 128 gated registrations
        // and the regex counted 127.
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
        commands::recipes::crud::promote_use_case_to_recipe,
        commands::recipes::crud::get_recipe_versions,
        commands::recipes::crud::start_recipe_versioning,
        commands::recipes::crud::cancel_recipe_versioning,
        commands::recipes::crud::accept_recipe_version,
        commands::recipes::crud::revert_recipe_version,
        // Recipes -- Stage B Phase 1b derivation from templates
        commands::recipes::recipe_derivation::derive_recipes_from_template,
        // Recipes -- Stage D Phase 1 keyword matcher (composer suggestions)
        commands::recipes::recipe_match::match_recipes_to_intent,
        // Recipes -- parameter-derivation coverage (which declared settings survive adoption)
        commands::recipes::recipe_parameter_coverage::get_recipe_parameter_coverage,
        // Recipes -- outcome attribution (runs + success rate per recipe)
        commands::recipes::recipe_outcomes::get_recipe_outcome_tallies,
        // Recipes -- Stage D Phase 4 telemetry (impression/accept/dismiss)
        commands::recipes::recipe_suggestion_log::log_recipe_suggestion_event,
        commands::recipes::recipe_suggestion_log::get_recipe_suggestion_stats,
        commands::recipes::recipe_suggestion_log::list_recipe_suggestion_events,
        // Recipes -- Stage E.1 eligibility scoring (recipe vs persona)
        // Recipes -- Stage E.2 adoption pipeline (eligibility precheck + link)
        commands::recipes::recipe_adoption::adopt_recipe_for_persona,
        // Communication -- Events
        commands::communication::events::list_events,
        commands::communication::events::list_events_in_range,
        commands::communication::events::search_events,
        commands::communication::events::list_known_event_types,
        commands::communication::events::get_event_skipped_stats,
        commands::communication::events::list_subscriptions,
        commands::communication::events::list_all_subscriptions,
        commands::communication::events::create_subscription,
        commands::communication::events::update_subscription,
        commands::communication::events::delete_subscription,
        commands::communication::events::test_event_flow,
        // Communication -- Outbound notification webhooks (Slack/Discord/Teams/generic)
        commands::communication::notifications::list_notification_subscriptions,
        commands::communication::notifications::get_notification_subscription,
        commands::communication::notifications::create_notification_subscription,
        commands::communication::notifications::update_notification_subscription,
        commands::communication::notifications::delete_notification_subscription,
        commands::communication::notifications::test_notification_subscription,
        commands::communication::events::list_dead_letter_events,
        commands::communication::events::count_dead_letter_events,
        commands::communication::events::retry_dead_letter_event,
        commands::communication::events::discard_dead_letter_event,
        commands::communication::events::bulk_retry_dead_letter_events,
        commands::communication::events::bulk_discard_dead_letter_events,
        commands::communication::events::get_dead_letter_config,
        // Communication -- Shared Events
        commands::communication::shared_events::shared_events_browse_catalog,
        commands::communication::shared_events::shared_events_refresh_catalog,
        commands::communication::shared_events::shared_events_subscribe,
        commands::communication::shared_events::shared_events_unsubscribe,
        commands::communication::shared_events::shared_events_list_subscriptions,
        commands::communication::shared_events::shared_events_list_firings,
        commands::communication::shared_events::shared_events_change_activity,
        commands::communication::shared_events::shared_events_list_project_routes,
        commands::communication::shared_events::shared_events_set_project_routes,
        commands::communication::shared_events::shared_events_list_impact_runs,
        commands::communication::shared_events::shared_events_dev_insert_firing,
        // Communication -- Messages
        commands::communication::reports::list_reports,
        commands::communication::reports::get_report,
        commands::communication::reports::mark_report_read,
        commands::communication::reports::mark_all_reports_read,
        commands::communication::reports::delete_report,
        commands::communication::reports::delete_all_reports,
        commands::communication::reports::get_unread_report_count,
        commands::communication::reports::get_unread_report_counts_by_persona,
        commands::communication::reports::list_unread_reports,
        commands::communication::reports::get_report_count,
        commands::communication::reports::get_report_deliveries,
        commands::communication::reports::get_bulk_delivery_summaries,
        commands::communication::reports::get_reports_by_thread,
        commands::communication::reports::get_thread_summaries,
        commands::communication::reports::get_thread_count,
        // Communication -- Observability: Metrics
        commands::communication::observability::metrics::get_metrics_summary,
        commands::communication::observability::metrics::get_metrics_chart_data,
        commands::communication::observability::metrics::get_value_rollup,
        commands::communication::observability::metrics::get_error_category_breakdown,
        commands::communication::observability::metrics::get_all_monthly_spend,
        commands::communication::observability::metrics::get_overview_bundle,
        commands::communication::observability::metrics::get_health_bundle,
        commands::communication::observability::metrics::get_prompt_performance,
        commands::communication::observability::metrics::get_execution_dashboard,
        commands::communication::observability::metrics::get_execution_heatmap,
        commands::communication::observability::metrics::get_anomaly_drilldown,
        // Communication -- Observability: Prompt Lab
        commands::communication::observability::prompt_lab::get_prompt_versions,
        commands::communication::observability::prompt_lab::get_prompt_versions_bulk,
        commands::communication::observability::prompt_lab::tag_prompt_version,
        commands::communication::observability::prompt_lab::rollback_prompt_version,
        commands::communication::observability::prompt_lab::get_prompt_error_rate,
        commands::communication::observability::prompt_lab::run_prompt_ab_test,
        // Communication -- Observability: Alerts
        commands::communication::observability::alerts::list_alert_rules,
        commands::communication::observability::alerts::create_alert_rule,
        commands::communication::observability::alerts::update_alert_rule,
        commands::communication::observability::alerts::delete_alert_rule,
        commands::communication::observability::alerts::toggle_alert_rule,
        commands::communication::observability::alerts::list_fired_alerts,
        commands::communication::observability::alerts::create_fired_alert,
        commands::communication::observability::alerts::dismiss_fired_alert,
        commands::communication::observability::alerts::clear_fired_alerts,
    ])
}
