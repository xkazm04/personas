use super::{trigger_scheduler_tick_counted, OverdueTriggersEvent, SchedulerState};
use crate::db::DbPool;
use crate::engine::event_registry::event_name;
use crate::engine::subscription::{
    self, CleanupSubscription, CloudWebhookRelaySubscription, CompositeSubscription,
    CredentialHealthcheckSubscription, EventBusSubscription, OAuthRefreshSubscription,
    PollingSubscription, RotationSubscription, SharedEventLocalRelaySubscription,
    SharedEventRelaySubscription, TriggerSchedulerSubscription,
};
#[cfg(feature = "desktop")]
use crate::engine::subscription::{
    AppFocusSubscription, ClipboardSubscription, ContextRuleSubscription, FileWatcherSubscription,
};
use crate::engine::ExecutionEngine;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tauri::{Emitter, Manager};

/// Start all background loops via the unified subscription model.
///
/// Returns a webhook shutdown sender -- hold onto it to keep the server running,
/// send `true` or drop it to trigger graceful shutdown.
#[allow(clippy::too_many_arguments)]
pub fn start_loops(
    scheduler: Arc<SchedulerState>,
    app: AppHandle,
    pool: DbPool,
    engine: Arc<ExecutionEngine>,
    rate_limiter: Arc<crate::engine::rate_limiter::RateLimiter>,
    tier_config: Arc<std::sync::Mutex<crate::engine::tier::TierConfig>>,
    cloud_client: Arc<tokio::sync::Mutex<Option<Arc<crate::cloud::client::CloudClient>>>>,
    cloud_webhook_relay_state: Arc<
        tokio::sync::Mutex<crate::engine::cloud_webhook_relay::CloudWebhookRelayState>,
    >,
    shared_event_relay_state: Arc<
        tokio::sync::Mutex<crate::engine::shared_event_relay::SharedEventRelayState>,
    >,
    #[cfg(feature = "desktop")] ambient_ctx: crate::engine::ambient_context::AmbientContextHandle,
    #[cfg(feature = "desktop")]
    context_rule_engine: crate::engine::context_rules::ContextRuleEngineHandle,
    composite_state: crate::engine::composite::CompositeState,
    smee_notifier: crate::engine::smee_relay::SmeeRelayNotifier,
) -> tokio::sync::watch::Sender<bool> {
    // Finding #1: CAS the start so two concurrent `start_scheduler` calls
    // can't both spawn a full subscription set (the caller's own
    // `is_running()` check is only advisory -- this is the authoritative
    // gate). A losing caller returns a fresh, unconnected shutdown channel;
    // the webhook server and subscriptions from the winning caller's start
    // are left untouched.
    let generation = match scheduler.try_begin_start() {
        Some(g) => g,
        None => {
            tracing::warn!(
                "start_loops called while the scheduler was already running -- \
                 ignoring duplicate start so a second subscription set isn't spawned \
                 (would double-fire every trigger/webhook and duplicate OAuth refresh)"
            );
            let (tx, _rx) = tokio::sync::watch::channel(false);
            return tx;
        }
    };
    tracing::info!(
        generation,
        "Scheduler starting via unified subscription model"
    );

    // V8: re-attach orchestrator tick tasks to team assignments orphaned by the
    // last shutdown (status running/queued with no task) — their in-flight
    // steps re-queue as pending and the assignment resumes instead of wedging.
    crate::engine::team_assignment_orchestrator::recover_orphaned_assignments(
        Arc::new(pool.clone()),
        app.clone(),
        engine.clone(),
        None,
    );

    // Build the HTTP client for the polling subscription.
    // Uses SsrfSafeDnsResolver to reject private IPs at connect time,
    // closing the DNS-rebinding TOCTOU window (CWE-367).
    let http = crate::engine::url_safety::build_ssrf_safe_client(Duration::from_secs(30));

    // Ensure every existing scrape pipeline has its Signal feeds registered +
    // subscribed (seeded/pre-feature configs included) so they surface in Studio.
    #[cfg(feature = "scraper")]
    crate::engine::scraper::reconcile_signal_feeds(&pool);

    // Assemble all reactive subscriptions
    #[allow(unused_mut)]
    let mut subscriptions: Vec<Box<dyn subscription::ReactiveSubscription>> = vec![
        Box::new(EventBusSubscription {
            scheduler: scheduler.clone(),
            app: app.clone(),
            pool: pool.clone(),
            engine: engine.clone(),
        }),
        Box::new(TriggerSchedulerSubscription {
            scheduler: scheduler.clone(),
            pool: pool.clone(),
        }),
        Box::new(PollingSubscription {
            scheduler: scheduler.clone(),
            pool: pool.clone(),
            http,
        }),
        Box::new(CleanupSubscription { pool: pool.clone() }),
        Box::new(RotationSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        Box::new(CompositeSubscription {
            pool: pool.clone(),
            composite_state,
        }),
        Box::new(crate::engine::pattern_miner::PatternMinerSubscription { pool: pool.clone() }),
        Box::new(subscription::AutoRollbackSubscription {
            pool: pool.clone(),
            app: app.clone(),
            engine: engine.clone(),
        }),
        Box::new(OAuthRefreshSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Daily in-process credential healthcheck sweep. Runs at most once per
        // 24h (gate inside the tick); first tick ~60s after launch is the
        // startup catch-up. Replaces the per-Vault-visit frontend auto-test,
        // whose concurrent privileged-IPC stampede produced false "degraded"
        // cards (x-ipc-token race in ipc_auth.rs).
        Box::new(CredentialHealthcheckSubscription { pool: pool.clone() }),
        // Periodic MCP gateway-member healthcheck: probes each enabled gateway
        // member and records per-member status into its credential metadata so a
        // dead member surfaces as an explicit "failed" instead of just silently
        // missing tools. No-op when no MCP gateways exist.
        Box::new(subscription::McpHealthcheckSubscription { pool: pool.clone() }),
        Box::new(subscription::ZombieExecutionSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        Box::new(subscription::HealingTtlSubscription { pool: pool.clone() }),
        Box::new(CloudWebhookRelaySubscription {
            cloud_client: cloud_client.clone(),
            pool: pool.clone(),
            app: app.clone(),
            state: cloud_webhook_relay_state,
        }),
        Box::new(SharedEventRelaySubscription {
            cloud_client,
            pool: pool.clone(),
            app: app.clone(),
            state: shared_event_relay_state,
        }),
        // Local-first delivery of baked curated firings (connector API-change
        // events). Runs independently of the cloud relay above; no cloud client.
        Box::new(SharedEventLocalRelaySubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Runs due saved scrape configs on their cron schedule (embedded Pumper).
        #[cfg(feature = "scraper")]
        Box::new(subscription::ScraperScheduleSubscription { pool: pool.clone() }),
        Box::new(subscription::DigestSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Autonomous goal advancement — default-OFF; gated on the
        // AUTONOMOUS_GOAL_ADVANCEMENT setting inside its tick.
        Box::new(subscription::GoalAdvanceSubscription {
            pool: pool.clone(),
            app: app.clone(),
            engine: engine.clone(),
        }),
        // Autonomous assignment retry — default-OFF; gated on the
        // AUTONOMOUS_ASSIGNMENT_RETRY setting inside its tick. Resumes an
        // assignment soft-paused at awaiting_review after a retryable
        // (quota/session/rate-limit) step failure so the goal-advance loop
        // self-heals instead of deadlocking.
        Box::new(subscription::AssignmentAutoResumeSubscription {
            pool: pool.clone(),
            app: app.clone(),
            engine: engine.clone(),
        }),
        // Autonomous manual-review triage — implied by the master autonomous
        // toggle (COMPANION_AUTONOMOUS_MODE, checked inside its tick; the legacy
        // AUTONOMOUS_REVIEW_TRIAGE key is no longer read). Auto-approves routine
        // (low/medium) pending reviews past a grace window so the accept→memory
        // learning loop keeps turning unattended; high severity stays for a human.
        Box::new(subscription::ManualReviewAutoTriageSubscription { pool: pool.clone() }),
        // Autonomous backlog -> goal (G7) — default-OFF; gated on the
        // AUTONOMOUS_BACKLOG_TO_GOAL setting inside its tick. When a goal-linked
        // project runs out of open goals, promote its best pending backlog idea
        // to a new goal so the goal-advance loop self-sustains instead of idling.
        Box::new(subscription::BacklogToGoalSubscription { pool: pool.clone() }),
        // G7 — autonomous idea replenishment: when a goal-managed project is
        // fully idle (no open goals, no pending ideas), run a backlog scan to
        // refeed the loop. Default-OFF (`autonomous_idea_scan`); 20h
        // per-project cooldown; one project per tick.
        Box::new(subscription::IdeaReplenishSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Roster redesign — Product Strategist backlog triage: ranks the
        // next-up queue + rejects low-value ideas (default-OFF
        // `autonomous_backlog_triage`; 24h/project cooldown).
        Box::new(subscription::BacklogTriageSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Director storm trigger (C3) — runs focused Director coaching on a
        // persona whose recent team work shows a burst of failures / QA
        // change-requests, bridging the verdict into the team channel
        // (default-OFF `autonomous_director_storm`; 6h/persona rate-limit).
        Box::new(subscription::DirectorStormSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Athena channel reactions — Athena watches each goal-managed team's
        // delivery stream and posts a genuine react/decline decision into the
        // team channel at reaction-worthy moments (cap-out escalations, QA
        // bounces, shipped goals), so her orchestration is visible + auditable
        // throughout development (default-OFF `autonomous_athena_reactions`;
        // ≤4 teams/tick, deduped against her last channel post per team).
        Box::new(subscription::AthenaChannelReactionSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Design D — deliberation moderator. Advances each open team
        // deliberation by a bounded number of persona turns per tick (a Haiku
        // moderator routes the key personas + curates the agenda; progress/stall
        // + cost/idle floors bound it — no turn budget). Default-OFF
        // `autonomous_deliberation`. Persona turns land in D3; the LLM never
        // enters the execution tick loop (the C-on-B doctrine).
        Box::new(crate::engine::deliberation::DeliberationSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // KPI → Goal derivation — derive goals from off-track KPIs (default-OFF
        // `autonomous_kpi_goal_derivation`; fresh-measurement + one-open-goal +
        // re-measure-after-completion gates; skip is a legitimate outcome).
        // Autonomous KPI evaluation — default-OFF; gated on the
        // AUTONOMOUS_KPI_EVALUATION setting inside its tick. Measures due
        // active KPIs hourly so the KPI→goal derivation loop has fresh data
        // on unattended runs (derivation refuses stale measurements).
        Box::new(subscription::KpiEvaluationSubscription { pool: pool.clone() }),
        Box::new(subscription::KpiGoalDerivationSubscription {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Overnight Portfolio Engine — nightly mechanical scan-delta → triage
        // rules → budget-governed fleet dispatch per autopilot suggest/full
        // project (explicit opt-in only; no global flag). Branch-only writes.
        Box::new(
            crate::commands::infrastructure::overnight::OvernightEngineSubscription {
                pool: pool.clone(),
                app: app.clone(),
            },
        ),
        // Fleet liveness watchdog — raises ONE deduped fleet_stall incident +
        // notification when autonomy is on, work is available, no quota
        // cooldown applies, and nothing has executed for 2h (the 06-09 silent
        // deadlock class). Always-on; spends nothing.
        Box::new(subscription::FleetLivenessWatchdog {
            pool: pool.clone(),
            app: app.clone(),
        }),
        // Queue drain watchdog — re-drains the execution queue after a
        // quota-aware admission cooldown lifts (the normal completion-driven
        // drain can't restart itself once all in-flight work has finished).
        // Always-on; cheap no-op when the queue is empty / at capacity.
        Box::new(subscription::QueueDrainWatchdog {
            pool: pool.clone(),
            app: app.clone(),
            engine: engine.clone(),
        }),
        // Incident auto-continuation (P2.3b): re-run blocked work when its
        // persona-raised incident is resolved. Idempotent via claim_continuation.
        Box::new(
            crate::engine::incident_continuation::IncidentContinuationSubscription {
                pool: pool.clone(),
                app: app.clone(),
                engine: engine.clone(),
            },
        ),
        // KP bridge (WP4) — periodic monthly-rollup push to the external KP
        // hiring app for personas carrying design_context.kpLink. Free when no
        // persona is KP-linked (one LIKE-prefiltered scan per tick); leadership
        // default keeps multi-instance setups from double-reporting.
        Box::new(crate::engine::kp_reporter::KpReporterSubscription { pool: pool.clone() }),
        // App master probation (P4) — raises the end-of-probation review packet
        // once per hire. Free when no project carries an App master mandate
        // (one settings-prefix query per tick and out).
        Box::new(
            crate::engine::app_master_probation::AppMasterProbationSubscription {
                pool: pool.clone(),
            },
        ),
        // App master proposal reconciler (P5a) — observes proposal branches,
        // runs the repository's OWN declared gates against them, and records
        // merges and reverts. Without it `proposalsMerged`,
        // `proposalsReverted` and `gatePassRate` are structurally null and the
        // probation verdict can never be anything but `incomplete`. Free when
        // no project carries a mandate (one settings-prefix query and out).
        Box::new(
            crate::engine::app_master_reconcile::AppMasterReconcileSubscription {
                pool: pool.clone(),
            },
        ),
    ];

    // Desktop-only subscriptions: file watcher, clipboard monitor, app focus, ambient context
    #[cfg(feature = "desktop")]
    {
        let (fw_state, fw_tx, fw_rx, fw_dropped) =
            crate::engine::file_watcher::create_file_watcher();
        subscriptions.push(Box::new(FileWatcherSubscription {
            pool: pool.clone(),
            state: fw_state,
            tx: fw_tx,
            rx: fw_rx,
            dropped: fw_dropped,
            ambient_ctx: ambient_ctx.clone(),
        }));
        // Build clipboard subscription with watcher support (error detection + KB search)
        {
            let app_state: &Arc<crate::AppState> = &app.state::<Arc<crate::AppState>>();
            subscriptions.push(Box::new(ClipboardSubscription {
                pool: pool.clone(),
                state: Arc::new(tokio::sync::Mutex::new(
                    crate::engine::clipboard_monitor::ClipboardState::new(),
                )),
                ambient_ctx: ambient_ctx.clone(),
                app: app.clone(),
                user_db: app_state.user_db.clone(),
                #[cfg(feature = "ml")]
                embedding_manager: app_state.embedding_manager.clone(),
                #[cfg(feature = "ml")]
                vector_store: app_state.vector_store.clone(),
                last_notification: Arc::new(tokio::sync::Mutex::new(None)),
                watcher_enabled: app_state.clipboard_watcher_enabled.clone(),
            }));
        }
        subscriptions.push(Box::new(AppFocusSubscription {
            pool: pool.clone(),
            state: Arc::new(tokio::sync::Mutex::new(
                crate::engine::app_focus::AppFocusState::new(),
            )),
            ambient_ctx: ambient_ctx.clone(),
        }));
        subscriptions.push(Box::new(subscription::AmbientContextSubscription {
            ctx: ambient_ctx.clone(),
        }));
        // Phase 3 c v3: TTL eviction for the cross-process ambient_signal
        // SQL projection. Runs every 30 min, drops rows older than 24h.
        subscriptions.push(Box::new(subscription::AmbientSignalEvictionSubscription {
            pool: pool.clone(),
        }));
        // Context rule engine: subscribes to the context stream and evaluates
        // persona-defined rules for proactive actions.
        let stream_rx = {
            let ctx = ambient_ctx
                .try_lock()
                .expect("ambient_ctx lock should be uncontested during startup");
            ctx.subscribe()
        };
        subscriptions.push(Box::new(ContextRuleSubscription {
            rule_engine: context_rule_engine,
            stream_rx: Arc::new(tokio::sync::Mutex::new(stream_rx)),
            pool: pool.clone(),
            app: app.clone(),
        }));
    }

    // Spawn all subscriptions through the unified scheduler. Each loop
    // captures `generation` at spawn and compares it against
    // `scheduler.generation()` on every tick (see `run_single`) instead of
    // trusting the bare `running` flag.
    let handles = subscription::spawn_subscriptions(
        subscriptions,
        scheduler.clone(),
        app.clone(),
        generation,
    );
    scheduler.store_subscription_handles(handles);

    // -- Startup overdue sweep ------------------------------------------------
    // Fire all overdue triggers immediately on startup (before waiting for the
    // first subscription tick). This ensures missed schedules from app-offline
    // periods are caught up within milliseconds of launch.
    {
        let recovered = trigger_scheduler_tick_counted(&scheduler, &pool);
        if recovered > 0 {
            tracing::info!(
                count = recovered,
                "Startup overdue sweep: fired {recovered} overdue trigger(s)"
            );
            let _ = app.emit(
                event_name::OVERDUE_TRIGGERS_FIRED,
                OverdueTriggersEvent {
                    recovered,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                },
            );
        }
    }

    // -- Startup OAuth refresh sweep ------------------------------------------
    // Immediately refresh all expired/expiring OAuth tokens on startup, before
    // waiting for the OAuthRefreshSubscription's first tick. Google access tokens
    // expire in ~1 hour, so any app-offline period >1h leaves tokens dead.
    tokio::spawn({
        let pool = pool.clone();
        let app = app.clone();
        async move {
            let (refreshed, failed) =
                crate::engine::oauth_refresh::startup_oauth_sweep(&pool, Some(&app)).await;
            if refreshed > 0 || failed > 0 {
                tracing::info!(refreshed, failed, "Startup OAuth sweep complete");
            }
            // Also auto-provision rotation policies for OAuth credentials that don't have one
            crate::engine::rotation::auto_provision_oauth_rotation_policies(&pool);
        }
    });

    // -- Startup stale-review GC sweep (A-grade Phase 8, 2026-05-04) ----------
    // Auto-resolve manual reviews left in `pending` for more than 7 days. The
    // rapid-validation modules driver flagged 5 such rows from a prior C7/C8
    // session — they accumulate when auto_triage's tokio task crashes or the
    // human-review UI subscription drops. Each resolution writes one
    // policy_events row tagged `review.stale_gc.resolved` so the disposition
    // is traceable. Runs once per launch; spawned async so it doesn't block
    // boot. Threshold is hardcoded at 7d here — exposing it via app_settings
    // is tracked as a follow-up.
    tokio::spawn({
        let pool = pool.clone();
        async move {
            const STALE_REVIEW_THRESHOLD_DAYS: i64 = 7;
            let cutoff = (chrono::Utc::now() - chrono::Duration::days(STALE_REVIEW_THRESHOLD_DAYS))
                .to_rfc3339();
            match crate::commands::design::reviews::gc_stale_manual_reviews_inner(&pool, &cutoff) {
                Ok(count) if count > 0 => {
                    tracing::info!(
                        count,
                        threshold_days = STALE_REVIEW_THRESHOLD_DAYS,
                        "Startup stale-review GC: auto-resolved pending reviews older than threshold"
                    );
                }
                Ok(_) => {} // no-op on a clean install — no log spam
                Err(e) => {
                    tracing::warn!(error = %e, "Startup stale-review GC failed");
                }
            }
        }
    });

    // Smee.io relay (long-lived SSE connection, event-driven via notifier)
    tokio::spawn({
        let pool = pool.clone();
        let app = app.clone();
        let notifier = smee_notifier.clone();
        async move {
            crate::engine::smee_relay::run_smee_relay(
                pool,
                app,
                Arc::new(tokio::sync::Mutex::new(
                    crate::engine::smee_relay::SmeeRelayState::new(),
                )),
                notifier,
            )
            .await;
        }
    });

    // Webhook HTTP server + Management API (not a reactive subscription -- it's a long-lived server)
    let (webhook_shutdown_tx, webhook_shutdown_rx) = tokio::sync::watch::channel(false);
    tokio::spawn({
        let pool = pool.clone();
        let scheduler = scheduler.clone();
        let app_for_mgmt = app.clone();
        async move {
            scheduler.webhook_alive.store(true, Ordering::Relaxed);

            // Which route table :9420 serves used to be decided by a single
            // `try_state` poll at this instant: resolve → 34 routes (webhook +
            // management API + pairing), miss → 3 webhook-only routes, with
            // nothing logged either way (deferred-fix #39). A miss made the KP
            // bridge (`/api/kp/*`) and device pairing (`/pair/*`) silently
            // 404 for the life of the process. AppState is managed in
            // `boot::mod` well before any caller reaches here, so the miss is
            // a startup-ordering accident, not a state the app wants: poll for
            // it instead of giving up on the first read, and shout if it never
            // arrives. `/health` reports the table that actually bound.
            const MGMT_STATE_POLLS: u32 = 50;
            const MGMT_STATE_POLL_INTERVAL: Duration = Duration::from_millis(100);
            let mut process_registry = None;
            for attempt in 0..MGMT_STATE_POLLS {
                if let Some(state) = app_for_mgmt.try_state::<std::sync::Arc<crate::AppState>>() {
                    process_registry = Some(state.process_registry.clone());
                    if attempt > 0 {
                        tracing::info!(
                            attempt,
                            "AppState resolved after waiting — :9420 serves the full route table"
                        );
                    }
                    break;
                }
                tokio::time::sleep(MGMT_STATE_POLL_INTERVAL).await;
            }
            if process_registry.is_none() {
                tracing::error!(
                    waited_ms = MGMT_STATE_POLLS as u64 * MGMT_STATE_POLL_INTERVAL.as_millis() as u64,
                    "AppState never resolved — :9420 degrades to the webhook-only route                      table; /api/* (management API, KP bridge) and /pair/* will 404 for                      the life of this process"
                );
            }
            let result = if let Some(registry) = process_registry {
                crate::engine::webhook::start_webhook_server_with_management(
                    pool,
                    rate_limiter,
                    tier_config,
                    app_for_mgmt,
                    registry,
                    webhook_shutdown_rx,
                )
                .await
            } else {
                // Fallback: webhook-only (no management API)
                crate::engine::webhook::start_webhook_server(
                    pool,
                    rate_limiter,
                    tier_config,
                    webhook_shutdown_rx,
                )
                .await
            };

            if let Err(e) = result {
                let msg = e.to_string();
                // EADDRINUSE (Windows os error 10048 / Unix EADDRINUSE) is a dev-mode
                // double-start, not an app bug — downgrade so it stays out of Sentry.
                if msg.contains("10048") || msg.to_lowercase().contains("address already in use") {
                    tracing::warn!("Webhook server bind skipped (port in use): {}", msg);
                } else {
                    tracing::error!("Webhook server failed: {}", msg);
                }
            }
            scheduler.webhook_alive.store(false, Ordering::Relaxed);
        }
    });

    webhook_shutdown_tx
}

/// Stop all background loops.
pub fn stop_loops(scheduler: &SchedulerState) {
    scheduler.running.store(false, Ordering::SeqCst);
    // Finding #1: bump the generation too, not just the bool. Dropping
    // `subscription_handles`' JoinHandles does not abort the underlying
    // tasks, so any loop spawned under the previous generation is still
    // alive and ticking. Without this bump, a later `start_loops` flips
    // `running` back to `true` and an orphaned old-generation loop (still
    // gating on the shared bool) would conclude it's current and keep
    // polling -- double-firing every trigger/webhook/schedule against the
    // same DB. Bumping here retires orphans even though we never abort
    // their handles.
    scheduler.generation.fetch_add(1, Ordering::SeqCst);
    tracing::info!("Scheduler stopped");
}
