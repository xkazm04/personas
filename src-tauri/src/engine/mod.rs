pub mod ai_helpers;
pub mod api_proxy;
pub mod auto_rollback;
pub mod automation_runner;
pub mod background;
pub mod build_session;
#[cfg(feature = "p2p")]
pub mod bundle;
pub mod capability;
pub mod cloud_webhook_relay;
pub mod composite;
pub mod connector_strategy;
pub mod credential_broker;
pub mod pattern_miner;
pub mod persona_brain;
// Moved to `personas-core` (crate-split step 3). Re-exported so every existing
// `crate::engine::{types, lifecycle, crypto, trace, cron, url_safety}` path
// keeps resolving — these six modules are needed by `db::models` and
// `validation`, which sit below the engine, so leaving them here forced the
// whole engine into the bottom layer of the graph.
pub use personas_core::{cron, crypto, lifecycle, trace, types, url_safety};
// The portable half of the engine now lives in `personas-engine` (see
// src-tauri/engine/). Re-exported wholesale so every `crate::engine::<name>`
// path across commands, companion and the remaining engine modules resolves
// unchanged. What stayed in this file and its siblings is the part that reaches
// `AppState`, `notifications`, `tray`, `cloud` or a command entry point.
pub use personas_engine::*;

// Moved to `personas-core` (crate-split step 4a). These six carry no engine
// dependencies of their own — `healing`, `run_budget`, `topology_graph`,
// `redact` and `limits` are pure classification/algorithm/constant modules, and
// `scheduler` needs only `cron` — but `db` reads all of them, which pinned the
// data layer above the engine. Re-exported so every `crate::engine::<name>`
// path keeps resolving.
pub use personas_core::{healing, limits, redact, run_budget, scheduler, topology_graph};
// Relocated into `db` (crate-split step 4c) — see the note there. Re-exported
// so `crate::engine::chain::…` and friends keep resolving.
#[cfg(feature = "ml")]
pub use crate::db::embedder;
#[cfg(feature = "ml")]
pub use crate::db::vector_store;
// `audit_incidents_promoter` is deliberately absent from this list: every
// caller is inside personas_db and reaches it as `crate::audit_incidents_promoter`,
// so the app_lib re-export had no users at all.
pub use crate::db::{byom, chain, memory_recall, model_routing, quality_gate};
pub mod curation_scheduler;
pub mod db_query;
pub mod deliberation;
pub mod digest;
pub mod director;
pub mod director_brain;
pub mod director_lab;
pub mod director_memory;
pub mod discord_poller;
pub mod discovery;
pub mod dispatch;
pub mod dry_run;
pub mod system_ops;
/// Moved to `personas-core` (crate-split step 2) — `error.rs` depends on it, so
/// it had to sit below both. Re-exported so the 6 existing
/// `crate::engine::error_taxonomy::…` call sites resolve unchanged.
pub use personas_core::error_taxonomy;
pub mod app_master_probation;
pub mod app_master_reconcile;
pub mod evolution;
pub mod failover;
pub mod fitness_driver;
pub mod genome;
pub mod genome_critique;
pub mod healthcheck;
#[cfg(feature = "ml")]
pub mod kb_extract;
#[cfg(feature = "ml")]
pub mod kb_ingest;
#[cfg(feature = "ml")]
pub mod kb_scan;
pub mod knowledge;
pub mod knowledge_consult;
pub mod kp_reporter;
pub mod leadership;
pub mod llm_topology;
pub mod management_api;
pub mod mcp_tools;
pub mod memory_reflection;
pub mod oauth_refresh;
// Ollama-as-CLI-engine is deferred (decision recorded 2026-05-05). The native
// HTTP path here is not dispatched from `runner` and is gated behind the
// `ollama` Cargo feature so it does not get compiled into normal builds.
// See ollama.rs module docs for the full revival checklist.
pub mod goal_advance;
/// Remote HTTP inference (Qwen/DashScope) — Phase 1 split engine. See module docs.
pub mod http_engine;
pub mod incident_continuation;
pub mod kpi_binding;
pub mod kpi_derivation;
pub mod kpi_eval;
pub mod persona_jobs;
pub mod pipeline_executor;
pub mod platforms;
pub mod polling;
pub mod process_session;
pub mod project_tracking;
pub mod recipe_seed;
pub mod render_plan;
pub mod resource_governor;
pub mod resource_listing;
pub mod rotation;
pub mod runner;
#[cfg(feature = "p2p")]
pub mod share_link;
pub mod shared_event_relay;
pub mod slack_bridge;
pub mod slack_poller;
pub mod smee_relay;
pub mod subscription;
pub mod team_assignment_learning;
pub mod team_assignment_matching;
pub mod team_assignment_orchestrator;
pub mod team_preset_adopter;
pub mod team_slack_relay;
pub mod tool_runner;
// F8 deterministic-verification primitive; consumed by the F7 fix-loop.
#[allow(dead_code)]
pub mod webhook;
pub mod webhook_notifier;

#[cfg(test)]
mod circuit_breakers_integration_tests;

/// Failure aftermath — healing evaluation, retry spawning, circuit breaker.
/// Private: everything the rest of the crate needs is re-exported below or
/// reached through `super::` from `execution`.
mod healing_retry;

/// The execution engine proper — admission, spawning, cancellation, the queue
/// drain and the completion pipeline. Private; the names the rest of the crate
/// reaches are re-exported just below, so every `crate::engine::…` path that
/// worked before still resolves.
mod execution;
pub(crate) use self::execution::kill_process;
pub use self::execution::{init_fix_loop_worker, ExecutionEngine};
// Named only through `init_fix_loop_worker`'s return type today, so the
// re-export has no direct user — but it is half that function's signature and
// was reachable as `crate::engine::FixReentryRequest` before the split.
#[allow(unused_imports)]
pub use self::execution::FixReentryRequest;

use futures_util::FutureExt;
use std::collections::{HashMap, HashSet};
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;
use tokio::sync::Mutex;

use tauri::Emitter;

use crate::db::models::{
    ConnectorDefinition, Persona, PersonaToolDefinition, UpdateExecutionStatus,
};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::audit_incidents as incidents_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::healing as healing_repo;
use crate::db::repos::execution::restart_recovery as exec_repo_restart;
use crate::db::repos::execution::scheduled_retries as scheduled_retries_repo;
use crate::db::repos::lab::evolution as evolution_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::engine::background::SchedulerState;
use crate::error::AppError;

use self::event_registry::{emit_event, event_name};
use self::types::{ExecutionResult, ExecutionState, HealingEventPayload, QueueStatusEvent};

pub(crate) use self::execution_engine::persist::persist_status_update;
use self::execution_engine::persist::{persist_status_if_not_final, persist_status_if_running};
use self::queue::{admission_conflict_key, AdmitResult, ConcurrencyTracker, ExecutionPriority};

// ---------------------------------------------------------------------------
// Host hooks
// ---------------------------------------------------------------------------

/// Side effects the engine fires into the surrounding application.
///
/// Every one of these targets lives ABOVE the engine — the tray, the
/// notification dispatcher, the companion's proactive lane. Calling them
/// directly is what kept this module (and, transitively, the 12 others that
/// depend on it) from being extractable into `personas-engine`.
///
/// Registered once at startup via [`set_host_hooks`]. Unset in a test or
/// headless context, every hook is a no-op — the engine must not require a
/// desktop shell to run, which is also why this is a struct of plain `fn`
/// pointers rather than a trait object: there is no state to carry, and a
/// missing registration degrades to silence rather than a panic.
#[derive(Clone, Copy)]
pub struct HostHooks {
    /// Refresh the OS tray after execution counts change.
    pub refresh_tray: fn(&AppHandle),
    /// Notify that an execution finished (short form).
    pub notify_execution_completed: fn(&AppHandle, &str, &str, u64, Option<&str>),
    /// Notify that an execution finished, with cost/model/error detail.
    #[allow(clippy::type_complexity)]
    pub notify_execution_completed_rich:
        fn(&AppHandle, &str, &str, u64, Option<&str>, Option<f64>, Option<&str>, Option<&str>),
    /// Notify that a healing issue was raised.
    pub notify_healing_issue: fn(&AppHandle, &str, &str, &str, Option<&str>, Option<&str>),
    /// Tell the companion's proactive lane that a run finished.
    pub signal_execution_finished: fn(),
}

impl HostHooks {
    /// All no-ops. The engine stays usable with no shell attached.
    pub const NOOP: HostHooks = HostHooks {
        refresh_tray: |_| {},
        notify_execution_completed: |_, _, _, _, _| {},
        notify_execution_completed_rich: |_, _, _, _, _, _, _, _| {},
        notify_healing_issue: |_, _, _, _, _, _| {},
        signal_execution_finished: || {},
    };
}

static HOST_HOOKS: std::sync::OnceLock<HostHooks> = std::sync::OnceLock::new();

/// Install the host hooks. First caller wins; later calls are ignored.
pub fn set_host_hooks(hooks: HostHooks) {
    let _ = HOST_HOOKS.set(hooks);
}

/// The registered hooks, or [`HostHooks::NOOP`] if the host never registered.
pub fn hooks() -> &'static HostHooks {
    HOST_HOOKS.get().unwrap_or(&HostHooks::NOOP)
}

/// Hard engine-level execution ceilings. Defined in `personas-core` (see
/// `core/src/limits.rs`) because `validation` clamps against them from below
/// the engine; re-exported here so `crate::engine::ENGINE_MAX_EXECUTION_*`
/// keeps working.
pub use personas_core::limits::{ENGINE_MAX_EXECUTION_MS, ENGINE_MAX_EXECUTION_SECS};
