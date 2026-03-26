use serde::Serialize;
use std::sync::OnceLock;
use std::time::Instant;
use ts_rs::TS;

/// Global process start time — set once at the top of `run()`.
static PROCESS_START: OnceLock<Instant> = OnceLock::new();

/// Completed startup timing report — set once after setup() finishes.
static TIMING_REPORT: OnceLock<StartupTimingReport> = OnceLock::new();

/// A single phase measurement.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StartupPhase {
    /// Human-readable name (e.g. "database_init").
    pub name: String,
    /// Milliseconds elapsed since process start when this phase completed.
    pub elapsed_ms: u64,
    /// Duration of this phase in milliseconds.
    pub duration_ms: u64,
}

/// Full startup timing report.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StartupTimingReport {
    /// Total wall-clock time from process start to setup() completion (ms).
    pub total_setup_ms: u64,
    /// Individual phase timings.
    pub phases: Vec<StartupPhase>,
    /// Frontend time-to-interactive (ms), reported by the WebView after mount.
    /// None until the frontend calls `report_frontend_ready`.
    pub frontend_tti_ms: Option<f64>,
}

/// Record the process start time. Call once at the top of `run()`.
pub fn mark_process_start() {
    PROCESS_START.set(Instant::now()).ok();
}

/// Get elapsed milliseconds since process start.
pub fn elapsed_ms() -> u64 {
    PROCESS_START
        .get()
        .map(|s| s.elapsed().as_millis() as u64)
        .unwrap_or(0)
}

/// Helper that tracks phase timings during the setup closure.
pub struct StartupTimer {
    phases: Vec<StartupPhase>,
    last_checkpoint: Instant,
}

impl StartupTimer {
    pub fn new() -> Self {
        Self {
            phases: Vec::with_capacity(16),
            last_checkpoint: PROCESS_START
                .get()
                .copied()
                .unwrap_or_else(Instant::now),
        }
    }

    /// Record a completed phase. Returns the phase duration in ms.
    pub fn checkpoint(&mut self, name: &str) -> u64 {
        let now = Instant::now();
        let duration_ms = now.duration_since(self.last_checkpoint).as_millis() as u64;
        let elapsed_ms = PROCESS_START
            .get()
            .map(|s| now.duration_since(*s).as_millis() as u64)
            .unwrap_or(0);

        self.phases.push(StartupPhase {
            name: name.to_string(),
            elapsed_ms,
            duration_ms,
        });
        self.last_checkpoint = now;
        duration_ms
    }

    /// Finalize and store the report. Returns the total setup time in ms.
    pub fn finalize(self) -> u64 {
        let total = PROCESS_START
            .get()
            .map(|s| s.elapsed().as_millis() as u64)
            .unwrap_or(0);

        let report = StartupTimingReport {
            total_setup_ms: total,
            phases: self.phases,
            frontend_tti_ms: None,
        };
        TIMING_REPORT.set(report).ok();
        total
    }
}

/// Get the startup timing report (None if setup hasn't completed yet).
pub fn get_report() -> Option<&'static StartupTimingReport> {
    TIMING_REPORT.get()
}

/// Record the frontend time-to-interactive value.
/// Safe to call multiple times; only the first call takes effect
/// (the OnceLock report is immutable after finalize, so we use interior approach).
pub fn set_frontend_tti(tti_ms: f64) {
    // Since OnceLock gives us &StartupTimingReport (immutable), we store the
    // frontend TTI in a separate cell and merge on read.
    FRONTEND_TTI.set(tti_ms).ok();
}

static FRONTEND_TTI: OnceLock<f64> = OnceLock::new();

/// Get the full report with frontend TTI merged in.
pub fn get_full_report() -> Option<StartupTimingReport> {
    TIMING_REPORT.get().map(|r| {
        let mut report = r.clone();
        if let Some(&tti) = FRONTEND_TTI.get() {
            report.frontend_tti_ms = Some(tti);
        }
        report
    })
}

/// Format the timing report for the boot log file.
pub fn format_boot_log(report: &StartupTimingReport) -> String {
    let mut out = String::with_capacity(512);
    out.push_str(&format!(
        "\n=== Startup Timing ===\nTotal setup: {}ms\n",
        report.total_setup_ms
    ));
    for phase in &report.phases {
        out.push_str(&format!(
            "  {:40} {:>6}ms  (at {}ms)\n",
            phase.name, phase.duration_ms, phase.elapsed_ms
        ));
    }
    out
}
