//! IPC handler shard 3 — see `super` (`ipc_shards/mod.rs`) for why the list is split
//! and how to add a command.

use super::Shard;
#[allow(unused_imports)] // not every shard names every root module
use crate::{cloud, commands, notifications, test_automation};

pub(super) fn shard(
) -> Shard<impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static> {
    personas_macros::ipc_shard!(tauri::generate_handler![
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
        commands::infrastructure::registry_sync::dev_tools_registry_sync,
        commands::infrastructure::registry_sync::dev_tools_set_knowledge_root,
        commands::infrastructure::registry_usage::dev_tools_write_registry_usage,
        commands::infrastructure::skill_registry_export::dev_tools_export_skill_registry,
        // Registry coverage (docs/plans/registry-coverage-ui.md R1, read-only)
        commands::infrastructure::registry_coverage::dev_tools_registry_probe,
        commands::infrastructure::registry_coverage::dev_tools_registry_coverage,
        commands::infrastructure::registry_galaxy::dev_tools_registry_galaxy,
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
    ])
}
