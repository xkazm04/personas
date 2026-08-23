//! Boot phase: the always-on background loops the shell owns.

use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::Manager;

use crate::db::{self, DbPool};
use crate::startup_timing::StartupTimer;
use crate::{cloud, commands, companion, daemon, engine, notifications, radio, AppState};

#[cfg(feature = "desktop")]
use crate::tray;

// Re-admit executions persisted as `queued` when the app last exited
// (recover_stale_executions above only fails mid-RUN rows now). This
// is what makes scheduled / event-triggered work survive a restart
// instead of being silently dropped (P1 durable-queue guarantee).
// Spawned so it never blocks startup; re-admission is idempotent.
pub fn spawn_requeue_persisted(
    app: &tauri::App,
    engine: &Arc<engine::ExecutionEngine>,
    pool: &DbPool,
) {
    {
        let requeue_engine = engine.clone();
        let requeue_app = app.handle().clone();
        let requeue_pool = pool.clone();
        tauri::async_runtime::spawn(async move {
            requeue_engine
                .requeue_persisted_executions(requeue_app, requeue_pool)
                .await;
        });
    }
}

// Side effects the engine fires into the shell. Registered here
// because every target — tray, notifications, the companion's
// proactive lane — sits above the engine. Unregistered, they are
// no-ops, so a headless build still runs.
pub fn register_host_hooks() {
    engine::set_host_hooks(engine::HostHooks {
        refresh_tray: |app| {
            #[cfg(feature = "desktop")]
            tray::refresh_tray(app);
            #[cfg(not(feature = "desktop"))]
            let _ = app;
        },
        notify_execution_completed: notifications::notify_execution_completed,
        notify_execution_completed_rich: notifications::notify_execution_completed_rich,
        notify_healing_issue: notifications::notify_healing_issue,
        signal_execution_finished:
            companion::proactive::execution_review::signal_execution_finished,
    });
}

// Engine leadership (multi-driver orchestration, ADR 2026-05-26):
// try to become the singleton-loop leader for this device/DB, then
// keep the lease fresh via a heartbeat task. Uses its own
// `engine-leader.lock` (independent of `daemon.lock`, so this never
// blocks the always-on daemon). Loop gating on `is_leader()` lands
// in a later phase — for now this only establishes + advertises
// leadership so every surface (UI/MCP/REST) can read it.
pub fn start_engine_leadership(state_arc: &Arc<AppState>) {
    {
        let became_leader = state_arc.leadership.try_acquire();
        tracing::info!(
            instance_id = %state_arc.leadership.instance_id(),
            leader = became_leader,
            "engine leadership: startup acquire"
        );
        let leadership = state_arc.leadership.clone();
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(daemon::lock::HEARTBEAT_INTERVAL);
            // Skip the immediate first tick — we just acquired above.
            ticker.tick().await;
            loop {
                ticker.tick().await;
                leadership.tick();
            }
        });
    }
}

// Phase 5 v1: seed the cross-process cli_session gate from app_settings
// on startup, so a user who toggled it ON in a previous session still
// has it ON after restart. Without this, AmbientContextFusion would
// default to false on every startup and the windowed runner's gate
// check would diverge from the daemon's persisted view. Read-only
// best-effort — failure is non-fatal (gate stays at default false).
#[cfg(feature = "desktop")]
pub fn restore_cli_session_gate(state_arc: &Arc<AppState>) {
    {
        let ambient = state_arc.ambient_context.clone();
        let pool = state_arc.db.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(Some(value)) = db::repos::core::settings::get(
                &pool,
                db::settings_keys::CLI_SESSION_AWARENESS_ENABLED,
            ) {
                let enabled = value == "true";
                if enabled {
                    let mut guard = ambient.lock().await;
                    guard.set_source_enabled("cli_session", true);
                }
            }
        });
    }
}

// Trace redaction: secrets are scrubbed from persisted execution
// output by default (engine::redact). Honor an explicit user opt-out
// persisted in a prior session; absent/any-other value keeps it ON.
#[cfg(feature = "desktop")]
pub fn restore_trace_redaction(state_arc: &Arc<AppState>) {
    {
        let pool = state_arc.db.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(Some(value)) = db::repos::core::settings::get(
                &pool,
                crate::engine::redact::REDACT_TRACES_ENABLED_KEY,
            ) {
                crate::engine::redact::set_enabled(value != "false");
            }
        });
    }
}

// F7 quality-gate fix-loop worker: drives opt-in persona re-entries
// after a completed-but-quality-failed run, decoupled from the
// execution pipeline to avoid a recursive async type cycle.
// The engine owns the channel; this loop owns the draining, because
// `execute_persona_inner` takes `&AppState` and the engine must not.
pub fn spawn_fix_loop_worker(app: &tauri::App) {
    if let Some(mut fix_rx) = crate::engine::init_fix_loop_worker() {
        let fix_app = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            while let Some(req) = fix_rx.recv().await {
                let state = fix_app.state::<Arc<AppState>>().inner().clone();
                if let Err(e) = commands::execution::executions::execute_persona_inner(
                    &state,
                    fix_app.clone(),
                    req.persona_id,
                    None,
                    Some(req.input),
                    req.use_case_id,
                    None,
                    None,
                    false,
                )
                .await
                {
                    tracing::warn!("fix-loop re-entry failed: {e}");
                }
            }
        });
    }
}

// Radio: footer-anchored dual-engine player (YouTube IFrame for
// curated tracklists, HTML5 audio for internet-radio streams).
// Stations are baked into the binary; runtime state (current
// station + per-station cursors + status + volume) persists to
// <config>/radio_state.json.
pub fn init_radio(app: &tauri::App, app_data_dir: &Path) {
    {
        let radio_state_path = app_data_dir.join("radio_state.json");
        let radio_service = radio::RadioService::new(radio_state_path);
        app.manage(radio::RadioServiceHandle(Arc::new(Mutex::new(
            radio_service,
        ))));
    }
}

// Spawn CDC drain task: converts SQLite update_hook events into Tauri emits
pub fn spawn_cdc_drain(
    app: &tauri::App,
    cdc_receiver: db::cdc::CdcReceiver,
    pool: &DbPool,
    st: &mut StartupTimer,
) {
    db::cdc::spawn_cdc_drain_task(
        app.handle().clone(),
        cdc_receiver,
        pool.clone(),
        db::cdc::CdcHooks {
            notify_cloud_dirty: cloud::sync::notify_dirty,
            wake_event_bus: || engine::subscription::event_bus_wake_signal().notify_one(),
        },
    );
    st.checkpoint("cdc_drain_task");
}

// Reversible Agent: journal writer thread (batches captures into
// the change_journal table; prunes retention at startup).
pub fn spawn_journal_and_maintenance(
    pool: &DbPool,
    user_db_pool: &db::UserDbPool,
    journal_receiver: db::journal::JournalReceiver,
) {
    db::journal::spawn_journal_writer(pool.clone(), journal_receiver);

    db::spawn_idle_maintenance_task(pool.clone(), user_db_pool.clone());
}

// Persona-jobs worker — projects the dream-job shape onto
// user-created personas (queued → running → completed |
// failed | canceled). v1 ships one kind: memory_curation_run,
// which writes proposals to persona_memory_review_proposal
// for the user to apply or discard. Concept borrowed from
// Anthropic Managed Agents' dream pipeline; implementation
// is local IPC + Tauri events.
pub fn spawn_persona_jobs_worker(
    app: &tauri::App,
    pool: &DbPool,
    state_arc: &Arc<AppState>,
    st: &mut StartupTimer,
) {
    {
        if let Err(e) = engine::persona_jobs::recover_orphans(pool) {
            tracing::warn!(error = %e, "persona-jobs: orphan recovery failed");
        }
        let pool_for_worker = pool.clone();
        let app_handle = app.handle().clone();
        let leadership_for_worker = state_arc.leadership.clone();
        tauri::async_runtime::spawn(async move {
            use std::time::Duration;
            // Brief startup delay so other init logs land first.
            tokio::time::sleep(Duration::from_secs(3)).await;
            loop {
                // Leader-only (ADR 2026-05-26): claims + runs queued
                // persona jobs; a follower would double-run them.
                if leadership_for_worker.is_leader() {
                    let res =
                        engine::persona_jobs::worker_tick(&pool_for_worker, &app_handle).await;
                    if let Err(e) = res {
                        tracing::warn!(error = %e, "persona-jobs worker tick failed");
                    }
                }
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });
    }
    st.checkpoint("persona_jobs_worker");
}

// Cloud sync writer (Phase 1a): pushes a secret-free read-projection
// of local data to the user's own Supabase tenant for the web
// dashboard. Default off (opt-in via Settings); leader-gated inside
// the loop. Event-driven wakes come from the CDC drain (notify_dirty).
pub fn spawn_cloud_sync(app: &tauri::App, state_arc: &Arc<AppState>, st: &mut StartupTimer) {
    cloud::sync::spawn_sync_loop(app.handle().clone(), state_arc.clone());
    st.checkpoint("cloud_sync_writer");
}

// Cloud remote commands (Phase 2): polls Supabase for run-requests
// from the web dashboard and surfaces them as explicit approval
// prompts. Never auto-executes; leader-gated + sync-enabled-gated.
pub fn spawn_cloud_remote_commands(
    app: &tauri::App,
    state_arc: &Arc<AppState>,
    st: &mut StartupTimer,
) {
    cloud::remote_commands::spawn_poll_loop(app.handle().clone(), state_arc.clone());
    st.checkpoint("cloud_remote_commands");
}

// Autonomous NOC v1: server-side alert evaluator — the authority
// for alert firing (fires with the UI closed), auto-opens
// incidents and runs the capped auto-diagnosis pass.
pub fn spawn_alert_evaluator(app: &tauri::App, state_arc: &Arc<AppState>, st: &mut StartupTimer) {
    commands::execution::alert_evaluator::spawn_evaluator(app.handle().clone(), state_arc.clone());
    st.checkpoint("alert_evaluator");
}

// F-CRON: scheduled-curation worker. Ticks every 60s,
// reads `persona_curation_schedule` rows, evaluates the
// cron expression vs `last_curation_at` (or `created_at`
// on first fire), and enqueues a memory_curation_run job
// when a persona is due. The persona-jobs worker above
// picks the queued job up on its next 5s tick.
//
// Distinct from `engine::scheduler` (cron evaluator that
// fires persona EXECUTIONS via the triggers table) — this
// scheduler operates on a different table with different
// semantics (curation vs execution).
pub fn spawn_curation_scheduler(pool: &DbPool, state_arc: &Arc<AppState>, st: &mut StartupTimer) {
    {
        let pool_for_curation = pool.clone();
        let leadership_for_curation = state_arc.leadership.clone();
        tauri::async_runtime::spawn(async move {
            // Slightly longer startup delay than the persona-jobs
            // worker so the first scheduler tick sees a settled
            // job table (no orphan-recovery races).
            tokio::time::sleep(std::time::Duration::from_secs(8)).await;
            loop {
                // Leader-only (ADR 2026-05-26): enqueues due curation
                // jobs; a follower would double-enqueue them.
                if leadership_for_curation.is_leader() {
                    match engine::curation_scheduler::tick(&pool_for_curation) {
                        Ok(0) => {} // quiet path; nothing due
                        Ok(n) => tracing::debug!(
                            enqueued = n,
                            "curation_scheduler: enqueued scheduled jobs"
                        ),
                        Err(e) => tracing::warn!(
                            error = %e,
                            "curation_scheduler tick failed"
                        ),
                    }
                }
                tokio::time::sleep(engine::curation_scheduler::SCHEDULER_TICK_INTERVAL).await;
            }
        });
    }
    st.checkpoint("curation_scheduler");
}

// Outbound webhook notifier. Polls persona_events on a 5s tick,
// fans matching events through enabled notification_subscriptions,
// and POSTs Mustache-templated bodies to Slack/Discord/Teams/
// generic JSON endpoints. See `engine/webhook_notifier.rs`.
pub fn spawn_webhook_notifier(app: &tauri::App, pool: &DbPool, st: &mut StartupTimer) {
    {
        let pool_for_notifier = pool.clone();
        let app_for_notifier = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            engine::webhook_notifier::run_dispatcher(pool_for_notifier, app_for_notifier).await;
        });
    }
    st.checkpoint("webhook_notifier");
}

// Discord inbound poller. For every persona whose notification
// channels include an enabled `type: "discord"` entry with
// `config.pollInbound == true`, fetch new messages every 5s,
// dispatch them through `execute_persona_inner`, then post the
// run's final output back to the same channel. See
// `engine/discord_poller.rs`.
pub fn spawn_discord_poller(
    app: &tauri::App,
    pool: &DbPool,
    state_arc: &Arc<AppState>,
    st: &mut StartupTimer,
) {
    {
        let pool_for_discord = pool.clone();
        let app_for_discord = app.handle().clone();
        let state_for_discord = state_arc.clone();
        tauri::async_runtime::spawn(async move {
            engine::discord_poller::run_poller(
                pool_for_discord,
                app_for_discord,
                state_for_discord,
            )
            .await;
        });
    }
    st.checkpoint("discord_poller");
}

// Slack inbound poller. The Slack analogue of the Discord poller:
// for every persona whose notification channels include an enabled
// `type: "slack"` entry with `config.pollInbound == true`, fetch new
// messages every 5s via conversations.history, dispatch them through
// `execute_persona_inner`, then post the run's final output back to
// the same thread via chat.postMessage. See `engine/slack_poller.rs`.
pub fn spawn_slack_poller(
    app: &tauri::App,
    pool: &DbPool,
    state_arc: &Arc<AppState>,
    st: &mut StartupTimer,
) {
    {
        let pool_for_slack = pool.clone();
        let app_for_slack = app.handle().clone();
        let state_for_slack = state_arc.clone();
        tauri::async_runtime::spawn(async move {
            engine::slack_poller::run_poller(pool_for_slack, app_for_slack, state_for_slack).await;
        });
    }
    st.checkpoint("slack_poller");
}

// Team channel -> Slack relay (outbound half of the team bridge).
// For every persona channel spec carrying `teamBridge: true`, mirror
// new team_channel_messages / team_assignment_events rows into the
// bound Slack channel on a 5s watermark-driven tick, reusing the
// notification stack's Slack sender. Leader-gated; never mirrors
// rows authored by Slack (the echo guard). See
// `engine/team_slack_relay.rs` and `engine/slack_bridge.rs`.
pub fn spawn_team_slack_relay(app: &tauri::App, pool: &DbPool, st: &mut StartupTimer) {
    {
        let pool_for_bridge = pool.clone();
        let app_for_bridge = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            engine::team_slack_relay::run_relay(pool_for_bridge, app_for_bridge).await;
        });
    }
    st.checkpoint("team_slack_relay");
}
