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

// ---------------------------------------------------------------------------
// Core fusion state
// ---------------------------------------------------------------------------

/// The shared fusion state, protected by a tokio Mutex.
pub struct AmbientContextFusion {
    /// Whether ambient context collection is globally enabled. Master kill
    /// switch — when off, no source captures anything regardless of the
    /// per-source flags below.
    enabled: bool,
    /// Per-source capture gate: clipboard signals captured iff true.
    /// Default false ("OFF until the user opts in"). Combined with `enabled`
    /// at the start of each `push_*` so capture only happens when both the
    /// master switch and the source-specific gate are on. See Phase 1 audit
    /// at `docs/architecture/athena-phase1-audit.md` — moving the
    /// per-source gating from consumption to capture is what makes the
    /// "default OFF per source" UI promise honest.
    clipboard_enabled: bool,
    /// Per-source capture gate: file-watcher signals captured iff true.
    file_changes_enabled: bool,
    /// Per-source capture gate: app-focus signals captured iff true.
    /// Window titles are redacted at capture (`redact_window_title`) so
    /// even when this is on, sensitive content from titles is stripped
    /// before reaching the rolling window.
    app_focus_enabled: bool,
    /// Phase 5 v1: read-time gate for the user's active Claude CLI
    /// session. Unlike the three above, this gate does NOT control
    /// capture (no signals enter the rolling window from CLI session
    /// reads). It controls READ — the runner only fetches and renders
    /// the user's active CLI transcript when this is true. Pairs with
    /// the per-persona `cli_awareness_enabled` flag; both must be true.
    /// Default false ("OFF until the user opts in"), same posture as
    /// the other source gates.
    cli_session_enabled: bool,
    /// Rolling window of recent signals.
    signals: VecDeque<AmbientSignal>,
    /// Per-persona sensory policies: persona_id -> policy. These filter
    /// at *consumption* (when a persona reads the snapshot); the per-source
    /// gates above filter at *capture*. Both layers exist intentionally —
    /// capture-time gating enforces the user's privacy promise; consumption-
    /// time policies let multiple personas with different scopes share the
    /// same captured stream.
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
            // All sources OFF by default — the user must opt in per source.
            // This is the privacy contract: no watcher captures anything
            // until an explicit toggle from the Companion settings UI.
            clipboard_enabled: false,
            file_changes_enabled: false,
            app_focus_enabled: false,
            cli_session_enabled: false,
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

    /// Source gate read: per-source capture switch. Names mirror the
    /// `source` strings used in `ContextEvent` and `AmbientSignal`:
    /// `"clipboard"`, `"file_watcher"`, `"app_focus"`, plus the Phase 5 v1
    /// read-time gate `"cli_session"`. Unknown sources return false (fail
    /// closed — don't capture/read what we don't recognize).
    pub fn is_source_enabled(&self, source: &str) -> bool {
        match source {
            "clipboard" => self.clipboard_enabled,
            "file_watcher" => self.file_changes_enabled,
            "app_focus" => self.app_focus_enabled,
            "cli_session" => self.cli_session_enabled,
            _ => false,
        }
    }

    /// Source gate write: toggle a per-source capture switch. When a
    /// source is being disabled (`enabled=false`), purge any prior signals
    /// from that source from the rolling window — the privacy promise is
    /// "stop capturing AND drop what was captured." Returns the number of
    /// signals purged (0 when enabling, ≥0 when disabling).
    ///
    /// `"cli_session"` (Phase 5 v1) is a read-time gate, not a capture-
    /// time gate — no signals are stored for it, so the disable-purge
    /// branch is a no-op for that source. The toggle still flows through
    /// here for UI symmetry (same Tauri command surface as the others).
    pub fn set_source_enabled(&mut self, source: &str, enabled: bool) -> usize {
        let already = self.is_source_enabled(source);
        match source {
            "clipboard" => self.clipboard_enabled = enabled,
            "file_watcher" => self.file_changes_enabled = enabled,
            "app_focus" => self.app_focus_enabled = enabled,
            "cli_session" => {
                self.cli_session_enabled = enabled;
                // No rolling-window state to purge — return early.
                return 0;
            }
            _ => return 0,
        }
        // Purge prior signals from this source on disable. No-op on enable.
        if already && !enabled {
            let before = self.signals.len();
            self.signals.retain(|s| s.source != source);
            // Clear the cached app/title when app_focus is being disabled
            // so a future enable doesn't surface stale state.
            if source == "app_focus" {
                self.current_app = None;
                self.current_window_title = None;
            }
            before - self.signals.len()
        } else {
            0
        }
    }

    /// List captured signals for the "What did Athena see?" view. Optional
    /// `source` filter narrows to one of `"clipboard"` / `"file_watcher"` /
    /// `"app_focus"`. Returns newest-first up to `limit`. Unlike
    /// `snapshot_for_persona`, this is an admin view — no per-persona
    /// policy filtering, no app-focus filter; the user has the right to
    /// see EVERYTHING that was captured to make a real privacy decision.
    pub fn list_signals(&self, source: Option<&str>, limit: usize) -> Vec<AmbientSignalEntry> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.signals
            .iter()
            .rev() // newest first
            .filter(|s| match source {
                Some(want) => s.source == want,
                None => true,
            })
            .take(limit)
            .map(|s| AmbientSignalEntry {
                id: s.id.clone(),
                source: s.source.clone(),
                summary: s.summary.clone(),
                captured_at: s.captured_at,
                age_secs: now.saturating_sub(s.captured_at),
                redacted_content: s.redacted_content.clone(),
            })
            .collect()
    }

    /// Delete a specific signal by id. Returns `true` if the signal was
    /// found and removed, `false` otherwise (e.g. it was already evicted
    /// by the rolling-window eviction or didn't exist). Used by the
    /// "What did Athena see?" view's per-event delete button.
    pub fn delete_signal(&mut self, id: &str) -> bool {
        let before = self.signals.len();
        self.signals.retain(|s| s.id != id);
        before != self.signals.len()
    }

    /// Snapshot the per-source enable state. Used by the UI to render the
    /// current toggle positions and to surface "what's currently captured"
    /// counts.
    pub fn source_state(&self) -> SensorySourceState {
        let by_source = |src: &str| -> u32 {
            self.signals.iter().filter(|s| s.source == src).count() as u32
        };
        SensorySourceState {
            global_enabled: self.enabled,
            clipboard_enabled: self.clipboard_enabled,
            file_changes_enabled: self.file_changes_enabled,
            app_focus_enabled: self.app_focus_enabled,
            cli_session_enabled: self.cli_session_enabled,
            clipboard_signals_in_window: by_source("clipboard"),
            file_changes_signals_in_window: by_source("file_watcher"),
            app_focus_signals_in_window: by_source("app_focus"),
            total_signals_captured: self.total_captured,
        }
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
        self.policies
            .get(persona_id)
            .unwrap_or(&self.default_policy)
    }

    /// Push a clipboard change signal carrying the (redacted) content.
    /// Captured iff master `enabled` AND the per-source `clipboard_enabled`
    /// gate are on. Redaction is applied at this capture site
    /// (`redact_clipboard_content`) before the signal enters the rolling
    /// window — the un-redacted text never reaches storage. Phase 3 of
    /// the Athena desktop-aware roadmap.
    pub fn push_clipboard_with_content(
        &mut self,
        content_type: &str,
        content: &str,
    ) -> Option<AmbientSignal> {
        if !self.enabled || !self.clipboard_enabled {
            return None;
        }
        let raw_len = content.len();
        let redacted = redact_clipboard_content(content);
        let summary = format!("Clipboard: {content_type} ({raw_len} chars)");
        self.broadcast_event("clipboard", &summary, Vec::new(), None, None);
        Some(self.push_signal_with_payload(
            "clipboard",
            summary,
            Vec::new(),
            Some(redacted),
        ))
    }

    /// Legacy push site for clipboard signals when only metadata is
    /// available (no content). Kept for backward compatibility with
    /// existing tests and any caller that has only the length. New code
    /// should use [`push_clipboard_with_content`] so the redacted
    /// content reaches the rolling window.
    pub fn push_clipboard(
        &mut self,
        content_type: &str,
        content_length: usize,
    ) -> Option<AmbientSignal> {
        if !self.enabled || !self.clipboard_enabled {
            return None;
        }
        let summary = format!("Clipboard: {content_type} ({content_length} chars)");
        self.broadcast_event("clipboard", &summary, Vec::new(), None, None);
        Some(self.push_signal("clipboard", summary))
    }

    /// Push a file change signal. Captured iff master `enabled` AND the
    /// per-source `file_changes_enabled` gate are on.
    pub fn push_file_change(
        &mut self,
        kind: &str,
        paths: &[String],
    ) -> Option<AmbientSignal> {
        if !self.enabled || !self.file_changes_enabled {
            return None;
        }
        let path_display: Vec<&str> = paths
            .iter()
            .map(|p| p.rsplit(['/', '\\']).next().unwrap_or(p.as_str()))
            .collect();
        let summary = format!("File {kind}: {}", path_display.join(", "));
        let raw_paths = paths.to_vec();
        self.broadcast_event("file_watcher", &summary, raw_paths.clone(), None, None);
        Some(self.push_signal_with_paths("file_watcher", summary, raw_paths))
    }

    /// Push an app focus change signal and update current app state.
    /// Captured iff master `enabled` AND the per-source `app_focus_enabled`
    /// gate are on. Window titles are redacted at capture time
    /// (`redact_window_title`) before being stored or broadcast — file
    /// paths in titles are reduced to basenames, email-shaped patterns are
    /// masked, and overall length is capped.
    pub fn push_app_focus(
        &mut self,
        app_name: &str,
        window_title: &str,
    ) -> Option<AmbientSignal> {
        if !self.enabled || !self.app_focus_enabled {
            return None;
        }
        let redacted_title = redact_window_title(window_title);
        self.current_app = Some(app_name.to_string());
        self.current_window_title = Some(redacted_title.clone());
        let summary = format!("Focused: {app_name} — {redacted_title}");
        self.broadcast_event(
            "app_focus",
            &summary,
            Vec::new(),
            Some(app_name.to_string()),
            Some(redacted_title),
        );
        Some(self.push_signal("app_focus", summary))
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

    fn push_signal(&mut self, source: &str, summary: String) -> AmbientSignal {
        self.push_signal_with_paths(source, summary, Vec::new())
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

    fn push_signal_with_paths(
        &mut self,
        source: &str,
        summary: String,
        raw_paths: Vec<String>,
    ) -> AmbientSignal {
        self.push_signal_with_payload(source, summary, raw_paths, None)
    }

    /// Internal capture site that accepts an optional redacted-content
    /// payload. Clipboard signals provide the content (post-redaction);
    /// file-watcher and app-focus signals omit it (they communicate
    /// everything through `summary`).
    ///
    /// Returns a clone of the just-pushed signal — capture-side callers
    /// (clipboard_monitor, app_focus tick) use this to mirror the
    /// capture into the SQL projection (`ambient_signal_repo`) without
    /// re-locking the fusion to read the back of the queue. Cheap clone:
    /// strings + small Vec of paths.
    fn push_signal_with_payload(
        &mut self,
        source: &str,
        summary: String,
        raw_paths: Vec<String>,
        redacted_content: Option<String>,
    ) -> AmbientSignal {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Pre-compute id from total_captured BEFORE incrementing — gives
        // each signal a unique stable id (`sig_<n>`) for the lifetime of
        // this fusion instance. Survives buffer eviction; the counter is
        // monotonic and never reused.
        let id = format!("sig_{}", self.total_captured);
        let signal = AmbientSignal {
            id,
            source: source.to_string(),
            summary,
            captured_at: now,
            raw_paths,
            redacted_content,
        };
        self.signals.push_back(signal.clone());
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

        signal
    }

    fn evict_old_signals(&mut self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let max_age = self.effective_max_age();
        self.signals
            .retain(|s| now.saturating_sub(s.captured_at) < max_age);
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
                id: s.id.clone(),
                source: s.source.clone(),
                summary: s.summary.clone(),
                captured_at: s.captured_at,
                age_secs: now.saturating_sub(s.captured_at),
                redacted_content: s.redacted_content.clone(),
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
    /// Thin wrapper: builds the active-app label from the fusion's
    /// `current_app` / `current_window_title` fields, then delegates to
    /// the pure renderer [`format_signals_for_prompt`]. The renderer is
    /// also used by the daemon path (step 5 of Phase 3 c v3) which
    /// loads signals from SQL — sharing the renderer keeps the
    /// daemon-rendered prompt byte-identical to the windowed-app one
    /// for the same data.
    pub fn format_for_prompt(&self, persona_id: &str) -> Option<String> {
        let snapshot = self.snapshot_for_persona(persona_id);
        if !snapshot.enabled {
            return None;
        }
        let label = snapshot.active_app.as_ref().map(|app| {
            if let Some(ref title) = snapshot.active_window_title {
                format!("{app} — {title}")
            } else {
                app.clone()
            }
        });
        format_signals_for_prompt(&snapshot.signals, label.as_deref())
    }
}

/// Pure renderer for the ambient prompt block.
///
/// Takes a pre-filtered slice of signals (the caller is responsible
/// for applying the persona's `SensoryPolicy` — source filter, age
/// cutoff, window size — before calling) and an optional already-
/// formatted "App — Window Title" label, and produces a markdown
/// document suitable for prepending to a system prompt.
///
/// Returns `None` when the signal list is empty — this is the signal
/// to the caller (`prepend_ambient_to_system_prompt`) that there's
/// nothing to inject and the no-op path should run.
///
/// The two callers are:
/// - [`AmbientContextFusion::format_for_prompt`] — windowed-app path,
///   reads from in-memory rolling window.
/// - The Phase 3 c v3 daemon path — reads from
///   [`ambient_signal_repo::recent_signals`] and applies the persona
///   policy explicitly before calling.
///
/// Sharing the renderer means the daemon-rendered prompt is byte-
/// identical to the windowed-app one for the same input data — a
/// regression in the rendered shape would appear in both code paths
/// simultaneously and be caught by the existing
/// `test_format_for_prompt` and the daemon-path tests in step 7.
pub fn format_signals_for_prompt(
    signals: &[AmbientSignalEntry],
    active_app_label: Option<&str>,
) -> Option<String> {
    if signals.is_empty() {
        return None;
    }

    let mut doc = String::with_capacity(512);
    doc.push_str("## Ambient Desktop Context\n");
    doc.push_str(
        "The following is a summary of recent desktop activity observed by the system.\n",
    );
    doc.push_str("Use this context to understand what the user is currently working on.\n\n");

    if let Some(label) = active_app_label {
        doc.push_str(&format!("**Active Application**: {label}\n\n"));
    }

    doc.push_str("**Recent Activity** (newest first):\n");
    for entry in signals {
        let age = if entry.age_secs < 60 {
            format!("{}s ago", entry.age_secs)
        } else if entry.age_secs < 3600 {
            format!("{}m ago", entry.age_secs / 60)
        } else {
            format!("{}h ago", entry.age_secs / 3600)
        };
        doc.push_str(&format!(
            "- [{}] {} ({})\n",
            entry.source, entry.summary, age
        ));
    }

    Some(doc)
}

// ---------------------------------------------------------------------------
// Capture-time redaction
// ---------------------------------------------------------------------------

/// Maximum length for a captured window title. Long titles often contain
/// pasted error messages, URLs with query strings, or document paths —
/// truncating bounds the per-signal token cost in the rolling window.
const WINDOW_TITLE_MAX_LEN: usize = 120;

/// Maximum length for redacted clipboard content stored in the rolling
/// window. Captures the head of the paste — enough for context, bounded
/// for prompt-token cost. Long clipboard items (code, logs, prose) get
/// truncated with an ellipsis suffix.
const CLIPBOARD_CONTENT_MAX_LEN: usize = 256;

/// Redact a clipboard payload before it enters the rolling window.
///
/// The Sourabh Sharma blueprint and Phase 1 audit both flagged
/// credential-shaped clipboard content as the highest-risk leak surface
/// for an always-listening companion. Pasted secrets routinely include
/// AWS keys, JWTs, Bearer tokens, and provider-prefixed API keys. This
/// function masks each known shape with a typed token (e.g. `[REDACTED:jwt]`)
/// before the content is stored, so the un-redacted secret never reaches
/// the rolling window OR the broadcast channel.
///
/// Strategy:
///   - JWTs (three base64-url-safe segments separated by `.`)
///   - Bearer tokens (literal `Bearer <token>`)
///   - AWS access keys (`AKIA...` + 16 alnum)
///   - Stripe live/test keys (`sk_live_...` / `pk_live_...`)
///   - GitHub fine-grained tokens (`ghp_...`, `github_pat_...`)
///   - Slack bot tokens (`xoxb-...`)
///   - Email addresses → `[email]`
///   - Final length cap at `CLIPBOARD_CONTENT_MAX_LEN`
///
/// Pure (no I/O). Idempotent on already-redacted input.
pub fn redact_clipboard_content(content: &str) -> String {
    use std::sync::OnceLock;
    static PATTERNS: OnceLock<Vec<(regex::Regex, &'static str)>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        vec![
            // JWT: three base64url segments separated by dots, first starts with eyJ.
            (
                regex::Regex::new(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b")
                    .unwrap(),
                "[REDACTED:jwt]",
            ),
            // AWS access key id.
            (
                regex::Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap(),
                "[REDACTED:aws-key]",
            ),
            // Stripe keys (live and test, public and secret).
            (
                regex::Regex::new(r"\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b").unwrap(),
                "[REDACTED:stripe-key]",
            ),
            // GitHub PATs (classic personal-access tokens + fine-grained).
            (
                regex::Regex::new(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b").unwrap(),
                "[REDACTED:github-token]",
            ),
            (
                regex::Regex::new(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b").unwrap(),
                "[REDACTED:github-token]",
            ),
            // Slack bot/user tokens (xoxb / xoxp).
            (
                regex::Regex::new(r"\bxox[bpoa]-[A-Za-z0-9\-]{10,}\b").unwrap(),
                "[REDACTED:slack-token]",
            ),
            // Bearer header — match literal `Bearer ` plus a token-shape suffix.
            (
                regex::Regex::new(r"\bBearer\s+[A-Za-z0-9_\-\.]{16,}\b").unwrap(),
                "Bearer [REDACTED]",
            ),
            // Email addresses.
            (
                regex::Regex::new(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b").unwrap(),
                "[email]",
            ),
        ]
    });

    let mut out = content.to_string();
    for (re, replacement) in patterns.iter() {
        out = re.replace_all(&out, *replacement).into_owned();
    }

    // Length cap — truncate at char boundary, append ellipsis if cut.
    if out.chars().count() > CLIPBOARD_CONTENT_MAX_LEN {
        let truncated: String = out.chars().take(CLIPBOARD_CONTENT_MAX_LEN).collect();
        format!("{truncated}…")
    } else {
        out
    }
}

/// Redact a window title before it enters the rolling ambient window.
///
/// Window titles routinely leak sensitive content — filenames in editor
/// tabs (`~/Documents/Confidential proposal.docx — Word`), URLs with
/// query parameters in browser tabs (`Google Search — paypal login`),
/// email subject lines (`Re: severance terms — Outlook`). The Sourabh
/// Sharma blueprint and Phase 1 audit both call out window-title
/// redaction as Phase 2's mandatory companion to clipboard redaction.
///
/// Strategy:
///   1. Reduce filesystem paths in the title to basenames only —
///      `C:\Users\foo\secret.docx — Word` becomes `secret.docx — Word`.
///   2. Mask email-shaped patterns with `[email]`.
///   3. Mask URL paths beyond the host (preserve domain for context but
///      drop query strings and path segments).
///   4. Cap total length to `WINDOW_TITLE_MAX_LEN` chars.
///
/// Idempotent: redacting an already-redacted title produces the same
/// string. Pure (no I/O, no allocations beyond the result string).
pub fn redact_window_title(title: &str) -> String {
    let mut out = String::with_capacity(title.len());

    // Step 1: reduce filesystem paths to basenames. Match both Windows
    // (`C:\…`, `D:\…`) and POSIX (`/…`) absolute path tokens. Heuristic:
    // a token containing `/` or `\` and at least one path separator is
    // treated as a path; we keep only the part after the final separator.
    for token in title.split_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        let looks_like_path = token.contains('\\')
            || (token.contains('/') && !token.starts_with("http://") && !token.starts_with("https://"));
        if looks_like_path {
            // Take the basename — the last component after the rightmost separator.
            let basename = token
                .rsplit(|c| c == '/' || c == '\\')
                .next()
                .unwrap_or(token);
            out.push_str(basename);
        } else if let Some(at_pos) = token.find('@') {
            // Email-shaped token: replace anything that looks like an
            // email with [email]. Conservative: must have `@` and a dot
            // somewhere after.
            if token[at_pos..].contains('.') {
                out.push_str("[email]");
            } else {
                out.push_str(token);
            }
        } else if token.starts_with("http://") || token.starts_with("https://") {
            // URL: keep scheme+host, drop path/query.
            let host_end = token[8..]
                .find('/')
                .map(|i| i + 8)
                .unwrap_or(token.len());
            out.push_str(&token[..host_end]);
        } else {
            out.push_str(token);
        }
    }

    // Step 4: cap length. Truncate at a char boundary (chars iterator)
    // not byte boundary, otherwise we corrupt multi-byte sequences.
    if out.chars().count() > WINDOW_TITLE_MAX_LEN {
        let truncated: String = out.chars().take(WINDOW_TITLE_MAX_LEN).collect();
        format!("{truncated}…")
    } else {
        out
    }
}

// ---------------------------------------------------------------------------
// Persona-execution prefix helpers (Phase 3 c — daemon/runner bridge)
// ---------------------------------------------------------------------------
//
// Building blocks for injecting "what Athena saw" into persona-execution
// prompts (gap #6 from the Phase 1 audit). The helpers live here because
// the rolling window is owned by `AmbientContextFusion`; runtime call-site
// wiring (engine/mod.rs::run_execution_with_ceiling and the daemon's
// consume_headless_events) is a follow-up commit.
//
// Architectural note — daemon process limitation:
//   The `personas-daemon` binary runs as a separate process from the
//   windowed Tauri app. The clipboard / file_watcher / app_focus
//   watchers live in the windowed process; their captured signals
//   never reach the daemon's address space. So `format_ambient_for_persona`
//   in the daemon path will always return None today — the daemon's
//   AppState doesn't construct an ambient handle either.
//
//   Closing the cross-process gap requires a separate piece of work
//   (likely a SQL-persisted projection of the rolling window OR a
//   tail-able UDS / named-pipe stream the daemon subscribes to). That
//   work is explicitly deferred — the v1 windowed-app wiring is the
//   higher-yield target.

/// Render the ambient context snapshot for a specific persona as a
/// markdown block suitable for prepending to that persona's system
/// prompt. Returns `None` when:
///   - the global `enabled` flag is off
///   - the rolling window is empty after policy filtering
///   - no per-source signals match the persona's `SensoryPolicy`
///
/// Locks the handle for the duration; safe to call from async contexts
/// where the caller already holds nothing on the fusion. Pairs with
/// [`prepend_ambient_to_system_prompt`] for the mutate-the-persona
/// shape that runtime call sites use.
pub async fn format_ambient_for_persona(
    ambient_ctx: &AmbientContextHandle,
    persona_id: &str,
) -> Option<String> {
    let guard = ambient_ctx.lock().await;
    guard.format_for_prompt(persona_id)
}

/// Prepend a rendered ambient context block to a persona's system
/// prompt. Caller-owned mutation — works on a `&mut Persona` so the
/// runtime path can inject without cloning the persona record. The
/// ambient block lands BEFORE the existing system prompt with a blank
/// line separator, so persona-authored instructions remain the
/// recency-weighted last block in the prompt.
///
/// No-op when `ambient_md` is empty or whitespace-only — the goal is
/// to add context, not produce an empty section header.
pub fn prepend_ambient_to_system_prompt(persona: &mut crate::db::models::Persona, ambient_md: &str) {
    if ambient_md.trim().is_empty() {
        return;
    }
    let existing = std::mem::take(&mut persona.system_prompt);
    persona.system_prompt = if existing.trim().is_empty() {
        ambient_md.to_string()
    } else {
        format!("{ambient_md}\n\n{existing}")
    };
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
pub async fn ambient_context_tick(ctx: &AmbientContextHandle) {
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

// ---------------------------------------------------------------------------
// Validation Screenshot Capture
// ---------------------------------------------------------------------------
//
// Lets a persona screenshot a target window (or the full primary screen) and
// feed the resulting PNG back into the LLM for visual verification -- e.g.
// confirming a UI change landed after editing a file or restarting an app.
//
// This is a *capability*, not a default behaviour. runner.rs does NOT
// auto-screenshot; a persona opts in by calling
// `capture_validation_screenshot` explicitly. The resulting file lives under
// `<app_data_dir>/validation_screenshots/` so downstream tools can read it
// back via the standard multimodal Read path.

/// Metadata returned from a validation screenshot capture.
#[cfg(feature = "desktop")]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ValidationScreenshot {
    /// Absolute path to the saved PNG on disk.
    pub path: String,
    /// RFC3339 timestamp when the capture completed.
    pub captured_at: String,
    /// The window title we captured. For full-screen captures this is the
    /// display name (e.g. "Screen 1").
    pub window_title: String,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
}

/// Maximum age of a stored validation screenshot before the auto-prune
/// housekeeping sweep deletes it. Keeps the directory from growing unbounded
/// when a persona loops on validation-heavy tasks.
#[cfg(feature = "desktop")]
const VALIDATION_SCREENSHOT_MAX_AGE: std::time::Duration =
    std::time::Duration::from_secs(24 * 60 * 60); // 24 hours

/// Capture a screenshot of a target window (if its title matches
/// `target_window_title`) or the primary display when no title is given or
/// no matching window is found. Saves the result as a PNG under
/// `<save_dir>/validation_<timestamp>.png` and returns metadata the agent
/// can use to read it back.
///
/// Designed for visual validation loops:
///   1. Agent makes a UI change (writes a file, restarts an app, etc.)
///   2. Agent calls this function to capture the current state
///   3. Agent reads the resulting PNG via its multimodal Read path
///   4. Agent confirms the change worked or iterates
///
/// NOTE: full-screen capture is the current fallback. `xcap 0.7`
/// per-window captures are inconsistent on Wayland, so the match logic
/// stays conservative until upstream stabilizes.
#[cfg(feature = "desktop")]
pub async fn capture_validation_screenshot(
    target_window_title: Option<&str>,
    save_dir: &std::path::Path,
) -> Result<ValidationScreenshot, crate::error::AppError> {
    use crate::error::AppError;

    // Ensure the save dir exists before any capture attempts.
    tokio::fs::create_dir_all(save_dir).await.map_err(|e| {
        AppError::Internal(format!(
            "Failed to create validation screenshot dir {}: {e}",
            save_dir.display()
        ))
    })?;

    // Opportunistic prune of old captures. Failures here are non-fatal --
    // we don't want a housekeeping hiccup to block the primary operation.
    if let Err(e) = prune_old_validation_screenshots(save_dir).await {
        tracing::debug!("Validation screenshot prune failed (non-fatal): {e}");
    }

    // Clone the target title into an owned String so the synchronous
    // spawn_blocking closure can own its captured data.
    let target_title_owned = target_window_title.map(|s| s.to_string());
    let save_dir_owned = save_dir.to_path_buf();

    // xcap's capture API is blocking + not Send-safe across awaits, so run
    // it on a blocking thread.
    let result = tokio::task::spawn_blocking(
        move || -> Result<ValidationScreenshot, String> {
            use xcap::{Monitor, Window};

            // First, try to find a window by title (exact, then substring).
            let mut captured: Option<(image::RgbaImage, String)> = None;

            if let Some(ref wanted) = target_title_owned {
                if let Ok(windows) = Window::all() {
                    // Prefer an exact title match.
                    let hit = windows
                        .iter()
                        .find(|w| w.title().map(|t| t == *wanted).unwrap_or(false))
                        .or_else(|| {
                            // Fall back to substring match.
                            windows.iter().find(|w| {
                                w.title()
                                    .map(|t| t.contains(wanted.as_str()))
                                    .unwrap_or(false)
                            })
                        });
                    if let Some(w) = hit {
                        match w.capture_image() {
                            Ok(img) => {
                                let title = w
                                    .title()
                                    .ok()
                                    .unwrap_or_else(|| wanted.clone());
                                captured = Some((img, title));
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "Per-window capture failed for '{wanted}': {e}. Falling back to primary display."
                                );
                            }
                        }
                    }
                }
            }

            // Fall back to the primary monitor when window capture didn't
            // happen (no target supplied, no match, or capture failure).
            if captured.is_none() {
                let monitors = Monitor::all()
                    .map_err(|e| format!("Failed to enumerate monitors: {e}"))?;
                let primary = monitors
                    .into_iter()
                    .next()
                    .ok_or_else(|| "No monitors available for capture".to_string())?;
                let title = primary
                    .name()
                    .ok()
                    .unwrap_or_else(|| "Primary Display".to_string());
                let img = primary
                    .capture_image()
                    .map_err(|e| format!("Monitor capture failed: {e}"))?;
                captured = Some((img, title));
            }

            let (img, window_title) =
                captured.ok_or_else(|| "No capture produced".to_string())?;
            let width = img.width();
            let height = img.height();

            let ts = chrono::Utc::now();
            let filename = format!(
                "validation_{}.png",
                ts.format("%Y%m%dT%H%M%S%.3fZ")
            );
            let path = save_dir_owned.join(&filename);
            img.save(&path)
                .map_err(|e| format!("Failed to write PNG to {}: {e}", path.display()))?;

            Ok(ValidationScreenshot {
                path: path.to_string_lossy().to_string(),
                captured_at: ts.to_rfc3339(),
                window_title,
                width,
                height,
            })
        },
    )
    .await
    .map_err(|e| AppError::Internal(format!("Capture task join error: {e}")))?;

    result.map_err(AppError::Internal)
}

/// Delete screenshots older than `VALIDATION_SCREENSHOT_MAX_AGE` from the
/// save directory. Silently skips files it can't stat.
#[cfg(feature = "desktop")]
async fn prune_old_validation_screenshots(
    save_dir: &std::path::Path,
) -> Result<(), std::io::Error> {
    let mut entries = match tokio::fs::read_dir(save_dir).await {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let cutoff = std::time::SystemTime::now()
        .checked_sub(VALIDATION_SCREENSHOT_MAX_AGE)
        .unwrap_or(std::time::UNIX_EPOCH);
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("png") {
            continue;
        }
        if let Ok(meta) = entry.metadata().await {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = tokio::fs::remove_file(&path).await;
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
impl AmbientContextFusion {
    /// Test helper: create a fusion with all per-source gates enabled.
    /// Default `new()` returns all sources OFF (the production privacy
    /// contract); tests that exercise the push paths and don't care about
    /// the gate semantics should call this instead.
    fn new_for_tests() -> Self {
        let mut f = Self::new();
        f.set_source_enabled("clipboard", true);
        f.set_source_enabled("file_watcher", true);
        f.set_source_enabled("app_focus", true);
        f
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_push_and_snapshot() {
        let mut fusion = AmbientContextFusion::new_for_tests();
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
        let mut fusion = AmbientContextFusion::new_for_tests();
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
        let mut fusion = AmbientContextFusion::new_for_tests();
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
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.set_enabled(false);
        fusion.push_clipboard("text", 10);
        let snap = fusion.snapshot_for_persona("any");
        assert!(!snap.enabled);
        assert!(snap.signals.is_empty());
    }

    #[test]
    fn test_window_eviction() {
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.default_policy.max_window_size = 5;
        for i in 0..10 {
            fusion.push_clipboard("text", i * 10);
        }
        // Should have at most 5 signals
        assert!(fusion.signals.len() <= 5);
    }

    #[test]
    fn test_format_for_prompt() {
        let mut fusion = AmbientContextFusion::new_for_tests();
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
        let mut fusion = AmbientContextFusion::new_for_tests();
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
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.set_enabled(false);
        assert!(fusion.format_for_prompt("p1").is_none());
    }

    #[test]
    fn test_buffer_adapts_to_registered_policies() {
        let mut fusion = AmbientContextFusion::new_for_tests();
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
        let mut fusion = AmbientContextFusion::new_for_tests();
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
        let mut fusion = AmbientContextFusion::new_for_tests();
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

    /// Smoke test: capturing to a fresh save dir creates the dir, writes a
    /// PNG, and returns metadata pointing at the new file. This doesn't
    /// validate the pixel content (which depends on the host display and
    /// isn't meaningful in CI), only that the path on disk is real.
    #[cfg(feature = "desktop")]
    #[tokio::test]
    async fn test_capture_validation_screenshot_writes_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let save_dir = tmp.path().join("validation_screenshots");
        // Dir should NOT exist yet -- capture creates it.
        assert!(!save_dir.exists());

        let result = capture_validation_screenshot(None, &save_dir).await;

        // In headless CI there may be no displays at all -- in that case
        // xcap returns an error. We accept either outcome: if capture
        // succeeds, the file must exist; if it fails, it must be the
        // "no monitors" path, not a Rust panic.
        match result {
            Ok(shot) => {
                assert!(save_dir.exists(), "save dir should be created");
                let p = std::path::PathBuf::from(&shot.path);
                assert!(p.exists(), "screenshot file should exist on disk");
                assert!(p.extension().and_then(|e| e.to_str()) == Some("png"));
                assert!(shot.width > 0 && shot.height > 0);
                assert!(!shot.captured_at.is_empty());
            }
            Err(e) => {
                // Acceptable on headless hosts: no monitor / wayland permission
                // denied / etc. We just want to make sure we don't panic.
                let msg = format!("{e}");
                tracing::info!(
                    "capture_validation_screenshot error (expected in headless CI): {msg}"
                );
            }
        }
    }

    #[test]
    fn test_buffer_shrinks_after_policy_update() {
        let mut fusion = AmbientContextFusion::new_for_tests();
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

    // ── Per-source gate (Phase 2 v1) ──────────────────────────────────────

    #[test]
    fn new_starts_with_all_sources_off() {
        // Privacy contract: a fresh fusion has every per-source gate OFF
        // until the user opts in. This is the default-off promise.
        let fusion = AmbientContextFusion::new();
        assert!(!fusion.is_source_enabled("clipboard"));
        assert!(!fusion.is_source_enabled("file_watcher"));
        assert!(!fusion.is_source_enabled("app_focus"));
        // Master switch defaults on (the kill-switch shape — present but
        // rarely toggled). Per-source gates carry the privacy guarantee.
        assert!(fusion.is_enabled());
    }

    #[test]
    fn push_skips_when_per_source_gate_off() {
        let mut fusion = AmbientContextFusion::new(); // all sources OFF
        fusion.push_clipboard("text", 100);
        fusion.push_file_change("modify", &["a.rs".to_string()]);
        fusion.push_app_focus("Code.exe", "main.rs");
        assert_eq!(fusion.signals.len(), 0);
        assert_eq!(fusion.total_captured, 0);
    }

    #[test]
    fn push_captures_when_per_source_gate_on() {
        let mut fusion = AmbientContextFusion::new();
        fusion.set_source_enabled("clipboard", true);
        fusion.push_clipboard("text", 50);
        // file_watcher + app_focus still OFF
        fusion.push_file_change("modify", &["a.rs".to_string()]);
        fusion.push_app_focus("Code.exe", "main.rs");
        assert_eq!(fusion.signals.len(), 1, "only clipboard should land");
        assert_eq!(fusion.signals[0].source, "clipboard");
    }

    #[test]
    fn disable_source_purges_prior_signals() {
        let mut fusion = AmbientContextFusion::new_for_tests(); // all on
        fusion.push_clipboard("text", 10);
        fusion.push_clipboard("text", 20);
        fusion.push_app_focus("Code.exe", "main.rs");
        assert_eq!(fusion.signals.len(), 3);
        // Disable clipboard — its signals must be purged.
        let purged = fusion.set_source_enabled("clipboard", false);
        assert_eq!(purged, 2, "should purge 2 clipboard signals");
        assert_eq!(fusion.signals.len(), 1);
        assert_eq!(fusion.signals[0].source, "app_focus");
    }

    #[test]
    fn disable_app_focus_clears_current_state() {
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.push_app_focus("Code.exe", "main.rs");
        assert!(fusion.current_app.is_some());
        assert!(fusion.current_window_title.is_some());
        fusion.set_source_enabled("app_focus", false);
        assert!(
            fusion.current_app.is_none(),
            "current_app should clear on app_focus disable"
        );
        assert!(
            fusion.current_window_title.is_none(),
            "current_window_title should clear on app_focus disable"
        );
    }

    #[test]
    fn enable_source_does_not_replay_signals() {
        let mut fusion = AmbientContextFusion::new(); // OFF
        fusion.push_clipboard("text", 10); // dropped
        fusion.set_source_enabled("clipboard", true); // late opt-in
        // Enabling AFTER a push must NOT replay the dropped signal —
        // the user said "start now," not "include the past."
        assert_eq!(fusion.signals.len(), 0);
    }

    #[test]
    fn unknown_source_name_fails_closed() {
        let mut fusion = AmbientContextFusion::new();
        // Unknown sources read as false (don't capture) and the setter
        // is a no-op (doesn't add a new field).
        assert!(!fusion.is_source_enabled("nonsense"));
        let purged = fusion.set_source_enabled("nonsense", true);
        assert_eq!(purged, 0);
        assert!(!fusion.is_source_enabled("nonsense"));
    }

    #[test]
    fn source_state_reports_per_source_counts() {
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.push_clipboard("text", 10);
        fusion.push_clipboard("text", 20);
        fusion.push_file_change("modify", &["a.rs".to_string()]);
        let state = fusion.source_state();
        assert!(state.global_enabled);
        assert!(state.clipboard_enabled);
        assert!(state.file_changes_enabled);
        assert!(state.app_focus_enabled);
        assert_eq!(state.clipboard_signals_in_window, 2);
        assert_eq!(state.file_changes_signals_in_window, 1);
        assert_eq!(state.app_focus_signals_in_window, 0);
        assert_eq!(state.total_signals_captured, 3);
    }

    // ── Window-title redaction ────────────────────────────────────────────

    #[test]
    fn redact_title_strips_filesystem_paths_to_basename() {
        // Editor tabs typically render as `<full path> — <app>`. The
        // basename is the visible part the user expects to see; the
        // directory chain is the leak.
        assert_eq!(
            redact_window_title("C:\\Users\\foo\\Documents\\secret.docx — Word"),
            "secret.docx — Word"
        );
        assert_eq!(
            redact_window_title("/home/user/projects/personas/main.rs - Code"),
            "main.rs - Code"
        );
    }

    #[test]
    fn redact_title_masks_emails() {
        assert_eq!(
            redact_window_title("Re: design review john.doe@example.com — Outlook"),
            "Re: design review [email] — Outlook"
        );
    }

    #[test]
    fn redact_title_strips_url_path_and_query() {
        // Browser titles often expose the full URL in the tab. Keeping
        // host but dropping path+query reduces leak surface while
        // preserving "user is on github.com" context.
        let out = redact_window_title("Issue #42 — https://github.com/owner/repo/issues/42?token=secret");
        assert!(out.contains("https://github.com"));
        assert!(!out.contains("token=secret"));
        assert!(!out.contains("/owner/repo"));
    }

    #[test]
    fn redact_title_truncates_long_input() {
        let long = "x".repeat(500);
        let out = redact_window_title(&long);
        // Truncated to the cap with an ellipsis suffix.
        assert!(out.chars().count() <= WINDOW_TITLE_MAX_LEN + 1);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn redact_title_idempotent_on_clean_input() {
        let clean = "main.rs - Code";
        assert_eq!(redact_window_title(clean), clean);
    }

    // ── list_signals + delete_signal (Phase 2 v3) ─────────────────────────

    #[test]
    fn each_signal_gets_a_unique_stable_id() {
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.push_clipboard("text", 10);
        fusion.push_clipboard("text", 20);
        fusion.push_file_change("modify", &["a.rs".to_string()]);
        let ids: Vec<String> = fusion.signals.iter().map(|s| s.id.clone()).collect();
        assert_eq!(ids, vec!["sig_0", "sig_1", "sig_2"]);
        // Counter is monotonic across pushes; ids never reused.
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), 3);
    }

    #[test]
    fn list_signals_returns_newest_first() {
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.push_clipboard("text", 10);
        fusion.push_clipboard("text", 20);
        fusion.push_clipboard("text", 30);
        let listed = fusion.list_signals(None, 10);
        assert_eq!(listed.len(), 3);
        // Newest (sig_2) first.
        assert_eq!(listed[0].id, "sig_2");
        assert_eq!(listed[2].id, "sig_0");
    }

    #[test]
    fn list_signals_filters_by_source() {
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.push_clipboard("text", 10);
        fusion.push_file_change("modify", &["a.rs".to_string()]);
        fusion.push_app_focus("Code.exe", "main.rs");
        let clipboard = fusion.list_signals(Some("clipboard"), 10);
        assert_eq!(clipboard.len(), 1);
        assert_eq!(clipboard[0].source, "clipboard");
        let app = fusion.list_signals(Some("app_focus"), 10);
        assert_eq!(app.len(), 1);
        assert_eq!(app[0].source, "app_focus");
    }

    #[test]
    fn list_signals_respects_limit() {
        let mut fusion = AmbientContextFusion::new_for_tests();
        for i in 0..5 {
            fusion.push_clipboard("text", i * 10);
        }
        let listed = fusion.list_signals(None, 3);
        assert_eq!(listed.len(), 3);
        // Newest 3.
        assert_eq!(listed[0].id, "sig_4");
        assert_eq!(listed[2].id, "sig_2");
    }

    #[test]
    fn delete_signal_removes_target() {
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.push_clipboard("text", 10);
        fusion.push_clipboard("text", 20);
        fusion.push_clipboard("text", 30);
        let removed = fusion.delete_signal("sig_1");
        assert!(removed);
        assert_eq!(fusion.signals.len(), 2);
        let remaining_ids: Vec<&str> = fusion.signals.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(remaining_ids, vec!["sig_0", "sig_2"]);
    }

    #[test]
    fn delete_signal_returns_false_for_unknown_id() {
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.push_clipboard("text", 10);
        // Idempotent: calling twice on a non-existent id is safe.
        assert!(!fusion.delete_signal("sig_999"));
        assert!(!fusion.delete_signal("sig_999"));
        assert_eq!(fusion.signals.len(), 1);
    }

    #[test]
    fn delete_signal_after_eviction_returns_false() {
        // Simulate an already-evicted signal: capture, evict by setting a
        // tiny window cap via policy, then attempt to delete the original.
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.push_clipboard("text", 10); // sig_0
        // Force eviction by registering a 0-size policy and pushing more.
        fusion.set_policy(
            "p1".to_string(),
            SensoryPolicy {
                max_window_size: 1,
                ..Default::default()
            },
        );
        fusion.push_clipboard("text", 20); // sig_1 — pushes sig_0 out
        // sig_0 has been evicted; delete is a no-op.
        assert!(!fusion.delete_signal("sig_0"));
        assert!(fusion.delete_signal("sig_1"));
    }

    // ── Persona-execution prefix helpers (Phase 3 c) ──────────────────────

    fn make_persona(system_prompt: &str) -> crate::db::models::Persona {
        // Construct a minimal Persona for prefix-injection tests. The
        // prepend helper only reads/writes `system_prompt`; the rest
        // are filled with sensible defaults so the struct compiles.
        crate::db::models::Persona {
            id: "p_test".into(),
            project_id: "proj_test".into(),
            name: "Test".into(),
            description: None,
            system_prompt: system_prompt.to_string(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            sensitive: false,
            headless: false,
            max_concurrent: 1,
            timeout_ms: 60_000,
            notification_channels: None,
            last_design_result: None,
            last_test_report: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            home_team_id: None,
            source_review_id: None,
            trust_level: crate::db::models::PersonaTrustLevel::Verified,
            trust_origin: crate::db::models::PersonaTrustOrigin::default(),
            trust_verified_at: None,
            trust_score: 1.0,
            parameters: None,
            gateway_exposure: Default::default(),
            template_category: None,
            cli_awareness_enabled: false,
            langfuse_export_enabled: true,
            setup_status: "ready".to_string(),
            setup_detail: None,
            disabled_dims_json: None,
            created_at: "2026-05-09T00:00:00Z".into(),
            updated_at: "2026-05-09T00:00:00Z".into(),
        }
    }

    #[test]
    fn prepend_ambient_to_empty_system_prompt() {
        let mut p = make_persona("");
        prepend_ambient_to_system_prompt(&mut p, "## Ambient\nactivity here");
        assert_eq!(p.system_prompt, "## Ambient\nactivity here");
    }

    #[test]
    fn prepend_ambient_to_existing_system_prompt() {
        let mut p = make_persona("You are a helpful assistant.");
        prepend_ambient_to_system_prompt(&mut p, "## Ambient\nactivity here");
        // Ambient lands first, then a blank line, then the original prompt.
        assert!(p.system_prompt.starts_with("## Ambient\nactivity here"));
        assert!(p.system_prompt.ends_with("You are a helpful assistant."));
        assert!(p.system_prompt.contains("\n\nYou are a helpful assistant."));
    }

    #[test]
    fn prepend_ambient_noop_on_empty_block() {
        let mut p = make_persona("Hello");
        prepend_ambient_to_system_prompt(&mut p, "");
        assert_eq!(p.system_prompt, "Hello");
        prepend_ambient_to_system_prompt(&mut p, "   \n\t  ");
        assert_eq!(p.system_prompt, "Hello");
    }

    #[tokio::test]
    async fn format_ambient_for_persona_returns_none_when_empty() {
        let handle = create_ambient_context();
        // Empty rolling window → no markdown block.
        let out = format_ambient_for_persona(&handle, "p_test").await;
        assert!(out.is_none());
    }

    #[tokio::test]
    async fn format_ambient_for_persona_returns_some_when_signals_present() {
        let handle = create_ambient_context();
        {
            let mut g = handle.lock().await;
            *g = AmbientContextFusion::new_for_tests();
            g.push_clipboard_with_content("text", "deploy plan for staging");
        }
        let out = format_ambient_for_persona(&handle, "p_test").await;
        assert!(out.is_some());
        let md = out.unwrap();
        assert!(md.contains("Ambient Desktop Context"));
        assert!(md.contains("clipboard"));
    }

    #[tokio::test]
    async fn format_then_prepend_round_trip() {
        // End-to-end: capture a signal, render for persona, inject into
        // a persona's system prompt. Demonstrates the wiring shape that
        // future runtime callers (engine/mod.rs) will use.
        let handle = create_ambient_context();
        {
            let mut g = handle.lock().await;
            *g = AmbientContextFusion::new_for_tests();
            g.push_app_focus("Code.exe", "main.rs - personas");
        }
        let md = format_ambient_for_persona(&handle, "p_test")
            .await
            .expect("snapshot should render");
        let mut persona = make_persona("Be terse.");
        prepend_ambient_to_system_prompt(&mut persona, &md);
        assert!(persona.system_prompt.contains("Ambient Desktop Context"));
        assert!(persona.system_prompt.contains("Be terse."));
        // Original content preserved at the end.
        assert!(persona.system_prompt.ends_with("Be terse."));
    }

    // ── Clipboard content capture + redaction (Phase 3 v1) ────────────────

    #[test]
    fn redact_clipboard_masks_jwt() {
        let raw = "Authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4f";
        let out = redact_clipboard_content(raw);
        assert!(!out.contains("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
        assert!(out.contains("[REDACTED:jwt]"));
    }

    #[test]
    fn redact_clipboard_masks_aws_key() {
        let raw = "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
        let out = redact_clipboard_content(raw);
        assert!(!out.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(out.contains("[REDACTED:aws-key]"));
    }

    #[test]
    fn redact_clipboard_masks_stripe_keys() {
        let raw = "stripe.api_key = sk_live_4eC39HqLyjWDarjtT1zdp7dc";
        let out = redact_clipboard_content(raw);
        assert!(!out.contains("sk_live_4eC39HqLyjWDarjtT1zdp7dc"));
        assert!(out.contains("[REDACTED:stripe-key]"));
    }

    #[test]
    fn redact_clipboard_masks_github_pat() {
        let raw = "git remote set-url origin https://oauth2:ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456@github.com/owner/repo";
        let out = redact_clipboard_content(raw);
        assert!(!out.contains("ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456"));
        assert!(out.contains("[REDACTED:github-token]"));
    }

    #[test]
    fn redact_clipboard_masks_slack_token() {
        let raw = "slack_bot_token=xoxb-1234567890-1234567890-AbCdEfGhIjKlMnOpQrStUvWx";
        let out = redact_clipboard_content(raw);
        assert!(!out.contains("xoxb-1234567890-1234567890-AbCdEfGhIjKlMnOpQrStUvWx"));
        assert!(out.contains("[REDACTED:slack-token]"));
    }

    #[test]
    fn redact_clipboard_masks_bearer_token() {
        let raw = "curl -H 'Authorization: Bearer abc123def456ghi789jklmnopqr_-.xyz' https://api.example.com";
        let out = redact_clipboard_content(raw);
        assert!(!out.contains("abc123def456ghi789jklmnopqr"));
        assert!(out.contains("Bearer [REDACTED]"));
    }

    #[test]
    fn redact_clipboard_masks_emails() {
        let raw = "Send the report to alice@example.com and bob.smith@company.co.uk by Friday.";
        let out = redact_clipboard_content(raw);
        assert!(!out.contains("alice@example.com"));
        assert!(!out.contains("bob.smith@company.co.uk"));
        assert!(out.matches("[email]").count() == 2);
    }

    #[test]
    fn redact_clipboard_truncates_long_input() {
        let raw = "x".repeat(2000);
        let out = redact_clipboard_content(&raw);
        // Cap at CLIPBOARD_CONTENT_MAX_LEN with ellipsis suffix.
        assert!(out.chars().count() <= CLIPBOARD_CONTENT_MAX_LEN + 1);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn redact_clipboard_idempotent_on_clean_text() {
        let clean = "TODO: refactor the cache eviction logic in dedupedStorage.ts";
        assert_eq!(redact_clipboard_content(clean), clean);
    }

    #[test]
    fn redact_clipboard_handles_multiple_secrets() {
        let raw = "key=AKIAIOSFODNN7EXAMPLE jwt=eyJhbGc.payload.sig and email=foo@bar.com";
        let out = redact_clipboard_content(raw);
        assert!(out.contains("[REDACTED:aws-key]"));
        assert!(out.contains("[REDACTED:jwt]"));
        assert!(out.contains("[email]"));
        assert!(!out.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(!out.contains("foo@bar.com"));
    }

    #[test]
    fn push_clipboard_with_content_redacts_before_storing() {
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.push_clipboard_with_content(
            "text",
            "ghp_SuperSecretGitHubToken123456789012345 — please don't store this",
        );
        assert_eq!(fusion.signals.len(), 1);
        let stored = fusion.signals[0].redacted_content.as_deref();
        assert!(stored.is_some());
        let stored = stored.unwrap();
        assert!(stored.contains("[REDACTED:github-token]"));
        assert!(!stored.contains("ghp_SuperSecretGitHubToken123456789012345"));
    }

    #[test]
    fn push_clipboard_with_content_skips_when_gate_off() {
        let mut fusion = AmbientContextFusion::new(); // clipboard gate OFF
        fusion.push_clipboard_with_content("text", "any content");
        assert_eq!(fusion.signals.len(), 0);
    }

    #[test]
    fn push_clipboard_summary_uses_raw_length_not_redacted_length() {
        let mut fusion = AmbientContextFusion::new_for_tests();
        let raw = "x".repeat(2000);
        fusion.push_clipboard_with_content("text", &raw);
        // Summary shows the original 2000-char length so the user sees
        // what was actually pasted, even though stored content is capped.
        assert!(fusion.signals[0].summary.contains("2000 chars"));
    }

    // ── push_app_focus redaction (Phase 2 v1) ──────────────────────────────

    #[test]
    fn push_app_focus_redacts_before_storing() {
        let mut fusion = AmbientContextFusion::new_for_tests();
        fusion.push_app_focus(
            "Word.exe",
            "C:\\Users\\foo\\Documents\\Confidential proposal.docx — Word",
        );
        // The stored signal summary AND current_window_title must both be redacted.
        assert!(fusion
            .current_window_title
            .as_ref()
            .map(|t| !t.contains("C:\\Users"))
            .unwrap_or(false));
        assert_eq!(fusion.signals.len(), 1);
        assert!(!fusion.signals[0].summary.contains("C:\\Users"));
    }
}
