//! Resource-aware admission governor.
//!
//! Periodically samples host CPU/memory load and pauses the
//! [`crate::engine::queue::ConcurrencyTracker`]'s admission when load is high
//! (with hysteresis), so the engine doesn't pile new executions onto an
//! already-stressed host and risk an OOM kill. It mirrors the tracker's existing
//! `quota_cooldown` admission gate, but driven by **system load** instead of the
//! AI provider's rate limit.
//!
//! Running executions are NEVER interrupted — only NEW admissions defer to the
//! per-persona queues, draining as load recovers.
//!
//! Rationale for asymmetric thresholds: 70%+ used RAM is often normal idle (the
//! kernel keeps caches warm), whereas the OOM kill happens near ~95% — so
//! memory's bar is higher than CPU's. CPU spikes are transient, so a moderate
//! bar with hysteresis avoids flapping admission on/off.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;

use crate::commands::infrastructure::system_metrics::SystemMetricsSampler;
use crate::engine::queue::ConcurrencyTracker;

/// Pause new admissions when global CPU usage ≥ this percent.
const CPU_PAUSE_PCT: f32 = 70.0;
/// Resume admitting once CPU drops below this (hysteresis vs `CPU_PAUSE_PCT`).
const CPU_RESUME_PCT: f32 = 55.0;
/// Pause new admissions when used RAM ≥ this percent.
const MEM_PAUSE_PCT: f32 = 85.0;
/// Resume admitting once used RAM drops below this (hysteresis vs `MEM_PAUSE_PCT`).
const MEM_RESUME_PCT: f32 = 70.0;
/// How often to sample host load. Cheap (no process enumeration).
const SAMPLE_INTERVAL: Duration = Duration::from_secs(3);

/// Run the governor loop forever, updating the tracker's resource gate. Spawned
/// once at engine startup (real-app context only; headless/test skips it).
pub async fn run(tracker: Arc<Mutex<ConcurrencyTracker>>) {
    let mut sampler = SystemMetricsSampler::new();
    let mut throttled = false;
    loop {
        tokio::time::sleep(SAMPLE_INTERVAL).await;
        let m = sampler.sample();
        // The first sample has no valid CPU delta — skip it so we don't act on a
        // bogus 0% CPU reading.
        if !m.sample_valid {
            continue;
        }
        let next = if throttled {
            // Resume only when BOTH metrics fall below their resume watermark.
            !(m.cpu_percent < CPU_RESUME_PCT && m.mem_used_percent < MEM_RESUME_PCT)
        } else {
            // Pause when EITHER metric exceeds its pause watermark.
            m.cpu_percent >= CPU_PAUSE_PCT || m.mem_used_percent >= MEM_PAUSE_PCT
        };
        if next != throttled {
            throttled = next;
            tracker.lock().await.set_resource_throttled(throttled);
            tracing::info!(
                cpu_percent = m.cpu_percent,
                mem_used_percent = m.mem_used_percent,
                throttled,
                "Resource governor: admission {}",
                if throttled {
                    "PAUSED (high system load)"
                } else {
                    "resumed (load recovered)"
                }
            );
        }
    }
}
