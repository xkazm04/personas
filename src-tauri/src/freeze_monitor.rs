//! Freeze/OOM monitor — tracks memory growth without external process spawning.
//!
//! Checks the Rust process heap allocation count every 10s.
//! Writes alerts to `{app_data}/logs/freeze_monitor.jsonl` when growth is anomalous.
//! Zero external process spawns — fully silent.

use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
struct ProbeEntry {
    ts: String,
    elapsed_s: u64,
    probe_id: u32,
    /// Approximate heap via jemalloc/system allocator stats (Rust side only).
    /// For WebView2 subprocess tracking, use browser devtools or the debug timeline.
    heap_estimate_mb: i64,
    alert: Option<String>,
}

/// Estimate Rust-side memory via peak RSS reported by the OS.
fn estimate_heap_mb() -> i64 {
    // Use Rust's built-in peak RSS tracking if available
    #[cfg(windows)]
    {
        // On Windows, read PROCESS_MEMORY_COUNTERS via raw FFI (no windows-sys crate needed)
        #[repr(C)]
        #[allow(non_snake_case)]
        struct ProcessMemoryCounters {
            cb: u32,
            PageFaultCount: u32,
            PeakWorkingSetSize: usize,
            WorkingSetSize: usize,
            QuotaPeakPagedPoolUsage: usize,
            QuotaPagedPoolUsage: usize,
            QuotaPeakNonPagedPoolUsage: usize,
            QuotaNonPagedPoolUsage: usize,
            PagefileUsage: usize,
            PeakPagefileUsage: usize,
        }
        extern "system" {
            fn GetCurrentProcess() -> isize;
            fn K32GetProcessMemoryInfo(
                process: isize,
                pmc: *mut ProcessMemoryCounters,
                cb: u32,
            ) -> i32;
        }
        unsafe {
            let mut pmc = std::mem::zeroed::<ProcessMemoryCounters>();
            pmc.cb = std::mem::size_of::<ProcessMemoryCounters>() as u32;
            if K32GetProcessMemoryInfo(GetCurrentProcess(), &mut pmc, pmc.cb) != 0 {
                return pmc.WorkingSetSize as i64 / (1024 * 1024);
            }
        }
        -1
    }
    #[cfg(not(windows))]
    { -1 }
}

pub fn start(_app: AppHandle, log_dir: PathBuf) {
    tauri::async_runtime::spawn(async move {
        let log_path = log_dir.join("freeze_monitor.jsonl");
        if let Ok(mut f) = std::fs::File::create(&log_path) {
            let _ = writeln!(f, "{{\"event\":\"monitor_start\",\"ts\":\"{}\"}}", chrono::Utc::now().to_rfc3339());
        }

        let start = Instant::now();
        let mut probe_id: u32 = 0;
        let mut prev_heap: i64 = 0;

        tokio::time::sleep(Duration::from_secs(10)).await;

        loop {
            tokio::time::sleep(Duration::from_secs(10)).await;
            probe_id += 1;

            let heap = estimate_heap_mb();
            let growth = if prev_heap > 0 { heap - prev_heap } else { 0 };
            prev_heap = heap;

            // Alert on >100MB growth in 10s (Rust side only — WebView leaks
            // are tracked by the frontend freezeTimeline)
            let alert = if growth > 100 {
                let msg = format!("RUST_RSS_GROWTH: +{}MB/10s (now {}MB)", growth, heap);
                tracing::warn!("[freeze-monitor] {}", msg);
                Some(msg)
            } else {
                None
            };

            if alert.is_some() || probe_id % 60 == 0 {
                let entry = ProbeEntry {
                    ts: chrono::Utc::now().to_rfc3339(),
                    elapsed_s: start.elapsed().as_secs(),
                    probe_id,
                    heap_estimate_mb: heap,
                    alert,
                };
                if let Ok(mut f) = std::fs::OpenOptions::new().append(true).create(true).open(&log_path) {
                    if let Ok(json) = serde_json::to_string(&entry) {
                        let _ = writeln!(f, "{}", json);
                    }
                }
            }
        }
    });
}
