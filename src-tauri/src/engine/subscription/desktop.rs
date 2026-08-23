use super::*;
use crate::db::DbPool;
#[cfg(feature = "ml")]
use crate::engine::event_registry::event_name;
use std::sync::Arc;
use std::time::Duration;
#[cfg(feature = "ml")]
use std::time::Instant;
use tauri::AppHandle;

/// File watcher subscription: monitor file system for changes.
#[cfg(feature = "desktop")]
pub struct FileWatcherSubscription {
    pub pool: DbPool,
    pub state: Arc<tokio::sync::Mutex<crate::engine::file_watcher::FileWatcherState>>,
    pub tx: tokio::sync::mpsc::Sender<crate::engine::file_watcher::RawFsEvent>,
    pub rx: Arc<
        tokio::sync::Mutex<tokio::sync::mpsc::Receiver<crate::engine::file_watcher::RawFsEvent>>,
    >,
    pub dropped: Arc<std::sync::atomic::AtomicU64>,
    /// Ambient fusion handle. Each tick pushes coalesced+debounced
    /// file events through `push_file_change` so they appear in the
    /// rolling window AND mirror to the cross-process `ambient_signal`
    /// SQL table for the daemon-side bridge (Phase 3 c v3).
    pub ambient_ctx: crate::engine::ambient_context::AmbientContextHandle,
}

/// Clipboard monitor subscription: detect clipboard content changes.
/// Also runs error detection + KB search for the clipboard watcher feature.
#[cfg(feature = "desktop")]
pub struct ClipboardSubscription {
    pub pool: DbPool,
    pub state: Arc<tokio::sync::Mutex<crate::engine::clipboard_monitor::ClipboardState>>,
    pub ambient_ctx: crate::engine::ambient_context::AmbientContextHandle,
    /// App handle for sending OS notifications and Tauri events.
    /// Read only from the `ml`-gated error->KB notification path
    /// (`handle_detection`, lines ~607/616), so it is genuinely dead in a
    /// build without `ml` and genuinely live in one with it.
    #[cfg_attr(not(feature = "ml"), allow(dead_code))]
    pub app: AppHandle,
    /// User database pool (for KB lookups). Read only by the `ml`-gated
    /// `search_kb`, which is the sole KB entry point for this subscription.
    #[cfg_attr(not(feature = "ml"), allow(dead_code))]
    pub user_db: crate::db::UserDbPool,
    /// Embedding manager for vectorising error queries.
    #[cfg(feature = "ml")]
    pub embedding_manager: Option<Arc<crate::engine::embedder::EmbeddingManager>>,
    /// Vector store for KB similarity search.
    #[cfg(feature = "ml")]
    pub vector_store: Option<Arc<crate::engine::vector_store::SqliteVectorStore>>,
    /// Cooldown: last time a clipboard error notification was sent.
    pub last_notification: Arc<tokio::sync::Mutex<Option<std::time::Instant>>>,
    /// Whether the clipboard watcher is enabled (toggled from tray).
    pub watcher_enabled: Arc<std::sync::atomic::AtomicBool>,
}

/// App focus subscription: detect foreground application changes.
#[cfg(feature = "desktop")]
pub struct AppFocusSubscription {
    pub pool: DbPool,
    pub state: Arc<tokio::sync::Mutex<crate::engine::app_focus::AppFocusState>>,
    pub ambient_ctx: crate::engine::ambient_context::AmbientContextHandle,
}

/// Ambient context fusion subscription: aggregates desktop signals into a rolling context window.
#[cfg(feature = "desktop")]
pub struct AmbientContextSubscription {
    pub ctx: crate::engine::ambient_context::AmbientContextHandle,
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
    pub rule_engine: crate::engine::context_rules::ContextRuleEngineHandle,
    pub stream_rx: Arc<tokio::sync::Mutex<crate::engine::ambient_context::ContextStreamReceiver>>,
    pub pool: DbPool,
    pub app: AppHandle,
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
        crate::engine::file_watcher::file_watcher_tick(
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
        crate::engine::clipboard_monitor::clipboard_tick(
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
        let detection = match crate::engine::clipboard_error_detector::detect_error_pattern(&text) {
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

    /// Search all KBs for the given query. Delegates to the SHARED all-KB
    /// scan in [`crate::engine::kb_scan`] — this used to be a drifted
    /// copy-paste twin of `clipboard_intel::search_kb_for_error`; both call
    /// sites now route through the single implementation (ready-only KBs,
    /// similarity-desc, truncate to limit).
    #[cfg(feature = "ml")]
    fn search_kb(
        &self,
        query: &str,
    ) -> Result<Vec<crate::engine::kb_scan::KbMatch>, crate::error::AppError> {
        let embedding_manager = self.embedding_manager.as_ref().ok_or_else(|| {
            crate::error::AppError::Internal("Embedding manager not available".into())
        })?;
        let vector_store = self
            .vector_store
            .as_ref()
            .ok_or_else(|| crate::error::AppError::Internal("Vector store not available".into()))?;

        crate::engine::kb_scan::search_all_kbs(
            &self.user_db,
            embedding_manager,
            vector_store,
            query,
            3,
        )
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

        crate::engine::app_focus::app_focus_tick(&self.pool, &self.state).await;

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
        crate::engine::ambient_context::ambient_context_tick(&self.ctx).await;
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
        match crate::engine::ambient_signal_repo::evict_older_than(&self.pool, cutoff) {
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
        match crate::engine::cli_session_audit_repo::evict_older_than(&self.pool, cutoff) {
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
        crate::engine::context_rules::context_rule_tick(
            &self.rule_engine,
            &self.stream_rx,
            &self.pool,
            &self.app,
        )
        .await;
    }
}
