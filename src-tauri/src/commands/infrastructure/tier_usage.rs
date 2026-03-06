use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::engine::rate_limiter::EVENT_SOURCE_WINDOW;
use crate::engine::tier::TierConfig;
use crate::error::AppError;
use crate::AppState;

/// A single rate-limit bucket's current usage.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct RateBucketUsage {
    /// Bucket key, e.g. "event:webhook" or "webhook:trigger-123"
    pub key: String,
    /// Current event count in the window.
    pub current: usize,
    /// Maximum allowed events in the window (from tier config).
    pub limit: usize,
    /// Usage percentage (0–100).
    pub percent: f64,
}

/// Full tier usage snapshot returned to the frontend.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct TierUsageSnapshot {
    /// Current tier config.
    pub tier: TierConfig,
    /// Per-bucket rate limiter usage.
    pub rate_buckets: Vec<RateBucketUsage>,
    /// Total running executions across all personas.
    pub total_running: usize,
    /// Total queued executions across all personas.
    pub total_queued: usize,
    /// Configured max queue depth per persona.
    pub max_queue_depth: usize,
    /// Whether any bucket is at or above 80% of its limit.
    pub approaching_limit: bool,
}

#[tauri::command]
pub async fn get_tier_usage(
    state: State<'_, Arc<AppState>>,
) -> Result<TierUsageSnapshot, AppError> {
    let tier = state.tier_config.lock().unwrap_or_else(|e| e.into_inner()).clone();

    // Snapshot rate limiter buckets
    let raw_buckets = state.rate_limiter.usage_snapshot(EVENT_SOURCE_WINDOW);

    let rate_buckets: Vec<RateBucketUsage> = raw_buckets
        .into_iter()
        .map(|(key, current)| {
            let limit = if key.starts_with("webhook:") {
                tier.webhook_trigger_max
            } else {
                tier.event_source_max
            };
            let percent = if limit == 0 || limit == usize::MAX {
                0.0
            } else {
                (current as f64 / limit as f64 * 100.0).min(100.0)
            };
            RateBucketUsage { key, current, limit, percent }
        })
        .collect();

    // Snapshot concurrency tracker (tokio Mutex — needs await)
    let tracker = state.engine.tracker().lock().await;
    let total_running = tracker.total_running();
    let total_queued = tracker.total_queued();
    let max_queue_depth = tracker.max_queue_depth();
    drop(tracker);

    let approaching_limit = rate_buckets.iter().any(|b| b.percent >= 80.0);

    Ok(TierUsageSnapshot {
        tier,
        rate_buckets,
        total_running,
        total_queued,
        max_queue_depth,
        approaching_limit,
    })
}
