//! `personas-engine` — the portable half of the execution engine.
//!
//! Split out of `app_lib` in crate-split step 5. This crate holds the ~56k LOC
//! of engine code that depends only on `personas-core` and `personas-db`.
//!
//! **What is NOT here, and why.** Roughly 88k LOC of `engine/` stayed in
//! `app_lib`: everything that reaches `AppState`, `notifications`, `tray`,
//! `cloud` or a `commands::*` entry point. A module that pokes at `AppState`
//! is application wiring rather than library code, so that boundary is a
//! statement about the code, not a compromise — but it is also where the
//! remaining work is, and closing it needs a context trait rather than a move.
//!
//! `app_lib`'s `engine` module re-exports everything here, so existing
//! `crate::engine::<name>` paths resolve unchanged on the other side.

// Lint posture for code that arrived here by `git mv`.
//
// 56k LOC lifted verbatim out of `app_lib` — only module paths were rewritten,
// no logic touched. Extracting it exposed the code to a clippy pass `app_lib`
// was never getting (its own `--all-targets -D warnings` run still reports
// hundreds of errors), so these fire on code that has been in the tree for
// months. Allowed rather than fixed because a code-motion commit must not
// change behaviour or public API. Do NOT extend this list for new code.
#![allow(clippy::collapsible_match)]
#![allow(clippy::derivable_impls)]
#![allow(clippy::doc_lazy_continuation)]
#![allow(clippy::doc_overindented_list_items)]
#![allow(clippy::explicit_counter_loop)]
#![allow(clippy::for_kv_map)]
#![allow(clippy::let_unit_value)]
#![allow(clippy::manual_pattern_char_comparison)]
#![allow(clippy::manual_strip)]
#![allow(clippy::match_single_binding)]
#![allow(clippy::needless_borrow)]
#![allow(clippy::new_without_default)]
#![allow(clippy::ptr_arg)]
#![allow(clippy::single_char_add_str)]
#![allow(clippy::too_many_arguments)]
#![allow(clippy::type_complexity)]
#![allow(clippy::unnecessary_lazy_evaluations)]
#![allow(clippy::unnecessary_map_or)]

pub mod a2a;
pub mod adoption_answers;
pub mod ai_healing;
#[cfg(feature = "desktop")]
pub mod ambient_context;
#[cfg(feature = "desktop")]
pub mod ambient_signal_repo;
pub mod api_definition;
#[cfg(feature = "desktop")]
pub mod app_focus;
pub mod app_master;
pub mod app_master_gates;
pub mod app_master_hire_memory;
pub mod app_master_memory;
pub mod archetype_catalog;
pub mod auto_triage;
pub mod autonomy;
pub mod autopilot;
#[cfg(feature = "desktop")]
pub mod bridge_manifest;
pub mod build_stall;
pub mod bus;
pub mod capability_contract;
#[cfg(feature = "desktop")]
pub mod channel_live_context;
#[cfg(feature = "desktop")]
pub mod channel_reply;
pub mod chunker;
pub mod claude_md_projection;
pub mod cli_capabilities;
pub mod cli_mcp_config;
pub mod cli_process;
#[cfg(feature = "desktop")]
pub mod cli_session_audit_repo;
#[cfg(feature = "desktop")]
pub mod cli_session_awareness;
#[cfg(feature = "desktop")]
pub mod clipboard_error_detector;
#[cfg(feature = "desktop")]
pub mod clipboard_monitor;
pub mod compilation_pipeline;
pub mod compiler;
pub mod config_merge;
pub mod connector_explorer;
pub mod context_fidelity;
#[cfg(feature = "desktop")]
pub mod context_rules;
pub mod cost;
pub mod credential_design;
pub mod credential_negotiator;
pub mod design;
pub mod design_context;
#[cfg(feature = "desktop")]
pub mod desktop_bridges;
#[cfg(feature = "desktop")]
pub mod desktop_discovery;
#[cfg(feature = "desktop")]
pub mod desktop_runtime;
pub mod desktop_security;
#[cfg(feature = "p2p")]
pub mod enclave;
pub mod eval;
pub mod event_registry;
pub mod event_vocabulary;
pub mod events;
pub mod execution_engine;
pub mod failure_signature;
#[cfg(feature = "desktop")]
pub mod file_watcher;
pub mod fix_loop;
pub mod git_checkpoint;
pub mod google_oauth;
pub mod headless;
pub mod healing_orchestrator;
pub mod healing_timeline;
pub mod hooks_sidecar;
#[cfg(feature = "p2p")]
pub mod identity;
pub mod inflight_guard;
pub mod intent_compiler;
pub mod kb_index;
pub mod kp_tool_surface;
pub mod logger;
pub mod oauth_refresh_lock;
#[cfg(feature = "ollama")]
pub mod ollama;
pub mod optimizer;
pub mod output_assertions;
#[cfg(feature = "p2p")]
pub mod p2p;
pub mod pairing;
pub mod parser;
pub mod path_safety;
pub mod persona_icon;
pub mod pipeline;
pub mod platform_rules;
pub mod prepared_run_cache;
pub mod process_activity;
pub mod prompt;
pub mod protocol;
pub mod provider;
pub mod queue;
pub mod rate_limiter;
pub mod recipe_eligibility;
pub mod recipe_matcher;
pub mod recipe_parameters;
pub mod safe_json;
pub mod scope_enforcement;
#[cfg(feature = "scraper")]
pub mod scraper;
pub mod session_pool;
pub mod shared_event_local_relay;
pub mod skill_scratchpad;
pub mod skills_sidecar;
pub mod sla_breach;
pub mod str_utils;
pub mod team_handoff;
pub mod team_preset_loader;
pub mod template_checksums;
pub mod template_v3;
pub mod test_runner;
pub mod tier;
pub mod tool_outcome;
pub mod topology_heuristic;
pub mod topology_types;
pub mod unattended;
pub mod unattended_worktree;
pub mod verification_command;
pub mod workflow_compiler;
pub mod workspace_projection;
pub mod workspace_sync;
pub mod worktree_settings;
