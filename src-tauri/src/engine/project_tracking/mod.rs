//! Project tracking — engine subsystem that absorbs CLI activity (git
//! commits, active-runs ledger entries, optional Obsidian notes), keeps a
//! capped raw event log, and runs an hourly consolidator (Sonnet 4.6) that
//! produces a stable per-project "pulse" — narrative + 3-5 named
//! directions + 0-3 tensions. Companion's brain consumes the pulse via the
//! `project-tracking://pulse-updated` event; users discuss it in chat when
//! both the Companion master toggle (in plugin setup) and the Dev Tools
//! chat toggle are ON.
//!
//! ## Ownership
//!
//! - **This module (engine):** watchers, scheduler, consolidator, raw
//!   events, pulse rows, the local_http push endpoint.
//! - **Dev Tools plugin:** project registry (`companion_known_project`)
//!   plus per-project subscription config (`dev_tools_project_subscription`
//!   — watch flags, obsidian vault path, enabled gate).
//! - **Companion:** master toggle in plugin setup, brain integration
//!   (`companion::project_pulse_consumer`), prompt injection in chat.
//!
//! ## Phase 0 (this commit)
//!
//! Lays the namespace + the [`ProjectTracker`] placeholder struct so the
//! AppState slot compiles. Submodules land in subsequent phases:
//!
//! - Phase 1: `watchers/{git,ledger}`, `events`, `scheduler` (no LLM).
//! - Phase 2: `consolidator`, `pulse`, emits `project-tracking://pulse-updated`.
//! - Phase 3: `push` — out-of-cadence trigger from local_http.
//! - Phase 6: `watchers/obsidian` (when an Obsidian credential is detected).

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

/// Engine project tracking subsystem.
///
/// Always present in [`AppState`](crate::AppState); the
/// `enabled` flag (set by the Companion master toggle) gates whether the
/// scheduler tick is doing work. This avoids the lifecycle complexity of
/// replacing an `Option<Arc<...>>` at runtime — the watcher loop checks
/// the flag each tick and short-circuits when off.
///
/// Phase 0 is a placeholder; Phase 1 wires the scheduler.
pub struct ProjectTracker {
    /// Master enable gate. Flipped from the Companion plugin's "Track
    /// development activity" toggle in setup.
    pub enabled: Arc<AtomicBool>,
}

impl ProjectTracker {
    pub fn new() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl Default for ProjectTracker {
    fn default() -> Self {
        Self::new()
    }
}
