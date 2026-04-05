//! Lightweight freeze/OOM monitor — tracks WebView2 subprocess memory.
//!
//! Runs for the app's lifetime. Probes every 5s (low overhead), writes to
//! `{app_data}/logs/freeze_monitor.jsonl` which survives OOM crashes.
//! Only logs when anomalies are detected (memory growth >50MB/10s).

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
    webview_memory_mb: u64,
    app_memory_mb: u64,
    alert: Option<String>,
}

fn get_webview_memory() -> (u64, u64) {
    let output = std::process::Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output();

    let mut wv_total: u64 = 0;
    let mut app_total: u64 = 0;

    if let Ok(output) = output {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            let parts: Vec<&str> = line.split(',').collect();
            if parts.len() < 5 { continue; }
            let name = parts[0].trim_matches('"').to_lowercase();
            let mem_str: String = parts[4..].join(",");
            let mem_kb: u64 = mem_str.chars().filter(|c| c.is_ascii_digit())
                .collect::<String>().parse().unwrap_or(0);
            let mem_mb = mem_kb / 1024;

            if name.contains("msedgewebview2") {
                wv_total += mem_mb;
            }
            if name.contains("personas") || name.contains("msedgewebview2") {
                app_total += mem_mb;
            }
        }
    }
    (wv_total, app_total)
}

pub fn start(app: AppHandle, log_dir: PathBuf) {
    let _ = app; // used for future eval probes if needed
    tauri::async_runtime::spawn(async move {
        let log_path = log_dir.join("freeze_monitor.jsonl");
        if let Ok(mut f) = std::fs::File::create(&log_path) {
            let _ = writeln!(f, "{{\"event\":\"monitor_start\",\"ts\":\"{}\"}}", chrono::Utc::now().to_rfc3339());
        }

        let start = Instant::now();
        let mut probe_id: u32 = 0;
        let mut samples: Vec<u64> = Vec::new();

        tokio::time::sleep(Duration::from_secs(5)).await;

        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            probe_id += 1;

            let (wv_mem, app_mem) = get_webview_memory();
            samples.push(wv_mem);
            if samples.len() > 12 { samples.remove(0); } // 60s window

            // Detect rapid growth (>200MB in 10s = 2 samples)
            let alert = if samples.len() >= 2 {
                let prev = samples[samples.len().saturating_sub(3)];
                let growth = wv_mem.saturating_sub(prev);
                if growth > 200 {
                    let msg = format!("MEMORY_GROWTH: +{}MB/10s ({}MB -> {}MB)", growth, prev, wv_mem);
                    tracing::warn!("[freeze-monitor] {}", msg);
                    Some(msg)
                } else {
                    None
                }
            } else {
                None
            };

            // Only write to file when there's an alert or every 30th probe (~2.5min)
            if alert.is_some() || probe_id % 30 == 0 {
                let entry = ProbeEntry {
                    ts: chrono::Utc::now().to_rfc3339(),
                    elapsed_s: start.elapsed().as_secs(),
                    probe_id,
                    webview_memory_mb: wv_mem,
                    app_memory_mb: app_mem,
                    alert,
                };
                if let Ok(mut f) = std::fs::OpenOptions::new().append(true).create(true).open(&log_path) {
                    if let Ok(json) = serde_json::to_string(&entry) {
                        let _ = writeln!(f, "{}", json);
                        let _ = f.flush();
                    }
                }
            }
        }
    });
}
