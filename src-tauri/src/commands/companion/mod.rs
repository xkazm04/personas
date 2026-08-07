//! Tauri command surface for the Companion (Athena) plugin.
//!
//! Phase 0 ships only `companion_init` — the rest of the surface
//! (chat send, stream, approve/reject, brain queries, consolidation,
//! dev feedback, observability digest) lands in Phase 1+.

pub mod approvals;
pub mod backlog_triage;
pub mod brain;
pub mod briefing;
pub mod browser_test;
pub mod canvas_control;
pub mod chat;
pub mod chat_cards;
pub mod connectors;
pub mod consolidate;
pub mod conversation;
pub mod daily_goals;
#[cfg(debug_assertions)]
pub mod debug_export;
pub mod decisions;
pub mod dev_review;
pub mod feedback;
pub mod fleet_bridge;
pub mod jobs;
pub mod mcp_bridge;
pub mod observability;
pub mod plugins;
pub mod proactive;
pub mod project_tracking;
#[cfg(feature = "desktop")]
pub mod sensory;
pub mod sidecars;
pub mod stt;
pub mod templates;
pub mod tours;
pub mod voice;

use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;

use futures_util::FutureExt;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::companion::brain::doctrine;
use crate::companion::disk;
use crate::companion::proactive as proactive_engine;
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Once-per-process guard so re-running `companion_init` (HMR, manual
/// re-call) doesn't stack a second proactive scheduler task. The
/// `OnceLock` value is the JoinHandle of the first scheduler spawn —
/// we don't actually use it (cancel-on-shutdown is handled by Tauri's
/// async runtime tearing down), but storing it prevents respawn.
static PROACTIVE_SCHEDULER: OnceLock<()> = OnceLock::new();

/// Same one-shot guard for the Phase G background-job worker.
static JOB_WORKER: OnceLock<()> = OnceLock::new();

/// One-shot guard for the Goal-1 execution-review debouncer (the task
/// that turns engine execution-finished signals into review turns).
static EXEC_REVIEW_DEBOUNCER: OnceLock<()> = OnceLock::new();

/// One-shot guard for the Phase-4 dev-op boot-recovery sweep — a re-run
/// mid-process could race sessions dispatched after boot (see the call
/// site note; the sweep's registry liveness check is the second guard).
static DEV_OP_RECOVERY: OnceLock<()> = OnceLock::new();

/// How often the background scheduler wakes to evaluate triggers. Five
/// minutes is a sweet spot — short enough that a goal hitting its 24h
/// window fires within minutes of the threshold, long enough that the
/// per-tick cost (a handful of SQL queries) stays trivial.
const PROACTIVE_TICK_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// Job-worker poll interval. Faster cadence than the proactive
/// scheduler because users expect "I started a scan" → results within
/// seconds-to-a-minute, not minutes. 3s polling is cheap (single SQL
/// SELECT per tick when the queue is empty).
const JOB_WORKER_INTERVAL: Duration = Duration::from_secs(3);

/// Initialize the companion-brain disk layout. Idempotent — safe to call
/// on every app start. Returns the absolute path to the brain root for
/// debugging / display purposes.
///
/// Also kicks off doctrine ingestion (the curated app-philosophy docs) in
/// a background tokio task so first-run embedding doesn't block the UI.
#[tauri::command]
pub fn companion_init(state: State<'_, Arc<AppState>>, app: AppHandle) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let root = disk::ensure_initialized(&state.db)?;

    // Multi-conversation: make sure the always-present system threads
    // (default "General" + "athena-notices") exist from boot, not just on the
    // first list. Best-effort — `conversation::list` also creates them lazily,
    // so a failure here doesn't block init.
    if let Err(e) = crate::companion::conversation::ensure_system_conversations(&state.user_db) {
        tracing::warn!(error = %e, "ensure_system_conversations failed at init (will retry lazily)");
    }

    // Phase E: the proactive scheduler. Normally already running — `setup()`
    // starts it at boot (see `start_proactive_scheduler`) — but the call is
    // kept here so a build/path that reaches `companion_init` first still
    // gets it. Idempotent either way.
    start_proactive_scheduler(state.inner(), &app);

    // Phase G: spawn the background-job worker. Same OnceLock guard so
    // HMR/re-init doesn't stack workers (which would race for queued
    // rows; the SQL UPDATE...WHERE status='queued' guarantees
    // exactly-once even if it did, but spawning multiple is wasteful).
    JOB_WORKER.get_or_init(|| {
        let pool = state.user_db.clone();
        let cred_pool = state.db.clone();
        let app_handle = app.clone();
        let sink = crate::companion::jobs::JobEventSink::App(app_handle);
        #[cfg(feature = "ml")]
        let embedder = state.embedding_manager.clone();
        tauri::async_runtime::spawn(async move {
            // Short startup delay so the bridge boot logs land first.
            tokio::time::sleep(Duration::from_secs(2)).await;
            loop {
                // Panic boundary (see proactive scheduler above): keep the
                // job-worker loop alive across a panicking tick instead of
                // silently dropping the task and stalling the queue.
                let tick_result = AssertUnwindSafe(async {
                    #[cfg(feature = "ml")]
                    {
                        crate::companion::jobs::worker_tick(&pool, &cred_pool, embedder.as_ref(), &sink).await
                    }
                    #[cfg(not(feature = "ml"))]
                    {
                        crate::companion::jobs::worker_tick(&pool, &cred_pool, &sink).await
                    }
                })
                .catch_unwind()
                .await;
                match tick_result {
                    Ok(Ok(_)) => {}
                    Ok(Err(e)) => {
                        tracing::warn!(error = %e, "job worker tick failed");
                    }
                    Err(_) => {
                        tracing::error!(
                            "job worker tick panicked — loop will continue on next interval"
                        );
                    }
                }
                tokio::time::sleep(JOB_WORKER_INTERVAL).await;
            }
        });
    });

    // Goal 1: execution-review debouncer. Turns engine execution-finished
    // signals into review turns (autonomous-mode-gated, debounced + capped
    // by the same reviewer the 5-min tick uses). OnceLock-guarded so HMR
    // re-init doesn't stack debouncers racing the same signal.
    EXEC_REVIEW_DEBOUNCER.get_or_init(|| {
        let user_db = state.user_db.clone();
        let sys_db = state.db.clone();
        let app_handle = app.clone();
        #[cfg(feature = "ml")]
        let debounce_embedder = state.embedding_manager.clone();
        tauri::async_runtime::spawn(async move {
            crate::companion::proactive::execution_review::run_execution_review_debouncer(
                user_db,
                sys_db,
                app_handle,
                #[cfg(feature = "ml")]
                debounce_embedder,
            )
            .await;
        });
    });

    // Seed the project registry on first run with the Personas repo
    // so "list projects" / "scan project X" have something to act on.
    // Idempotent (path UNIQUE).
    if let Err(e) = crate::companion::projects::seed_default_project(&state.user_db) {
        tracing::warn!(error = %e, "companion: seed_default_project failed");
    }

    // Recover any background jobs that were `running` when the process
    // last exited (HMR rebuild, crash). Without this they'd sit in
    // `running` forever; with it they get marked `failed` so the user
    // can re-enqueue cleanly.
    if let Err(e) = crate::companion::jobs::recover_orphans(&state.user_db) {
        tracing::warn!(error = %e, "companion: job orphan recovery failed");
    }
    if let Err(e) = crate::companion::jobs::prune_terminal_jobs(&state.user_db) {
        tracing::warn!(error = %e, "companion: job history prune failed");
    }
    if let Err(e) = crate::companion::turn_ledger::prune_old_turns(&state.user_db) {
        tracing::warn!(error = %e, "companion: turn-ledger prune failed");
    }

    // Spawn doctrine ingest in the background. `companion_init` is a sync
    // command, so we use Tauri's async runtime helper rather than
    // `tokio::spawn` (which would panic — no current runtime in scope).
    // Subsequent calls are cheap (idempotent via content_hash).
    #[cfg(feature = "ml")]
    {
        let pool = state.user_db.clone();
        if let Some(emb) = state.embedding_manager.clone() {
            tauri::async_runtime::spawn(async move {
                if let Err(e) = run_doctrine_ingest(pool, emb).await {
                    tracing::warn!(error = %e, "companion doctrine ingest failed");
                }
            });
        } else {
            tracing::debug!("companion doctrine: no embedder configured, skipping ingest");
        }
    }

    // DEV MODE boot recovery (Phase 4): dev_improve rows still `dispatched`
    // are orphans — their fleet PTY sessions died with the previous app
    // process (typically the dev-server restart that backend work causes).
    // Sweep them to `interrupted` + one proactive card each describing what
    // survived on disk (worktree/branch/commits) and the options. Cheap
    // no-op when the ledger has no dispatched rows. Once per process —
    // companion_init re-runs on panel mounts/page reloads, and a mid-run
    // re-sweep mislabeled a live 5-second-old op on 2026-07-04 (the sweep
    // also liveness-checks against the fleet registry as the second guard).
    DEV_OP_RECOVERY.get_or_init(|| {
        let pool = state.user_db.clone();
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::companion::dev_mode::recover_interrupted_dev_ops(&pool, &app_handle);
        });
    });

    Ok(root.display().to_string())
}

/// The fleet's backlog as the wake window sees it.
struct FleetCensus {
    /// Sessions a periodic pass could look at this tick.
    pending: usize,
    /// A session is waiting on a human. Human-blocking, so it bypasses the
    /// window (see `wake_window::FLEET_SURFACE`).
    has_priority: bool,
}

/// Shortest of the three passes' own freshness thresholds
/// (`IDLE_REASSESS_AFTER_MS`). A session that moved more recently than this is
/// not a candidate for ANY of them, so counting it would let brand-new
/// activity hold the window open. Each pass still applies its own, stricter,
/// threshold afterwards.
const FLEET_CENSUS_MIN_IDLE_MS: i64 = 90 * 1000;

/// Pure census over `(state, ms since last activity)` pairs.
///
/// Deliberately broader than any single pass: stuck-session recovery works off
/// operative memory and targets sessions that are still `Running`, so a census
/// restricted to parked states would report zero and gate that pass off
/// entirely. Anything non-terminal and not freshly active counts; the passes
/// themselves remain the precise filters.
fn fleet_census<I: IntoIterator<Item = (crate::commands::fleet::types::FleetSessionState, i64)>>(
    rows: I,
) -> FleetCensus {
    use crate::commands::fleet::types::FleetSessionState as S;
    let mut census = FleetCensus { pending: 0, has_priority: false };
    for (state, idle_ms) in rows {
        if matches!(state, S::Exited | S::Hibernated) {
            continue;
        }
        if idle_ms < FLEET_CENSUS_MIN_IDLE_MS {
            continue;
        }
        census.pending += 1;
        // `Finished` is priority alongside `AwaitingInput`. Both are states
        // where the operator is the next mover — one is blocked on an answer,
        // the other has an outcome nobody has been told about — and making a
        // finished fleet wait out the periodic window is how "everything is
        // done" stayed silent for up to the whole window length.
        if matches!(state, S::AwaitingInput | S::Finished) {
            census.has_priority = true;
        }
    }
    census
}

/// Snapshot the live registry into the census. One read, no renders.
fn fleet_reassess_census() -> FleetCensus {
    let now = crate::commands::fleet::registry::now_ms();
    fleet_census(
        crate::commands::fleet::registry::registry()
            .list_dto()
            .into_iter()
            .map(|s| (s.state, now - s.last_activity_ms)),
    )
}

/// Start Athena's proactive scheduler: the five-minute autonomy loop that
/// runs the fleet reassess passes, execution review, message triage and the
/// stale-approval GC.
///
/// Called from `setup()` in `lib.rs`, next to the other engine loops. It used
/// to start inside `companion_init`, which is invoked by the frontend from a
/// lazily-mounted footer icon: if that chunk never mounted, or failed to, the
/// whole autonomy loop silently never started for the process lifetime, and
/// `PROACTIVE_SCHEDULER` being a `OnceLock` meant a failed first init had no
/// retry either. A backend lifecycle point is the only guaranteed start.
///
/// Still `OnceLock`-guarded, so the surviving `companion_init` call (which
/// does plenty of other work) is a cheap no-op rather than a second
/// scheduler. Starting the loop is NOT turning autonomy on: every autonomy
/// leg inside the tick stays behind the `autonomous_mode_enabled` runtime
/// gate, and the `catch_unwind` panic boundary is unchanged.
pub fn start_proactive_scheduler(state: &Arc<AppState>, app: &AppHandle) {
    if !claim_proactive_scheduler_slot() {
        return;
    }
    {
        let pool = state.user_db.clone();
        // Goal 2: the execution-review leg reads the executions table
        // (main db, not user_db) + the persisted autonomous-mode flag,
        // and spawns reasoning turns. Clone both pools + the embedder.
        let sys_db = state.db.clone();
        #[cfg(feature = "ml")]
        let review_embedder = state.embedding_manager.clone();
        let app_handle = app.clone();
        // Phase 3 b — clone the ambient + rule-engine handles so the
        // scheduler can run `ambient_match` candidates alongside the
        // existing time/state-based triggers. Desktop-feature gated;
        // non-desktop builds get None and skip the ambient leg.
        #[cfg(feature = "desktop")]
        let ambient_ctx = state.ambient_context.clone();
        #[cfg(feature = "desktop")]
        let rule_engine = state.context_rule_engine.clone();
        tauri::async_runtime::spawn(async move {
            // Tiny initial delay so the first tick doesn't race the rest
            // of startup (state registration, doctrine ingest, orphan
            // recovery). 30s is enough.
            tokio::time::sleep(Duration::from_secs(30)).await;
            loop {
                // Panic boundary: a panicking tick would otherwise kill this
                // spawned task silently, stopping proactive scheduling until the
                // process restarts. catch_unwind lets the loop survive — mirrors
                // engine::subscription::run_single's panic guard. The trailing
                // interval sleep prevents tight-looping on a persistent panic.
                let tick_result = AssertUnwindSafe(async {
                    #[cfg(feature = "desktop")]
                    let nudge_res =
                        run_proactive_tick(&pool, &app_handle, Some(&ambient_ctx), Some(&rule_engine)).await;
                    #[cfg(not(feature = "desktop"))]
                    let nudge_res = run_proactive_tick(&pool, &app_handle).await;

                    // Self-initiated execution review. Independent of the
                    // nudge pipeline (which early-returns when no candidates
                    // landed) — only runs when autonomous mode is toggled
                    // on, so it's opt-in and off by default. One batched
                    // headless triage per tick: digest card + ≤1 deep-dive
                    // turn (see proactive::execution_review module docs).
                    if crate::commands::companion::chat::autonomous_mode_enabled(&sys_db) {
                        // Wake window: the cadence dial now governs the fleet's
                        // PERIODIC passes too (see `wake_window::FLEET_SURFACE`
                        // for what is deliberately left outside it). Census
                        // first so a skipped tick still records why, and so an
                        // idle fleet costs one registry read instead of three
                        // sweeps.
                        let census = fleet_reassess_census();
                        let wake = crate::companion::wake_window::gate(
                            &sys_db,
                            crate::companion::wake_window::FLEET_SURFACE,
                            census.pending,
                            census.has_priority,
                        );
                        if wake.due {
                            let wake_started = std::time::Instant::now();
                            // Fleet orchestration re-check: re-assess parked
                            // AwaitingInput sessions from their real screen. Replaces
                            // the old blind "want me to peek?" nudge — orchestration's
                            // throttle + screen-hash dedupe make this cheap and
                            // non-spammy (unchanged screens are skipped).
                            crate::commands::companion::fleet_bridge::reassess_stale_awaiting(
                                &app_handle,
                            );
                            // Phase 3b — stuck-session recovery: wake Athena on a
                            // dispatched session that failed and stalled so she
                            // proposes a confidence-gated `fleet_intervene` (or
                            // defers). Replaces the old ask-only `fleet_session_stuck`
                            // nudge; same throttle/dedupe + one-intervention cap.
                            crate::commands::companion::fleet_bridge::reassess_stuck_sessions(
                                &app_handle,
                            );
                            // Phase 3a — idle-needs-next: a dispatched session that
                            // finished its turn and idles at the prompt has no
                            // event-driven trigger; wake Athena to judge done-vs-next
                            // against its objective and send the next step (gated) or
                            // leave a finished session alone.
                            crate::commands::companion::fleet_bridge::reassess_idle_needs_next(
                                &app_handle,
                            );
                            // Ledger row so the cadence strip's impact line
                            // counts fleet wakes instead of silently omitting
                            // them. `cli_calls` / `actions` stay 0 on purpose:
                            // each pass hands sessions to orchestration, which
                            // throttles + screen-hash-dedupes them and decides
                            // asynchronously, so counting routed sessions here
                            // would overstate turns that may never happen. The
                            // per-turn accounting lives in the assessment batch.
                            crate::companion::wake_window::log_wake(
                                &sys_db,
                                crate::companion::wake_window::FLEET_SURFACE,
                                wake.reason,
                                census.pending,
                                0,
                                0,
                                wake_started.elapsed().as_millis() as u64,
                            );
                        }
                        // Expire pending fleet consults whose target session is
                        // gone or that sat unactioned >30 min — leftovers from
                        // prior app runs read as "Athena is asking me things
                        // she should have handled" in the chat.
                        if let Some(st) = app_handle.try_state::<std::sync::Arc<crate::AppState>>() {
                            crate::commands::companion::fleet_bridge::gc_stale_fleet_approvals(
                                &app_handle,
                                &st,
                            );
                        }

                        let review = crate::companion::proactive::execution_review::review_recent_executions(
                            &pool,
                            &sys_db,
                            &app_handle,
                            #[cfg(feature = "ml")]
                            review_embedder.as_ref(),
                        )
                        .await;
                        match review {
                            Ok(n) if n > 0 => {
                                tracing::info!(surfaced = n, "proactive: execution triage surfaced finding(s)");
                            }
                            Ok(_) => {}
                            Err(e) => {
                                tracing::warn!(error = %e, "proactive: execution review failed");
                            }
                        }

                        // Messages triage — Athena reads the Overview →
                        // Messages inbox the way she resolves human reviews:
                        // routine ones are read-and-done, business value is
                        // summarized onto one digest card, and items that
                        // need the user personally stay unread + escalate.
                        // Implied by autonomous mode (no separate opt-in).
                        match crate::companion::proactive::message_triage::triage_unread_messages(
                            &pool,
                            &sys_db,
                            &app_handle,
                        )
                        .await
                        {
                            Ok(n) if n > 0 => {
                                tracing::info!(triaged = n, "proactive: message triage processed message(s)");
                            }
                            Ok(_) => {}
                            Err(e) => {
                                tracing::warn!(error = %e, "proactive: message triage failed");
                            }
                        }
                    }
                    nudge_res
                })
                .catch_unwind()
                .await;
                match tick_result {
                    Ok(Ok(_)) => {}
                    Ok(Err(e)) => {
                        tracing::warn!(error = %e, "proactive scheduler tick failed");
                    }
                    Err(_) => {
                        tracing::error!(
                            "proactive scheduler tick panicked — loop will continue on next interval"
                        );
                    }
                }
                tokio::time::sleep(PROACTIVE_TICK_INTERVAL).await;
            }
        });
    }
}

/// Claim the once-per-process scheduler slot.
///
/// `true` for the first caller, `false` for every one after it. Split out of
/// [`start_proactive_scheduler`] so the "two starts do not stack two
/// schedulers" guarantee is testable without an `AppHandle`: with the start
/// point now in `setup()` AND the legacy `companion_init` call still present,
/// a double start is the normal case, not an edge case.
fn claim_proactive_scheduler_slot() -> bool {
    let mut claimed = false;
    PROACTIVE_SCHEDULER.get_or_init(|| {
        claimed = true;
    });
    claimed
}

/// Re-run doctrine ingestion on demand. Idempotent — unchanged chunks are
/// skipped via content_hash. Useful when docs/ changes and the user wants
/// Athena to pick up the latest without an app restart.
#[tauri::command]
pub async fn companion_reingest_doctrine(
    state: State<'_, Arc<AppState>>,
) -> Result<DoctrineIngestSummary, AppError> {
    crate::ipc_auth::require_auth(&state).await?;
    #[cfg(feature = "ml")]
    {
        let pool = state.user_db.clone();
        let embedder = state.embedding_manager.clone().ok_or_else(|| {
            AppError::Internal("embedding manager unavailable (ml feature disabled)".into())
        })?;
        let stats = doctrine::ingest_all(&pool, &embedder).await?;
        Ok(DoctrineIngestSummary::from(stats))
    }
    #[cfg(not(feature = "ml"))]
    {
        let _ = state;
        Ok(DoctrineIngestSummary::default())
    }
}

/// Frontend-friendly summary of an ingest pass.
#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctrineIngestSummary {
    pub files_seen: usize,
    pub files_missing: usize,
    pub chunks_inserted: usize,
    pub chunks_updated: usize,
    pub chunks_unchanged: usize,
    pub chunks_deleted: usize,
    pub errors: Vec<String>,
}

impl From<doctrine::IngestStats> for DoctrineIngestSummary {
    fn from(s: doctrine::IngestStats) -> Self {
        Self {
            files_seen: s.files_seen,
            files_missing: s.files_missing,
            chunks_inserted: s.chunks_inserted,
            chunks_updated: s.chunks_updated,
            chunks_unchanged: s.chunks_unchanged,
            chunks_deleted: s.chunks_deleted,
            errors: s.errors,
        }
    }
}

/// One scheduler tick: evaluate triggers, mark new messages delivered,
/// emit `companion://proactive` if anything new landed. Errors are
/// logged inside; the loop keeps running.
///
/// Desktop builds also run `ambient_match` (Phase 3 b) so context-rule
/// matches against the rolling ambient window become Nudges alongside
/// the time/state-based triggers. Non-desktop builds skip the ambient
/// leg entirely.
#[cfg(feature = "desktop")]
async fn run_proactive_tick(
    pool: &UserDbPool,
    app: &AppHandle,
    ambient_ctx: Option<&crate::engine::ambient_context::AmbientContextHandle>,
    rule_engine: Option<&crate::engine::context_rules::ContextRuleEngineHandle>,
) -> Result<(), AppError> {
    let mut extra = match (ambient_ctx, rule_engine) {
        (Some(ctx), Some(eng)) => proactive_engine::triggers::ambient_match(ctx, eng)
            .await
            .unwrap_or_else(|e| {
                tracing::warn!(error = %e, "ambient_match: skipping (non-fatal)");
                Vec::new()
            }),
        _ => Vec::new(),
    };
    // Goals hub: surface stalled / target-approaching project goals. dev_goals
    // live in the main app DB, reachable here via the managed AppState.
    let app_state = app.state::<Arc<AppState>>();
    // C3: emit the once-daily end-of-day rollup if it's due (gated, no budget).
    proactive_engine::rollup::maybe_emit_daily_rollup(pool, &app_state.db, app);
    // F3: run the weekly behavioral profile-synthesis pass if due (gated).
    crate::companion::brain::profile_synthesis::maybe_run_synthesis(pool, &app_state.db, app).await;
    // Night Shift v1 (gated, default off): evening plan-job enqueue, exited-
    // session review sweep, and the morning report at wake.
    crate::companion::night_shift::tick(pool, &app_state.db, app);
    extra.extend(proactive_engine::triggers::dev_goal_nudges(&app_state.db));
    // Incidents inbox: surface OPEN high/critical audit incidents (main app DB)
    // so Athena nudges about them unattended. Mirrors dev_goal_nudges as an
    // extra-candidate source; engaging lands the user on Overview → Incidents.
    extra.extend(proactive_engine::incident_triggers::incident_blocker_nudges(&app_state.db));
    // Fleet triggers only fire when Athena's autonomy is on (see collect_all) —
    // with it off, she leaves the fleet to the user instead of re-checking it.
    let autonomous = crate::commands::companion::chat::autonomous_mode_enabled(&app_state.db);
    let new_msgs = proactive_engine::evaluate_with_extra_candidates(pool, extra, autonomous)?;
    if new_msgs.is_empty() {
        return Ok(());
    }
    run_proactive_tick_finalize(pool, app, new_msgs).await
}

#[cfg(not(feature = "desktop"))]
async fn run_proactive_tick(pool: &UserDbPool, app: &AppHandle) -> Result<(), AppError> {
    // Non-desktop has no Fleet; pass autonomous=false so the fleet triggers
    // (gated in collect_all) are skipped — they'd read an empty registry anyway.
    let new_msgs = proactive_engine::evaluate(pool, false)?;
    if new_msgs.is_empty() {
        return Ok(());
    }
    run_proactive_tick_finalize(pool, app, new_msgs).await
}

async fn run_proactive_tick_finalize(
    pool: &UserDbPool,
    app: &AppHandle,
    new_msgs: Vec<crate::companion::proactive::ProactiveMessage>,
) -> Result<(), AppError> {
    if new_msgs.is_empty() {
        return Ok(());
    }
    for m in &new_msgs {
        if let Err(e) = proactive_engine::mark_delivered(pool, &m.id) {
            tracing::warn!(id = %m.id, error = %e, "proactive: mark_delivered failed");
        }
    }
    let payload = crate::commands::companion::proactive::ProactiveDelivery {
        messages: new_msgs
            .into_iter()
            .map(|m| crate::companion::proactive::ProactiveMessage {
                status: "delivered".into(),
                ..m
            })
            .collect(),
    };
    if let Err(e) = app.emit(
        crate::commands::companion::proactive::PROACTIVE_EVENT,
        payload,
    ) {
        tracing::warn!(error = %e, "proactive: scheduler event emit failed");
    }
    Ok(())
}

#[cfg(feature = "ml")]
async fn run_doctrine_ingest(
    pool: UserDbPool,
    embedder: Arc<EmbeddingManager>,
) -> Result<(), AppError> {
    let stats = doctrine::ingest_all(&pool, &embedder).await?;
    tracing::info!(
        inserted = stats.chunks_inserted,
        updated = stats.chunks_updated,
        unchanged = stats.chunks_unchanged,
        deleted = stats.chunks_deleted,
        "companion doctrine ingest completed (background)"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fleet::types::FleetSessionState as S;

    const OLD: i64 = FLEET_CENSUS_MIN_IDLE_MS + 1;
    const FRESH: i64 = FLEET_CENSUS_MIN_IDLE_MS - 1;

    #[test]
    fn scheduler_slot_is_claimed_exactly_once() {
        // The whole point of moving the start into `setup()` while leaving the
        // `companion_init` call in place: the second start must be inert.
        assert!(claim_proactive_scheduler_slot(), "first start owns the loop");
        assert!(!claim_proactive_scheduler_slot(), "second start must not stack a scheduler");
        assert!(!claim_proactive_scheduler_slot());
    }

    #[test]
    fn census_skips_terminal_and_freshly_active_sessions() {
        let c = fleet_census([
            (S::Exited, OLD),
            (S::Hibernated, OLD),
            (S::Running, FRESH),
            (S::Idle, FRESH),
        ]);
        assert_eq!(c.pending, 0);
        assert!(!c.has_priority);
    }

    #[test]
    fn census_counts_every_state_a_pass_can_act_on() {
        // Stuck-session recovery targets sessions that are still Running, so a
        // census restricted to parked states would gate that pass off entirely.
        let c = fleet_census([(S::Running, OLD), (S::Idle, OLD), (S::Stale, OLD)]);
        assert_eq!(c.pending, 3);
        assert!(!c.has_priority);
    }

    #[test]
    fn an_awaiting_session_is_a_priority_signal() {
        // Waiting on a human bypasses the cadence window — the 2026-07-24
        // outage left sessions invisible with questions on screen, and the
        // periodic sweep is the backstop that finds them.
        let c = fleet_census([(S::Idle, OLD), (S::AwaitingInput, OLD)]);
        assert_eq!(c.pending, 2);
        assert!(c.has_priority);
        // ...but only once it is past the freshness floor the hook path owns.
        assert!(!fleet_census([(S::AwaitingInput, FRESH)]).has_priority);
    }

    #[test]
    fn an_empty_fleet_never_wakes() {
        // `gate` treats pending == 0 as "waiting", so an idle fleet costs
        // nothing and logs nothing.
        let c = fleet_census(std::iter::empty());
        assert_eq!(c.pending, 0);
        assert!(!c.has_priority);
    }
}
