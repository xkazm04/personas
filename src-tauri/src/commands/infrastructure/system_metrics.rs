//! Host CPU/RAM sampling for the footer "system load" gauge.
//!
//! A deliberately small, standalone signal: it answers "does *this machine*
//! have headroom for more local work?" — NOT "will my LLM provider let me run
//! more agents?" (that is rate/cost-bound and lives elsewhere). It exists as a
//! soft, advisory hint, so it is intentionally not coupled to concurrency.

use std::sync::Arc;

use serde::Serialize;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

const BYTES_PER_MB: u64 = 1_048_576;

/// A single host CPU/RAM reading. Raw numbers only — the frontend does the
/// EMA smoothing + hysteresis + green/amber/red banding (see `systemLoad.ts`),
/// keeping the UX tuning where it is cheap to iterate.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SystemMetrics {
    /// Global CPU usage 0–100 (summed across cores, normalized). Meaningless on
    /// the very first sample — see `sample_valid`.
    pub cpu_percent: f32,
    /// Used physical RAM as a percent of total (0–100), where "used" excludes
    /// reclaimable cache (`total - available`).
    pub mem_used_percent: f32,
    /// Memory available for new allocations without reclaim/swap, in MB — the
    /// real "headroom" number (NOT free memory, which the kernel keeps low by
    /// using it as cache).
    pub mem_available_mb: u64,
    /// Total physical RAM in MB.
    pub mem_total_mb: u64,
    /// Swap currently in use, in MB. Rising while RAM is pinned ≈ thrashing.
    pub swap_used_mb: u64,
    /// `false` on the first sample after start: CPU% is a delta between two
    /// samples, so the first reading is not yet meaningful (sysinfo
    /// `MINIMUM_CPU_UPDATE_INTERVAL` ≈ 200 ms). The frontend discards it.
    pub sample_valid: bool,
}

/// Persistent sampler held in `AppState`. Keeps ONE `System` instance so that
/// consecutive CPU refreshes (which are ≥ the poll interval apart) yield a
/// correct usage delta — re-creating `System` per call would reset the
/// baseline and always read 0%.
pub struct SystemMetricsSampler {
    sys: System,
    /// `true` once at least one prior CPU sample has been taken.
    primed: bool,
}

impl SystemMetricsSampler {
    pub fn new() -> Self {
        // Refresh ONLY CPU usage + memory — never enumerate the process list
        // (that allocation is the expensive part of sysinfo and we don't need
        // it for a host-load gauge).
        let sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
                .with_memory(MemoryRefreshKind::nothing().with_ram().with_swap()),
        );
        Self { sys, primed: false }
    }

    pub fn sample(&mut self) -> SystemMetrics {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();

        let total = self.sys.total_memory();
        let available = self.sys.available_memory();
        let used = total.saturating_sub(available);
        let mem_used_percent = if total > 0 {
            (used as f64 / total as f64 * 100.0) as f32
        } else {
            0.0
        };

        let metrics = SystemMetrics {
            cpu_percent: if self.primed { self.sys.global_cpu_usage() } else { 0.0 },
            mem_used_percent,
            mem_available_mb: available / BYTES_PER_MB,
            mem_total_mb: total / BYTES_PER_MB,
            swap_used_mb: self.sys.used_swap() / BYTES_PER_MB,
            sample_valid: self.primed,
        };
        self.primed = true;
        metrics
    }
}

impl Default for SystemMetricsSampler {
    fn default() -> Self {
        Self::new()
    }
}

/// Sample the host's current CPU + memory load. Cheap (no process enumeration);
/// the frontend polls this on a ~2 s timer while the footer gauge is mounted.
#[tauri::command]
pub async fn get_system_metrics(
    state: State<'_, Arc<AppState>>,
) -> Result<SystemMetrics, AppError> {
    require_auth(&state).await?;
    let mut sampler = state
        .system_metrics
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    Ok(sampler.sample())
}
