use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ---------------------------------------------------------------------------
// Context stream: real-time broadcast of desktop signals
// ---------------------------------------------------------------------------

/// A typed event broadcast through the context stream whenever a new desktop
/// signal is captured. Subscribers (e.g. the context rule engine) receive
/// these in real time rather than polling.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContextEvent {
    /// Signal source: "clipboard", "file_watcher", or "app_focus".
    pub source: String,
    /// Compact, prompt-safe summary of the event.
    pub summary: String,
    /// Unix timestamp (seconds) when the event was captured.
    pub timestamp: u64,
    /// Optional file paths (only set for file_watcher events).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    /// For app_focus events: the focused application name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    /// For app_focus events: the window title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
}

/// Stats about the context stream (total events broadcast, active subscribers).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContextStreamStats {
    /// Total events broadcast since engine start.
    pub total_events_broadcast: u64,
    /// Current number of active stream subscribers.
    pub active_subscribers: usize,
    /// Whether the context stream is enabled.
    pub enabled: bool,
}

/// Capacity of the broadcast channel — subscribers that lag behind this many
/// messages will miss older events (lagged).
pub(crate) const CONTEXT_STREAM_CAPACITY: usize = 128;

/// Shared handle to a context stream broadcast sender.
pub type ContextStreamSender = tokio::sync::broadcast::Sender<ContextEvent>;

pub type ContextStreamReceiver = tokio::sync::broadcast::Receiver<ContextEvent>;

// ---------------------------------------------------------------------------
// Signal types
// ---------------------------------------------------------------------------

/// A single ambient signal captured from a desktop source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmbientSignal {
    /// Stable id assigned at capture time, unique per fusion lifetime.
    /// Format: `sig_<monotonic-counter>`. Lets the "What did Athena see?"
    /// view target a specific signal for delete without depending on
    /// timestamp-equality (signals can collide on captured_at when two
    /// fire in the same second).
    pub id: String,
    /// Signal source: "clipboard", "file_watcher", or "app_focus".
    pub source: String,
    /// Compact summary suitable for prompt injection (never raw secrets).
    pub summary: String,
    /// Unix timestamp (seconds) when the signal was captured.
    pub captured_at: u64,
    /// Original file paths (only set for file_watcher signals) for glob matching.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub raw_paths: Vec<String>,
    /// Redacted preview of the captured content. For clipboard signals,
    /// this carries the redacted clipboard text (capped to a bounded
    /// length, with credential-shaped substrings replaced by tokens like
    /// `[REDACTED:jwt]`). `None` for sources that don't capture content
    /// (file_watcher and app_focus rely on the summary for everything).
    /// Phase 3 of the Athena desktop-aware roadmap — pairs with
    /// `redact_clipboard_content` at capture site.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redacted_content: Option<String>,
}

/// Sensory policy: declares what ambient signals a persona is interested in.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SensoryPolicy {
    /// Enable clipboard signals.
    pub clipboard: bool,
    /// Enable file watcher signals.
    pub file_changes: bool,
    /// Enable app focus signals.
    pub app_focus: bool,
    /// Only capture signals when these apps are in focus (empty = any).
    /// Case-insensitive match against exe name, e.g. ["Code.exe", "chrome.exe"].
    pub focus_app_filter: Vec<String>,
    /// Only capture file changes matching these glob patterns (empty = all).
    pub file_glob_filter: Vec<String>,
    /// Maximum number of signals to keep in the rolling window.
    pub max_window_size: u32,
    /// Maximum age of signals in seconds (older signals are evicted).
    pub max_age_secs: u64,
}

impl Default for SensoryPolicy {
    fn default() -> Self {
        Self {
            clipboard: true,
            file_changes: true,
            app_focus: true,
            focus_app_filter: Vec::new(),
            file_glob_filter: Vec::new(),
            max_window_size: 30,
            max_age_secs: 600, // 10 minutes
        }
    }
}

/// A snapshot of the fused ambient context, ready for prompt injection.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AmbientContextSnapshot {
    /// Current focused app (if known).
    pub active_app: Option<String>,
    /// Current window title (if known).
    pub active_window_title: Option<String>,
    /// Rolling signal entries.
    pub signals: Vec<AmbientSignalEntry>,
    /// Total signals captured since engine start.
    pub total_signals_captured: u64,
    /// Whether ambient context is enabled.
    pub enabled: bool,
}

/// A single entry in the snapshot (serialisable version of AmbientSignal).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AmbientSignalEntry {
    /// Stable per-signal id (format `sig_<n>`), assigned at capture time.
    /// Used by the "What did Athena see?" view to delete a single row
    /// without timestamp-collision races.
    pub id: String,
    pub source: String,
    pub summary: String,
    pub captured_at: u64,
    /// Seconds ago relative to snapshot time.
    pub age_secs: u64,
    /// Redacted clipboard text (or other captured payload), if any.
    /// Lets the "What did Athena see?" view show what the user actually
    /// pasted — with credential-shaped substrings already masked. None
    /// for sources that don't capture content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redacted_content: Option<String>,
}

/// Per-source capture-gate state, surfaced to the UI via Tauri commands.
/// The toggles render against the *_enabled fields; the *_signals_in_window
/// counts populate the "What did Athena see?" view's source headers.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SensorySourceState {
    /// Master kill switch (rarely toggled; defaults true).
    pub global_enabled: bool,
    /// Per-source capture gate for clipboard signals (default false).
    pub clipboard_enabled: bool,
    /// Per-source capture gate for file-watcher signals (default false).
    pub file_changes_enabled: bool,
    /// Per-source capture gate for app-focus signals (default false).
    pub app_focus_enabled: bool,
    /// Phase 5 v1: read-time gate for the user's active Claude CLI
    /// session (default false). Unlike the three above, no signals are
    /// captured for this — it controls whether the runner will read the
    /// transcript and inject a prompt prefix. Pairs with the per-persona
    /// `cli_awareness_enabled` flag.
    #[serde(default)]
    pub cli_session_enabled: bool,
    /// Number of clipboard signals currently in the rolling window.
    pub clipboard_signals_in_window: u32,
    /// Number of file-watcher signals currently in the rolling window.
    pub file_changes_signals_in_window: u32,
    /// Number of app-focus signals currently in the rolling window.
    pub app_focus_signals_in_window: u32,
    /// Lifetime total of signals captured since process start (across all sources).
    pub total_signals_captured: u64,
}
