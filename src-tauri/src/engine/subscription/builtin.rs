use super::*;
use crate::db::DbPool;
use crate::engine::background::SchedulerState;
use crate::engine::ExecutionEngine;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;

// ---------------------------------------------------------------------------
// Concrete subscriptions
// ---------------------------------------------------------------------------

/// Event bus subscription: poll pending events, match to subscriptions, trigger executions.
pub struct EventBusSubscription {
    pub scheduler: Arc<SchedulerState>,
    pub app: AppHandle,
    pub pool: DbPool,
    pub engine: Arc<ExecutionEngine>,
}

/// Trigger scheduler subscription: poll due schedule/chain triggers, publish events.
pub struct TriggerSchedulerSubscription {
    pub scheduler: Arc<SchedulerState>,
    pub pool: DbPool,
}

/// Polling subscription: HTTP content-hash diffing for polling triggers.
pub struct PollingSubscription {
    pub scheduler: Arc<SchedulerState>,
    pub pool: DbPool,
    pub http: reqwest::Client,
}

/// Cleanup subscription: delete old processed events periodically.
pub struct CleanupSubscription {
    pub pool: DbPool,
}

/// Credential rotation subscription: evaluate due policies and detect anomalies.
pub struct RotationSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
}

/// Composite trigger subscription: evaluate composite conditions against event stream.
pub struct CompositeSubscription {
    pub pool: DbPool,
    pub composite_state: crate::engine::composite::CompositeState,
}

/// Auto-rollback subscription: periodically checks personas with auto-rollback
/// enabled and reverts to the previous prompt version when error rate exceeds 2x.
pub struct AutoRollbackSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
    /// Engine handle, used only to acquire the `healing_personas` slot so a
    /// rollback's prompt write can't race a concurrent AI-healing prompt write.
    pub engine: Arc<ExecutionEngine>,
}

/// OAuth token refresh subscription: proactively refresh tokens before expiry.
pub struct OAuthRefreshSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
}

/// Daily credential healthcheck subscription: probes every stored credential
/// in-process once per 24h and persists the result into credential metadata.
///
/// Replaces the old per-Vault-visit frontend auto-test, which fired ~24
/// concurrent *privileged* `healthcheck_credential` IPC calls and raced the
/// `x-ipc-token` injection (`ipc_auth.rs`) — the rejected calls surfaced as
/// false "degraded" cards while the stored keys stayed valid. Running the sweep
/// here never crosses the IPC auth boundary. The 24h gate + startup catch-up
/// live in `healthcheck::daily_healthcheck_tick`.
pub struct CredentialHealthcheckSubscription {
    pub pool: DbPool,
}

/// Periodic MCP gateway-member healthcheck subscription: probes every enabled
/// member of every MCP gateway and persists per-member status (ok / failed /
/// last-checked) into the member credential's metadata ring buffer.
///
/// Closes the "dead gateway member is invisible" gap: without this a member
/// that stops responding just silently drops its tools from `list_tools`
/// (`mcp_tools` gateway fan-out), with no status anywhere. The tick skips
/// entirely when no MCP gateways exist, so this is free for the common case.
pub struct McpHealthcheckSubscription {
    pub pool: DbPool,
}

/// Periodic sweep for zombie executions stuck in 'running' state.
pub struct ZombieExecutionSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
}

/// Periodic sweep that reverts `auto_fix_pending` healing issues older than
/// [`crate::db::repos::execution::healing::AUTO_FIX_PENDING_TTL_MINUTES`]
/// back to `open`. Without this, an app crash or no-further-failures
/// scenario between `mark_auto_fix_pending` and the retry firing would
/// leave issues stuck on "pending" forever — the dashboard would lie
/// about healing progress.
pub struct HealingTtlSubscription {
    pub pool: DbPool,
}

/// Performance digest subscription: periodically generates and delivers
/// a performance digest summarizing agent success rates, cost trends,
/// top failures, credential health, and anomalies.
pub struct DigestSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
}

/// Cloud webhook relay: polls cloud trigger firings and injects them into
/// the local event bus so 3rd-party webhooks reach the desktop app.
pub struct CloudWebhookRelaySubscription {
    pub cloud_client: Arc<tokio::sync::Mutex<Option<Arc<crate::cloud::client::CloudClient>>>>,
    pub pool: DbPool,
    pub app: AppHandle,
    pub state: Arc<tokio::sync::Mutex<crate::engine::cloud_webhook_relay::CloudWebhookRelayState>>,
}

/// Shared event relay: polls subscribed shared event feeds from the FastAPI
/// facade and injects them into the local event bus.
pub struct SharedEventRelaySubscription {
    pub cloud_client: Arc<tokio::sync::Mutex<Option<Arc<crate::cloud::client::CloudClient>>>>,
    pub pool: DbPool,
    pub app: AppHandle,
    pub state: Arc<tokio::sync::Mutex<crate::engine::shared_event_relay::SharedEventRelayState>>,
}

/// Local-first shared event relay: delivers baked curated firings (connector
/// API-change events, seeded from `db/builtin_shared_events.rs`) to subscribers
/// with no cloud dependency. See [`crate::engine::shared_event_local_relay`].
pub struct SharedEventLocalRelaySubscription {
    pub pool: DbPool,
    pub app: AppHandle,
}

/// Runs due saved scrape configs on their cron schedule (embedded Pumper,
/// Phase 1b). See [`crate::engine::scraper::scraper_schedule_tick`].
#[cfg(feature = "scraper")]
pub struct ScraperScheduleSubscription {
    pub pool: DbPool,
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

#[async_trait::async_trait]
impl ReactiveSubscription for EventBusSubscription {
    fn name(&self) -> &'static str {
        "event_bus"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(2)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(10)
    }

    /// Push fan-out: the CDC drain task notifies on every persona_events
    /// INSERT, so dispatch latency is bounded by CDC delivery (~ms), not the
    /// 2s/10s poll. The poll cadence above is retained as the heartbeat.
    fn wake_signal(&self) -> Option<&'static tokio::sync::Notify> {
        Some(event_bus_wake_signal())
    }

    async fn tick(&self) {
        crate::engine::background::event_bus_tick(
            &self.scheduler,
            &self.app,
            &self.pool,
            &self.engine,
        )
        .await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for TriggerSchedulerSubscription {
    fn name(&self) -> &'static str {
        "trigger_scheduler"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(5)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(30)
    }

    async fn tick(&self) {
        let scheduler = self.scheduler.clone();
        let pool = self.pool.clone();
        run_blocking_tick(move || {
            crate::engine::background::trigger_scheduler_tick(&scheduler, &pool)
        })
        .await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for PollingSubscription {
    fn name(&self) -> &'static str {
        "polling"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(10)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(60)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn tick(&self) {
        crate::engine::polling::poll_due_triggers(&self.pool, &self.scheduler, &self.http).await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for CleanupSubscription {
    fn name(&self) -> &'static str {
        "cleanup"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(3600)
    }

    async fn tick(&self) {
        let pool = self.pool.clone();
        run_blocking_tick(move || crate::engine::background::cleanup_tick(&pool)).await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for RotationSubscription {
    fn name(&self) -> &'static str {
        "rotation"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(60)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(30)
    }

    async fn tick(&self) {
        crate::engine::rotation::evaluate_due_rotations(&self.pool, &self.app).await;
        crate::engine::rotation::evaluate_credential_events(&self.pool).await;
        crate::engine::rotation::detect_anomalies(&self.pool, &self.app).await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for CompositeSubscription {
    fn name(&self) -> &'static str {
        "composite"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(2)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(15)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(3)
    }

    async fn tick(&self) {
        let pool = self.pool.clone();
        let composite_state = self.composite_state.clone();
        run_blocking_tick(move || {
            crate::engine::composite::composite_tick(&pool, &composite_state)
        })
        .await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for AutoRollbackSubscription {
    fn name(&self) -> &'static str {
        "auto_rollback"
    }

    fn interval(&self) -> Duration {
        // Check every 5 minutes -- auto-rollback doesn't need to be instant
        Duration::from_secs(300)
    }

    fn initial_delay(&self) -> Duration {
        // Wait 60 seconds after startup before first check
        Duration::from_secs(60)
    }

    async fn tick(&self) {
        let pool = self.pool.clone();
        let app = self.app.clone();
        let engine = self.engine.clone();
        run_blocking_tick(move || {
            crate::engine::auto_rollback::auto_rollback_tick(&pool, &app, &engine)
        })
        .await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for OAuthRefreshSubscription {
    fn name(&self) -> &'static str {
        "oauth_refresh"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(300) // 5 minutes
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(10) // Startup sweep handles immediate refresh; first tick follows shortly
    }

    async fn tick(&self) {
        crate::engine::oauth_refresh::oauth_refresh_tick(&self.pool, Some(&self.app)).await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for CredentialHealthcheckSubscription {
    fn name(&self) -> &'static str {
        "credential_healthcheck"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(600) // 10 min — the 24h gate inside the tick is the real cadence
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(1800) // 30 min when idle
    }

    fn initial_delay(&self) -> Duration {
        // First tick ~60s after launch acts as the startup catch-up: the 24h
        // gate runs the sweep if it's been ≥24h (or never) since the last one.
        Duration::from_secs(60)
    }

    async fn tick(&self) {
        crate::engine::healthcheck::daily_healthcheck_tick(&self.pool).await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for McpHealthcheckSubscription {
    fn name(&self) -> &'static str {
        "mcp_healthcheck"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(900) // 15 min — member health can change between runs
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(1800) // 30 min when idle
    }

    fn initial_delay(&self) -> Duration {
        // Let the app + credential subsystem settle before the first sweep.
        Duration::from_secs(90)
    }

    async fn tick(&self) {
        crate::engine::mcp_tools::mcp_gateway_healthcheck_tick(&self.pool).await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for ZombieExecutionSubscription {
    fn name(&self) -> &'static str {
        "zombie_execution_sweep"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(300) // 5 minutes
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(60) // Let the app fully start
    }

    async fn tick(&self) {
        let pool = self.pool.clone();
        let app = self.app.clone();
        run_blocking_tick(move || {
            crate::engine::background::zombie_execution_tick(&pool, &app);
            crate::engine::background::silent_execution_tick(&pool, &app);
        })
        .await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for HealingTtlSubscription {
    fn name(&self) -> &'static str {
        "healing_ttl_sweep"
    }

    fn interval(&self) -> Duration {
        // The TTL is 10 minutes; sweeping every 2 minutes bounds the
        // worst-case "pending" overshoot at TTL + 2m, which is well below
        // a user's "is this stuck?" threshold without burning DB cycles.
        Duration::from_secs(120)
    }

    fn idle_interval(&self) -> Duration {
        // When the app is idle, slowing the sweep is fine — no new
        // mark_auto_fix_pending calls are happening, so any stale rows
        // are already past the cliff and just need eventual cleanup.
        Duration::from_secs(600)
    }

    fn initial_delay(&self) -> Duration {
        // Let app startup settle before the first sweep.
        Duration::from_secs(30)
    }

    async fn tick(&self) {
        let pool = self.pool.clone();
        run_blocking_tick(move || {
            let _ = crate::db::repos::execution::healing::revert_all_stale_auto_fix_pending(
                &pool,
                crate::db::repos::execution::healing::AUTO_FIX_PENDING_TTL_MINUTES,
            );
        })
        .await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for DigestSubscription {
    fn name(&self) -> &'static str {
        "performance_digest"
    }

    fn interval(&self) -> Duration {
        // Check every 30 minutes whether a digest is due
        Duration::from_secs(1800)
    }

    fn initial_delay(&self) -> Duration {
        // Wait 2 minutes after startup before first check
        Duration::from_secs(120)
    }

    async fn tick(&self) {
        let pool = self.pool.clone();
        let app = self.app.clone();
        run_blocking_tick(move || crate::engine::digest::digest_tick(&pool, &app)).await;
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for CloudWebhookRelaySubscription {
    fn name(&self) -> &'static str {
        "cloud_webhook_relay"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(15)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(60)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn tick(&self) {
        let client_guard = self.cloud_client.lock().await;
        if let Some(ref client) = *client_guard {
            let client = client.clone();
            drop(client_guard); // Release lock before async work
            crate::engine::cloud_webhook_relay::cloud_webhook_relay_tick(
                &client,
                &self.pool,
                &self.app,
                &self.state,
            )
            .await;
        }
        // Not connected — silently skip
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for SharedEventRelaySubscription {
    fn name(&self) -> &'static str {
        "shared_event_relay"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(300) // 5 minutes
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(600) // 10 minutes when idle
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(15) // Let cloud client connect first
    }

    async fn tick(&self) {
        let client_guard = self.cloud_client.lock().await;
        if let Some(ref client) = *client_guard {
            let client = client.clone();
            drop(client_guard);
            crate::engine::shared_event_relay::shared_event_relay_tick(
                &client,
                &self.pool,
                &self.app,
                &self.state,
            )
            .await;
        }
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for SharedEventLocalRelaySubscription {
    fn name(&self) -> &'static str {
        "shared_event_local_relay"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(300) // 5 minutes
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(600) // 10 minutes when idle
    }

    fn initial_delay(&self) -> Duration {
        // Deliver soon after boot so an upgrade's fresh firings reach existing
        // subscribers promptly (no cloud connect to wait on).
        Duration::from_secs(20)
    }

    async fn tick(&self) {
        crate::engine::shared_event_local_relay::shared_event_local_relay_tick(
            &self.pool, &self.app,
        )
        .await;
    }
}

#[cfg(feature = "scraper")]
#[async_trait::async_trait]
impl ReactiveSubscription for ScraperScheduleSubscription {
    fn name(&self) -> &'static str {
        "scraper_schedule"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(60)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(30)
    }

    async fn tick(&self) {
        crate::engine::scraper::scraper_schedule_tick(&self.pool).await;
    }
}
