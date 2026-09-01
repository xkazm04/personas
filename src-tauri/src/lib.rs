pub mod background_job;
pub mod bench;
/// The backend boot sequence — the `.setup(...)` hook, split into named
/// phase functions. Moved out of `run()` in W1; the call order inside is an
/// invariant (see the module docs).
mod boot;
mod browser_bridge;
mod cloud;
mod commands;
mod companion;
pub mod daemon;
// The data layer is its own crate (see src-tauri/db/). Re-exported under the
// old name so every `crate::db::…` path across commands, engine and companion
// resolves unchanged — the split moved 84k LOC out of this crate without
// touching a single call site.
pub use personas_db as db;
mod engine;
pub use commands::artist::persistence as artist_persistence;
pub use commands::eval_runs;
pub use engine::provider::EngineKind;
pub use engine::render_plan;
pub use personas_core::error;
pub mod freeze_monitor;
mod gitlab;
pub mod ipc_auth;
pub mod keyed_pool;
mod local_http;
mod logging;
/// MCP tool implementations (also compiled into the `personas-mcp` binary).
/// Exposed from the lib so the split engine can call tools in-process.
pub mod mcp_server;
mod notifications;
/// Active-process / run bookkeeping for CLI-backed commands.
/// Moved out of the crate root in W1; re-exported below so every existing
/// `crate::ActiveProcessRegistry` path resolves unchanged.
pub mod process_registry;
pub use process_registry::{ActiveProcess, ActiveProcessRegistry, RunEntry, RunGuard};
mod radio;
/// Shared application state (`AppState`). Moved out of the crate root in W1;
/// re-exported below so every existing `crate::AppState` path resolves
/// unchanged.
pub mod state;
/// Unified retrieval lane — shared, pure retrieval primitives (distance
/// floor, hybrid lane ranking, excerpt-vs-full-body decision) extracted from
/// the companion brain. `pub` so the primitives are part of the lib surface
/// (companion consumes them today; persona-memory injection is the documented
/// next consumer — see the module docs).
/// Re-exported from `personas-core` (see `src-tauri/core/`). Physically moved
/// there as step 1 of the crate split; re-exporting keeps every existing
/// `crate::retrieval::…` path resolving, so the move touched 3 files instead
/// of the ~849 that reference these modules.
pub use personas_core::retrieval;
pub use state::AppState;
// Not feature-gated: the harness needs no optional dependency (std, tokio,
// serde, tauri and the fleet types), and `test_automation` calls into it
// unconditionally from four HTTP handlers whose routes are always registered.
// Gating it behind `test-automation` - a feature that exists to pull in the
// screenshot deps `xcap` and `image` - made `cargo test --features desktop`,
// which is what CI runs, fail to compile.
pub mod load_harness;
pub mod startup_timing;
#[cfg(debug_assertions)]
mod stream_harness;
pub mod test_automation;
#[cfg(feature = "desktop")]
mod tray;
pub use personas_core::utils;
// Moved to `personas-core` (crate-split step 3) — `db::models` validates
// through it, so it had to sit below the data layer.
pub use personas_core::validation;
// `declare_lifecycle!` is `#[macro_export]`ed from `personas_core::lifecycle`,
// which lands it at that crate's root. Re-export so `crate::declare_lifecycle!`
// keeps working (engine::process_session is the remaining caller here).
pub use personas_core::declare_lifecycle;
mod webbuild;

use std::sync::Arc;

use tauri::Manager;

// The process-wide HTTP clients live in `personas_core::http_clients` — engine
// call sites use them, and a `LazyLock` at this crate's root is unreachable
// from any crate below. Re-exported so `crate::SHARED_HTTP` and friends keep
// resolving.
//
// HTTP_ALLOW_PRIVATE is deliberately NOT re-exported: its three callers
// (engine/api_proxy.rs, engine/healthcheck.rs, engine/resource_listing.rs) all
// spell the full personas_core path, so the re-export resolved for nobody. Add
// it back in the same change that adds a `crate::`-qualified caller.
pub(crate) use personas_core::http_clients::{SHARED_HTTP, SSRF_SAFE_HTTP};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    startup_timing::mark_process_start();

    // Prevent ort/ONNX from finding a stale system-wide onnxruntime.dll (e.g. in System32).
    // The ort crate panics if the DLL version doesn't match its expected version.
    // By setting ORT_DYLIB_PATH to a non-existent file, ort will fail to load the DLL
    // gracefully instead of finding the wrong system DLL and panicking.
    if std::env::var_os("ORT_DYLIB_PATH").is_none() {
        let sentinel = dirs::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("com.personas.desktop")
            .join("lib")
            .join("onnxruntime.dll");
        std::env::set_var("ORT_DYLIB_PATH", &sentinel);
    }

    // Load .env file (project root) into process environment so that
    // runtime env vars like SUPABASE_URL are available without needing
    // them baked in at compile time.
    dotenvy::dotenv().ok();

    logging::init();

    tracing::info!("Starting Personas Desktop v{}", env!("CARGO_PKG_VERSION"));

    // Resolve and announce the headless bridge test mode BEFORE anything can
    // read the flag. The gate latches on this call, so an env var set later in
    // the process (a plugin, a test helper) cannot turn it on.
    // docs/architecture/cloud-integration-bridge.md §13.
    personas_engine::headless::warn_at_boot();

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
            builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
                tracing::info!("Single-instance callback fired, argv: {:?}", argv);
            }));
        }

        builder = builder
            .plugin(tauri_plugin_window_state::Builder::new().build())
            .plugin(tauri_plugin_updater::Builder::new().build())
            // No accelerator is bound here — the binding is a persisted user
            // setting and the frontend pushes it down via
            // `companion_set_voice_hotkey` once the store hydrates.
            .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    // Generate IPC session token for privileged command validation
    let ipc_token = ipc_auth::generate_ipc_session_token();
    ipc_auth::init_session_token(ipc_token.clone());
    let ipc_auth_script = ipc_auth::generate_ipc_auth_script(&ipc_token);
    tracing::info!("IPC session token initialised (privileged commands protected)");

    // If PERSONAS_TEST_PORT is set, inject a flag before page JS so the
    // frontend knows to load the test automation bridge.
    let test_port = test_automation::env_test_port();
    let mut final_builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("ipc-auth")
            .js_init_script(ipc_auth_script)
            .build(),
    );
    if test_port.is_some() {
        final_builder = final_builder.plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("test-mode-flag")
                .js_init_script(String::from("window.__PERSONAS_TEST_MODE__ = true;"))
                .build(),
        );
    }

    // Phase 1 diagnostic for idea-7452b77e: registers `stream-test://` so a
    // dev-only frontend harness can measure whether the WebView's URL loader
    // delivers a large response body incrementally or atomically. Compiled
    // only in debug builds.
    #[cfg(debug_assertions)]
    {
        final_builder = final_builder
            .register_asynchronous_uri_scheme_protocol("stream-test", stream_harness::handle);
    }

    final_builder
        .setup(boot::setup)
        .invoke_handler(ipc_auth::wrap_invoke_handler(tauri::generate_handler![
            // Phase 1
            commands::core::frontend_bridge::greet,
            commands::core::frontend_bridge::log_frontend_error,
            commands::core::frontend_bridge::report_frontend_ready,
            // Test automation (always registered; server only starts when enabled)
            test_automation::__test_respond,
            // Core -- Validation
            // Core -- Personas
            commands::core::personas::list_personas,
            commands::core::personas::get_persona,
            commands::core::personas::set_persona_starred,
            commands::core::personas::create_persona,
            commands::core::personas::update_persona,
            commands::core::personas::update_persona_parameters,
            commands::core::personas::list_persona_change_log,
            commands::core::personas::sync_capability_parameters,
            commands::core::personas::duplicate_persona,
            commands::core::personas::persona_blast_radius,
            commands::core::personas::delete_persona,
            commands::core::personas::archive_persona,
            commands::core::personas::restore_persona,
            commands::core::personas::bulk_delete_personas,
            commands::core::personas::get_persona_summaries,
            commands::core::personas::get_persona_detail,
            commands::core::personas::list_personas_using_connector,
            commands::core::personas::resolve_effective_config,
            commands::core::personas::resolve_effective_config_bulk,
            // Core -- Use Cases (Phase C3: capability toggle + simulate;
            // Phase C5b: per-capability generation policy + event rename)
            commands::core::use_cases::get_use_case_cascade,
            commands::core::use_cases::set_use_case_enabled,
            commands::core::use_cases::simulate_use_case,
            commands::core::use_cases::set_use_case_generation_settings,
            commands::core::use_cases::count_event_listeners,
            commands::core::use_cases::rename_event_listeners,
            // Core -- Memories
            commands::core::memories::list_memory_categories,
            commands::core::memories::list_memories,
            commands::core::memories::file_memory_claim,
            commands::core::memories::resolve_memory_claims,
            commands::core::memories::list_memory_claims,
            commands::core::memories::memory_disputed_overview,
            commands::core::memories::list_memories_with_stats,
            commands::core::memories::get_memory_count,
            commands::core::memories::get_memory_stats,
            commands::core::memories::list_memories_by_execution,
            commands::core::memories::create_memory,
            commands::core::memories::delete_memory,
            commands::core::memories::delete_all_memories,
            commands::core::memories::merge_memories,
            commands::core::memories::update_memory_importance,
            commands::core::memories::update_memory_content,
            commands::core::memories::batch_delete_memories,
            commands::core::memories::review_memories_with_cli,
            commands::core::memories::reflect_memories_with_cli,
            commands::core::memories::reflect_team_memories_with_cli,
            commands::core::memories::apply_persona_memory_review_proposal,
            commands::core::memories::discard_persona_memory_review_proposal,
            commands::core::memories::list_persona_memory_review_proposals,
            commands::core::memories::get_persona_memory_review_proposal,
            commands::core::memories::update_memory_tier,
            // Core -- Responsibilities (living-agent charters, WP3)
            commands::core::responsibilities::list_persona_responsibilities,
            commands::core::responsibilities::create_persona_responsibility,
            commands::core::responsibilities::update_persona_responsibility,
            commands::core::responsibilities::retire_persona_responsibility,
            commands::core::responsibilities::list_attention_ledger,
            commands::core::memory_compile::compile_persona_memories,
            // Core -- Memory curation runs (persona_background_job framework)
            commands::core::persona_jobs::enqueue_persona_memory_reflection,
            commands::core::persona_jobs::enqueue_team_memory_reflection,
            commands::core::persona_jobs::set_persona_curation_schedule,
            commands::core::persona_jobs::get_persona_curation_schedule,
            // Core -- Living-agent persona brain (WP4)
            commands::core::persona_brain::run_persona_consolidation_now,
            commands::core::persona_brain::list_persona_episodes,
            commands::core::persona_brain::get_persona_identity,
            commands::core::persona_brain::get_attention_loop_status,
            commands::core::persona_brain::propose_persona_identity_diffs,
            // Core -- Custom persona icons (desktop only — image decode pipeline)
            #[cfg(feature = "desktop")]
            commands::core::persona_icons::import_persona_icon,
            #[cfg(feature = "desktop")]
            commands::core::persona_icons::list_persona_icons,
            #[cfg(feature = "desktop")]
            commands::core::persona_icons::delete_persona_icon,
            #[cfg(feature = "desktop")]
            commands::core::persona_icon_gen::list_image_gen_credentials,
            #[cfg(feature = "desktop")]
            commands::core::persona_icon_gen::generate_persona_icon,
            #[cfg(feature = "desktop")]
            commands::core::persona_icon_gen::get_persona_icon_gen_spend,
            // Core -- Import/Export
            commands::core::import_export::export_persona,
            commands::core::import_export::import_persona,
            // Core -- Gallery (public share loop)
            commands::core::gallery::gallery_publish_persona,
            commands::core::gallery::gallery_import_persona,
            commands::core::gallery::gallery_publish_preset,
            commands::core::gallery::record_referral,
            commands::core::gallery::get_referral_count,
            // Core -- Data Portability
            commands::core::data_portability::get_export_stats,
            commands::core::data_portability::export_full,
            commands::core::data_portability::export_selective,
            commands::core::data_portability::import_portability_bundle,
            commands::core::data_portability::preview_competitive_import,
            commands::core::data_portability::export_credentials,
            commands::core::data_portability::import_credentials,
            #[cfg(debug_assertions)]
            commands::core::data_portability::export_selective_to_path,
            #[cfg(debug_assertions)]
            commands::core::data_portability::import_portability_bundle_from_path,
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
            commands::core::chat::save_chat_session_context,
            commands::core::chat::get_chat_session_context,
            commands::core::chat::get_latest_chat_session,
            // Execution -- Executions
            commands::execution::executions::list_executions,
            commands::execution::executions::list_executions_summary,
            commands::execution::executions::list_all_executions,
            commands::execution::executions::count_executions,
            commands::execution::executions::search_executions,
            commands::execution::executions::get_execution,
            commands::execution::executions::execute_persona,
            commands::execution::executions::prepare_persona_execution,
            commands::execution::executions::cancel_execution,
            commands::execution::executions::list_executions_by_trigger,
            commands::execution::executions::list_executions_for_use_case,
            commands::execution::executions::get_execution_log,
            commands::execution::executions::get_execution_log_lines,
            commands::execution::executions::get_execution_trace,
            commands::execution::executions::get_chain_trace,
            commands::execution::executions::get_chain_stop_reasons,
            commands::execution::journal::get_execution_data_diff,
            commands::execution::journal::undo_execution,
            commands::execution::executions::list_active_chains,
            commands::execution::executions::get_circuit_breaker_status,
            commands::execution::executions::preview_execution,
            commands::execution::executions::dry_run_persona,
            // Execution -- Annotations (tags / note / star)
            commands::execution::annotations::add_annotation,
            commands::execution::annotations::list_execution_annotations,
            commands::execution::annotations::list_persona_annotations,
            commands::execution::annotations::delete_annotation,
            // Execution -- Scheduler
            commands::execution::scheduler::get_scheduler_status,
            commands::execution::scheduler::start_scheduler,
            commands::execution::scheduler::stop_scheduler,
            commands::execution::scheduler::get_subscription_health,
            commands::execution::scheduler::backfill_schedule,
            commands::execution::scheduler::list_schedule_missed_runs,
            commands::execution::scheduler::clear_schedule_missed_runs,
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
            commands::execution::policy_events::get_policy_events_for_execution,
            // Execution -- Self-Tuning Fabric (policy proposals, review-each)
            commands::execution::policy_tuning::policy_tuning_generate,
            commands::execution::policy_tuning::policy_tuning_list,
            commands::execution::policy_tuning::policy_tuning_apply,
            commands::execution::policy_tuning::policy_tuning_decline,
            // Execution -- Audit Incidents inbox (cross-source triage)
            commands::execution::audit_incidents::list_audit_incidents,
            commands::execution::audit_incidents::get_audit_incidents_summary,
            commands::execution::audit_incidents::get_audit_incident,
            commands::execution::audit_incidents::acknowledge_audit_incident,
            commands::execution::audit_incidents::set_incident_in_progress,
            commands::execution::audit_incidents::resolve_audit_incident,
            commands::execution::audit_incidents::dismiss_audit_incident,
            commands::execution::audit_incidents::reopen_audit_incident,
            commands::execution::audit_incidents::bulk_acknowledge_audit_incidents,
            commands::execution::audit_incidents::bulk_resolve_audit_incidents,
            // Execution -- Autonomous NOC v1 (incident diagnosis + handled lane)
            commands::execution::incident_diagnosis::get_incident_diagnosis,
            commands::execution::incident_diagnosis::diagnose_audit_incident,
            commands::execution::incident_diagnosis::list_autonomously_handled_incidents,
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
            commands::execution::lab::lab_activate_version,
            commands::execution::lab::lab_get_error_rate,
            commands::execution::lab::lab_improve_prompt,
            commands::execution::lab::lab_get_active_progress,
            commands::execution::lab::lab_rate_result,
            commands::execution::lab::lab_get_ratings,
            commands::execution::lab::lab_get_version_ratings,
            commands::execution::lab::lab_get_version_economics,
            commands::execution::lab::lab_get_result_events,
            commands::execution::lab::lab_get_tool_calls,
            commands::execution::lab::lab_get_score_weights,
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
            commands::execution::evolution::evolution_list_promotion_proposals,
            commands::execution::evolution::evolution_resolve_promotion_proposal,
            commands::execution::evolution::get_run_budget_state,
            commands::execution::evolution::probe_cli_capabilities,
            // Execution -- Healing
            commands::execution::healing::list_healing_issues,
            commands::execution::healing::get_healing_issue,
            commands::execution::healing::update_healing_status,
            commands::execution::healing::run_healing_analysis,
            commands::execution::healing::get_retry_chain,
            commands::execution::healing::get_healing_timeline,
            commands::execution::healing::list_healing_audit_log,
            commands::execution::healing::get_healing_effectiveness,
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
            commands::design::build_sessions::start_build_session_headless,
            commands::design::build_sessions::answer_build_question,
            commands::design::build_sessions::cancel_build_session,
            commands::design::build_sessions::get_active_build_session,
            commands::design::build_sessions::get_latest_build_session,
            commands::design::build_sessions::list_build_sessions,
            commands::design::build_sessions::get_build_status,
            commands::design::build_sessions::test_build_draft,
            commands::design::build_sessions::promote_build_draft,
            commands::design::archetypes::list_archetypes,
            commands::design::build_sessions::create_adoption_session,
            commands::design::build_sessions::save_adoption_answers,
            commands::design::build_sessions::update_build_session_disabled_dims,
            commands::design::build_simulate::simulate_build_draft,
            commands::design::build_simulate::get_simulation_artefacts,
            #[cfg(feature = "test-automation")]
            commands::testing::synthesize_review::synthesize_manual_review,
            // Design -- Conversations
            commands::design::conversations::list_design_conversations,
            commands::design::conversations::get_design_conversation,
            commands::design::conversations::get_active_design_conversation,
            commands::design::conversations::create_design_conversation,
            commands::design::conversations::append_design_conversation_message,
            commands::design::conversations::append_single_design_message,
            commands::design::conversations::update_design_conversation_status,
            commands::design::conversations::delete_design_conversation,
            // Design -- N8n Transform
            commands::design::n8n_transform::cli_runner::start_n8n_transform_background,
            commands::design::n8n_transform::job_state::get_n8n_transform_snapshot,
            commands::design::n8n_transform::job_state::clear_n8n_transform_snapshot,
            commands::design::n8n_transform::job_state::cancel_n8n_transform,
            commands::design::n8n_transform::confirmation::confirm_n8n_persona_draft,
            commands::design::n8n_transform::cli_runner::continue_n8n_transform,
            // Design -- N8n Limits (canonical payload caps)
            // Design -- N8n Sessions
            commands::design::n8n_sessions::create_n8n_session,
            commands::design::n8n_sessions::get_n8n_session,
            commands::design::n8n_sessions::list_n8n_session_summaries,
            commands::design::n8n_sessions::update_n8n_session,
            commands::design::n8n_sessions::delete_n8n_session,
            // Design -- Template Adopt (legacy adoption-jobs subsystem retired
            // 2026-05-09; only snapshot poll + instant adopt remain wired)
            commands::design::template_adopt::get_template_adopt_snapshot,
            commands::design::template_adopt::instant_adopt_template,
            // Approach 1 -- always-on adjustment of the pre-built base IR
            commands::design::template_adopt::adjust_adoption_draft,
            // Design -- Team Presets (filesystem-shipped multi-template bundles)
            commands::design::team_presets::list_team_presets,
            commands::design::team_presets::get_team_preset,
            commands::design::team_presets::get_preset_adoption_schema,
            commands::design::team_presets::adopt_team_preset,
            commands::design::team_presets::retry_team_preset_members,
            commands::design::template_adopt::generate_template_background,
            commands::design::template_adopt::get_template_generate_snapshot,
            commands::design::template_adopt::clear_template_generate_snapshot,
            commands::design::template_adopt::cancel_template_generate,
            commands::design::template_adopt::save_custom_template,
            // Design -- Template Integrity (backend verification)
            commands::design::template_adopt::verify_template_integrity_batch,
            // Design -- Template Feedback
            commands::design::template_feedback::create_template_feedback,
            commands::design::template_feedback::list_template_feedback,
            commands::design::template_feedback::get_template_performance,
            // Design -- Team Synthesis
            commands::design::team_synthesis::synthesize_team_from_templates,
            commands::design::team_synthesis::synthesize_project_crew,
            commands::design::team_synthesis::get_project_pulse_snapshots,
            commands::design::team_synthesis::get_crew_fitness,
            // Design -- Platform Definitions
            commands::design::platform_definitions::list_platform_definitions,
            commands::design::platform_definitions::get_platform_definition,
            // Design -- Reviews
            commands::design::reviews::list_design_reviews,
            commands::design::reviews::count_design_reviews,
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
            commands::design::reviews::delete_stale_seed_templates,
            commands::design::reviews::start_design_review_run,
            commands::design::reviews::import_design_review,
            commands::design::reviews::batch_import_design_reviews,
            commands::design::reviews::cancel_design_review_run,
            commands::design::reviews::rebuild_design_review,
            commands::design::reviews::get_rebuild_snapshot,
            commands::design::reviews::cancel_rebuild,
            commands::design::reviews::list_manual_reviews,
            commands::design::reviews::list_manual_reviews_page,
            commands::design::reviews::get_manual_review_counts,
            commands::design::reviews::update_manual_review_status,
            commands::design::reviews::dispatch_review_action,
            commands::design::reviews::gc_stale_manual_reviews,
            commands::design::reviews::delete_all_manual_reviews,
            commands::design::reviews::get_pending_review_count,
            commands::design::reviews::list_review_messages,
            commands::design::reviews::add_review_message,
            commands::design::reviews::seed_mock_manual_review,
            commands::execution::knowledge::seed_mock_knowledge,
            commands::tools::triggers::seed_mock_cron_agent,
            commands::communication::reports::seed_mock_message,
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
            commands::credentials::crud::healthcheck_all_credentials,
            commands::credentials::crud::vault_status,
            commands::credentials::crud::migrate_plaintext_credentials,
            commands::credentials::crud::list_credential_fields,
            commands::credentials::crud::update_credential_field,
            commands::credentials::resources::get_scoped_resources,
            commands::credentials::resources::save_scoped_resources,
            commands::credentials::resources::list_connector_resources,
            commands::credentials::resources::set_credential_scope_enforcement,
            // Credentials -- External API Keys (A2A Gateway management API auth)
            commands::credentials::broker::mint_credential_handle,
            commands::credentials::broker::list_broker_consumers,
            commands::credentials::broker::list_broker_consumer_activity,
            commands::credentials::broker::revoke_broker_consumer,
            commands::credentials::external_api_keys::create_external_api_key,
            commands::credentials::external_api_keys::list_external_api_keys,
            commands::credentials::external_api_keys::revoke_external_api_key,
            commands::credentials::external_api_keys::delete_external_api_key,
            commands::credentials::external_api_keys::get_system_api_key,
            commands::credentials::external_api_keys::list_api_key_audit,
            commands::credentials::external_api_keys::list_pending_pairings,
            commands::credentials::external_api_keys::approve_pairing,
            commands::credentials::external_api_keys::reject_pairing,
            commands::credentials::external_api_keys::revoke_pairing,
            // Credentials -- Audit Log (registered via intelligence module)
            // Credentials -- Connectors
            commands::credentials::connectors::list_connectors,
            commands::credentials::connectors::get_connector,
            commands::credentials::connectors::create_connector,
            commands::credentials::connectors::update_connector,
            commands::credentials::connectors::delete_connector,
            // OpenAPI Autopilot
            commands::credentials::openapi_autopilot::openapi_playground_test,
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
            // Communication -- Observability: Performance Digest
            commands::communication::observability::digest::get_digest_config,
            commands::communication::observability::digest::set_digest_config,
            commands::communication::observability::digest::preview_digest,
            commands::communication::observability::digest::send_digest_now,
            // Communication -- SLA Dashboard
            commands::communication::sla::get_sla_dashboard,
            // Teams
            commands::teams::teams::list_teams,
            commands::teams::teams::get_team_counts,
            commands::teams::teams::get_team,
            commands::teams::teams::create_team,
            commands::teams::teams::repair_team_handoff,
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
            commands::teams::teams::approve_pipeline_node,
            commands::teams::teams::reject_pipeline_node,
            commands::teams::teams::get_pipeline_analytics,
            commands::teams::teams::suggest_topology,
            commands::teams::teams::suggest_topology_llm,
            // Team Memories
            commands::teams::team_channel::list_team_channel,
            commands::teams::team_channel::count_team_channel_kinds,
            commands::teams::team_channel::post_team_directive,
            commands::teams::team_channel::companion_post_team_message,
            commands::teams::team_channel::list_team_slack_bridges,
            commands::communication::persona_channel::list_persona_channel,
            commands::communication::persona_channel::count_persona_channel_kinds,
            commands::communication::persona_channel::post_persona_channel_message,
            commands::teams::team_memories::list_team_memories,
            commands::teams::team_memories::create_team_memory,
            commands::teams::team_memories::delete_team_memory,
            commands::teams::team_memories::update_team_memory,
            commands::teams::team_memories::update_team_memory_importance,
            commands::teams::team_memories::batch_delete_team_memories,
            commands::teams::team_memories::get_team_memory_count,
            commands::teams::team_memories::get_team_memory_stats,
            commands::teams::team_memories::list_team_memories_by_run,
            commands::teams::team_memories::evict_team_memories,
            // Team Assignments (orchestration Phase A)
            commands::teams::assignments::create_team_assignment,
            commands::teams::assignments::list_team_assignments,
            commands::teams::assignments::get_team_assignment_detail,
            commands::teams::assignments::list_team_assignment_events,
            commands::teams::assignments::companion_record_assignment_outcome,
            commands::teams::assignments::list_team_assignment_steps,
            commands::teams::assignments::start_team_assignment,
            commands::teams::assignments::abort_team_assignment,
            commands::teams::assignments::pause_team_assignment,
            commands::teams::assignments::resume_team_assignment,
            commands::teams::assignments::resolve_team_assignment_review,
            commands::teams::assignments::delete_team_assignment,
            commands::teams::assignments::set_team_assignment_goal,
            commands::teams::assignments::list_team_assignments_for_goal,
            commands::teams::assignments::decompose_team_assignment_goal,
            commands::teams::assignments::companion_assign_team,
            commands::teams::deliberations::create_team_deliberation,
            commands::teams::deliberations::list_team_deliberations,
            commands::teams::deliberations::get_team_deliberation,
            commands::teams::deliberations::list_deliberation_agenda,
            commands::teams::deliberations::list_deliberation_turns,
            commands::teams::deliberations::advance_team_deliberation,
            commands::teams::deliberations::approve_deliberation_action,
            commands::teams::deliberations::poll_deliberation_action,
            commands::teams::deliberations::skip_deliberation_action,
            commands::teams::deliberations::resolve_deliberation_escalation,
            commands::teams::deliberations::split_team_deliberation,
            commands::teams::deliberations::list_deliberation_tracks,
            commands::teams::deliberations::merge_deliberation_tracks,
            commands::teams::learning::get_assignment_outcome,
            commands::teams::learning::list_assignment_outcomes,
            commands::teams::learning::list_team_member_trust,
            commands::teams::learning::list_team_lessons,
            commands::teams::deliberations::approve_deliberation_proposal,
            commands::teams::deliberations::dismiss_deliberation_proposal,
            commands::teams::assignments::advance_team_goal,
            commands::teams::assignments::create_assignment_template,
            commands::teams::assignments::list_assignment_templates,
            commands::teams::assignments::delete_assignment_template,
            commands::teams::assignments::instantiate_assignment_template,
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
            commands::tools::tools::get_tool_performance_summary,
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
            commands::tools::triggers::set_trigger_unattended_mode,
            commands::tools::triggers::list_pending_trigger_fires,
            commands::tools::triggers::resolve_pending_trigger_fire,
            commands::tools::triggers::delete_trigger,
            commands::tools::triggers::validate_trigger,
            commands::tools::triggers::get_trigger_health_map,
            commands::tools::triggers::link_persona_to_event,
            commands::tools::triggers::unlink_persona_from_event,
            commands::tools::triggers::update_persona_event_handler,
            commands::tools::triggers::cleanup_dead_trigger_events,
            commands::tools::triggers::rename_event_type,
            commands::tools::triggers::get_webhook_status,
            commands::tools::triggers::preview_cron_schedule,
            commands::tools::triggers::cron_fire_times_in_range,
            commands::tools::triggers::dry_run_trigger,
            commands::tools::triggers::list_cron_agents,
            commands::tools::triggers::list_recent_schedule_runs,
            // Tools -- Webhook Request Inspector
            commands::tools::triggers::list_webhook_request_logs,
            commands::tools::triggers::clear_webhook_request_logs,
            commands::tools::triggers::replay_webhook_request,
            commands::tools::triggers::webhook_request_to_curl,
            commands::tools::triggers::get_persona_config_warnings,
            commands::tools::triggers::get_composite_partial_matches,
            // Tools -- Self-Wiring Fabric (mined automation suggestions)
            commands::tools::automation_suggestions::list_automation_suggestions,
            commands::tools::automation_suggestions::accept_automation_suggestion,
            commands::tools::automation_suggestions::reject_automation_suggestion,
            commands::tools::triggers::get_composite_partial_match,
            // Signing -- Document Signatures
            #[cfg(feature = "p2p")]
            commands::signing::sign_document,
            #[cfg(feature = "p2p")]
            commands::signing::verify_document,
            #[cfg(feature = "p2p")]
            commands::signing::generate_signing_key,
            #[cfg(feature = "p2p")]
            commands::signing::list_document_signatures,
            #[cfg(feature = "p2p")]
            commands::signing::get_document_signature,
            #[cfg(feature = "p2p")]
            commands::signing::delete_document_signature,
            #[cfg(feature = "p2p")]
            commands::signing::export_signature_sidecar,
            #[cfg(feature = "p2p")]
            commands::signing::write_sidecar_file,
            #[cfg(feature = "p2p")]
            commands::signing::read_sidecar_file,
            // OCR -- Document Text Extraction
            commands::ocr::ocr_with_gemini,
            commands::ocr::ocr_with_claude,
            commands::ocr::ocr_drive_file_gemini,
            commands::ocr::ocr_drive_file_claude,
            commands::ocr::cancel_ocr_operation,
            // Artist -- 3D/2D Asset Management
            commands::artist::artist_check_blender,
            commands::artist::artist_install_blender_mcp,
            commands::artist::artist_scan_folder,
            commands::artist::artist_list_assets,
            commands::artist::artist_import_asset,
            commands::artist::artist_delete_asset,
            commands::artist::artist_update_tags,
            commands::artist::artist_rename_asset,
            commands::artist::artist_get_default_folder,
            commands::artist::artist_ensure_folders,
            commands::artist::artist_read_image_base64,
            commands::artist::artist_run_creative_session,
            commands::artist::artist_cancel_creative_session,
            // Artist -- FFmpeg / Media Studio
            commands::artist::ffmpeg::artist_check_ffmpeg,
            commands::artist::ffmpeg::artist_probe_media,
            commands::artist::ffmpeg::artist_compile_render_plan,
            commands::artist::ffmpeg::artist_export_composition,
            commands::artist::ffmpeg::artist_cancel_export,
            commands::artist::ffmpeg::artist_extract_audio,
            commands::artist::ffmpeg::artist_save_thumbnail,
            commands::artist::ffmpeg::artist_trim_file,
            commands::artist::ffmpeg::artist_measure_loudness,
            commands::artist::persistence::artist_save_composition,
            commands::artist::persistence::artist_load_composition,
            commands::artist::persistence::artist_autosave_composition,
            commands::artist::persistence::artist_load_autosave,
            commands::artist::persistence::artist_clear_autosave,
            commands::artist::persistence::artist_default_save_dir,
            commands::artist::persistence::artist_composition_file_extension,
            commands::artist::transcribe::artist_transcribe_media,
            commands::artist::transcribe::artist_transcribe_providers_available,
            commands::artist::transcribe::artist_check_local_whisper,
            commands::artist::voiceover::artist_synthesize_voiceover,
            commands::artist::voiceover::artist_list_voiceover_voices,
            commands::artist::voiceover::artist_voiceover_status,
            commands::artist::transcribe::artist_load_transcript,
            // Dev Tools -- Skill Files (browser/editor)
            commands::infrastructure::skill_files::skill_files_list,
            commands::infrastructure::skill_files::skill_files_list_global,
            commands::infrastructure::skill_files::skill_files_read,
            commands::infrastructure::skill_files::skill_files_write,
            commands::infrastructure::skill_files::skill_files_install,
            commands::infrastructure::skill_files::skill_files_install_system,
            commands::infrastructure::skill_files::skill_files_install_preview,
            commands::infrastructure::skill_files::skill_files_stamp_provenance,
            commands::infrastructure::skill_files::skill_files_registry_root,
            // Skill usage telemetry (Brainiac-adoption P1)
            commands::infrastructure::skill_usage::skill_usage_scan,
            commands::infrastructure::skill_usage::skill_usage_overview,
            // Skill standard (versioning + lessons + offline registry —
            // docs/skill-standard.md)
            commands::infrastructure::skill_usage::skill_version_timeline,
            commands::infrastructure::skill_lessons::skill_lessons_list,
            commands::infrastructure::knowledge_promote::dev_tools_promote_persona_knowledge,
            commands::infrastructure::registry_sync::dev_tools_registry_sync,
            commands::infrastructure::registry_sync::dev_tools_set_knowledge_root,
            commands::infrastructure::registry_usage::dev_tools_write_registry_usage,
            commands::infrastructure::skill_registry_export::dev_tools_export_skill_registry,
            // Registry coverage (docs/plans/registry-coverage-ui.md R1, read-only)
            commands::infrastructure::registry_coverage::dev_tools_registry_probe,
            commands::infrastructure::registry_coverage::dev_tools_registry_coverage,
            // Doc-rot telemetry (Brainiac-adoption P2)
            commands::infrastructure::doc_rot::doc_rot_scan,
            commands::infrastructure::doc_rot::doc_rot_overview,
            // Knowledge-health snapshots (Brainiac-adoption P3)
            commands::infrastructure::memory_health::memory_health_scan,
            commands::infrastructure::memory_health::memory_health_overview,
            // Bridge Manifest -- declarative desktop bridges
            #[cfg(feature = "desktop")]
            commands::infrastructure::bridge_manifest::bridge_manifest_list_all,
            #[cfg(feature = "desktop")]
            commands::infrastructure::bridge_manifest::bridge_manifest_describe,
            #[cfg(feature = "desktop")]
            commands::infrastructure::bridge_manifest::bridge_manifest_dispatch,
            // Connector Explorer -- reverse-engineering CLI factory (v1)
            commands::design::connector_explorer::connector_explorer_explore,
            // Provider-CLI auth readiness (vercel/netlify/wrangler/flyctl/railway/gh)
            commands::design::connector_readiness::connector_cli_probe_status,
            commands::design::connector_readiness::connector_cli_probe_refresh,
            // Authoritative connector readiness for browsing surfaces (batch)
            commands::design::connector_readiness::connector_readiness_batch,
            // Drive -- managed local filesystem plugin
            commands::drive::drive_get_root,
            commands::drive::drive_storage_info,
            commands::drive::drive_list,
            commands::drive::drive_list_tree,
            commands::drive::drive_search,
            commands::drive::drive_recent,
            commands::drive::drive_stat,
            commands::drive::drive_read,
            commands::drive::drive_read_text,
            commands::drive::drive_write,
            commands::drive::drive_write_text,
            commands::drive::drive_mkdir,
            commands::drive::drive_delete,
            commands::drive::drive_rename,
            commands::drive::drive_move,
            commands::drive::drive_copy,
            commands::drive::drive_open_in_os,
            commands::drive::drive_reveal_in_os,
            // Live Roadmap -- runtime-fetched roadmap content
            commands::live_roadmap::fetch_roadmap,
            // Eval / Certification -- read-only viewer over docs/test/runs bundles (dev-only UI)
            commands::eval_runs::list_eval_runs,
            commands::eval_runs::get_cert_status,
            commands::eval_runs::get_eval_run,
            // Obsidian Brain -- Second Brain Sync
            commands::obsidian_brain::obsidian_brain_detect_vaults,
            commands::obsidian_brain::obsidian_brain_test_connection,
            commands::obsidian_brain::obsidian_brain_save_config,
            commands::obsidian_brain::obsidian_brain_get_config,
            commands::obsidian_brain::obsidian_brain_list_saved_vaults,
            commands::obsidian_brain::obsidian_brain_set_saved_vaults,
            commands::obsidian_brain::obsidian_mirror_get_config,
            commands::obsidian_brain::obsidian_mirror_set_config,
            commands::obsidian_brain::obsidian_available,
            commands::obsidian_brain::obsidian_mirror_backfill_execution_knowledge,
            commands::obsidian_brain::obsidian_brain_push_sync,
            commands::obsidian_brain::obsidian_brain_get_sync_log,
            commands::obsidian_brain::obsidian_brain_pull_sync,
            commands::obsidian_brain::obsidian_brain_resolve_conflict,
            commands::obsidian_brain::obsidian_brain_list_vault_files,
            commands::obsidian_brain::obsidian_brain_read_vault_note,
            commands::obsidian_brain::obsidian_brain_push_goals,
            commands::obsidian_brain::obsidian_brain_lint_vault,
            commands::obsidian_brain::obsidian_drive_status,
            commands::obsidian_brain::obsidian_drive_push_sync,
            commands::obsidian_brain::obsidian_drive_pull_sync,
            // Obsidian Brain — Revitalize (background vault memory optimization)
            commands::obsidian_brain::revitalize::obsidian_revitalize_start,
            commands::obsidian_brain::revitalize::obsidian_revitalize_snapshot,
            commands::obsidian_brain::revitalize::obsidian_revitalize_active,
            commands::obsidian_brain::revitalize::obsidian_revitalize_cancel,
            commands::obsidian_brain::revitalize::obsidian_revitalize_history,
            // Obsidian Brain — Graph (Obsidian Memory connector)
            commands::obsidian_brain::graph::obsidian_graph_search,
            commands::obsidian_brain::graph::obsidian_graph_outgoing_links,
            commands::obsidian_brain::graph::obsidian_graph_backlinks,
            commands::obsidian_brain::graph::obsidian_graph_list_orphans,
            commands::obsidian_brain::graph::obsidian_graph_list_mocs,
            commands::obsidian_brain::graph::obsidian_graph_stats,
            commands::obsidian_brain::graph::obsidian_graph_append_daily_note,
            commands::obsidian_brain::graph::obsidian_graph_write_meeting_note,
            commands::obsidian_brain::graph::obsidian_graph_start_watcher,
            commands::obsidian_brain::graph::obsidian_graph_stop_watcher,
            // Companion (Athena)
            commands::companion::companion_init,
            commands::companion::companion_reingest_doctrine,
            commands::companion::tours::companion_compose_tour,
            commands::companion::tours::companion_list_composed_tours,
            commands::companion::chat::companion_send_message,
            commands::companion::chat::companion_list_recent_messages,
            commands::companion::chat::companion_reset_conversation,
            commands::companion::conversation::companion_list_conversations,
            commands::companion::conversation::companion_create_conversation,
            commands::companion::conversation::companion_rename_conversation,
            commands::companion::conversation::companion_archive_conversation,
            commands::companion::conversation::companion_mark_conversation_read,
            commands::companion::chat::companion_interrupt_turn,
            commands::companion::chat::companion_cancel_autonomy,
            commands::companion::chat::companion_set_autonomous_mode,
            commands::companion::chat::companion_set_dev_mode,
            commands::companion::chat::companion_dev_op_ledger,
            commands::companion::dev_review::companion_dev_op_self_review,
            commands::companion::chat::companion_dev_op_set_verdict,
            commands::companion::chat::companion_set_fleet_boldness,
            commands::companion::chat::companion_get_fleet_boldness,
            commands::companion::chat::companion_wake_stats,
            commands::companion::canvas_control::companion_canvas_control_result,
            commands::companion::fleet_bridge::companion_record_fleet_event,
            commands::companion::fleet_bridge::companion_get_operative_memory_digest,
            commands::companion::mcp_bridge::companion_mcp_resolve_request,
            commands::companion::mcp_bridge::companion_mcp_pending_snapshot,
            #[cfg(feature = "test-automation")]
            commands::companion::mcp_bridge::companion_test_fleet_dispatch,
            #[cfg(feature = "test-automation")]
            commands::companion::approvals::companion_list_pending_approvals,
            commands::companion::backlog_triage::dev_tools_athena_triage_batch,
            commands::companion::backlog_triage::dev_tools_apply_triage_verdicts,
            commands::companion::approvals::companion_approve_action,
            commands::companion::approvals::companion_reject_action,
            commands::companion::approvals::companion_analyze_fleet,
            commands::companion::approvals::companion_dispatch_fleet_plan,
            commands::companion::approvals::companion_create_ship_milestone,
            commands::companion::approvals::companion_create_ship_goals,
            commands::companion::approvals::companion_daily_brief,
            commands::companion::browser_test::browser_bridge_status,
            commands::companion::browser_test::browser_bridge_regenerate_token,
            commands::companion::browser_test::companion_file_browser_defects,
            commands::companion::brain::companion_list_brain_items,
            commands::companion::brain::companion_count_brain_items,
            commands::companion::brain::companion_get_brain_item,
            commands::companion::brain::companion_delete_brain_item,
            commands::companion::brain::companion_save_identity,
            commands::companion::brain::companion_correct_identity_claim,
            commands::companion::brain::companion_reembed_missing,
            commands::companion::brain::companion_brain_health,
            commands::companion::feedback::companion_beta_flags,
            commands::companion::feedback::companion_record_ux_signal,
            #[cfg(debug_assertions)]
            commands::companion::debug_export::companion_export_conversation_log,
            commands::companion::daily_goals::companion_daily_goals_state,
            commands::companion::daily_goals::companion_daily_goals_create,
            commands::companion::daily_goals::companion_daily_goals_update,
            commands::companion::daily_goals::companion_daily_goals_toggle,
            commands::companion::daily_goals::companion_daily_goals_discard,
            commands::companion::chat::companion_list_messages_before,
            commands::companion::chat_cards::companion_list_chat_cards,
            commands::companion::chat_cards::companion_resolve_chat_card,
            commands::companion::sidecars::companion_save_turn_sidecar,
            commands::companion::sidecars::companion_get_turn_sidecars,
            commands::companion::voice::companion_tts,
            commands::companion::voice::companion_tts_list_kokoro_voices,
            commands::companion::voice::companion_tts_kokoro_status,
            commands::companion::voice::companion_tts_kokoro_download,
            commands::companion::voice::companion_tts_pocket_status,
            commands::companion::voice::companion_tts_list_pocket_voices,
            commands::companion::voice::companion_tts_pocket_download,
            commands::companion::voice::companion_tts_pocket_import_voice,
            commands::companion::voice::companion_tts_pocket_delete_voice,
            commands::companion::stt::companion_stt_transcribe,
            commands::companion::stt::companion_stt_list_models,
            commands::companion::stt::companion_stt_download_model,
            commands::companion::stt::companion_stt_delete_model,
            commands::companion::stt::companion_stt_engine_status,
            #[cfg(feature = "desktop")]
            commands::companion::voice_hotkey::companion_set_voice_hotkey,
            commands::companion::stt::companion_stt_install_engine,
            commands::companion::consolidate::companion_run_consolidation,
            commands::companion::consolidate::companion_list_consolidation_runs,
            commands::companion::consolidate::companion_list_cycle_reports,
            commands::companion::consolidate::companion_run_sleep_cycle,
            commands::companion::consolidate::companion_get_sleep_pressure,
            commands::companion::consolidate::companion_get_consolidation_items,
            commands::companion::consolidate::companion_apply_consolidation_item,
            commands::companion::consolidate::companion_reject_consolidation_item,
            commands::companion::consolidate::companion_decay_unused_facts,
            commands::companion::consolidate::companion_run_reflection,
            commands::companion::consolidate::companion_list_reflections,
            commands::companion::consolidate::companion_get_reflection,
            commands::companion::consolidate::companion_get_dashboard,
            commands::companion::consolidate::companion_get_cockpit,
            commands::companion::briefing::companion_compose_briefing,
            commands::companion::briefing::companion_record_briefing_action,
            commands::companion::consolidate::companion_pin_widget_to_cockpit,
            commands::companion::consolidate::companion_unpin_widget_from_cockpit,
            commands::companion::observability::companion_get_usage_dashboard,
            commands::companion::observability::companion_get_health,
            commands::companion::observability::companion_get_adaptations,
            commands::companion::observability::companion_prompt_block_stats,
            commands::companion::observability::companion_get_prompt_churn,
            commands::companion::observability::companion_get_spend_rollup,
            commands::companion::proactive::companion_evaluate_proactive_now,
            commands::companion::proactive::companion_list_proactive_messages,
            commands::companion::proactive::companion_engage_proactive,
            commands::companion::proactive::companion_dismiss_proactive,
            #[cfg(feature = "desktop")]
            commands::companion::sensory::companion_get_sensory_state,
            #[cfg(feature = "desktop")]
            commands::companion::sensory::companion_set_sensory_source_enabled,
            #[cfg(feature = "desktop")]
            commands::companion::sensory::companion_purge_sensory_source,
            #[cfg(feature = "desktop")]
            commands::companion::sensory::companion_list_sensory_signals,
            #[cfg(feature = "desktop")]
            commands::companion::sensory::companion_delete_sensory_signal,
            #[cfg(feature = "desktop")]
            commands::companion::sensory::companion_list_cli_session_reads,
            commands::companion::connectors::companion_list_active_connectors,
            commands::companion::connectors::companion_set_active_connectors,
            commands::companion::connectors::companion_set_connector_enabled,
            commands::companion::connectors::companion_remove_connector,
            commands::companion::plugins::companion_list_plugin_toggles,
            commands::companion::plugins::companion_set_plugin_enabled,
            commands::companion::jobs::companion_list_projects,
            commands::companion::jobs::companion_register_project,
            commands::companion::project_tracking::project_tracking_list_subscriptions,
            commands::companion::project_tracking::project_tracking_set_subscription,
            commands::companion::project_tracking::project_tracking_set_master_enabled,
            commands::companion::project_tracking::project_tracking_is_master_enabled,
            commands::companion::project_tracking::project_tracking_run_now,
            commands::companion::project_tracking::project_tracking_get_obsidian_vault,
            commands::companion::jobs::companion_list_jobs,
            commands::companion::jobs::companion_get_job,
            commands::companion::jobs::companion_enqueue_job,
            commands::companion::templates::companion_match_templates,
            commands::companion::decisions::companion_list_design_decisions,
            // Infrastructure -- Auth
            commands::infrastructure::auth::login_with_google,
            commands::infrastructure::auth::get_auth_state,
            commands::infrastructure::auth::logout,
            commands::infrastructure::auth::refresh_session,
            commands::infrastructure::auth::clear_pending_oauth,
            commands::infrastructure::auth::login_with_google_drive,
            commands::infrastructure::auth::get_google_drive_status,
            // Infrastructure -- System
            commands::infrastructure::system::system_health_check,
            commands::infrastructure::system::health_check_local,
            commands::infrastructure::system::health_check_agents,
            commands::infrastructure::system::health_check_cloud,
            commands::infrastructure::system::health_check_account,
            commands::infrastructure::system::health_check_circuit_breaker,
            commands::infrastructure::system::health_check_subscriptions,
            commands::infrastructure::system::health_check_environment,
            commands::infrastructure::system::cdc_dropped_count,
            commands::infrastructure::system::storage_usage,
            commands::infrastructure::system::prune_storage,
            commands::infrastructure::system::open_external_url,
            commands::infrastructure::system::open_local_path,
            commands::infrastructure::system::register_claude_desktop_mcp,
            commands::infrastructure::system::unregister_claude_desktop_mcp,
            commands::infrastructure::system::check_claude_desktop_mcp,
            commands::infrastructure::system::get_crash_logs,
            commands::infrastructure::system::clear_crash_logs,
            commands::infrastructure::system::get_log_directory_stats,
            commands::infrastructure::system::report_frontend_crash,
            commands::infrastructure::system::get_frontend_crashes,
            commands::infrastructure::system::clear_frontend_crashes,
            commands::infrastructure::system::get_frontend_crash_count,
            commands::infrastructure::system::get_db_performance,
            // Infrastructure -- Setup / Auto-install
            commands::infrastructure::setup::start_setup_install,
            commands::infrastructure::setup::cancel_setup_install,
            // Infrastructure -- Local scraper (Pumper, Phase 1b)
            commands::infrastructure::scraper::scraper_list_configs,
            commands::infrastructure::scraper::scraper_save_config,
            commands::infrastructure::scraper::scraper_run_config,
            commands::infrastructure::scraper::scraper_delete_config,
            commands::infrastructure::scraper::scraper_run_extract,
            commands::infrastructure::scraper::scraper_preview_extract,
            commands::infrastructure::scraper::scraper_generate_rules,
            commands::infrastructure::scraper::scraper_list_datasets,
            commands::infrastructure::scraper::scraper_query_dataset,
            // Infrastructure -- Settings
            commands::infrastructure::settings::get_app_setting,
            commands::infrastructure::settings::get_app_settings_bulk,
            commands::infrastructure::settings::set_app_setting,
            commands::infrastructure::settings::get_model_routing_rules,
            commands::infrastructure::settings::set_model_routing_rules,
            commands::infrastructure::settings::delete_app_setting,
            commands::infrastructure::settings::get_quality_gate_config,
            commands::infrastructure::settings::set_quality_gate_config,
            commands::infrastructure::settings::reset_quality_gate_config,
            commands::infrastructure::settings::list_settings_audit_entries,
            // Infrastructure -- Qwen remote engine (Phase 1 split engine)
            commands::infrastructure::qwen_engine::set_qwen_credentials,
            commands::infrastructure::qwen_engine::get_qwen_status,
            commands::infrastructure::qwen_engine::clear_qwen_credentials,
            // Infrastructure -- BYOM (Bring Your Own Model)
            commands::infrastructure::byom::get_byom_policy,
            commands::infrastructure::byom::set_byom_policy,
            commands::infrastructure::byom::validate_byom_policy,
            commands::infrastructure::byom::delete_byom_policy,
            commands::infrastructure::byom::list_provider_audit_log,
            commands::infrastructure::byom::list_provider_audit_by_persona,
            commands::infrastructure::byom::get_provider_usage_stats,
            commands::infrastructure::byom::get_provider_usage_timeseries,
            commands::infrastructure::byom::test_provider_connection,
            // Infrastructure -- Cloud
            commands::infrastructure::cloud::cloud_connect,
            commands::infrastructure::cloud::cloud_diagnose,
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
            commands::infrastructure::cloud::cloud_sync_persona,
            commands::infrastructure::cloud::cloud_list_deployments,
            commands::infrastructure::cloud::cloud_pause_deployment,
            commands::infrastructure::cloud::cloud_resume_deployment,
            commands::infrastructure::cloud::cloud_undeploy,
            commands::infrastructure::cloud::cloud_adopt_deployment,
            commands::infrastructure::cloud::cloud_get_base_url,
            commands::infrastructure::cloud::cloud_list_pending_reviews,
            commands::infrastructure::cloud::cloud_respond_to_review,
            commands::infrastructure::cloud::cloud_list_executions,
            commands::infrastructure::cloud::cloud_execution_stats,
            commands::infrastructure::cloud::cloud_get_execution_output,
            commands::infrastructure::cloud::cloud_list_triggers,
            commands::infrastructure::cloud::cloud_create_trigger,
            commands::infrastructure::cloud::cloud_update_trigger,
            commands::infrastructure::cloud::cloud_delete_trigger,
            commands::infrastructure::cloud::cloud_list_trigger_firings,
            commands::infrastructure::cloud::cloud_webhook_relay_status,
            commands::infrastructure::cloud::smee_relay_list,
            commands::infrastructure::cloud::smee_relay_create,
            commands::infrastructure::cloud::smee_relay_update,
            commands::infrastructure::cloud::smee_relay_set_status,
            commands::infrastructure::cloud::smee_relay_delete,
            commands::infrastructure::cloud_sync::cloud_sync_set_enabled,
            commands::infrastructure::cloud_sync::cloud_sync_status,
            commands::infrastructure::cloud_sync::cloud_sync_now,
            cloud::remote_commands::remote_command_list_pending,
            cloud::remote_commands::remote_command_approve,
            cloud::remote_commands::remote_command_reject,
            // Infrastructure -- GitLab
            commands::infrastructure::gitlab::gitlab_connect,
            commands::infrastructure::gitlab::gitlab_connect_from_vault,
            commands::infrastructure::gitlab::gitlab_disconnect,
            commands::infrastructure::gitlab::gitlab_get_config,
            commands::infrastructure::gitlab::gitlab_list_projects,
            commands::infrastructure::gitlab::gitlab_deploy_persona,
            commands::infrastructure::gitlab::gitlab_list_agents,
            commands::infrastructure::gitlab::gitlab_deployment_status,
            commands::infrastructure::gitlab::gitlab_undeploy_agent,
            commands::infrastructure::gitlab::gitlab_revoke_credentials,
            commands::infrastructure::gitlab::gitlab_list_persona_versions,
            commands::infrastructure::gitlab::gitlab_deploy_persona_versioned,
            commands::infrastructure::gitlab::gitlab_rollback_persona,
            commands::infrastructure::gitlab::gitlab_list_persona_branches,
            commands::infrastructure::gitlab::gitlab_setup_persona_branches,
            commands::infrastructure::gitlab::gitlab_list_deployment_history,
            commands::infrastructure::gitlab::list_deployment_history_all,
            commands::infrastructure::gitlab::gitlab_rollback_from_history,
            // Workflows
            commands::infrastructure::workflows::get_workflows_overview,
            commands::infrastructure::workflows::get_workflow_job_output,
            commands::infrastructure::workflows::cancel_workflow_job,
            // Tier usage
            commands::infrastructure::tier_usage::get_tier_usage,
            commands::infrastructure::system_metrics::get_system_metrics,
            // Research Lab
            commands::infrastructure::research_lab::research_lab_list_projects,
            commands::infrastructure::research_lab::research_lab_get_project,
            commands::infrastructure::research_lab::research_lab_create_project,
            commands::infrastructure::research_lab::research_lab_update_project,
            commands::infrastructure::research_lab::research_lab_delete_project,
            commands::infrastructure::research_lab::research_lab_list_sources,
            commands::infrastructure::research_lab::research_lab_create_source,
            commands::infrastructure::research_lab::research_lab_delete_source,
            commands::infrastructure::research_lab::research_lab_list_hypotheses,
            commands::infrastructure::research_lab::research_lab_create_hypothesis,
            commands::infrastructure::research_lab::research_lab_update_hypothesis,
            commands::infrastructure::research_lab::research_lab_delete_hypothesis,
            commands::infrastructure::research_lab::research_lab_list_experiments,
            commands::infrastructure::research_lab::research_lab_create_experiment,
            commands::infrastructure::research_lab::research_lab_delete_experiment,
            commands::infrastructure::research_lab::research_lab_list_findings,
            commands::infrastructure::research_lab::research_lab_create_finding,
            commands::infrastructure::research_lab::research_lab_delete_finding,
            commands::infrastructure::research_lab::research_lab_list_reports,
            commands::infrastructure::research_lab::research_lab_create_report,
            commands::infrastructure::research_lab::research_lab_delete_report,
            commands::infrastructure::research_lab::research_lab_get_dashboard_stats,
            commands::infrastructure::research_lab::research_lab_update_source_status,
            commands::infrastructure::research_lab::research_lab_sync_to_obsidian,
            commands::infrastructure::research_lab::research_lab_sync_daily_note,
            commands::infrastructure::research_lab::research_lab_list_experiment_runs,
            commands::infrastructure::research_lab::research_lab_create_experiment_run,
            // Director -- meta-persona that coaches every other persona
            commands::infrastructure::director::get_director_persona_id,
            commands::infrastructure::director::run_director_on_persona,
            commands::infrastructure::director::run_director_memory_cleanup,
            commands::infrastructure::director::run_director_batch,
            commands::infrastructure::director::list_director_verdicts,
            commands::infrastructure::director::list_director_score_trends,
            commands::infrastructure::director::get_director_portfolio,
            commands::infrastructure::director::get_director_brain_enabled,
            commands::infrastructure::director::set_director_brain_enabled,
            commands::infrastructure::director::get_director_brain_history,
            commands::infrastructure::director::commission_director_experiment,
            commands::infrastructure::director::list_director_experiments,
            commands::infrastructure::director::get_director_campaign_report,
            // Dev Tools -- Projects
            commands::infrastructure::dev_tools::dev_tools_list_projects,
            commands::infrastructure::dev_tools::dev_tools_create_project,
            commands::infrastructure::dev_tools::dev_tools_update_project,
            commands::infrastructure::dev_tools::dev_tools_set_standards_config,
            commands::infrastructure::dev_tools::dev_tools_backfill_qa_pr_review,
            commands::infrastructure::dev_tools::dev_tools_delete_project,
            commands::infrastructure::dev_tools::dev_tools_get_active_project,
            commands::infrastructure::dev_tools::dev_tools_set_active_project,
            // Dev Tools -- Workspace Knowledge Center (docs/plans/workspace-knowledge-center.md)
            commands::infrastructure::dev_workspaces::dev_tools_workspace_list,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_create,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_update,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_delete,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_assign_project,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_import_local,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_knowledge_list,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_knowledge_create,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_knowledge_update,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_knowledge_decide,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_knowledge_delete,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_adoption_list,
            commands::infrastructure::dev_workspaces::dev_tools_practice_context_rollup,
            commands::infrastructure::dev_workspaces::dev_tools_pattern_edges_list,
            commands::infrastructure::dev_workspaces::dev_tools_pattern_edge_set,
            commands::infrastructure::dev_workspaces::dev_tools_pattern_edge_delete,
            commands::infrastructure::dev_workspaces::dev_tools_playbooks_list,
            commands::infrastructure::dev_workspaces::dev_tools_playbook_patterns_list,
            commands::infrastructure::dev_workspaces::dev_tools_playbook_create,
            commands::infrastructure::dev_workspaces::dev_tools_playbook_set_status,
            commands::infrastructure::dev_workspaces::dev_tools_playbook_delete,
            commands::infrastructure::dev_workspaces::dev_tools_playbook_set_patterns,
            commands::infrastructure::dev_workspaces::dev_tools_consult_stats,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_adoption_set,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_run_miners,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_backfill_practice_ideas,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_project_practices,
            commands::infrastructure::workspace_harvest::dev_tools_workspace_harvest_prepare,
            commands::infrastructure::workspace_harvest::dev_tools_workspace_knowledge_ingest,
            commands::infrastructure::workspace_harvest::dev_tools_workspace_harvest_coverage,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_knowledge_decide_bulk,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_roll_up_doctrine,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_evidence_list,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_evidence_add,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_evidence_delete,
            commands::infrastructure::dev_workspaces::dev_tools_workspace_knowledge_set_structure,
            commands::infrastructure::workspace_divergence::dev_tools_workspace_run_divergence,
            commands::infrastructure::workspace_divergence::dev_tools_workspace_get_divergence_status,
            commands::infrastructure::workspace_divergence::dev_tools_workspace_cancel_divergence,
            commands::infrastructure::workspace_verify::dev_tools_workspace_verify_adoptions,
            commands::infrastructure::workspace_verify::dev_tools_workspace_get_verify_status,
            // Dev Tools -- Goals
            commands::infrastructure::dev_tools::dev_tools_list_goals,
            commands::infrastructure::dev_tools::dev_tools_create_goal,
            commands::infrastructure::dev_tools::dev_tools_update_goal,
            commands::infrastructure::dev_tools::dev_tools_delete_goal,
            commands::infrastructure::dev_tools::dev_tools_reorder_goals,
            // Dev Tools -- milestones (Ship layer: convergence cuts)
            commands::infrastructure::dev_tools::dev_tools_list_milestones,
            commands::infrastructure::dev_tools::dev_tools_create_milestone,
            commands::infrastructure::dev_tools::dev_tools_update_milestone,
            commands::infrastructure::dev_tools::dev_tools_delete_milestone,
            commands::infrastructure::dev_tools::dev_tools_list_milestone_items,
            commands::infrastructure::dev_tools::dev_tools_set_milestone_item,
            commands::infrastructure::dev_tools::dev_tools_remove_milestone_item,
            // The /ship-milestone skill's one gated door back into the app.
            commands::infrastructure::dev_tools::dev_tools_ship_milestone_ingest,
            commands::infrastructure::dev_tools::dev_tools_triage_verdicts_ingest,
            // Dev Tools -- L1 passport wall (one batched read for N covers)
            commands::infrastructure::dev_tools::dev_tools_project_wall_summary,
            // Dev Tools -- use cases (behavioral slice layer under contexts)
            commands::infrastructure::dev_tools::dev_tools_list_use_cases,
            commands::infrastructure::dev_tools::dev_tools_get_use_case,
            commands::infrastructure::dev_tools::dev_tools_list_use_cases_for_context,
            commands::infrastructure::dev_tools::dev_tools_create_use_case,
            commands::infrastructure::dev_tools::dev_tools_update_use_case,
            commands::infrastructure::dev_tools::dev_tools_delete_use_case,
            commands::infrastructure::dev_tools::dev_tools_backfill_use_cases,
            commands::infrastructure::use_case_scan::dev_tools_scan_use_cases,
            commands::infrastructure::use_case_scan::dev_tools_cancel_use_case_scan,
            commands::infrastructure::use_case_scan::dev_tools_get_use_case_scan_status,
            commands::infrastructure::dev_tools_http::dev_tools_bridge_port,
            // Dev Tools -- KPIs (outcome layer above goals)
            commands::infrastructure::dev_tools::dev_tools_list_kpis,
            commands::infrastructure::dev_tools::dev_tools_get_kpi,
            commands::infrastructure::dev_tools::dev_tools_create_kpi,
            commands::infrastructure::dev_tools::dev_tools_update_kpi,
            commands::infrastructure::dev_tools::dev_tools_delete_kpi,
            commands::infrastructure::dev_tools::dev_tools_save_kpi_assessment,
            commands::infrastructure::dev_tools::dev_tools_list_kpi_measurements,
            commands::infrastructure::dev_tools::dev_tools_record_kpi_measurement,
            commands::infrastructure::kpi_scan::dev_tools_scan_kpis,
            commands::infrastructure::kpi_sim::dev_tools_kpi_sim_prepare,
            commands::infrastructure::kpi_sim::dev_tools_kpi_sim_ingest,
            commands::infrastructure::feed_impact::dev_tools_feed_impact_ingest,
            commands::infrastructure::memory_ledger::dev_tools_memory_ingest,
            commands::infrastructure::context_map_export::dev_tools_export_backlog_digest,
            commands::infrastructure::memory_ledger::dev_tools_memory_list,
            commands::infrastructure::memory_ledger::dev_tools_memory_coverage,
            commands::infrastructure::memory_ledger::dev_tools_memory_project_vault,
            commands::infrastructure::memory_ledger::dev_tools_memory_import_vault,
            commands::infrastructure::memory_ledger::dev_tools_memory_skill_coverage,
            commands::infrastructure::memory_ledger::dev_tools_memory_skill_contexts,
            commands::infrastructure::memory_ledger::dev_tools_memory_skill_context_pairs,
            commands::infrastructure::kpi_scan::dev_tools_cancel_kpi_scan,
            commands::infrastructure::kpi_scan::dev_tools_get_kpi_scan_status,
            commands::infrastructure::llm_spend::llm_spend_dashboard,
            commands::infrastructure::kpi_compose::dev_tools_compose_kpi_measure,
            commands::infrastructure::kpi_compose::dev_tools_propose_kpi,
            commands::infrastructure::kpi_compose::dev_tools_propose_kpi_auto,
            commands::infrastructure::kpi_compose::dev_tools_get_kpi_compose_status,
            commands::infrastructure::kpi_compose::dev_tools_cancel_kpi_compose,
            commands::infrastructure::dev_tools::dev_tools_evaluate_kpi,
            commands::infrastructure::dev_tools::dev_tools_evaluate_due_kpis,
            // Per-project autopilot (one switch over the KPI→goal→team loop)
            commands::infrastructure::autopilot::dev_tools_get_autopilot_mode,
            commands::infrastructure::autopilot::dev_tools_set_autopilot_mode,
            commands::infrastructure::dev_tools::dev_tools_list_all_kpis,
            commands::infrastructure::dev_tools::dev_tools_list_kpi_measurements_bulk,
            commands::infrastructure::dev_tools::dev_tools_list_kpi_metric_types,
            commands::infrastructure::dev_tools::dev_tools_kpi_matching_credentials,
            commands::infrastructure::dev_tools::dev_tools_kpi_compose_binding,
            commands::infrastructure::dev_tools::dev_tools_kpi_activate_binding,
            commands::infrastructure::dev_tools::dev_tools_kpi_list_bindings,
            // Dev Tools -- Goal Dependencies
            commands::infrastructure::dev_tools::dev_tools_list_goal_dependencies,
            commands::infrastructure::dev_tools::dev_tools_add_goal_dependency,
            commands::infrastructure::dev_tools::dev_tools_remove_goal_dependency,
            // Dev Tools -- Goal Signals
            commands::infrastructure::dev_tools::dev_tools_list_goal_signals,
            // Dev Tools -- Goal Items + progress resolver (goals hub)
            commands::infrastructure::dev_tools::dev_tools_list_goal_items,
            commands::infrastructure::dev_tools::dev_tools_create_goal_item,
            commands::infrastructure::dev_tools::dev_tools_update_goal_item,
            commands::infrastructure::dev_tools::dev_tools_delete_goal_item,
            commands::infrastructure::dev_tools::dev_tools_reorder_goal_items,
            commands::infrastructure::dev_tools::dev_tools_set_goal_verification,
            commands::infrastructure::dev_tools::dev_tools_clear_goal_verification,
            commands::infrastructure::dev_tools::dev_tools_run_goal_uat,
            commands::infrastructure::dev_tools::dev_tools_complete_goal_uat,
            commands::infrastructure::dev_tools::dev_tools_list_child_goals,
            commands::infrastructure::dev_tools::dev_tools_resolve_goal_progress,
            // Dev Tools -- Goals v2 cross-project surfaces (Portfolio / Attention / Timeline / Map)
            commands::infrastructure::dev_tools::dev_tools_list_all_goals,
            // Goal acceptance queue (human-acceptance gate)
            commands::infrastructure::dev_tools::dev_tools_list_pending_acceptance,
            commands::infrastructure::dev_tools::dev_tools_count_pending_acceptance,
            commands::infrastructure::dev_tools::dev_tools_pending_counts,
            commands::infrastructure::dev_tools::dev_tools_resolve_goal_acceptance,
            commands::infrastructure::dev_tools::dev_tools_list_goal_dependencies_for_project,
            commands::infrastructure::dev_tools::dev_tools_list_goal_items_for_project,
            commands::infrastructure::dev_tools::dev_tools_goal_advancing_teams,
            // Staleness engine — goals + ideas + tasks in one ranked queue,
            // plus the accepted-but-never-dispatched list on its own.
            commands::infrastructure::dev_tools::dev_tools_attention_queue,
            commands::infrastructure::dev_tools::dev_tools_undispatched_ideas,
            // Dev Tools -- Context Groups
            commands::infrastructure::dev_tools::dev_tools_list_context_groups,
            commands::infrastructure::dev_tools::dev_tools_list_env_connectors,
            commands::infrastructure::dev_tools::dev_tools_set_env_connector,
            commands::infrastructure::dev_tools::dev_tools_create_context_group,
            commands::infrastructure::dev_tools::dev_tools_update_context_group,
            commands::infrastructure::dev_tools::dev_tools_delete_context_group,
            commands::infrastructure::dev_tools::dev_tools_reorder_context_groups,
            // Dev Tools -- Contexts
            commands::infrastructure::dev_tools::dev_tools_list_contexts,
            commands::infrastructure::dev_tools::dev_tools_create_context,
            commands::infrastructure::dev_tools::dev_tools_update_context,
            commands::infrastructure::dev_tools::dev_tools_delete_context,
            commands::infrastructure::dev_tools::dev_tools_set_context_pinned,
            // Dev Tools -- Context Generation (LLM-powered codebase scan)
            commands::infrastructure::context_generation::dev_tools_scan_codebase,
            commands::infrastructure::context_generation::dev_tools_cancel_scan_codebase,
            commands::infrastructure::context_generation::dev_tools_get_scan_codebase_status,
            commands::infrastructure::context_audit::dev_tools_audit_contexts,
            commands::infrastructure::context_consolidate::dev_tools_repair_cross_refs,
            commands::infrastructure::context_fingerprints::dev_tools_refresh_context_fingerprints,
            // Dev Tools -- Knowledge hierarchy (docs/concepts/paths/, read-only)
            commands::infrastructure::hierarchy_read::dev_tools_hierarchy_graph,
            commands::infrastructure::hierarchy_read::dev_tools_hierarchy_doc,
            commands::infrastructure::hierarchy_read::dev_tools_hierarchy_scorecard,
            // System operations (trigger → built-in op automations; Chain Studio + Context Map)
            commands::infrastructure::system_ops::system_ops_list_kinds,
            commands::infrastructure::system_ops::system_ops_list_automations,
            commands::infrastructure::system_ops::system_ops_create_automation,
            commands::infrastructure::system_ops::system_ops_set_enabled,
            commands::infrastructure::system_ops::system_ops_delete_automation,
            commands::infrastructure::system_ops::system_ops_run_now,
            commands::infrastructure::system_ops::system_ops_report_outcome,
            // Dev Tools -- Context Group Relationships
            commands::infrastructure::dev_tools::dev_tools_list_context_group_relationships,
            commands::infrastructure::dev_tools::dev_tools_create_context_group_relationship,
            commands::infrastructure::dev_tools::dev_tools_delete_context_group_relationship,
            // Dev Tools -- Ideas
            commands::infrastructure::dev_tools::dev_tools_list_ideas,
            commands::infrastructure::dev_tools::dev_tools_get_idea,
            commands::infrastructure::dev_tools::dev_tools_create_idea,
            commands::infrastructure::dev_tools::dev_tools_create_finding,
            commands::infrastructure::dev_tools::dev_tools_list_finding_dedup_keys,
            commands::infrastructure::dev_tools::dev_tools_set_finding_verify_state,
            commands::infrastructure::dev_tools::dev_tools_update_idea,
            commands::infrastructure::dev_tools::dev_tools_accept_idea,
            commands::infrastructure::dev_tools::dev_tools_reject_idea,
            commands::infrastructure::dev_tools::dev_tools_list_pending_ideas,
            commands::infrastructure::dev_tools::dev_tools_triage_ideas,
            commands::infrastructure::dev_tools::dev_tools_delete_idea,
            commands::infrastructure::dev_tools::dev_tools_bulk_delete_ideas,
            // Dev Tools -- Scans
            commands::infrastructure::dev_tools::dev_tools_list_scans,
            commands::infrastructure::dev_tools::dev_tools_get_scan,
            // Dev Tools -- Idea Scanner (LLM-powered)
            commands::infrastructure::idea_scanner::dev_tools_list_scan_agents,
            commands::infrastructure::idea_scanner::dev_tools_run_scan,
            commands::infrastructure::idea_scanner::dev_tools_cancel_scan,
            commands::infrastructure::idea_scanner::dev_tools_get_idea_scan_status,
            // Dev Tools -- Static Scan (deterministic CLI-driven sibling)
            commands::infrastructure::static_scan::dev_tools_set_static_scan_config,
            commands::infrastructure::standards_scan::dev_tools_run_standards_scan,
            commands::infrastructure::standards_scan::dev_tools_list_standards,
            commands::infrastructure::static_scan::dev_tools_run_static_scan,
            // Dev Tools -- Tasks
            commands::infrastructure::dev_tools::dev_tools_list_tasks,
            commands::infrastructure::dev_tools::dev_tools_create_task,
            commands::infrastructure::dev_tools::dev_tools_update_task,
            commands::infrastructure::dev_tools::dev_tools_delete_task,
            commands::infrastructure::dev_tools::dev_tools_tasks_page,
            commands::infrastructure::dev_tools::dev_tools_retry_task,
            commands::infrastructure::dev_tools::dev_tools_dispatch_ideas,
            // Dev Tools -- Task Executor (CLI-powered)
            commands::infrastructure::task_executor::dev_tools_execute_task,
            commands::infrastructure::task_executor::dev_tools_start_batch,
            commands::infrastructure::task_executor::dev_tools_cancel_task_execution,
            commands::infrastructure::task_executor::dev_tools_start_auto_run,
            commands::infrastructure::task_executor::dev_tools_cancel_auto_run,
            commands::infrastructure::task_executor::dev_tools_get_auto_run_status,
            // Dev Tools -- Triage Rules
            commands::infrastructure::dev_tools::dev_tools_list_triage_rules,
            commands::infrastructure::dev_tools::dev_tools_create_triage_rule,
            commands::infrastructure::dev_tools::dev_tools_update_triage_rule,
            commands::infrastructure::dev_tools::dev_tools_delete_triage_rule,
            commands::infrastructure::dev_tools::dev_tools_run_triage_rules,
            // Dev Tools -- Overnight Portfolio Engine
            commands::infrastructure::overnight::dev_tools_list_night_runs,
            commands::infrastructure::overnight::dev_tools_run_overnight_now,
            // Dev Tools -- Pipelines (Idea-to-Execution)
            // Dev Tools -- Health Snapshots
            // Dev Tools -- Cross-Project (Codebases connector)
            commands::infrastructure::dev_tools::dev_tools_list_cross_project_relations,
            commands::infrastructure::dev_tools::dev_tools_upsert_cross_project_relation,
            commands::infrastructure::dev_tools::dev_tools_get_cross_project_map,
            commands::infrastructure::dev_tools::dev_tools_generate_cross_project_metadata,
            commands::infrastructure::dev_tools::dev_tools_get_cross_project_metadata,
            commands::infrastructure::dev_tools::dev_tools_probe_repo_evidence,
            commands::infrastructure::dev_tools::dev_tools_create_idea_batch,
            commands::infrastructure::dev_tools::dev_tools_search_across_projects,
            commands::infrastructure::dev_tools::dev_tools_get_project_summary,
            commands::infrastructure::dev_tools::dev_tools_get_dependency_graph,
            // Dev Tools -- Competitions (multi-clone parallel execution)
            commands::infrastructure::dev_tools::dev_tools_start_competition,
            commands::infrastructure::dev_tools::dev_tools_list_competitions,
            commands::infrastructure::dev_tools::dev_tools_get_competition,
            commands::infrastructure::dev_tools::dev_tools_pick_competition_winner,
            commands::infrastructure::dev_tools::dev_tools_cancel_competition,
            commands::infrastructure::dev_tools::dev_tools_refresh_competition_slot,
            commands::infrastructure::dev_tools::dev_tools_get_competition_slot_diff,
            commands::infrastructure::dev_tools::dev_tools_get_strategy_leaderboard,
            commands::infrastructure::dev_tools::dev_tools_switch_to_worktree,
            commands::infrastructure::dev_tools::dev_tools_delete_competition,
            commands::infrastructure::dev_tools::dev_tools_start_slot_server,
            commands::infrastructure::dev_tools::dev_tools_stop_slot_server,
            // Dev Tools -- Implementation Pipeline (Direction 3)
            commands::infrastructure::dev_tools::dev_tools_create_branch,
            commands::infrastructure::dev_tools::dev_tools_apply_diff,
            commands::infrastructure::dev_tools::dev_tools_run_tests,
            commands::infrastructure::dev_tools::dev_tools_get_git_status,
            commands::infrastructure::dev_tools::dev_tools_commit_changes,
            // Dev Tools -- Portfolio Intelligence (Direction 5)
            commands::infrastructure::dev_tools::dev_tools_get_portfolio_health,
            commands::infrastructure::dev_tools::dev_tools_get_tech_radar,
            commands::infrastructure::dev_tools::dev_tools_get_risk_matrix,
            commands::infrastructure::dev_tools::dev_tools_get_project_favicon,
            // Twin plugin -- profile CRUD (P0)
            commands::infrastructure::twin::twin_list_profiles,
            commands::infrastructure::twin::twin_get_profile,
            commands::infrastructure::twin::twin_get_active_profile,
            commands::infrastructure::twin::twin_create_profile,
            commands::infrastructure::twin::twin_update_profile,
            commands::infrastructure::twin::twin_delete_profile,
            commands::infrastructure::twin::twin_set_active_profile,
            // Twin plugin -- tone CRUD (P1)
            commands::infrastructure::twin::twin_list_tones,
            commands::infrastructure::twin::twin_get_tone,
            commands::infrastructure::twin::twin_upsert_tone,
            commands::infrastructure::twin::twin_delete_tone,
            // Twin plugin -- knowledge base + memory + comms (P2)
            commands::infrastructure::twin::twin_bind_knowledge_base,
            commands::infrastructure::twin::twin_unbind_knowledge_base,
            commands::infrastructure::twin::twin_list_pending_memories,
            commands::infrastructure::twin::twin_review_memory,
            commands::infrastructure::twin::twin_list_communications,
            commands::infrastructure::twin::twin_record_interaction,
            // Twin plugin -- voice profiles (P3)
            commands::infrastructure::twin::twin_get_voice_profile,
            commands::infrastructure::twin::twin_upsert_voice_profile,
            commands::infrastructure::twin::twin_delete_voice_profile,
            // Twin plugin -- channels (P4)
            commands::infrastructure::twin::twin_list_channels,
            commands::infrastructure::twin::twin_create_channel,
            commands::infrastructure::twin::twin_update_channel,
            commands::infrastructure::twin::twin_delete_channel,
            // Twin plugin -- AI bio generation
            commands::infrastructure::twin::twin_generate_bio,
            // Twin plugin -- Training Studio: twin-simulated answer drafting
            commands::infrastructure::twin::twin_simulate_answer,
            // Twin plugin -- Channels outbox: draft a channel-appropriate reply
            commands::infrastructure::twin::twin_draft_reply,
            // Twin plugin -- Training Studio: background batch generation
            commands::infrastructure::twin::twin_studio_generate_questions,
            commands::infrastructure::twin::twin_studio_generate_answers,
            commands::infrastructure::twin::twin_studio_get_batch,
            commands::infrastructure::twin::twin_studio_cancel,
            // Twin plugin -- Second-brain build-out (P6)
            commands::infrastructure::twin::twin_ingest_url,
            commands::infrastructure::twin::twin_compile_wiki,
            commands::infrastructure::twin::twin_audit_wiki,
            commands::infrastructure::twin::twin_wiki_status,
            commands::infrastructure::twin::twin_list_distilled_facts,
            commands::infrastructure::twin::twin_create_distilled_fact,
            commands::infrastructure::twin::twin_delete_distilled_fact,
            commands::infrastructure::twin::twin_list_contacts,
            commands::infrastructure::twin::twin_update_contact,
            commands::infrastructure::twin::twin_reflect,
            commands::infrastructure::twin::twin_list_reflections,
            commands::infrastructure::twin::twin_delete_reflection,
            commands::infrastructure::twin::twin_recall,
            commands::infrastructure::twin::twin_ingest_doctrine_docs,
            // Notifications
            notifications::send_app_notification,
            notifications::test_notification_channel,
            notifications::get_notification_delivery_stats,
            notifications::test_channel_delivery,
            // Network -- Identity (Invisible Apps Phase 1)
            #[cfg(feature = "p2p")]
            commands::network::identity::get_local_identity,
            #[cfg(feature = "p2p")]
            commands::network::identity::reinitialize_identity,
            #[cfg(feature = "p2p")]
            commands::network::identity::set_display_name,
            #[cfg(feature = "p2p")]
            commands::network::identity::export_identity_card,
            #[cfg(feature = "p2p")]
            commands::network::identity::list_trusted_peers,
            #[cfg(feature = "p2p")]
            commands::network::identity::import_trusted_peer,
            #[cfg(feature = "p2p")]
            commands::network::identity::update_trusted_peer,
            #[cfg(feature = "p2p")]
            commands::network::identity::revoke_peer_trust,
            #[cfg(feature = "p2p")]
            commands::network::identity::delete_trusted_peer,
            // Network -- Owned Devices (cross-device persona continuity, ADR 2026-05-24 Stage 2)
            #[cfg(feature = "p2p")]
            commands::network::owned_devices::get_device_group_id,
            #[cfg(feature = "p2p")]
            commands::network::owned_devices::list_owned_devices,
            #[cfg(feature = "p2p")]
            commands::network::owned_devices::register_owned_device,
            #[cfg(feature = "p2p")]
            commands::network::owned_devices::forget_owned_device,
            #[cfg(feature = "p2p")]
            commands::network::owned_devices::set_device_home,
            // Network -- Device pairing (signed handshake + fingerprint confirm)
            #[cfg(feature = "p2p")]
            commands::network::pairing::pair_request,
            #[cfg(feature = "p2p")]
            commands::network::pairing::pair_confirm,
            #[cfg(feature = "p2p")]
            commands::network::pairing::pair_cancel,
            #[cfg(feature = "p2p")]
            commands::network::pairing::list_pending_device_pairings,
            // Network -- Remote jobs (one paired device runs the other's instruction)
            #[cfg(feature = "p2p")]
            commands::network::remote_jobs::list_remote_jobs,
            #[cfg(feature = "p2p")]
            commands::network::remote_jobs::list_remote_job_notes,
            #[cfg(feature = "p2p")]
            commands::network::remote_jobs::send_remote_instruction,
            // Network -- Exposure Manifest (Invisible Apps Phase 1)
            #[cfg(feature = "p2p")]
            commands::network::exposure::list_exposed_resources,
            #[cfg(feature = "p2p")]
            commands::network::exposure::get_exposed_resource,
            #[cfg(feature = "p2p")]
            commands::network::exposure::create_exposed_resource,
            #[cfg(feature = "p2p")]
            commands::network::exposure::update_exposed_resource,
            #[cfg(feature = "p2p")]
            commands::network::exposure::delete_exposed_resource,
            #[cfg(feature = "p2p")]
            commands::network::exposure::get_exposure_manifest,
            #[cfg(feature = "p2p")]
            commands::network::exposure::list_provenance,
            #[cfg(feature = "p2p")]
            commands::network::exposure::get_resource_provenance,
            // Network -- Bundle (Invisible Apps Phase 1)
            #[cfg(feature = "p2p")]
            commands::network::bundle::export_persona_bundle,
            #[cfg(feature = "p2p")]
            commands::network::bundle::preview_bundle_import,
            #[cfg(feature = "p2p")]
            commands::network::bundle::apply_bundle_import,
            #[cfg(feature = "p2p")]
            commands::network::bundle::verify_bundle,
            #[cfg(feature = "p2p")]
            commands::network::bundle::export_bundle_to_clipboard,
            #[cfg(feature = "p2p")]
            commands::network::bundle::preview_bundle_from_clipboard,
            #[cfg(feature = "p2p")]
            commands::network::bundle::apply_bundle_from_clipboard,
            #[cfg(feature = "p2p")]
            commands::network::bundle::create_share_link,
            #[cfg(feature = "p2p")]
            commands::network::bundle::preview_share_link,
            #[cfg(feature = "p2p")]
            commands::network::bundle::import_from_share_link,
            #[cfg(feature = "p2p")]
            commands::network::bundle::resolve_share_deep_link,
            // Network -- Sovereign Enclaves
            #[cfg(feature = "p2p")]
            commands::network::enclave::seal_enclave,
            #[cfg(feature = "p2p")]
            commands::network::enclave::verify_enclave,
            // Network -- P2P Discovery (Invisible Apps Phase 2)
            #[cfg(feature = "p2p")]
            commands::network::discovery::get_discovered_peers,
            #[cfg(feature = "p2p")]
            commands::network::discovery::connect_to_peer,
            #[cfg(feature = "p2p")]
            commands::network::discovery::disconnect_peer,
            #[cfg(feature = "p2p")]
            commands::network::discovery::get_peer_manifest,
            #[cfg(feature = "p2p")]
            commands::network::discovery::sync_peer_manifest,
            #[cfg(feature = "p2p")]
            commands::network::discovery::get_connection_status,
            #[cfg(feature = "p2p")]
            commands::network::discovery::get_network_status,
            #[cfg(feature = "p2p")]
            commands::network::discovery::get_connection_health,
            #[cfg(feature = "p2p")]
            commands::network::discovery::get_network_snapshot,
            #[cfg(feature = "p2p")]
            commands::network::discovery::get_messaging_metrics,
            // Agent-to-agent messaging over the (now signed-handshake) p2p link.
            // Registered: both commands are thin wrappers over MessageRouter,
            // already `require_auth`-gated, and the peer they address is
            // authenticated at handshake time as of PROTOCOL_VERSION 2.
            #[cfg(feature = "p2p")]
            commands::network::discovery::send_agent_message,
            #[cfg(feature = "p2p")]
            commands::network::discovery::get_received_messages,
            #[cfg(feature = "p2p")]
            commands::network::discovery::set_network_config,
            // Vector Knowledge Base
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::create_knowledge_base,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::list_knowledge_bases,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::get_knowledge_base,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::delete_knowledge_base,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_pick_files,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_pick_directory,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_ingest_files,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_ingest_text,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_ingest_directory,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_reindex,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_search,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_list_documents,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_corpus_map,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_infer_schema,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_run_extraction,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_list_extraction_runs,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_list_entities,
            #[cfg(feature = "ml")]
            commands::credentials::vector_kb::kb_delete_document,
            // Radio
            commands::radio::radio_list_stations,
            commands::radio::radio_get_state,
            commands::radio::radio_get_now_playing,
            commands::radio::radio_play,
            commands::radio::radio_pause,
            commands::radio::radio_next,
            commands::radio::radio_prev,
            commands::radio::radio_set_station,
            commands::radio::radio_set_volume,
            commands::radio::radio_report_status,
            commands::radio::radio_track_ended,
            commands::radio::radio_fetch_somafm_metadata,
            // Fleet (DEV-only Claude Code session aggregator)
            commands::fleet::commands::fleet_spawn_session,
            commands::fleet::commands::fleet_write_input,
            commands::fleet::commands::fleet_resize_session,
            commands::fleet::commands::fleet_subscribe_terminal,
            commands::fleet::commands::fleet_unsubscribe_terminal,
            commands::fleet::commands::fleet_kill_session,
            commands::fleet::commands::fleet_list_sessions,
            commands::fleet::commands::fleet_remove_session,
            commands::fleet::commands::fleet_install_hooks,
            commands::fleet::commands::fleet_uninstall_hooks,
            commands::fleet::commands::fleet_check_hooks,
            commands::fleet::commands::fleet_rename_session,
            commands::fleet::commands::fleet_hibernate_session,
            commands::fleet::commands::fleet_wake_session,
            commands::fleet::commands::fleet_spawn_headless_session,
            commands::fleet::external::fleet_spawn_external_console,
            commands::fleet::external::fleet_write_dispatch_brief,
            commands::fleet::commands::fleet_set_auto_hibernate,
            commands::fleet::commands::fleet_set_live_slots,
            commands::fleet::commands::fleet_set_state_cutoffs,
            commands::fleet::commands::fleet_debug_log_start,
            commands::fleet::commands::fleet_debug_log_stop,
            commands::fleet::commands::fleet_debug_log_status,
            commands::fleet::commands::fleet_begin_run,
            commands::fleet::commands::fleet_end_run,
            commands::fleet::commands::fleet_list_runs,
            commands::fleet::commands::fleet_run_report,
            commands::fleet::transcript_read::fleet_read_transcript,
            commands::fleet::transcript_read::fleet_recent_transcripts,
            commands::fleet::transcript_read::fleet_session_metadata,
            commands::fleet::transcript_read::fleet_token_summary,
            commands::fleet::monitor_stats::fleet_monitor_stats,
            commands::fleet::process_scan::fleet_detect_processes,
            commands::fleet::process_scan::fleet_kill_pid,
            commands::fleet::process_scan::fleet_resume_orphan,
            commands::fleet::pairing::fleet_pair_device,
            commands::fleet::pairing::fleet_companion_devices,
            commands::fleet::pairing::fleet_companion_revoke,
            // Web-build runtime (Athena web-dev companion, P0)
            commands::infrastructure::webbuild::webbuild_scaffold,
            commands::infrastructure::webbuild::webbuild_register_existing,
            commands::infrastructure::webbuild::webbuild_dev_start,
            commands::infrastructure::webbuild::webbuild_dev_stop,
            commands::infrastructure::webbuild::webbuild_bun_status,
            commands::infrastructure::webbuild::webbuild_status,
            commands::infrastructure::webbuild::webbuild_list_servers,
            commands::infrastructure::webbuild::webbuild_list_routes,
            commands::infrastructure::webbuild::webbuild_list_versions,
            commands::infrastructure::webbuild::webbuild_restore_version,
            commands::infrastructure::webbuild::webbuild_session_send,
            commands::infrastructure::webbuild::webbuild_session_stop,
            commands::infrastructure::webbuild::webbuild_next_ready,
        ]))
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            // Deliberately NOT `tracing::error!`: the next statement is
            // `process::exit(1)`, which runs no destructors, so a buffered
            // subscriber would never flush this. stderr is the only sink
            // guaranteed to carry a message out of a failed startup.
            #[allow(clippy::print_stderr)]
            {
                eprintln!("Fatal: Tauri application failed to start: {e}");
            }
            std::process::exit(1);
        })
        .run(|app_handle, event| {
            // Kill any running Bun dev servers when the app exits so a closing
            // app never orphans a `bun`/`next` process tree (web-build runtime).
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(state) = app_handle.try_state::<Arc<AppState>>() {
                    state.webbuild_servers.stop_all();
                }
            }
        });
}

#[cfg(test)]
mod registry_target_tests {
    use super::ActiveProcessRegistry;

    // Pins the fix for "delete_recipe blocks all recipes during any in-flight
    // task": a run's target resource id is tracked so conflict checks scope to
    // the actually-targeted recipe, not "any run in this domain".

    #[test]
    fn active_target_returns_target_only_while_run_is_active() {
        let reg = ActiveProcessRegistry::new();
        // No run yet → no target.
        assert_eq!(reg.active_target("recipe_execution"), None);

        reg.set_id("recipe_execution", "task-1".into());
        reg.set_target("recipe_execution", Some("recipe-A".into()));
        assert_eq!(
            reg.active_target("recipe_execution").as_deref(),
            Some("recipe-A")
        );
    }

    #[test]
    fn unrelated_recipe_run_does_not_match_a_different_recipe() {
        let reg = ActiveProcessRegistry::new();
        reg.set_id("recipe_execution", "task-1".into());
        reg.set_target("recipe_execution", Some("recipe-A".into()));

        // Deleting recipe-B must not see a conflict from a run targeting recipe-A.
        let blocks_b = reg.active_target("recipe_execution").as_deref() == Some("recipe-B");
        assert!(
            !blocks_b,
            "a run for recipe-A must not block deleting recipe-B"
        );
    }

    #[test]
    fn clearing_the_id_also_clears_the_target() {
        let reg = ActiveProcessRegistry::new();
        reg.set_id("recipe_versioning", "task-1".into());
        reg.set_target("recipe_versioning", Some("recipe-A".into()));

        // Completion path clears the id when it matches.
        reg.clear_id_if("recipe_versioning", "task-1");
        assert_eq!(reg.active_target("recipe_versioning"), None);

        // Cancellation path (take_id) also clears the target.
        reg.set_id("recipe_versioning", "task-2".into());
        reg.set_target("recipe_versioning", Some("recipe-B".into()));
        assert_eq!(reg.take_id("recipe_versioning").as_deref(), Some("task-2"));
        assert_eq!(reg.active_target("recipe_versioning"), None);
    }

    #[test]
    fn generation_without_a_target_never_reports_a_conflict() {
        let reg = ActiveProcessRegistry::new();
        // recipe_generation produces a brand-new recipe and sets no target.
        reg.set_id("recipe_generation", "gen-1".into());
        assert_eq!(reg.active_target("recipe_generation"), None);
    }
}

/// Structural guard for the `generate_handler!` registration list.
///
/// Rust silently applies a *stack* of `#[cfg(...)]` attributes to whatever item
/// comes next, so a line like
///
/// ```text
/// #[cfg(feature = "p2p")]
/// #[cfg(feature = "p2p")]
/// commands::network::exposure::create_exposed_resource,
/// ```
///
/// compiles cleanly while the command that was *supposed* to sit under the first
/// cfg has silently vanished from the IPC surface. That exact bug removed 15
/// `commands::network::*` commands from `generate_handler!` and shipped —
/// nothing in the compiler, clippy, or the test suite noticed, because the
/// missing entry is a *deletion*, not an error.
///
/// This test parses the source text (not the macro expansion, which is
/// feature-gated and therefore can't be reflected on in a lite build) and
/// asserts the two lists agree. It is intentionally NOT `#[cfg(feature = "p2p")]`
/// so it guards the registration list in every build configuration.
#[cfg(test)]
mod network_command_registration_tests {
    use std::collections::BTreeSet;

    /// Extract `name` from a `pub fn name(` / `pub async fn name(` signature line.
    fn command_fn_name(line: &str) -> Option<&str> {
        let rest = line.trim().strip_prefix("pub ")?;
        let rest = rest.strip_prefix("async ").unwrap_or(rest);
        let rest = rest.strip_prefix("fn ")?;
        let end = rest.find(['(', '<', ' '])?;
        let name = &rest[..end];
        if name.is_empty() {
            None
        } else {
            Some(name)
        }
    }

    /// Every `#[tauri::command]`-annotated fn under `src/commands/network/`,
    /// as `("<module>", "<fn name>")`.
    fn declared_network_commands() -> BTreeSet<(String, String)> {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands/network");
        let mut found = BTreeSet::new();
        let entries = std::fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()));
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let module = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            if module == "mod" {
                continue;
            }
            let content = std::fs::read_to_string(&path).expect("read command module");
            let lines: Vec<&str> = content.lines().collect();
            for (i, line) in lines.iter().enumerate() {
                if line.trim() != "#[tauri::command]" {
                    continue;
                }
                // Skip any attributes between the marker and the signature
                // (`#[allow(...)]`, doc comments, `#[cfg(...)]`, ...).
                let mut j = i + 1;
                while let Some(next) = lines.get(j) {
                    let t = next.trim();
                    if t.starts_with('#') || t.starts_with("///") || t.starts_with("//") {
                        j += 1;
                    } else {
                        break;
                    }
                }
                let sig = lines.get(j).unwrap_or_else(|| {
                    panic!(
                        "#[tauri::command] at {}:{} has no fn",
                        path.display(),
                        i + 1
                    )
                });
                let name = command_fn_name(sig).unwrap_or_else(|| {
                    panic!(
                        "cannot parse fn name from {}:{} -- {sig:?}",
                        path.display(),
                        j + 1
                    )
                });
                found.insert((module.clone(), name.to_string()));
            }
        }
        found
    }

    /// The body of `tauri::generate_handler![ ... ]` in `src/lib.rs`.
    fn generate_handler_body() -> String {
        let lib = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs");
        let src = std::fs::read_to_string(&lib).expect("read lib.rs");
        let start = src
            .find("generate_handler![")
            .expect("lib.rs must contain a generate_handler![ list");
        let open = start + "generate_handler![".len();
        // Bracket-match, but ONLY over code. The list carries prose comments,
        // and several of them quote `#[cfg(` — an unbalanced `[` that a naive
        // counter reads as real nesting. It did: from the commit that added
        // that comment until 2026-08-21 this fn panicked "unterminated" on
        // every run, taking BOTH tests in this module down with it, and the
        // failure looked like a missing `]` rather than a comment.
        let mut depth = 1usize;
        let bytes = src.as_bytes();
        let mut i = open;
        while i < bytes.len() {
            let c = bytes[i];
            match c {
                // line comment — skip to end of line
                b'/' if bytes.get(i + 1) == Some(&b'/') => {
                    while i < bytes.len() && bytes[i] != b'\n' {
                        i += 1;
                    }
                }
                // block comment — skip to the closing delimiter
                b'/' if bytes.get(i + 1) == Some(&b'*') => {
                    i += 2;
                    while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                        i += 1;
                    }
                    i += 2;
                }
                // string literal — skip it, honouring backslash escapes
                b'"' => {
                    i += 1;
                    while i < bytes.len() && bytes[i] != b'"' {
                        i += if bytes[i] == b'\\' { 2 } else { 1 };
                    }
                    i += 1;
                }
                b'[' => {
                    depth += 1;
                    i += 1;
                }
                b']' => {
                    depth -= 1;
                    if depth == 0 {
                        return src[open..i].to_string();
                    }
                    i += 1;
                }
                _ => i += 1,
            }
        }
        panic!("unterminated generate_handler![ list in lib.rs");
    }

    /// A `#[cfg(...)]` line immediately followed by another attribute line with
    /// no item between them means the first cfg silently swallowed nothing --
    /// the entry it was meant to gate is gone. Catch the shape directly so the
    /// failure names the mechanism, not just the missing command.
    #[test]
    fn generate_handler_has_no_orphaned_cfg_attributes() {
        let body = generate_handler_body();
        let lines: Vec<&str> = body.lines().collect();
        let mut orphans = Vec::new();
        for (i, line) in lines.iter().enumerate() {
            let t = line.trim();
            if !t.starts_with("#[cfg(") {
                continue;
            }
            // Walk forward past comments; the next *code* line must be a path,
            // not another attribute.
            let mut j = i + 1;
            while let Some(next) = lines.get(j) {
                let n = next.trim();
                if n.is_empty() || n.starts_with("//") {
                    j += 1;
                } else {
                    break;
                }
            }
            if let Some(next) = lines.get(j) {
                if next.trim().starts_with("#[cfg(") {
                    orphans.push(format!("{}: {t}", i + 1));
                }
            } else {
                orphans.push(format!("{}: {t} (trailing)", i + 1));
            }
        }
        assert!(
            orphans.is_empty(),
            "stacked #[cfg] attributes with no item between them in generate_handler! \
             (each one silently deleted the command that belonged under it):\n{orphans:#?}"
        );
    }

    #[test]
    fn every_network_command_is_registered_in_generate_handler() {
        let declared = declared_network_commands();
        assert!(
            declared.len() > 20,
            "expected to find well over 20 #[tauri::command] fns under \
             src/commands/network/, found {} -- the source walk is broken, \
             not the app",
            declared.len()
        );

        let body = generate_handler_body();
        let missing: Vec<String> = declared
            .iter()
            .filter(|(module, name)| {
                let path = format!("commands::network::{module}::{name},");
                !body.contains(&path)
            })
            .map(|(module, name)| format!("commands::network::{module}::{name}"))
            .collect();

        assert!(
            missing.is_empty(),
            "network commands defined but NOT present in generate_handler! -- \
             they are unreachable from the frontend:\n{missing:#?}"
        );
    }
}
