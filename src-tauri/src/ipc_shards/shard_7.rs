//! IPC handler shard 7 — see `super` (`ipc_shards/mod.rs`) for why the list is split
//! and how to add a command.

use super::Shard;
#[allow(unused_imports)] // not every shard names every root module
use crate::{cloud, commands, notifications, test_automation};

pub(super) fn shard(
) -> Shard<impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static> {
    personas_macros::ipc_shard!(tauri::generate_handler![
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
        // Twin plugin -- guided Setup: one conversation turn (own prompt,
        // deliberately NOT routed through twin_generate_bio)
        commands::infrastructure::twin::twin_setup_turn,
        // Twin plugin -- style studio (spark twin-presets): roll 3 candidate
        // styles, materialize one per channel (both preview-only), apply
        commands::infrastructure::twin_style::twin_style_roll,
        commands::infrastructure::twin_style::twin_style_materialize,
        commands::infrastructure::twin_style::twin_style_apply,
        // Twin plugin -- Channels outbox: draft a channel-appropriate reply
        commands::infrastructure::twin::twin_draft_reply,
        // Twin plugin -- Browser toolbar: draft a page comment in the twin's voice
        commands::infrastructure::twin::twin_draft_for_page,
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
        commands::fleet::queue::fleet_queue_snapshot,
        commands::fleet::queue::fleet_queue_reorder,
        commands::fleet::queue::fleet_queue_cancel,
        commands::fleet::queue::fleet_queue_start_now,
        commands::fleet::transcript_read::fleet_read_transcript,
        commands::fleet::transcript_read::fleet_recent_transcripts,
        commands::fleet::transcript_read::fleet_session_metadata,
        commands::fleet::transcript_read::fleet_token_summary,
        commands::fleet::transcript_read::fleet_session_recap,
        commands::fleet::monitor_stats::fleet_monitor_stats,
        commands::fleet::claude_usage::fleet_claude_usage,
        commands::fleet::autopilot::fleet_autopilot_status,
        commands::fleet::autopilot::fleet_dispatch_preview,
        commands::fleet::claude_accounts::fleet_claude_accounts_list,
        commands::fleet::claude_accounts::fleet_claude_account_capture,
        commands::fleet::claude_accounts::fleet_claude_account_switch,
        commands::fleet::claude_accounts::fleet_claude_account_remove,
        commands::fleet::claude_accounts::fleet_claude_auto_rotate_set,
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
    ])
}
