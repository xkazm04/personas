//! Ambient Context Fusion: continuous desktop signal aggregation.
//!
//! Unifies clipboard, file watcher, and app focus signals into a rolling
//! context window that personas can subscribe to via sensory policies.
//! The fused context is injected into execution prompts so personas are
//! aware of the user's current workflow without explicit triggers.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
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
const CONTEXT_STREAM_CAPACITY: usize = 128;

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
    /// Signal source: "clipboard", "file_watcher", or "app_focus".
    pub source: String,
    /// Compact summary suitable for prompt injection (never raw secrets).
    pub summary: String,
    /// Unix timestamp (seconds) when the signal was captured.
    pub captured_at: u64,
    /// Original file paths (only set for file_watcher signals) for glob matching.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub raw_paths: Vec<String>,
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
    pub source: String,
    pub summary: String,
    pub captured_at: u64,
    /// Seconds ago relative to snapshot time.
    pub age_secs: u64,
}

// ---------------------------------------------------------------------------
// Core fusion state
// ---------------------------------------------------------------------------

/// The shared fusion state, protected by a tokio Mutex.
pub struct AmbientContextFusion {
    /// Whether ambient context collection is globally enabled.
    enabled: bool,
    /// Rolling window of recent signals.
    signals: VecDeque<AmbientSignal>,
    /// Per-persona sensory policies: persona_id -> policy.
    policies: std::collections::HashMap<String, SensoryPolicy>,
    /// Current foreground app info.
    current_app: Option<String>,
    current_window_title: Option<String>,
    /// Default policy for personas without an explicit one.
    default_policy: SensoryPolicy,
    /// Monotonic counter for total signals captured.
    total_captured: u64,
    /// Last eviction sweep time.
    last_eviction: Instant,
    /// Broadcast sender for real-time context stream.
    stream_tx: ContextStreamSender,
    /// Total events broadcast (may differ from total_captured if stream disabled).
    total_broadcast: u64,
}

impl AmbientContextFusion {
    pub fn new() -> Self {
        let (stream_tx, _) = tokio::sync::broadcast::channel(CONTEXT_STREAM_CAPACITY);
        Self {
            enabled: true,
            signals: VecDeque::with_capacity(64),
            policies: std::collections::HashMap::new(),
            current_app: None,
            current_window_title: None,
            default_policy: SensoryPolicy::default(),
            total_captured: 0,
            last_eviction: Instant::now(),
            stream_tx,
            total_broadcast: 0,
        }
    }

    /// Subscribe to the real-time context event stream.
    pub fn subscribe(&self) -> ContextStreamReceiver {
        self.stream_tx.subscribe()
    }

    /// Get stats about the context stream.
    pub fn stream_stats(&self) -> ContextStreamStats {
        ContextStreamStats {
            total_events_broadcast: self.total_broadcast,
            active_subscribers: self.stream_tx.receiver_count(),
            enabled: self.enabled,
        }
    }

    /// Toggle global enable/disable.
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        if !enabled {
            self.signals.clear();
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Register or update a sensory policy for a persona.
    pub fn set_policy(&mut self, persona_id: String, policy: SensoryPolicy) {
        self.policies.insert(persona_id, policy);
    }

    /// Remove a persona's sensory policy.
    pub fn remove_policy(&mut self, persona_id: &str) {
        self.policies.remove(persona_id);
    }

    /// Get a persona's effective policy (persona-specific or default).
    pub fn get_policy(&self, persona_id: &str) -> &SensoryPolicy {
        self.policies.get(persona_id).unwrap_or(&self.default_policy)
    }

    /// Push a clipboard change signal.
    pub fn push_clipboard(&mut self, content_type: &str, content_length: usize) {
        if !self.enabled {
            return;
        }
        let summary = format!("Clipboard: {content_type} ({content_length} chars)");
        self.broadcast_event("clipboard", &summary, Vec::new(), None, None);
        self.push_signal("clipboard", summary);
    }

    /// Push a file change signal.
    pub fn push_file_change(&mut self, kind: &str, paths: &[String]) {
        if !self.enabled {
            return;
        }
        let path_display: Vec<&str> = paths
            .iter()
            .map(|p| {
                p.rsplit(['/', '\\'])
                    .next()
                    .unwrap_or(p.as_str())
            })
            .collect();
        let summary = format!("File {kind}: {}", path_display.join(", "));
        let raw_paths = paths.to_vec();
        self.broadcast_event("file_watcher", &summary, raw_paths.clone(), None, None);
        self.push_signal_with_paths("file_watcher", summary, raw_paths);
    }

    /// Push an app focus change signal and update current app state.
    pub fn push_app_focus(&mut self, app_name: &str, window_title: &str) {
        if !self.enabled {
            return;
        }
        self.current_app = Some(app_name.to_string());
        self.current_window_title = Some(window_title.to_string());
        let summary = format!("Focused: {app_name} — {window_title}");
        self.broadcast_event(
            "app_focus",
            &summary,
            Vec::new(),
            Some(app_name.to_string()),
            Some(window_title.to_string()),
        );
        self.push_signal("app_focus", summary);
    }

    /// Broadcast a context event to all stream subscribers.
    fn broadcast_event(
        &mut self,
        source: &str,
        summary: &str,
        paths: Vec<String>,
        app_name: Option<String>,
        window_title: Option<String>,
    ) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let event = ContextEvent {
            source: source.to_string(),
            summary: summary.to_string(),
            timestamp: now,
            paths,
            app_name,
            window_title,
        };
        // Send is best-effort — if no subscribers, the event is simply dropped.
        let _ = self.stream_tx.send(event);
        self.total_broadcast += 1;
    }

    fn push_signal(&mut self, source: &str, summary: String) {
        self.push_signal_with_paths(source, summary, Vec::new());
    }

    /// Effective buffer limit: the maximum `max_window_size` across all
    /// registered persona policies.  Falls back to the default policy when
    /// no persona-specific policies are registered.  This keeps the global
    /// buffer large enough for the most permissive persona while trimming
    /// excess signals that no persona is configured to receive.
    fn effective_buffer_limit(&self) -> usize {
        if self.policies.is_empty() {
            self.default_policy.max_window_size as usize
        } else {
            self.policies
                .values()
                .map(|p| p.max_window_size as usize)
                .max()
                .unwrap_or(self.default_policy.max_window_size as usize)
        }
    }

    /// Effective max age: the maximum `max_age_secs` across all registered
    /// persona policies, falling back to the default when none are registered.
    fn effective_max_age(&self) -> u64 {
        if self.policies.is_empty() {
            self.default_policy.max_age_secs
        } else {
            self.policies
                .values()
                .map(|p| p.max_age_secs)
                .max()
                .unwrap_or(self.default_policy.max_age_secs)
        }
    }

    fn push_signal_with_paths(&mut self, source: &str, summary: String, raw_paths: Vec<String>) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        self.signals.push_back(AmbientSignal {
            source: source.to_string(),
            summary,
            captured_at: now,
            raw_paths,
        });
        self.total_captured += 1;

        // Evict if over the effective window size (derived from registered
        // persona policies, not the hardcoded default).
        let max = self.effective_buffer_limit();
        while self.signals.len() > max {
            self.signals.pop_front();
        }

        // Periodic age-based eviction (at most once per 10 seconds)
        if self.last_eviction.elapsed() > Duration::from_secs(10) {
            self.evict_old_signals();
            self.last_eviction = Instant::now();
        }
    }

    fn evict_old_signals(&mut self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let max_age = self.effective_max_age();
        self.signals.retain(|s| now.saturating_sub(s.captured_at) < max_age);
    }

    /// Build a snapshot of ambient context for a specific persona,
    /// filtered by that persona's sensory policy.
    pub fn snapshot_for_persona(&self, persona_id: &str) -> AmbientContextSnapshot {
        if !self.enabled {
            return AmbientContextSnapshot {
                active_app: None,
                active_window_title: None,
                signals: Vec::new(),
                total_signals_captured: self.total_captured,
                enabled: false,
            };
        }

        let policy = self.get_policy(persona_id);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Filter by policy and age
        let max_age = policy.max_age_secs;
        let max_count = policy.max_window_size as usize;

        let filtered: Vec<AmbientSignalEntry> = self
            .signals
            .iter()
            .rev() // newest first
            .filter(|s| {
                let age = now.saturating_sub(s.captured_at);
                if age >= max_age {
                    return false;
                }
                match s.source.as_str() {
                    "clipboard" => policy.clipboard,
                    "file_watcher" => {
                        if !policy.file_changes {
                            return false;
                        }
                        // Apply glob filter if set — match against original file paths
                        if !policy.file_glob_filter.is_empty() {
                            let opts = glob::MatchOptions {
                                case_sensitive: false,
                                ..Default::default()
                            };
                            return s.raw_paths.iter().any(|path| {
                                // Normalise Windows backslashes to forward slashes for matching
                                let normalised = path.replace('\\', "/");
                                policy.file_glob_filter.iter().any(|pat| {
                                    glob::Pattern::new(pat)
                                        .map(|p| p.matches_with(&normalised, opts))
                                        .unwrap_or(false)
                                })
                            });
                        }
                        true
                    }
                    "app_focus" => policy.app_focus,
                    _ => true,
                }
            })
            .take(max_count)
            .map(|s| AmbientSignalEntry {
                source: s.source.clone(),
                summary: s.summary.clone(),
                captured_at: s.captured_at,
                age_secs: now.saturating_sub(s.captured_at),
            })
            .collect();

        // Check focus app filter for the current app
        let app_matches_filter = if policy.focus_app_filter.is_empty() {
            true
        } else if let Some(ref app) = self.current_app {
            let app_lower = app.to_lowercase();
            policy
                .focus_app_filter
                .iter()
                .any(|f| app_lower.contains(&f.to_lowercase()))
        } else {
            false
        };

        AmbientContextSnapshot {
            active_app: if app_matches_filter {
                self.current_app.clone()
            } else {
                None
            },
            active_window_title: if app_matches_filter {
                self.current_window_title.clone()
            } else {
                None
            },
            signals: if app_matches_filter {
                filtered
            } else {
                Vec::new()
            },
            total_signals_captured: self.total_captured,
            enabled: true,
        }
    }

    /// Build a markdown-formatted context document for prompt injection.
    pub fn format_for_prompt(&self, persona_id: &str) -> Option<String> {
        let snapshot = self.snapshot_for_persona(persona_id);
        if !snapshot.enabled || snapshot.signals.is_empty() {
            return None;
        }

        let mut doc = String::with_capacity(512);
        doc.push_str("## Ambient Desktop Context\n");
        doc.push_str("The following is a summary of recent desktop activity observed by the system.\n");
        doc.push_str("Use this context to understand what the user is currently working on.\n\n");

        if let Some(ref app) = snapshot.active_app {
            doc.push_str(&format!("**Active Application**: {app}"));
            if let Some(ref title) = snapshot.active_window_title {
                doc.push_str(&format!(" — {title}"));
            }
            doc.push_str("\n\n");
        }

        doc.push_str("**Recent Activity** (newest first):\n");
        for entry in &snapshot.signals {
            let age = if entry.age_secs < 60 {
                format!("{}s ago", entry.age_secs)
            } else if entry.age_secs < 3600 {
                format!("{}m ago", entry.age_secs / 60)
            } else {
                format!("{}h ago", entry.age_secs / 3600)
            };
            doc.push_str(&format!("- [{}] {} ({})\n", entry.source, entry.summary, age));
        }

        Some(doc)
    }
}

/// Shared handle to the ambient context fusion state.
pub type AmbientContextHandle = Arc<Mutex<AmbientContextFusion>>;

/// Create a new ambient context handle.
pub fn create_ambient_context() -> AmbientContextHandle {
    Arc::new(Mutex::new(AmbientContextFusion::new()))
}

// ---------------------------------------------------------------------------
// Tick function: called from the ambient context subscription to aggregate
// signals from the three desktop monitors.
// ---------------------------------------------------------------------------

/// Ambient context fusion tick — reads the latest state from the desktop
/// monitors and pushes signals into the fusion window.
///
/// This is designed to be called independently from (and in addition to)
/// the existing per-monitor ticks. The monitors publish events; this tick
/// captures the state for ambient context.
pub async fn ambient_context_tick(
    ctx: &AmbientContextHandle,
) {
    let guard = ctx.lock().await;
    if !guard.is_enabled() {
        return;
    }
    // The actual signal pushing happens from within the existing monitor ticks
    // via the push_* methods. This tick just performs periodic housekeeping
    // (eviction of stale signals).
    drop(guard);

    // Eviction is handled inside push_signal, but do an explicit sweep
    // in case no new signals have arrived for a while.
    let mut guard = ctx.lock().await;
    guard.evict_old_signals();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_push_and_snapshot() {
        let mut fusion = AmbientContextFusion::new();
        fusion.push_clipboard("text", 42);
        fusion.push_file_change("modify", &["src/main.rs".to_string()]);
        fusion.push_app_focus("Code.exe", "main.rs — personas");

        let snap = fusion.snapshot_for_persona("test-persona");
        assert!(snap.enabled);
        assert_eq!(snap.signals.len(), 3);
        assert_eq!(snap.active_app.as_deref(), Some("Code.exe"));
    }

    #[test]
    fn test_policy_filtering() {
        let mut fusion = AmbientContextFusion::new();
        fusion.set_policy(
            "p1".to_string(),
            SensoryPolicy {
                clipboard: false,
                file_changes: true,
                app_focus: false,
                ..Default::default()
            },
        );
        fusion.push_clipboard("text", 10);
        fusion.push_file_change("create", &["test.ts".to_string()]);

        let snap = fusion.snapshot_for_persona("p1");
        assert_eq!(snap.signals.len(), 1);
        assert_eq!(snap.signals[0].source, "file_watcher");
    }

    #[test]
    fn test_focus_app_filter() {
        let mut fusion = AmbientContextFusion::new();
        fusion.set_policy(
            "p1".to_string(),
            SensoryPolicy {
                focus_app_filter: vec!["Code.exe".to_string()],
                ..Default::default()
            },
        );

        fusion.push_app_focus("chrome.exe", "Google");
        fusion.push_clipboard("text", 5);

        let snap = fusion.snapshot_for_persona("p1");
        // Chrome doesn't match the filter, so signals should be empty
        assert!(snap.signals.is_empty());
        assert!(snap.active_app.is_none());

        // Now focus VS Code
        fusion.push_app_focus("Code.exe", "main.rs");
        fusion.push_file_change("modify", &["app.tsx".to_string()]);

        let snap = fusion.snapshot_for_persona("p1");
        assert!(snap.signals.len() >= 2);
        assert_eq!(snap.active_app.as_deref(), Some("Code.exe"));
    }

    #[test]
    fn test_disabled() {
        let mut fusion = AmbientContextFusion::new();
        fusion.set_enabled(false);
        fusion.push_clipboard("text", 10);
        let snap = fusion.snapshot_for_persona("any");
        assert!(!snap.enabled);
        assert!(snap.signals.is_empty());
    }

    #[test]
    fn test_window_eviction() {
        let mut fusion = AmbientContextFusion::new();
        fusion.default_policy.max_window_size = 5;
        for i in 0..10 {
            fusion.push_clipboard("text", i * 10);
        }
        // Should have at most 5 signals
        assert!(fusion.signals.len() <= 5);
    }

    #[test]
    fn test_format_for_prompt() {
        let mut fusion = AmbientContextFusion::new();
        fusion.push_app_focus("Code.exe", "ambient_context.rs");
        fusion.push_file_change("modify", &["ambient_context.rs".to_string()]);

        let doc = fusion.format_for_prompt("p1");
        assert!(doc.is_some());
        let doc = doc.unwrap();
        assert!(doc.contains("Ambient Desktop Context"));
        assert!(doc.contains("Code.exe"));
    }

    #[test]
    fn test_file_glob_filter() {
        let mut fusion = AmbientContextFusion::new();
        fusion.set_policy(
            "p1".to_string(),
            SensoryPolicy {
                file_changes: true,
                file_glob_filter: vec!["*.rs".to_string(), "src/**/*.tsx".to_string()],
                ..Default::default()
            },
        );

        // Should match *.rs
        fusion.push_file_change("modify", &["main.rs".to_string()]);
        // Should match src/**/*.tsx
        fusion.push_file_change("modify", &["src/components/App.tsx".to_string()]);
        // Should NOT match — .rst is not .rs
        fusion.push_file_change("modify", &["report.rst".to_string()]);
        // Should NOT match — .json doesn't match either glob
        fusion.push_file_change("modify", &["version.json".to_string()]);

        let snap = fusion.snapshot_for_persona("p1");
        let summaries: Vec<&str> = snap.signals.iter().map(|s| s.summary.as_str()).collect();

        assert!(
            summaries.iter().any(|s| s.contains("main.rs")),
            "main.rs should match *.rs"
        );
        assert!(
            summaries.iter().any(|s| s.contains("App.tsx")),
            "src/components/App.tsx should match src/**/*.tsx"
        );
        assert!(
            !summaries.iter().any(|s| s.contains("report.rst")),
            "report.rst should NOT match *.rs"
        );
        assert!(
            !summaries.iter().any(|s| s.contains("version.json")),
            "version.json should NOT match any glob"
        );
    }

    #[test]
    fn test_format_empty_when_disabled() {
        let mut fusion = AmbientContextFusion::new();
        fusion.set_enabled(false);
        assert!(fusion.format_for_prompt("p1").is_none());
    }

    #[test]
    fn test_buffer_adapts_to_registered_policies() {
        let mut fusion = AmbientContextFusion::new();
        // Register two personas with small windows
        fusion.set_policy(
            "p1".to_string(),
            SensoryPolicy {
                max_window_size: 5,
                ..Default::default()
            },
        );
        fusion.set_policy(
            "p2".to_string(),
            SensoryPolicy {
                max_window_size: 8,
                ..Default::default()
            },
        );
        // Push 20 signals — more than either persona needs
        for i in 0..20 {
            fusion.push_clipboard("text", i * 10);
        }
        // Global buffer should be clamped to max(5, 8) = 8, not default 30
        assert!(
            fusion.signals.len() <= 8,
            "buffer should adapt to registered policies, got {}",
            fusion.signals.len()
        );
    }

    #[test]
    fn test_snapshot_clamps_to_persona_window_size() {
        let mut fusion = AmbientContextFusion::new();
        // p1 wants a small window, p2 a larger one
        fusion.set_policy(
            "p1".to_string(),
            SensoryPolicy {
                max_window_size: 3,
                ..Default::default()
            },
        );
        fusion.set_policy(
            "p2".to_string(),
            SensoryPolicy {
                max_window_size: 10,
                ..Default::default()
            },
        );
        for i in 0..15 {
            fusion.push_clipboard("text", i * 10);
        }
        // p1 should receive at most 3 signals
        let snap1 = fusion.snapshot_for_persona("p1");
        assert!(
            snap1.signals.len() <= 3,
            "p1 (max_window_size=3) received {} signals",
            snap1.signals.len()
        );
        // p2 should receive at most 10 signals
        let snap2 = fusion.snapshot_for_persona("p2");
        assert!(
            snap2.signals.len() <= 10,
            "p2 (max_window_size=10) received {} signals",
            snap2.signals.len()
        );
    }

    #[test]
    fn test_buffer_uses_default_when_no_policies() {
        let mut fusion = AmbientContextFusion::new();
        // No persona policies registered — should fall back to default (30)
        for i in 0..35 {
            fusion.push_clipboard("text", i * 10);
        }
        assert!(
            fusion.signals.len() <= 30,
            "buffer should use default max when no policies registered, got {}",
            fusion.signals.len()
        );
    }

    #[test]
    fn test_buffer_shrinks_after_policy_update() {
        let mut fusion = AmbientContextFusion::new();
        // Start with a large window
        fusion.set_policy(
            "p1".to_string(),
            SensoryPolicy {
                max_window_size: 20,
                ..Default::default()
            },
        );
        for i in 0..20 {
            fusion.push_clipboard("text", i * 10);
        }
        assert_eq!(fusion.signals.len(), 20);

        // Shrink p1's window — next push should evict down
        fusion.set_policy(
            "p1".to_string(),
            SensoryPolicy {
                max_window_size: 5,
                ..Default::default()
            },
        );
        fusion.push_clipboard("text", 999);
        assert!(
            fusion.signals.len() <= 5,
            "buffer should shrink after policy update, got {}",
            fusion.signals.len()
        );
    }
}
