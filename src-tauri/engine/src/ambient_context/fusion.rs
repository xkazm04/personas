use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{
    format_signals_for_prompt, redact_clipboard_content, redact_window_title,
    AmbientContextSnapshot, AmbientSignal, AmbientSignalEntry, ContextEvent, ContextStreamReceiver,
    ContextStreamSender, ContextStreamStats, SensoryPolicy, SensorySourceState,
    CONTEXT_STREAM_CAPACITY,
};
use tokio::sync::Mutex;

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
    pub(crate) signals: VecDeque<AmbientSignal>,
    /// Per-persona sensory policies: persona_id -> policy. These filter
    /// at *consumption* (when a persona reads the snapshot); the per-source
    /// gates above filter at *capture*. Both layers exist intentionally —
    /// capture-time gating enforces the user's privacy promise; consumption-
    /// time policies let multiple personas with different scopes share the
    /// same captured stream.
    policies: std::collections::HashMap<String, SensoryPolicy>,
    /// Current foreground app info.
    pub(crate) current_app: Option<String>,
    pub(crate) current_window_title: Option<String>,
    /// Default policy for personas without an explicit one.
    pub(crate) default_policy: SensoryPolicy,
    /// Monotonic counter for total signals captured.
    pub(crate) total_captured: u64,
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
        let by_source =
            |src: &str| -> u32 { self.signals.iter().filter(|s| s.source == src).count() as u32 };
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
        Some(self.push_signal_with_payload("clipboard", summary, Vec::new(), Some(redacted)))
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
    pub fn push_file_change(&mut self, kind: &str, paths: &[String]) -> Option<AmbientSignal> {
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
    pub fn push_app_focus(&mut self, app_name: &str, window_title: &str) -> Option<AmbientSignal> {
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

    /// Build-time connector evidence: which of the supplied connector
    /// `keywords` appear in the current ambient state, ranked newest-first.
    ///
    /// Used by the build-session gate seeder (`build_session::gates`) to
    /// pre-rank the connector-picker options when the user's stated intent
    /// is silent about which service to wire — e.g. the user is building a
    /// persona while `github.com` is the focused tab, or `*.docx` files just
    /// landed in a watched folder.
    ///
    /// Privacy posture: this is *persona-agnostic* on purpose (there is no
    /// persona yet during a build) so it bypasses per-persona `SensoryPolicy`,
    /// but it still honours the master `enabled` switch and only ever reads
    /// signals that the per-source capture gates already let into the window
    /// (clipboard content arrives pre-redacted). Critically, it returns
    /// **only matched keywords from the caller-supplied connector vocabulary**
    /// — never raw window titles, file paths, or clipboard text. The output
    /// is a small set of service identifiers, so no ambient content can leak
    /// into the build UI or the persona prompt through this path.
    ///
    /// Returns an empty Vec when disabled, when there are no signals, or when
    /// nothing matches. Multi-word keywords (`"google drive"`) are matched as
    /// substrings; matching is case-insensitive.
    pub fn connector_evidence(&self, keywords: &[String]) -> Vec<String> {
        if !self.enabled || keywords.is_empty() {
            return Vec::new();
        }

        // Ordered fragments, newest-first: the active app/title is "right
        // now", then the rolling window from newest to oldest. Each fragment
        // is matched independently so the first (most recent) appearance of a
        // keyword fixes its rank.
        let mut fragments: Vec<String> = Vec::new();
        if let Some(app) = &self.current_app {
            let mut frag = app.to_lowercase();
            if let Some(title) = &self.current_window_title {
                frag.push(' ');
                frag.push_str(&title.to_lowercase());
            }
            fragments.push(frag);
        }
        for sig in self.signals.iter().rev() {
            let mut frag = sig.summary.to_lowercase();
            if let Some(content) = &sig.redacted_content {
                frag.push(' ');
                frag.push_str(&content.to_lowercase());
            }
            for path in &sig.raw_paths {
                frag.push(' ');
                frag.push_str(&path.to_lowercase());
            }
            fragments.push(frag);
        }

        let lowered: Vec<String> = keywords.iter().map(|k| k.to_lowercase()).collect();
        let mut matched: Vec<String> = Vec::new();
        for frag in &fragments {
            for (kw_lower, kw_original) in lowered.iter().zip(keywords.iter()) {
                if kw_lower.is_empty() {
                    continue;
                }
                if frag.contains(kw_lower) && !matched.iter().any(|m| m == kw_original) {
                    matched.push(kw_original.clone());
                }
            }
        }
        matched
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

#[cfg(test)]
impl AmbientContextFusion {
    /// Test helper: create a fusion with all per-source gates enabled.
    /// Default `new()` returns all sources OFF (the production privacy
    /// contract); tests that exercise the push paths and don't care about
    /// the gate semantics should call this instead.
    pub(crate) fn new_for_tests() -> Self {
        let mut f = Self::new();
        f.set_source_enabled("clipboard", true);
        f.set_source_enabled("file_watcher", true);
        f.set_source_enabled("app_focus", true);
        f
    }
}
