//! Unified reactive subscription model.
//!
//! All background reactivity loops follow the same abstract pattern:
//!   1. **Source** -- poll an external condition (DB rows, HTTP endpoints, etc.)
//!   2. **Predicate** -- evaluate whether the condition warrants action
//!   3. **Action** -- dispatch the side-effect (publish event, start execution, etc.)
//!
//! The [`ReactiveSubscription`] trait captures this pattern. Each subscription
//! declares its own poll interval, and the unified [`run_subscriptions`] loop
//! schedules all subscriptions through a single `tokio::select!` loop.
//!
//! Adding a new reactivity source (e.g., file-watch, WebSocket) only requires
//! implementing the trait -- no new `tokio::spawn` block needed.

use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::FutureExt;
use tauri::{AppHandle, Emitter, Manager};

use super::event_registry::event_name;
use crate::db::DbPool;
use crate::engine::background::{SchedulerState, SubscriptionCrashEvent};
use crate::engine::ExecutionEngine;

// ---------------------------------------------------------------------------
// Trait
// ---------------------------------------------------------------------------

/// A reactive subscription that the unified scheduler loop will poll.
///
/// Each implementor defines:
/// - `name()` -- human-readable label for logs
/// - `interval()` -- how often to poll when active
/// - `idle_interval()` -- how often to poll when idle (default: same as interval)
/// - `initial_delay()` -- optional startup delay (default 0)
/// - `tick()` -- the combined source -> predicate -> action cycle
#[async_trait::async_trait]
pub trait ReactiveSubscription: Send + Sync + 'static {
    /// Human-readable name for logging.
    fn name(&self) -> &'static str;

    /// How often this subscription should be polled when the app is active.
    fn interval(&self) -> Duration;

    /// How often to poll when idle (no running executions, app backgrounded).
    /// Subscriptions that don't benefit from reduced cadence can leave the default.
    fn idle_interval(&self) -> Duration {
        self.interval()
    }

    /// Optional delay before the first poll (e.g., let the app fully start).
    fn initial_delay(&self) -> Duration {
        Duration::ZERO
    }

    /// Execute one poll cycle: source -> predicate -> action.
    ///
    /// Errors are logged internally; the loop continues regardless.
    async fn tick(&self);

    /// Whether this subscription is an engine *singleton* that must run only
    /// on the instance holding engine leadership (multi-driver orchestration,
    /// ADR 2026-05-26 — `engine/leadership.rs`). Default `true`: every loop in
    /// this registry is a singleton (scheduler, polling, OAuth refresh, relays,
    /// event bus) and double-running it across instances on one shared DB is a
    /// bug. A genuinely per-instance subscription overrides to `false`.
    fn requires_leadership(&self) -> bool {
        true
    }
}

/// Run a blocking, DB-heavy tick body on the blocking thread pool.
///
/// rusqlite is synchronous: calling repo functions directly inside an
/// `async fn tick()` occupies a tokio worker thread for the whole query
/// (up to `POOL_ACQUIRE_TIMEOUT` under pool contention). Offloading to
/// `spawn_blocking` keeps async workers free for IPC and other tasks.
///
/// If the blocking closure panics, the panic is re-propagated onto the
/// tick future so `run_single`'s `catch_unwind` still records the crash
/// and applies backoff — preserving the existing crash-surfacing behavior.
async fn run_blocking_tick<F>(f: F)
where
    F: FnOnce() + Send + 'static,
{
    if let Err(join_err) = tokio::task::spawn_blocking(f).await {
        if join_err.is_panic() {
            std::panic::resume_unwind(join_err.into_panic());
        }
    }
}

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

/// File watcher subscription: monitor file system for changes.
#[cfg(feature = "desktop")]
pub struct FileWatcherSubscription {
    pub pool: DbPool,
    pub state: Arc<tokio::sync::Mutex<super::file_watcher::FileWatcherState>>,
    pub tx: tokio::sync::mpsc::Sender<super::file_watcher::RawFsEvent>,
    pub rx: Arc<tokio::sync::Mutex<tokio::sync::mpsc::Receiver<super::file_watcher::RawFsEvent>>>,
    pub dropped: Arc<std::sync::atomic::AtomicU64>,
    /// Ambient fusion handle. Each tick pushes coalesced+debounced
    /// file events through `push_file_change` so they appear in the
    /// rolling window AND mirror to the cross-process `ambient_signal`
    /// SQL table for the daemon-side bridge (Phase 3 c v3).
    pub ambient_ctx: super::ambient_context::AmbientContextHandle,
}

/// Clipboard monitor subscription: detect clipboard content changes.
/// Also runs error detection + KB search for the clipboard watcher feature.
#[cfg(feature = "desktop")]
pub struct ClipboardSubscription {
    pub pool: DbPool,
    pub state: Arc<tokio::sync::Mutex<super::clipboard_monitor::ClipboardState>>,
    pub ambient_ctx: super::ambient_context::AmbientContextHandle,
    /// App handle for sending OS notifications and Tauri events.
    pub app: AppHandle,
    /// User database pool (for KB lookups).
    pub user_db: crate::db::UserDbPool,
    /// Embedding manager for vectorising error queries.
    #[cfg(feature = "ml")]
    pub embedding_manager: Option<Arc<crate::engine::embedder::EmbeddingManager>>,
    /// Vector store for KB similarity search.
    #[cfg(feature = "ml")]
    pub vector_store: Option<Arc<super::vector_store::SqliteVectorStore>>,
    /// Cooldown: last time a clipboard error notification was sent.
    pub last_notification: Arc<tokio::sync::Mutex<Option<std::time::Instant>>>,
    /// Whether the clipboard watcher is enabled (toggled from tray).
    pub watcher_enabled: Arc<std::sync::atomic::AtomicBool>,
}

/// App focus subscription: detect foreground application changes.
#[cfg(feature = "desktop")]
pub struct AppFocusSubscription {
    pub pool: DbPool,
    pub state: Arc<tokio::sync::Mutex<super::app_focus::AppFocusState>>,
    pub ambient_ctx: super::ambient_context::AmbientContextHandle,
}

/// Ambient context fusion subscription: aggregates desktop signals into a rolling context window.
#[cfg(feature = "desktop")]
pub struct AmbientContextSubscription {
    pub ctx: super::ambient_context::AmbientContextHandle,
}

/// Ambient signal SQL projection eviction subscription (Phase 3 c v3).
///
/// The cross-process bridge table (`ambient_signal`) is a rolling
/// buffer — without periodic eviction it grows unbounded. This
/// subscription runs every 30 minutes and deletes rows older than
/// the TTL cutoff (default 24h). Eviction is the privacy bound:
/// rows are POST-redaction by contract, but the durability envelope
/// shouldn't grow indefinitely.
///
/// Separate from `AmbientContextSubscription` because the in-memory
/// fusion ticks at 5s (signal-driven) and the SQL eviction needs
/// to run on a much slower cadence to avoid hammering the DB.
#[cfg(feature = "desktop")]
pub struct AmbientSignalEvictionSubscription {
    pub pool: DbPool,
}

/// Context rule engine subscription: evaluates persona-defined rules against
/// the real-time context stream and triggers actions on matches.
#[cfg(feature = "desktop")]
pub struct ContextRuleSubscription {
    pub rule_engine: super::context_rules::ContextRuleEngineHandle,
    pub stream_rx: Arc<tokio::sync::Mutex<super::ambient_context::ContextStreamReceiver>>,
    pub pool: DbPool,
    pub app: AppHandle,
}

/// Composite trigger subscription: evaluate composite conditions against event stream.
pub struct CompositeSubscription {
    pub pool: DbPool,
    pub composite_state: super::composite::CompositeState,
}

/// Auto-rollback subscription: periodically checks personas with auto-rollback
/// enabled and reverts to the previous prompt version when error rate exceeds 2x.
pub struct AutoRollbackSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
}

/// OAuth token refresh subscription: proactively refresh tokens before expiry.
pub struct OAuthRefreshSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
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
    pub state: Arc<tokio::sync::Mutex<super::cloud_webhook_relay::CloudWebhookRelayState>>,
}

/// Shared event relay: polls subscribed shared event feeds from the FastAPI
/// facade and injects them into the local event bus.
pub struct SharedEventRelaySubscription {
    pub cloud_client: Arc<tokio::sync::Mutex<Option<Arc<crate::cloud::client::CloudClient>>>>,
    pub pool: DbPool,
    pub app: AppHandle,
    pub state: Arc<tokio::sync::Mutex<super::shared_event_relay::SharedEventRelayState>>,
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

    async fn tick(&self) {
        super::background::event_bus_tick(&self.scheduler, &self.app, &self.pool, &self.engine)
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
            super::background::trigger_scheduler_tick(&scheduler, &pool)
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
        super::polling::poll_due_triggers(&self.pool, &self.scheduler, &self.http).await;
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
        run_blocking_tick(move || super::background::cleanup_tick(&pool)).await;
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
        super::rotation::evaluate_due_rotations(&self.pool, &self.app).await;
        super::rotation::evaluate_credential_events(&self.pool).await;
        super::rotation::detect_anomalies(&self.pool, &self.app).await;
    }
}

#[cfg(feature = "desktop")]
#[async_trait::async_trait]
impl ReactiveSubscription for FileWatcherSubscription {
    fn name(&self) -> &'static str {
        "file_watcher"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(2)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(5)
    }

    async fn tick(&self) {
        super::file_watcher::file_watcher_tick(
            &self.pool,
            &self.state,
            &self.tx,
            &self.rx,
            &self.dropped,
            Some(&self.ambient_ctx),
        )
        .await;
    }
}

#[cfg(feature = "desktop")]
#[async_trait::async_trait]
impl ReactiveSubscription for ClipboardSubscription {
    fn name(&self) -> &'static str {
        "clipboard"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(3)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(8)
    }

    async fn tick(&self) {
        // Capture clipboard state before tick to detect changes
        let hash_before = {
            let s = self.state.lock().await;
            s.last_hash()
        };

        // Phase 3: clipboard_tick pushes the redacted content directly
        // through the ambient handle, so the rolling window sees the
        // actual paste (redacted at capture) instead of the prior
        // length-only `("text", 0)` placeholder. The fusion's per-source
        // gate is the privacy contract — capture is a no-op when off.
        super::clipboard_monitor::clipboard_tick(
            &self.pool,
            &self.state,
            Some(&self.ambient_ctx),
        )
        .await;

        // Hash diff still drives the error-detection / KB search side
        // path (which is independent of the ambient pipeline).
        let hash_after = {
            let s = self.state.lock().await;
            s.last_hash()
        };
        if hash_before != hash_after
            && self
                .watcher_enabled
                .load(std::sync::atomic::Ordering::Relaxed)
        {
            self.run_error_detection().await;
        }
    }
}

#[cfg(feature = "desktop")]
impl ClipboardSubscription {
    /// Read the current clipboard text and run error detection + KB search.
    /// Sends an OS notification if a KB match is found, respecting a 30-second cooldown.
    async fn run_error_detection(&self) {
        use std::time::Instant;

        // Cooldown check: 30 seconds between notifications
        {
            let last = self.last_notification.lock().await;
            if let Some(t) = *last {
                if t.elapsed().as_secs() < 30 {
                    return;
                }
            }
        }

        // Read clipboard text (separate read from the monitor — we need the actual content)
        let clip_text = tokio::task::spawn_blocking(|| {
            arboard::Clipboard::new()
                .ok()
                .and_then(|mut cb| cb.get_text().ok())
                .filter(|t| !t.is_empty())
        })
        .await
        .unwrap_or(None);

        let text = match clip_text {
            Some(t) => t,
            None => return,
        };

        // Run error detection
        let detection = match super::clipboard_error_detector::detect_error_pattern(&text) {
            Some(d) if d.confidence >= 0.6 => d,
            _ => return,
        };

        tracing::debug!(
            error_type = %detection.error_type,
            confidence = detection.confidence,
            summary = %detection.summary,
            "Clipboard error detected"
        );

        // Search KB for the error summary (requires ML feature)
        #[cfg(feature = "ml")]
        {
            let matches = match self.search_kb(&detection.summary) {
                Ok(m) => m,
                Err(e) => {
                    tracing::debug!("KB search for clipboard error failed: {e}");
                    return;
                }
            };

            // Filter to similarity > 0.5 threshold
            let good_matches: Vec<_> = matches.into_iter().filter(|m| m.similarity > 0.5).collect();

            if good_matches.is_empty() {
                return;
            }

            // Send OS notification with top match
            let top = &good_matches[0];
            let body = format!(
                "KB \"{}\": {}",
                top.kb_name,
                top.chunk_text.chars().take(120).collect::<String>()
            );
            crate::notifications::send(&self.app, "Possible fix found", &body);

            // Emit Tauri event with full detection + matches payload
            {
                use tauri::Emitter;
                let payload = serde_json::json!({
                    "detection": detection,
                    "matches": good_matches,
                });
                let _ = self.app.emit(event_name::CLIPBOARD_ERROR_DETECTED, payload);
            }

            // Update cooldown timestamp
            {
                let mut last = self.last_notification.lock().await;
                *last = Some(Instant::now());
            }

            tracing::info!(
                error_type = %detection.error_type,
                kb_matches = good_matches.len(),
                "Clipboard watcher: notified user of KB match for detected error"
            );
        }
    }

    /// Search all KBs for the given query. Wraps the command module's logic
    /// with direct field access to avoid needing the full AppState.
    #[cfg(feature = "ml")]
    fn search_kb(
        &self,
        query: &str,
    ) -> Result<Vec<crate::commands::execution::clipboard_intel::KbMatch>, crate::error::AppError>
    {
        let embedding_manager = self.embedding_manager.as_ref().ok_or_else(|| {
            crate::error::AppError::Internal("Embedding manager not available".into())
        })?;
        let vector_store = self
            .vector_store
            .as_ref()
            .ok_or_else(|| crate::error::AppError::Internal("Vector store not available".into()))?;

        let query_text = query.to_string();
        let em = embedding_manager.clone();
        let query_vec = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(em.embed_query(&query_text))
        })?;

        let user_conn = self.user_db.get()?;

        // List all ready KBs
        let mut kb_stmt = user_conn.prepare(
            "SELECT id, name FROM knowledge_bases WHERE status = 'ready' ORDER BY created_at DESC",
        )?;
        let kb_list: Vec<(String, String)> = kb_stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut all_matches = Vec::new();
        let limit = 3usize;

        for (kb_id, kb_name) in &kb_list {
            let results = match vector_store.search(kb_id, &query_vec, limit) {
                Ok(r) => r,
                Err(_) => continue,
            };
            for (chunk_id, distance) in results {
                let similarity = 1.0 / (1.0 + distance);
                let (chunk_text, source_file) = user_conn
                    .prepare(
                        "SELECT c.content, d.source_path
                         FROM kb_chunks c
                         LEFT JOIN kb_documents d ON d.id = c.document_id
                         WHERE c.id = ?1",
                    )
                    .and_then(|mut stmt| {
                        stmt.query_row(rusqlite::params![chunk_id], |row| {
                            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
                        })
                    })
                    .unwrap_or_default();

                if chunk_text.is_empty() {
                    continue;
                }

                all_matches.push(crate::commands::execution::clipboard_intel::KbMatch {
                    kb_name: kb_name.clone(),
                    chunk_text,
                    similarity,
                    source_file,
                });
            }
        }

        all_matches.sort_by(|a, b| {
            b.similarity
                .partial_cmp(&a.similarity)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        all_matches.truncate(limit);
        Ok(all_matches)
    }
}

#[cfg(feature = "desktop")]
#[async_trait::async_trait]
impl ReactiveSubscription for AppFocusSubscription {
    fn name(&self) -> &'static str {
        "app_focus"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(3)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(8)
    }

    async fn tick(&self) {
        // Capture app state before tick to detect changes
        let (app_before, title_before) = {
            let s = self.state.lock().await;
            (
                s.last_app_name().map(|s| s.to_string()),
                s.last_window_title().map(|s| s.to_string()),
            )
        };

        super::app_focus::app_focus_tick(&self.pool, &self.state).await;

        // If app changed, push a signal to ambient context
        let (app_after, title_after) = {
            let s = self.state.lock().await;
            (
                s.last_app_name().map(|s| s.to_string()),
                s.last_window_title().map(|s| s.to_string()),
            )
        };
        if app_before != app_after || title_before != title_after {
            if let (Some(ref app), Some(ref title)) = (&app_after, &title_after) {
                let captured = {
                    let mut ctx = self.ambient_ctx.lock().await;
                    ctx.push_app_focus(app, title)
                };

                // Phase 3 c v3: mirror app-focus capture into the
                // cross-process SQL projection so daemon-fired
                // executions can see what window the user was on.
                // Same fire-and-forget shape as clipboard_monitor.
                if let Some(sig) = captured {
                    if let Err(e) = crate::engine::ambient_signal_repo::insert_signal(
                        &self.pool,
                        &sig.id,
                        &sig.source,
                        &sig.summary,
                        sig.captured_at,
                        sig.redacted_content.as_deref(),
                    ) {
                        tracing::warn!(
                            error = %e,
                            signal_id = %sig.id,
                            "ambient_signal: app_focus SQL projection failed"
                        );
                    }
                }
            }
        }
    }
}

#[cfg(feature = "desktop")]
#[async_trait::async_trait]
impl ReactiveSubscription for AmbientContextSubscription {
    fn name(&self) -> &'static str {
        "ambient_context"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(5)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(30)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn tick(&self) {
        super::ambient_context::ambient_context_tick(&self.ctx).await;
    }
}

/// Default TTL for the SQL ambient_signal projection — 24 hours.
/// Bounded by privacy posture (Phase 3 v1 redaction is the gate;
/// time is the bound) and by typical "what was I doing recently"
/// horizon a daemon-fired persona might care about.
#[cfg(feature = "desktop")]
const AMBIENT_SIGNAL_TTL_SECS: u64 = 24 * 60 * 60;

#[cfg(feature = "desktop")]
#[async_trait::async_trait]
impl ReactiveSubscription for AmbientSignalEvictionSubscription {
    fn name(&self) -> &'static str {
        "ambient_signal_eviction"
    }

    fn interval(&self) -> Duration {
        // 30 minutes — eviction cadence doesn't need to be tight;
        // even a brief overshoot of the TTL on a row is harmless
        // (rows are post-redaction).
        Duration::from_secs(30 * 60)
    }

    fn idle_interval(&self) -> Duration {
        // Same cadence on idle — eviction is a maintenance task,
        // not user-driven.
        Duration::from_secs(30 * 60)
    }

    fn initial_delay(&self) -> Duration {
        // Wait 60s after startup so the migration + initial pool
        // setup are settled before the first DELETE fires.
        Duration::from_secs(60)
    }

    async fn tick(&self) {
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let cutoff = now_secs.saturating_sub(AMBIENT_SIGNAL_TTL_SECS);
        match super::ambient_signal_repo::evict_older_than(&self.pool, cutoff) {
            Ok(0) => {} // common case — quiet
            Ok(n) => tracing::debug!(
                rows_deleted = n,
                ttl_secs = AMBIENT_SIGNAL_TTL_SECS,
                "ambient_signal: TTL eviction"
            ),
            Err(e) => tracing::warn!(
                error = %e,
                "ambient_signal: TTL eviction failed"
            ),
        }

        // Phase 5 v1: same 24h cutoff also evicts the CLI session
        // read audit table. Sibling concern, sibling cadence — keeps
        // both transparency footprints bounded under one tick.
        match super::cli_session_audit_repo::evict_older_than(&self.pool, cutoff) {
            Ok(0) => {}
            Ok(n) => tracing::debug!(
                rows_deleted = n,
                ttl_secs = AMBIENT_SIGNAL_TTL_SECS,
                "cli_session_audit: TTL eviction"
            ),
            Err(e) => tracing::warn!(
                error = %e,
                "cli_session_audit: TTL eviction failed"
            ),
        }
    }
}

#[cfg(feature = "desktop")]
#[async_trait::async_trait]
impl ReactiveSubscription for ContextRuleSubscription {
    fn name(&self) -> &'static str {
        "context_rules"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(2)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(10)
    }

    fn initial_delay(&self) -> Duration {
        Duration::from_secs(12) // Start after ambient context subscription
    }

    async fn tick(&self) {
        super::context_rules::context_rule_tick(
            &self.rule_engine,
            &self.stream_rx,
            &self.pool,
            &self.app,
        )
        .await;
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
            super::composite::composite_tick(&pool, &composite_state)
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
        run_blocking_tick(move || {
            super::auto_rollback::auto_rollback_tick(&pool, &app)
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
        super::oauth_refresh::oauth_refresh_tick(&self.pool, Some(&self.app)).await;
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
            super::background::zombie_execution_tick(&pool, &app);
            super::background::silent_execution_tick(&pool, &app);
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
        run_blocking_tick(move || super::digest::digest_tick(&pool, &app)).await;
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
            super::cloud_webhook_relay::cloud_webhook_relay_tick(
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
            super::shared_event_relay::shared_event_relay_tick(
                &client,
                &self.pool,
                &self.app,
                &self.state,
            )
            .await;
        }
    }
}

// ---------------------------------------------------------------------------
// Unified scheduler loop
// ---------------------------------------------------------------------------

/// Maximum consecutive panics before applying backoff to the tick interval.
const PANIC_BACKOFF_THRESHOLD: u32 = 3;
/// Multiplier applied to the interval after consecutive panics exceed the threshold.
const PANIC_BACKOFF_MULTIPLIER: u32 = 2;
/// Cap on the backoff multiplier to prevent intervals from growing unbounded.
const PANIC_BACKOFF_MAX: u32 = 16;
/// Fraction of the interval that triggers a slow-tick warning (80%).
const SLOW_TICK_THRESHOLD_NUM: u64 = 4;
const SLOW_TICK_THRESHOLD_DEN: u64 = 5;

/// Run a single reactive subscription in its own task, respecting initial delay,
/// interval, and the scheduler's running flag.
///
/// Adaptively switches between `interval()` and `idle_interval()` based on
/// the scheduler's active flag, reducing CPU/IO when the system is idle.
///
/// Applies exponential backoff when a subscription repeatedly panics, similar
/// to [`PeriodicTask`](super::p2p::periodic::PeriodicTask).
///
/// Registers itself as alive/dead in `SchedulerState` and emits a
/// `subscription-crashed` Tauri event on every panic so the frontend can
/// surface dead subscriptions immediately.
async fn run_single(
    sub: Box<dyn ReactiveSubscription>,
    scheduler: Arc<SchedulerState>,
    app: AppHandle,
) {
    let name = sub.name();
    let active_interval = sub.interval();
    let idle_interval = sub.idle_interval();
    let has_idle_mode = active_interval != idle_interval;

    // Register this subscription as alive before any delay
    scheduler.mark_subscription_alive(name, active_interval.as_millis() as u64);

    let delay = sub.initial_delay();
    if !delay.is_zero() {
        tracing::debug!(subscription = name, delay_secs = ?delay.as_secs(), "Delaying initial poll");
        tokio::time::sleep(delay).await;
    }

    let mut was_active = true;
    let mut consecutive_panics: u32 = 0;
    let mut interval = tokio::time::interval(active_interval);
    loop {
        interval.tick().await;
        if !scheduler.is_running() {
            break;
        }

        // Engine-leadership gate (multi-driver orchestration, ADR 2026-05-26):
        // a leader-only subscription ticks only on the instance that currently
        // holds engine leadership, so multiple instances on one shared DB never
        // double-run a singleton loop (double scheduler fires, double OAuth
        // rotation, double relay consumption). If AppState isn't available
        // (e.g. unit tests), behave as leader — no regression from today's
        // single-instance behavior. A follower just idles + re-checks each
        // interval, taking over within the lease's stale window if the leader dies.
        if sub.requires_leadership()
            && !app
                .try_state::<std::sync::Arc<crate::AppState>>()
                .map(|s| s.leadership.is_leader())
                .unwrap_or(true)
        {
            continue;
        }

        // Switch interval when activity level changes
        if has_idle_mode {
            let is_active = scheduler.is_active();
            if is_active != was_active {
                let new_dur = if is_active {
                    active_interval
                } else {
                    idle_interval
                };
                interval = tokio::time::interval(new_dur);
                interval.tick().await; // consume the immediate first tick
                was_active = is_active;
                tracing::debug!(
                    subscription = name,
                    mode = if is_active { "active" } else { "idle" },
                    interval_secs = new_dur.as_secs(),
                    "Subscription interval adjusted"
                );
            }
        }

        let tick_start = Instant::now();

        // Execute the tick within a tracing span for structured observability.
        let tick_future = {
            let _span = tracing::debug_span!("subscription_tick", subscription = name).entered();
            // Panic boundary: catch any panic inside tick() so the subscription
            // loop survives and the crash is surfaced via logs + metrics.
            AssertUnwindSafe(sub.tick()).catch_unwind()
        };
        let tick_result = tick_future.await;
        let elapsed = tick_start.elapsed();

        if let Err(panic_payload) = tick_result {
            let msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                s.clone()
            } else {
                "unknown panic".to_string()
            };
            consecutive_panics = consecutive_panics.saturating_add(1);
            tracing::error!(
                subscription = name,
                panic_message = %msg,
                consecutive_panics,
                "Subscription tick panicked — loop will continue on next interval"
            );
            scheduler.record_subscription_crash(name);

            // Emit a Tauri event so the frontend can surface the crash immediately
            let _ = app.emit(
                event_name::SUBSCRIPTION_CRASHED,
                SubscriptionCrashEvent {
                    name: name.to_string(),
                    panic_message: msg,
                    consecutive_panics,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                },
            );

            // Apply backoff when panics exceed the threshold, to avoid
            // tight-looping on a persistently broken subscription.
            if consecutive_panics >= PANIC_BACKOFF_THRESHOLD {
                let multiplier = PANIC_BACKOFF_MULTIPLIER
                    .saturating_pow(consecutive_panics - PANIC_BACKOFF_THRESHOLD + 1)
                    .min(PANIC_BACKOFF_MAX);
                let effective = if has_idle_mode && !was_active {
                    idle_interval
                } else {
                    active_interval
                };
                let backoff = effective * multiplier;
                tracing::warn!(
                    subscription = name,
                    consecutive_panics,
                    backoff_secs = backoff.as_secs(),
                    "Applying backoff after repeated panics"
                );
                tokio::time::sleep(backoff).await;
            }
            continue;
        }

        // Successful tick — reset the panic counter
        if consecutive_panics > 0 {
            tracing::info!(
                subscription = name,
                previous_panics = consecutive_panics,
                "Subscription recovered after consecutive panics"
            );
            consecutive_panics = 0;
        }

        // Use the current effective interval for overrun / slow-tick detection
        let effective_interval = if has_idle_mode && !was_active {
            idle_interval
        } else {
            active_interval
        };
        scheduler.record_tick_latency(name, effective_interval, elapsed);

        let elapsed_ms = elapsed.as_millis() as u64;
        let interval_ms = effective_interval.as_millis() as u64;

        // Debug-level trace for every tick — available when tracing is turned up.
        tracing::debug!(
            subscription = name,
            elapsed_ms,
            interval_ms,
            "Tick completed"
        );

        if elapsed > effective_interval {
            tracing::warn!(
                subscription = name,
                elapsed_ms,
                interval_ms,
                "Tick overrun: subscription tick took longer than its configured interval"
            );
        } else {
            // Slow-tick early warning at 80% of interval
            let slow_threshold = interval_ms * SLOW_TICK_THRESHOLD_NUM / SLOW_TICK_THRESHOLD_DEN;
            if elapsed_ms > slow_threshold {
                tracing::warn!(
                    subscription = name,
                    elapsed_ms,
                    interval_ms,
                    threshold_ms = slow_threshold,
                    "Slow tick: approaching interval limit"
                );
            }
        }
    }
    scheduler.mark_subscription_dead(name);
    tracing::info!(subscription = name, "Subscription loop exited");
}

/// Spawn all reactive subscriptions as independent tokio tasks.
///
/// Each subscription gets its own task but the pattern is uniform: the caller
/// only needs to push a new `Box<dyn ReactiveSubscription>` to add a new
/// reactivity source -- no new `tokio::spawn` block required.
///
/// Returns the retained `JoinHandle`s so the caller can store them (preventing
/// silent task drops) and optionally await graceful shutdown.
pub fn spawn_subscriptions(
    subscriptions: Vec<Box<dyn ReactiveSubscription>>,
    scheduler: Arc<SchedulerState>,
    app: AppHandle,
) -> Vec<tokio::task::JoinHandle<()>> {
    let mut handles = Vec::with_capacity(subscriptions.len());
    for sub in subscriptions {
        let sched = scheduler.clone();
        let app_handle = app.clone();
        handles.push(tokio::spawn(run_single(sub, sched, app_handle)));
    }
    handles
}

// ---------------------------------------------------------------------------
// Autonomous goal advancement (default-OFF)
// ---------------------------------------------------------------------------

/// Keeps each goal-linked team's active goal moving **unattended** — turns a
/// stalled-but-unworked goal into a running `team_assignment` via
/// [`crate::engine::goal_advance::advance_goal`]. This is the "works for weeks"
/// layer on top of the manual/Athena initiator.
///
/// **Gated OFF by default** (`settings_keys::AUTONOMOUS_GOAL_ADVANCEMENT`): the
/// tick is a no-op until the user opts in, so nothing spends tokens
/// autonomously without consent. Guardrails when ON: one active assignment per
/// goal (enforced in `advance_goal`), a per-goal cooldown after any assignment
/// (so a failed run isn't retried in a tight loop; currently 2h, tuned up from
/// the 30m default for the day-long multi-team soak test), eligible-persona
/// check, and a hard per-tick cap so a large fleet ramps gradually.
pub struct GoalAdvanceSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
    pub engine: Arc<ExecutionEngine>,
}

/// Max goals advanced per tick — bounds the autonomous spend ramp.
const GOAL_ADVANCE_MAX_PER_TICK: usize = 3;

/// G1 — quota-aware backpressure for the autonomous-spend loops. Returns true
/// when the Claude account hit a session/usage/rate limit in the recent window,
/// i.e. we're inside a limit window. While active, the goal-advance and
/// assignment-retry ticks SKIP — so a burst doesn't keep slamming an exhausted
/// quota (the dominant failure mode in the soak: 94% of failures were session
/// limit). Cheap recency probe over recent failed executions; the self-heal
/// still retries the work once the window clears.
const QUOTA_COOLDOWN_LOOKBACK_MINUTES: i64 = 15;
fn quota_cooldown_active(pool: &DbPool) -> bool {
    let Ok(conn) = pool.get() else { return false };
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM persona_executions
             WHERE status = 'failed'
               -- datetime() normalizes the RFC3339 'T' separator: a raw string
               -- compare made EVERY same-day row count as recent ('T' > ' '),
               -- wedging the quota gate for the whole day after one limit hit.
               AND datetime(created_at) > datetime('now', ?1)
               AND (LOWER(COALESCE(output_data,'')) LIKE '%session limit%'
                    OR LOWER(COALESCE(output_data,'')) LIKE '%usage limit%'
                    OR LOWER(COALESCE(output_data,'')) LIKE '%hit your%limit%'
                    OR LOWER(COALESCE(error_message,'')) LIKE '%rate limit%'
                    OR LOWER(COALESCE(error_message,'')) LIKE '%429%')",
            rusqlite::params![format!("-{QUOTA_COOLDOWN_LOOKBACK_MINUTES} minutes")],
            |r| r.get(0),
        )
        .unwrap_or(0);
    n > 0
}

/// Goal-linked teams with an active, unworked goal and no recent assignment.
/// Returns `(team_id, goal_id)` pairs. The cooldown via `created_at` (2h for the
/// soak test, default 30m) prevents stampede + failure-retry loops.
fn find_goal_advance_candidates(pool: &DbPool) -> Result<Vec<(String, String)>, crate::error::AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT dp.team_id, g.id
         FROM dev_goals g
         JOIN dev_projects dp ON dp.id = g.project_id
         WHERE dp.team_id IS NOT NULL
           AND g.status NOT IN ('done', 'completed')
           AND g.progress < 100
           AND NOT EXISTS (
             SELECT 1 FROM team_assignments ta
             WHERE ta.goal_id = g.id
               AND (ta.status IN ('queued', 'running', 'awaiting_review')
                    -- Per-goal cooldown: tuned up 30m -> 2h for the day-long
                    -- multi-team soak test (2h cadence per team). Revert to
                    -- '-30 minutes' to restore the default advancement rate.
                    OR datetime(ta.created_at) > datetime('now', '-120 minutes'))
           )
         ORDER BY g.updated_at ASC",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

#[async_trait::async_trait]
impl ReactiveSubscription for GoalAdvanceSubscription {
    fn name(&self) -> &'static str {
        "goal_advance"
    }

    fn interval(&self) -> Duration {
        // Advancement is heavy (it spawns persona executions); 5 minutes is
        // plenty of cadence for an unattended loop.
        Duration::from_secs(300)
    }

    fn idle_interval(&self) -> Duration {
        Duration::from_secs(900)
    }

    fn initial_delay(&self) -> Duration {
        // Let the app settle before the first autonomous advance.
        Duration::from_secs(60)
    }

    async fn tick(&self) {
        // Default-OFF gate — opt-in only.
        let enabled = crate::db::repos::core::settings::get(
            &self.pool,
            crate::db::settings_keys::AUTONOMOUS_GOAL_ADVANCEMENT,
        )
        .ok()
        .flatten()
        .as_deref()
            == Some("true");
        if !enabled {
            return;
        }
        // G1: quota-aware backpressure — don't start NEW team work while the
        // account is inside a session/usage-limit window.
        if quota_cooldown_active(&self.pool) {
            tracing::info!("goal_advance: quota cooldown active — skipping tick");
            return;
        }

        // Candidate query is sync rusqlite — offload off the async worker.
        let pool = self.pool.clone();
        let candidates = match tokio::task::spawn_blocking(move || find_goal_advance_candidates(&pool))
            .await
        {
            Ok(Ok(c)) => c,
            Ok(Err(e)) => {
                tracing::warn!(error = %e, "goal_advance: candidate query failed");
                return;
            }
            Err(_) => return,
        };

        let mut started = 0usize;
        for (team_id, goal_id) in candidates.into_iter().take(GOAL_ADVANCE_MAX_PER_TICK) {
            match crate::engine::goal_advance::advance_goal(
                &self.pool,
                &self.app,
                self.engine.clone(),
                None, // llm_eval match strategy — embedding manager unused
                &team_id,
                &goal_id,
            )
            .await
            {
                Ok(crate::engine::goal_advance::AdvanceResult::Started(id)) => {
                    started += 1;
                    tracing::info!(team_id = %team_id, goal_id = %goal_id, assignment_id = %id, "goal_advance: started autonomous assignment");
                }
                Ok(crate::engine::goal_advance::AdvanceResult::AlreadyAdvancing) => {}
                Err(e) => {
                    tracing::warn!(team_id = %team_id, goal_id = %goal_id, error = %e, "goal_advance: advance failed");
                }
            }
        }
        if started > 0 {
            tracing::info!(count = started, "goal_advance: autonomous tick started {started} assignment(s)");
        }
    }
}

// ---------------------------------------------------------------------------
// Autonomous assignment retry (default-OFF) — self-heal quota-failed assignments
// ---------------------------------------------------------------------------

/// Per-step retry cap for the autonomous resume path. Once a step has been
/// auto-retried this many times the failure is almost certainly not a transient
/// quota blip, so the assignment is left paused for a human.
const ASSIGNMENT_RETRY_MAX: i64 = 8;
/// Backoff between auto-retries of a failed step (minutes). Long enough that a
/// Claude session/usage-limit window has a real chance to reset before the next
/// attempt; with the cap this spans several hours of recovery.
const ASSIGNMENT_RETRY_BACKOFF_MINUTES: i64 = 30;
/// Max assignments resumed per tick — bounds the spend ramp (mirrors
/// `GOAL_ADVANCE_MAX_PER_TICK`).
const ASSIGNMENT_AUTO_RESUME_MAX_PER_TICK: usize = 5;

/// Resumes team assignments soft-paused at `awaiting_review` because a step
/// failed for a RETRYABLE reason (Claude session/usage limit, rate limit) —
/// resetting those steps and re-running them once the quota window has likely
/// recovered, so the unattended goal-advance loop self-heals instead of
/// deadlocking. Default-OFF (`AUTONOMOUS_ASSIGNMENT_RETRY`); per-persona opt-out
/// via `design_context.repeat_on_failure`; bounded by a per-step cap + backoff.
pub struct AssignmentAutoResumeSubscription {
    pub pool: DbPool,
    pub app: AppHandle,
    pub engine: Arc<ExecutionEngine>,
}

/// A failed step that passed the SQL-expressible retry filters (assignment
/// `awaiting_review`, step `failed`, under the retry cap, past the backoff).
/// The retryable-error classification + per-persona repeat gate run in Rust.
struct RetryCandidateStep {
    assignment_id: String,
    step_id: String,
    persona_id: Option<String>,
    execution_id: Option<String>,
    step_error: Option<String>,
}

fn find_assignment_retry_candidates(
    pool: &DbPool,
) -> Result<Vec<RetryCandidateStep>, crate::error::AppError> {
    let conn = pool.get()?;
    let backoff = format!("-{ASSIGNMENT_RETRY_BACKOFF_MINUTES} minutes");
    let mut stmt = conn.prepare(
        "SELECT s.assignment_id, s.id, s.assigned_persona_id, s.execution_id, s.error_message
         FROM team_assignment_steps s
         JOIN team_assignments a ON a.id = s.assignment_id
         WHERE a.status = 'awaiting_review'
           AND s.status = 'failed'
           AND COALESCE(s.retry_count, 0) < ?1
           AND (s.completed_at IS NULL OR datetime(s.completed_at) < datetime('now', ?2))
         ORDER BY s.completed_at ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![ASSIGNMENT_RETRY_MAX, backoff], |r| {
        Ok(RetryCandidateStep {
            assignment_id: r.get(0)?,
            step_id: r.get(1)?,
            persona_id: r.get(2)?,
            execution_id: r.get(3)?,
            step_error: r.get(4)?,
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

/// Is this failed step's failure TRANSIENT (worth retrying once conditions
/// recover) rather than permanent? Looks at the step's own `error_message` plus
/// its execution's `error_message` and `output_data` (where the CLI's "You've
/// hit your session limit" lands), and classifies via the failover taxonomy.
///
/// Retryable = the transient categories that an overloaded quota burst produces
/// and that waiting/recovery resolves: rate/session limit, timeout, transient
/// process failure, network, and 5xx API errors. NOT retryable: missing binary,
/// credential failure, validation, tool errors, or unknown — waiting won't fix
/// those, so the assignment stays paused for a human (and the per-step retry cap
/// bounds the cost of a step that keeps failing transiently).
fn step_failure_is_retryable(pool: &DbPool, exec_id: Option<&str>, step_error: Option<&str>) -> bool {
    use crate::engine::error_taxonomy::ErrorCategory;
    let mut blob = step_error.unwrap_or("").to_string();
    if let Some(eid) = exec_id {
        if let Ok(conn) = pool.get() {
            if let Ok((err, out)) = conn.query_row(
                "SELECT COALESCE(error_message,''), COALESCE(output_data,'') FROM persona_executions WHERE id = ?1",
                rusqlite::params![eid],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            ) {
                blob.push(' ');
                blob.push_str(&err);
                blob.push(' ');
                blob.push_str(&out);
            }
        }
    }
    matches!(
        crate::engine::failover::classify_error(&blob),
        Some(
            ErrorCategory::RateLimit
                | ErrorCategory::SessionLimit
                | ErrorCategory::Timeout
                | ErrorCategory::TransientProcessFailure
                | ErrorCategory::Network
                | ErrorCategory::ApiError
        )
    )
}

/// Per-persona opt-out: `design_context.repeat_on_failure` — default TRUE when
/// absent/unparseable (repeat is the default; this is an opt-out, not opt-in).
fn persona_repeats_on_failure(pool: &DbPool, persona_id: Option<&str>) -> bool {
    let Some(pid) = persona_id else { return true };
    let Ok(conn) = pool.get() else { return true };
    let dc: Option<String> = conn
        .query_row("SELECT design_context FROM personas WHERE id = ?1", rusqlite::params![pid], |r| r.get(0))
        .ok()
        .flatten();
    match dc.as_deref().and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()) {
        Some(v) => v
            .get("repeat_on_failure")
            .and_then(|b| b.as_bool())
            .unwrap_or(true),
        None => true,
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for AssignmentAutoResumeSubscription {
    fn name(&self) -> &'static str {
        "assignment_auto_resume"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(300)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(900)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(90)
    }

    async fn tick(&self) {
        // Default-OFF gate — opt-in only.
        let enabled = crate::db::repos::core::settings::get(
            &self.pool,
            crate::db::settings_keys::AUTONOMOUS_ASSIGNMENT_RETRY,
        )
        .ok()
        .flatten()
        .as_deref()
            == Some("true");
        if !enabled {
            return;
        }
        // G1: don't retry into an active limit window — wait for it to clear so
        // the retry actually has a chance to succeed instead of re-failing.
        if quota_cooldown_active(&self.pool) {
            tracing::info!("assignment_auto_resume: quota cooldown active — skipping tick");
            return;
        }

        // SQL filter + retryable-classification + per-persona gate, all on the
        // blocking pool (sync rusqlite). Result groups retryable step ids by
        // assignment so each assignment is resumed once.
        let pool = self.pool.clone();
        let by_assignment = match tokio::task::spawn_blocking(move || {
            let cands = find_assignment_retry_candidates(&pool)?;
            let mut grouped: std::collections::BTreeMap<String, Vec<String>> =
                std::collections::BTreeMap::new();
            for c in cands {
                if !step_failure_is_retryable(&pool, c.execution_id.as_deref(), c.step_error.as_deref())
                {
                    continue;
                }
                if !persona_repeats_on_failure(&pool, c.persona_id.as_deref()) {
                    continue;
                }
                grouped.entry(c.assignment_id).or_default().push(c.step_id);
            }
            Ok::<_, crate::error::AppError>(grouped)
        })
        .await
        {
            Ok(Ok(m)) => m,
            Ok(Err(e)) => {
                tracing::warn!(error = %e, "assignment_auto_resume: candidate query failed");
                return;
            }
            Err(_) => return,
        };

        let mut resumed = 0usize;
        for (assignment_id, step_ids) in by_assignment
            .into_iter()
            .take(ASSIGNMENT_AUTO_RESUME_MAX_PER_TICK)
        {
            match crate::engine::team_assignment_orchestrator::auto_resume_retryable_steps(
                Arc::new(self.pool.clone()),
                self.app.clone(),
                self.engine.clone(),
                None,
                &assignment_id,
                &step_ids,
            ) {
                Ok(()) => {
                    resumed += 1;
                    tracing::info!(assignment_id = %assignment_id, steps = step_ids.len(), "assignment_auto_resume: resumed retryable-failed assignment");
                }
                Err(e) => {
                    tracing::warn!(assignment_id = %assignment_id, error = %e, "assignment_auto_resume: resume failed");
                }
            }
        }
        if resumed > 0 {
            tracing::info!(count = resumed, "assignment_auto_resume: resumed {resumed} assignment(s)");
        }
    }
}

// ---------------------------------------------------------------------------
// Autonomous manual-review triage (default-OFF) — keep the learning loop turning
// ---------------------------------------------------------------------------

/// A review must sit `pending` at least this long before auto-triage touches
/// it, giving a human first crack.
const REVIEW_TRIAGE_GRACE_MINUTES: i64 = 60;
/// Max reviews auto-triaged per tick.
const REVIEW_TRIAGE_MAX_PER_TICK: usize = 10;

/// Auto-resolves routine `persona_manual_reviews` that have sat `pending` past a
/// grace window, so the accept/reject → memory learning loop keeps turning
/// unattended. Conservative policy: APPROVES only low/medium severity (which
/// `manual_reviews::update_status` routes into a `decision` team/persona memory);
/// HIGH/critical severity is left for a human. Default-OFF
/// (`AUTONOMOUS_REVIEW_TRIAGE`). Distinct from the command-triggered
/// `gc_stale_pending`, which neutral-resolves (no learning signal).
pub struct ManualReviewAutoTriageSubscription {
    pub pool: DbPool,
}

/// One pending review eligible for auto-triage.
struct TriageCandidate {
    id: String,
    severity: String,
    title: String,
    description: String,
    suggested_actions: String,
}

fn find_triage_candidates(pool: &DbPool) -> Result<Vec<TriageCandidate>, crate::error::AppError> {
    let conn = pool.get()?;
    let cutoff = format!("-{REVIEW_TRIAGE_GRACE_MINUTES} minutes");
    let mut stmt = conn.prepare(
        "SELECT id, COALESCE(severity,'medium'), COALESCE(title,''), \
                COALESCE(description,''), COALESCE(suggested_actions,'')
         FROM persona_manual_reviews
         WHERE status = 'pending' AND datetime(created_at) < datetime('now', ?1)
         -- Auto-APPROVABLE severities first (low/medium), THEN high/critical,
         -- each oldest-first. Without this, a backlog of legitimately-held
         -- high/critical business items (PHI/PII/compliance) at the front of an
         -- oldest-first queue permanently STARVES the approvable low/medium
         -- reviews behind them under the per-tick cap — the real reason
         -- autonomous triage resolved nothing despite 29 approvable pending.
         ORDER BY CASE WHEN lower(COALESCE(severity,'medium')) IN ('low','medium') THEN 0 ELSE 1 END,
                  created_at ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![cutoff], |r| {
        Ok(TriageCandidate {
            id: r.get(0)?,
            severity: r.get(1)?,
            title: r.get(2)?,
            description: r.get(3)?,
            suggested_actions: r.get(4)?,
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

/// Business/policy markers — a HARD denylist. A high/critical review whose text
/// matches ANY of these is NEVER auto-approved unattended; it is a genuine human
/// decision (PHI/compliance, production config, pricing, irreversible/destructive
/// change, secrets/credentials). The denylist wins on any overlap with the
/// safe-technical allowlist below.
const REVIEW_BUSINESS_POLICY_MARKERS: &[&str] = &[
    "phi", "hipaa", "baa", "pii", "compliance", "gdpr",
    "production", "prod deploy", "prod-deploy", "production config", "production-config",
    "pricing", "price", "payment", "billing",
    "origin push", "push to origin", "force push", "force-push", "--force",
    "irreversible", "destructive", "rm -rf", "drop table", "delete all", "purge",
    "credential", "secret", "api key", "egress",
];

/// Safe technical-status markers — items the team policy says should NOT be human
/// review items at all (a red build, a lint failure, a code-review change-request,
/// a missing dependency/migration, a mis-sequenced handoff). A high/critical
/// review matching one of these (and NO business/policy marker) is safe to
/// auto-approve unattended.
const REVIEW_SAFE_TECHNICAL_MARKERS: &[&str] = &[
    "lint", "eslint", "tsc", "typecheck", "type error",
    "red build", "build is red", "build red", "ci red", "ci fail", "build fail",
    "test fail", "tests fail", "failing test",
    "request_changes", "request-changes", "request changes", "change-request",
    "missing dependency", "missing migration", "migration landed", "migration needed",
    "migration before", "pre-existing lint", "pre-existing", "baseline lint", "stray file",
    "mis-sequenced", "handoff", "blocked — fix", "blocked - fix",
    "findings to triage", "review findings", "e2e review",
];

/// Decide whether a HIGH/critical-severity pending review is safe to auto-approve
/// unattended. Conservative: the business/policy denylist wins on any overlap, and
/// anything not recognised as a safe technical-status item stays pending for a
/// human. Pure + unit-tested.
fn high_severity_auto_approvable(title: &str, description: &str, suggested_actions: &str) -> bool {
    let hay = format!("{title}\n{description}\n{suggested_actions}").to_ascii_lowercase();
    if REVIEW_BUSINESS_POLICY_MARKERS.iter().any(|m| hay.contains(m)) {
        return false; // genuine business/policy decision — never auto-approve
    }
    REVIEW_SAFE_TECHNICAL_MARKERS.iter().any(|m| hay.contains(m))
}

#[async_trait::async_trait]
impl ReactiveSubscription for ManualReviewAutoTriageSubscription {
    fn name(&self) -> &'static str {
        "manual_review_auto_triage"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(600)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(1800)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(120)
    }

    async fn tick(&self) {
        // Default-OFF gate — opt-in only.
        let enabled = crate::db::repos::core::settings::get(
            &self.pool,
            crate::db::settings_keys::AUTONOMOUS_REVIEW_TRIAGE,
        )
        .ok()
        .flatten()
        .as_deref()
            == Some("true");
        if !enabled {
            return;
        }

        // High/critical auto-approval is a SEPARATE, riskier opt-in: only safe
        // technical-status items (allowlist) with no business/policy marker
        // (denylist) are approved; genuine business/policy decisions stay human.
        let high_enabled = crate::db::repos::core::settings::get(
            &self.pool,
            crate::db::settings_keys::AUTONOMOUS_REVIEW_TRIAGE_HIGH,
        )
        .ok()
        .flatten()
        .as_deref()
            == Some("true");

        let pool = self.pool.clone();
        let triaged = tokio::task::spawn_blocking(move || {
            let cands = match find_triage_candidates(&pool) {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!(error = %e, "manual_review_auto_triage: query failed");
                    return 0usize;
                }
            };
            let mut n = 0usize;
            for c in cands.into_iter().take(REVIEW_TRIAGE_MAX_PER_TICK) {
                let sev = c.severity.to_ascii_lowercase();
                let note = if sev == "high" || sev == "critical" {
                    // High/critical: approve ONLY when the high tier is enabled AND
                    // the item is a safe technical-status item with no business/policy
                    // marker. Everything else (incl. unrecognised high items) stays
                    // pending for a human.
                    if !high_enabled
                        || !high_severity_auto_approvable(
                            &c.title,
                            &c.description,
                            &c.suggested_actions,
                        )
                    {
                        continue;
                    }
                    "[auto-triaged — high-severity technical-status item: matched the \
                     safe-technical allowlist with no business/policy marker; genuine \
                     business/policy decisions are never auto-approved]"
                } else {
                    "[auto-triaged — unattended review policy: routine (low/medium) \
                     severity auto-approved; feeds the accept→decision learning loop]"
                };
                match crate::db::repos::communication::manual_reviews::update_status(
                    &pool,
                    &c.id,
                    crate::db::models::ManualReviewStatus::Approved,
                    Some(note.to_string()),
                ) {
                    Ok(()) => n += 1,
                    Err(e) => {
                        tracing::warn!(review_id = %c.id, error = %e, "manual_review_auto_triage: approve failed")
                    }
                }
            }
            n
        })
        .await
        .unwrap_or(0);

        if triaged > 0 {
            tracing::info!(count = triaged, "manual_review_auto_triage: auto-approved {triaged} routine review(s)");
        }
    }
}

// ---------------------------------------------------------------------------
// Autonomous backlog → goal (default-OFF) — keep the goal-advance loop fed
// ---------------------------------------------------------------------------

/// Max goals promoted per tick (one per idling project; this caps the total).
const BACKLOG_TO_GOAL_MAX_PER_TICK: usize = 5;

/// Keeps the unattended goal-advance loop self-sustaining (analysis §G7): when a
/// goal-linked project has run out of open goals (the loop would otherwise
/// idle), promote that project's single BEST pending backlog idea (highest
/// impact, lowest risk, lowest effort) into a new `dev_goals` row and mark the
/// idea accepted. ONE goal per idling project per tick — flood-safe; nothing
/// happens for a project that still has an open goal or no pending ideas.
/// Default-OFF (`AUTONOMOUS_BACKLOG_TO_GOAL`).
pub struct BacklogToGoalSubscription {
    pub pool: DbPool,
}

/// The best pending idea for an idling goal-linked project.
struct PromotableIdea {
    idea_id: String,
    project_id: String,
    title: String,
    description: Option<String>,
}

fn find_promotable_ideas(pool: &DbPool) -> Result<Vec<PromotableIdea>, crate::error::AppError> {
    let conn = pool.get()?;
    // One row per IDLING goal-linked project (no open, non-done, progress<100
    // goal): that project's single best pending idea. STRATEGIST-RANKED ideas
    // win first (`priority` ASC, 1 = do next — written by the backlog-triage
    // job); unranked ideas fall back to the scanner self-scores (impact desc,
    // risk asc, effort asc, oldest first).
    let mut stmt = conn.prepare(
        "SELECT i.id, i.project_id, i.title, i.description
         FROM dev_ideas i
         JOIN dev_projects dp ON dp.id = i.project_id
         WHERE dp.team_id IS NOT NULL
           AND i.status = 'pending'
           AND NOT EXISTS (
             SELECT 1 FROM dev_goals g
             WHERE g.project_id = i.project_id
               AND g.status NOT IN ('done','completed')
               AND g.progress < 100
           )
           AND i.id = (
             SELECT i2.id FROM dev_ideas i2
             WHERE i2.project_id = i.project_id AND i2.status = 'pending'
             ORDER BY (i2.priority IS NULL) ASC, i2.priority ASC,
                      COALESCE(i2.impact,0) DESC, COALESCE(i2.risk,99) ASC, COALESCE(i2.effort,99) ASC, i2.created_at ASC
             LIMIT 1
           )
         ORDER BY i.project_id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(PromotableIdea {
            idea_id: r.get(0)?,
            project_id: r.get(1)?,
            title: r.get(2)?,
            description: r.get(3)?,
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

#[async_trait::async_trait]
impl ReactiveSubscription for BacklogToGoalSubscription {
    fn name(&self) -> &'static str {
        "backlog_to_goal"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(600)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(1800)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(150)
    }

    async fn tick(&self) {
        // Default-OFF gate — opt-in only.
        let enabled = crate::db::repos::core::settings::get(
            &self.pool,
            crate::db::settings_keys::AUTONOMOUS_BACKLOG_TO_GOAL,
        )
        .ok()
        .flatten()
        .as_deref()
            == Some("true");
        if !enabled {
            return;
        }
        // Don't generate new work while inside a quota-limit window (G1).
        if quota_cooldown_active(&self.pool) {
            tracing::info!("backlog_to_goal: quota cooldown active — skipping tick");
            return;
        }

        let pool = self.pool.clone();
        let promoted = tokio::task::spawn_blocking(move || {
            let ideas = match find_promotable_ideas(&pool) {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(error = %e, "backlog_to_goal: query failed");
                    return 0usize;
                }
            };
            let mut n = 0usize;
            for idea in ideas.into_iter().take(BACKLOG_TO_GOAL_MAX_PER_TICK) {
                let desc = format!(
                    "{}\n\n(Promoted from backlog idea {} to keep the team's goal queue fed.)",
                    idea.description.as_deref().unwrap_or("").trim(),
                    idea.idea_id,
                );
                match crate::db::repos::dev_tools::create_goal(
                    &pool,
                    &idea.project_id,
                    &idea.title,
                    Some(desc.trim()),
                    None,
                    Some("open"),
                    None,
                    None,
                ) {
                    Ok(_) => {
                        // Mark the idea consumed so it is never re-promoted.
                        let _ = crate::db::repos::dev_tools::update_idea(
                            &pool,
                            &idea.idea_id,
                            None,
                            None,
                            Some("accepted"),
                            None,
                            None,
                            None,
                            None,
                            None,
                        );
                        n += 1;
                        tracing::info!(project_id = %idea.project_id, idea_id = %idea.idea_id, "backlog_to_goal: promoted backlog idea to goal");
                    }
                    Err(e) => {
                        tracing::warn!(idea_id = %idea.idea_id, error = %e, "backlog_to_goal: create_goal failed")
                    }
                }
            }
            n
        })
        .await
        .unwrap_or(0);

        if promoted > 0 {
            tracing::info!(count = promoted, "backlog_to_goal: promoted {promoted} backlog idea(s) to goals");
        }
    }
}

// =============================================================================
// G7 — Autonomous idea replenishment (last link of the self-sustaining loop)
// =============================================================================

/// When a goal-managed project is FULLY idle — no open goals AND no pending
/// backlog ideas — the loop starves: `backlog_to_goal` has nothing to promote
/// and `goal_advance` nothing to advance. This subscription replenishes the
/// backlog by running an idea scan (architecture-analyst agent) on ONE such
/// project per tick. Guardrails: a 20h per-project cooldown via the
/// `dev_scans` history (scans spawn a paid CLI agent, ~$1-3 / ~6 min), the
/// quota gate, and the default-OFF `autonomous_idea_scan` setting.
pub struct IdeaReplenishSubscription {
    pub pool: DbPool,
    pub app: tauri::AppHandle,
}

/// The roster-aligned ideation lenses the replenish loop rotates through —
/// each maps to a team perspective so the backlog carries real-life variety
/// instead of architecture-only items: Architect (architecture), Security
/// Sentinel (security), QA (test), engineer (optimizer/error-handling), the UX
/// seat (ux/accessibility/onboarding), and the Product Strategist (business).
const REPLENISH_LENSES: &[&str] = &[
    "architecture-analyst",
    "business-strategist",
    "ux-reviewer",
    "security-auditor",
    "test-strategist",
    "code-optimizer",
    "accessibility-checker",
    "onboarding-designer",
    "error-handler",
];

/// Pick the 2 least-recently-used lenses for a project from the rotation,
/// based on the `dev_scans` history (scan_type is a comma-joined list).
/// Never-used lenses come first, then oldest-used — so every perspective gets
/// its turn before any repeats.
fn pick_replenish_lenses(pool: &DbPool, project_id: &str) -> Vec<String> {
    let mut last_used: std::collections::HashMap<&str, String> = Default::default();
    if let Ok(conn) = pool.get() {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT scan_type, MAX(created_at) FROM dev_scans
             WHERE project_id = ?1 GROUP BY scan_type",
        ) {
            if let Ok(rows) = stmt.query_map([project_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            }) {
                for (types, at) in rows.flatten() {
                    for t in types.split(',').map(str::trim) {
                        if let Some(lens) = REPLENISH_LENSES.iter().find(|l| **l == t) {
                            let e = last_used.entry(lens).or_default();
                            if at > *e {
                                *e = at.clone();
                            }
                        }
                    }
                }
            }
        }
    }
    let mut ordered: Vec<&str> = REPLENISH_LENSES.to_vec();
    ordered.sort_by_key(|l| last_used.get(l).cloned().unwrap_or_default());
    ordered.into_iter().take(2).map(String::from).collect()
}

/// One fully-idle, scan-cooled project: `(project_id, name)`.
fn find_replenish_candidate(
    pool: &DbPool,
) -> Result<Option<(String, String)>, crate::error::AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT dp.id, dp.name FROM dev_projects dp
         WHERE dp.team_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM dev_goals g WHERE g.project_id = dp.id
                             AND g.status NOT IN ('done','completed') AND g.progress < 100)
           AND NOT EXISTS (SELECT 1 FROM dev_ideas i WHERE i.project_id = dp.id
                             AND i.status = 'pending')
           AND NOT EXISTS (SELECT 1 FROM dev_scans s WHERE s.project_id = dp.id
                             AND datetime(s.created_at) > datetime('now','-20 hours'))
         ORDER BY dp.updated_at ASC
         LIMIT 1",
    )?;
    let row = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(Result::ok)
        .next();
    Ok(row)
}

#[async_trait::async_trait]
impl ReactiveSubscription for IdeaReplenishSubscription {
    fn name(&self) -> &'static str {
        "idea_replenish"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(900)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(1800)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(300)
    }

    async fn tick(&self) {
        // Default-OFF gate — opt-in only.
        let enabled = crate::db::repos::core::settings::get(
            &self.pool,
            crate::db::settings_keys::AUTONOMOUS_IDEA_SCAN,
        )
        .ok()
        .flatten()
        .as_deref()
            == Some("true");
        if !enabled {
            return;
        }
        // Don't spend on scans while inside a quota-limit window (G1).
        if quota_cooldown_active(&self.pool) {
            tracing::info!("idea_replenish: quota cooldown active — skipping tick");
            return;
        }

        let candidate = {
            let pool = self.pool.clone();
            tokio::task::spawn_blocking(move || find_replenish_candidate(&pool))
                .await
                .ok()
                .and_then(|r| r.ok())
                .flatten()
        };
        let Some((project_id, name)) = candidate else {
            return;
        };

        // Rotate roster-aligned lenses (LRU) so backlog variety mirrors a real
        // team: architecture one round, business/UX/security/test the next.
        let lenses = {
            let pool = self.pool.clone();
            let pid = project_id.clone();
            tokio::task::spawn_blocking(move || pick_replenish_lenses(&pool, &pid))
                .await
                .unwrap_or_else(|_| vec!["architecture-analyst".to_string()])
        };
        tracing::info!(project_id = %project_id, project = %name, lenses = ?lenses, "idea_replenish: project fully idle (no goals, no ideas) — running backlog scan");
        match crate::commands::infrastructure::idea_scanner::run_scan_core(
            self.app.clone(),
            self.pool.clone(),
            project_id.clone(),
            lenses,
        )
        .await
        {
            Ok(v) => {
                tracing::info!(project_id = %project_id, scan = %v, "idea_replenish: scan launched");
            }
            Err(e) => {
                tracing::warn!(project_id = %project_id, error = %e, "idea_replenish: scan launch failed");
            }
        }
    }
}

// =============================================================================
// Roster redesign — Product Strategist backlog triage
// =============================================================================

/// When a goal-managed project's pending backlog grows past a threshold with
/// unranked items, run the Product Strategist triage job: it RANKS the next-up
/// queue (`dev_ideas.priority`, promotion prefers ranked) balancing business /
/// UX / technical themes, and REJECTS low-value items (reason → shared team
/// constraint memory + scanner suppression). Replaces the naive
/// impact/effort-only promotion shortcut. One project per tick; 24h
/// per-project cooldown via `dev_scans` (`backlog-triage`); default-OFF
/// `autonomous_backlog_triage`.
pub struct BacklogTriageSubscription {
    pub pool: DbPool,
    pub app: tauri::AppHandle,
}

/// One project needing triage: ≥ 6 pending ideas, ≥ 3 of them unranked, and no
/// `backlog-triage` run in the last 24h.
fn find_triage_candidate_project(
    pool: &DbPool,
) -> Result<Option<(String, String)>, crate::error::AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT dp.id, dp.name FROM dev_projects dp
         WHERE dp.team_id IS NOT NULL
           AND (SELECT COUNT(*) FROM dev_ideas i WHERE i.project_id = dp.id
                  AND i.status = 'pending') >= 6
           AND (SELECT COUNT(*) FROM dev_ideas i WHERE i.project_id = dp.id
                  AND i.status = 'pending' AND i.priority IS NULL) >= 3
           AND NOT EXISTS (SELECT 1 FROM dev_scans s WHERE s.project_id = dp.id
                             AND s.scan_type = 'backlog-triage'
                             AND datetime(s.created_at) > datetime('now','-24 hours'))
         ORDER BY dp.updated_at ASC
         LIMIT 1",
    )?;
    let row = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(Result::ok)
        .next();
    Ok(row)
}

#[async_trait::async_trait]
impl ReactiveSubscription for BacklogTriageSubscription {
    fn name(&self) -> &'static str {
        "backlog_triage"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(1200)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(2400)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(420)
    }

    async fn tick(&self) {
        let enabled = crate::db::repos::core::settings::get(
            &self.pool,
            crate::db::settings_keys::AUTONOMOUS_BACKLOG_TRIAGE,
        )
        .ok()
        .flatten()
        .as_deref()
            == Some("true");
        if !enabled {
            return;
        }
        if quota_cooldown_active(&self.pool) {
            tracing::info!("backlog_triage: quota cooldown active — skipping tick");
            return;
        }

        let candidate = {
            let pool = self.pool.clone();
            tokio::task::spawn_blocking(move || find_triage_candidate_project(&pool))
                .await
                .ok()
                .and_then(|r| r.ok())
                .flatten()
        };
        let Some((project_id, name)) = candidate else {
            return;
        };

        tracing::info!(project_id = %project_id, project = %name, "backlog_triage: pending backlog needs ranking — running strategist triage");
        match crate::commands::infrastructure::idea_scanner::run_backlog_triage(
            self.app.clone(),
            self.pool.clone(),
            project_id.clone(),
        )
        .await
        {
            Ok(v) => {
                tracing::info!(project_id = %project_id, scan = %v, "backlog_triage: triage launched");
            }
            Err(e) => {
                tracing::warn!(project_id = %project_id, error = %e, "backlog_triage: launch failed");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Director storm trigger (C3) — focused coaching when a persona's team work
// shows a burst of failures / QA change-requests.
// ---------------------------------------------------------------------------

/// Opt-in autonomous loop: when a team persona hits a STORM (≥2 step failures
/// or QA change-requests in the last 2h) and the Director hasn't coached it via
/// the channel in the last 6h, run a focused Director evaluation. The coaching
/// is bridged into the team channel by `run_director_cycle_for` (C3), so it
/// reaches the persona's next step. Complements the command-driven batch runs.
pub struct DirectorStormSubscription {
    pub pool: DbPool,
    pub app: tauri::AppHandle,
}

/// A persona whose recent team work shows a storm and who hasn't been coached
/// in the channel recently (the rate-limit). Returns its persona id.
fn find_storm_persona(pool: &DbPool) -> Result<Option<String>, crate::error::AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT s.assigned_persona_id, COUNT(*) AS bursts
         FROM team_assignment_events e
         JOIN team_assignment_steps s ON s.id = e.step_id
         JOIN team_assignments a ON a.id = e.assignment_id
         WHERE e.kind IN ('step_failed', 'qa_changes_requested_rework')
           AND datetime(e.created_at) > datetime('now', '-2 hours')
           AND s.assigned_persona_id IS NOT NULL
           AND a.team_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM team_channel_messages m
               WHERE m.author_kind = 'director'
                 AND m.addressed_to LIKE '%\"' || s.assigned_persona_id || '\"%'
                 AND datetime(m.created_at) > datetime('now', '-6 hours')
           )
         GROUP BY s.assigned_persona_id
         HAVING bursts >= 2
         ORDER BY bursts DESC
         LIMIT 1",
    )?;
    let row = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .filter_map(Result::ok)
        .next();
    Ok(row)
}

#[async_trait::async_trait]
impl ReactiveSubscription for DirectorStormSubscription {
    fn name(&self) -> &'static str {
        "director_storm"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(1800)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(3600)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(600)
    }

    async fn tick(&self) {
        let enabled = crate::db::repos::core::settings::get(
            &self.pool,
            crate::db::settings_keys::AUTONOMOUS_DIRECTOR_STORM,
        )
        .ok()
        .flatten()
        .as_deref()
            == Some("true");
        if !enabled {
            return;
        }
        if quota_cooldown_active(&self.pool) {
            tracing::info!("director_storm: quota cooldown active — skipping tick");
            return;
        }

        let persona = {
            let pool = self.pool.clone();
            tokio::task::spawn_blocking(move || find_storm_persona(&pool))
                .await
                .ok()
                .and_then(|r| r.ok())
                .flatten()
        };
        let Some(persona_id) = persona else {
            return;
        };

        let Some(state) = self.app.try_state::<std::sync::Arc<crate::AppState>>() else {
            return;
        };
        tracing::info!(persona_id = %persona_id, "director_storm: storm detected — running focused Director coaching");
        match crate::engine::director::run_director_cycle_for(
            state.inner(),
            self.app.clone(),
            &persona_id,
        )
        .await
        {
            Ok(n) => tracing::info!(persona_id = %persona_id, verdicts = n, "director_storm: coaching complete"),
            Err(e) => tracing::warn!(persona_id = %persona_id, error = %e, "director_storm: coaching failed"),
        }
    }
}

// ---------------------------------------------------------------------------
// Queue drain watchdog — re-drain the execution queue after a quota cooldown
// ---------------------------------------------------------------------------

/// Re-attempts draining the execution queue on a timer. The queue is normally
/// drained on each execution COMPLETION (a freed slot promotes the next queued
/// item) — but quota-aware admission can pause ALL admission while the AI
/// provider's limit is in cooldown, and once every in-flight execution has
/// drained there is no completion left to trigger a re-drain when the cooldown
/// later expires. This watchdog closes that gap: each tick, while the quota
/// cooldown has lifted and there is spare capacity with work waiting, it
/// promotes queued executions (each promotion's completion then cascades the
/// rest via the normal drain path). Also a general safety net for an otherwise
/// stuck queue. Always-on and a cheap no-op when idle. NOT gated by a setting —
/// it only ever drains work that was already admitted-then-queued.
pub struct QueueDrainWatchdog {
    pub pool: DbPool,
    pub app: AppHandle,
    pub engine: Arc<ExecutionEngine>,
}

#[async_trait::async_trait]
impl ReactiveSubscription for QueueDrainWatchdog {
    fn name(&self) -> &'static str {
        "queue_drain_watchdog"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(30)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(60)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(45)
    }

    async fn tick(&self) {
        // Promote up to a bounded number of queued executions per tick so a
        // post-cooldown queue fills its free slots promptly. Stop early when:
        // the quota is still in cooldown, there's no global capacity, the queue
        // is empty, OR a drain promoted nothing (e.g. all queued items are at
        // their per-persona cap) — the no-progress break prevents spinning.
        const MAX_PROMOTE_PER_TICK: usize = 16;
        for _ in 0..MAX_PROMOTE_PER_TICK {
            let (proceed, before) = {
                let t = self.engine.tracker().lock().await;
                (
                    t.quota_available() && t.has_global_capacity() && t.total_queued() > 0,
                    t.total_running(),
                )
            };
            if !proceed {
                break;
            }
            self.engine
                .drain_after_slot_freed(self.app.clone(), self.pool.clone())
                .await;
            let after = self.engine.tracker().lock().await.total_running();
            if after <= before {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct TestSubscription {
        tick_count: Arc<AtomicU32>,
    }

    #[async_trait::async_trait]
    impl ReactiveSubscription for TestSubscription {
        fn name(&self) -> &'static str {
            "test"
        }

        fn interval(&self) -> Duration {
            Duration::from_millis(50)
        }

        async fn tick(&self) {
            self.tick_count.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[test]
    fn test_high_severity_auto_approvable_classifier() {
        // Safe technical-status items (real stranded examples) -> approvable.
        assert!(high_severity_auto_approvable(
            "PR #1 is red — needs migration landed on main before it can merge",
            "",
            ""
        ));
        assert!(high_severity_auto_approvable(
            "REQUEST_CHANGES — lint gate fails on new src/lib/lighttrack.ts (17 errors)",
            "",
            ""
        ));
        assert!(high_severity_auto_approvable(
            "Release blocked — fix 10 pre-existing lint errors",
            "",
            ""
        ));
        assert!(high_severity_auto_approvable(
            "Eligibility Filtering — 4 review findings to triage",
            "",
            ""
        ));

        // Genuine business/policy decisions (real stranded examples) -> NEVER approvable.
        assert!(!high_severity_auto_approvable(
            "PHI egress to external observability — needs HIPAA/BAA decision",
            "",
            ""
        ));
        assert!(!high_severity_auto_approvable(
            "Release tagged — approve origin push + confirm production-deploy gate",
            "",
            ""
        ));
        assert!(!high_severity_auto_approvable(
            "Pricing change for the paid tier",
            "",
            ""
        ));

        // Denylist WINS on overlap: a change-request that also touches production stays human.
        assert!(!high_severity_auto_approvable(
            "REQUEST_CHANGES — production config change to prod deploy",
            "",
            ""
        ));
        // The PII-egress REQUEST_CHANGES variant stays human even though it mentions a code review.
        assert!(!high_severity_auto_approvable(
            "Merge gate: telemetry changeset — REQUEST_CHANGES (live customer PII egress)",
            "",
            ""
        ));

        // Unrecognised high-severity item -> stays pending (conservative default).
        assert!(!high_severity_auto_approvable(
            "Investigate intermittent customer report",
            "",
            ""
        ));
    }

    #[test]
    fn test_subscription_trait_name() {
        let count = Arc::new(AtomicU32::new(0));
        let sub = TestSubscription { tick_count: count };
        assert_eq!(sub.name(), "test");
        assert_eq!(sub.interval(), Duration::from_millis(50));
        assert_eq!(sub.initial_delay(), Duration::ZERO);
    }

    #[tokio::test]
    async fn test_subscription_ticks() {
        let count = Arc::new(AtomicU32::new(0));
        let sub = TestSubscription {
            tick_count: count.clone(),
        };
        sub.tick().await;
        sub.tick().await;
        assert_eq!(count.load(Ordering::Relaxed), 2);
    }

    /// A subscription whose tick always panics — used to verify the panic boundary.
    struct PanickingSubscription;

    #[async_trait::async_trait]
    impl ReactiveSubscription for PanickingSubscription {
        fn name(&self) -> &'static str {
            "panicker"
        }

        fn interval(&self) -> Duration {
            Duration::from_millis(50)
        }

        async fn tick(&self) {
            panic!("intentional test panic");
        }
    }

    #[tokio::test]
    async fn test_panic_boundary_catches_tick_panic() {
        use futures_util::FutureExt;

        let sub: Box<dyn ReactiveSubscription> = Box::new(PanickingSubscription);
        let result = AssertUnwindSafe(sub.tick()).catch_unwind().await;
        assert!(result.is_err(), "catch_unwind should capture the panic");
    }

    #[test]
    fn test_scheduler_crash_counter_from_subscription() {
        let state = SchedulerState::new();
        assert_eq!(state.stats().subscriptions_crashed, 0);
        state.record_subscription_crash("panicker");
        assert_eq!(state.stats().subscriptions_crashed, 1);
    }
}
