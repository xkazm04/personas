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
//! ## Phases
//!
//! - **Phase 0:** namespace + [`ProjectTracker`] placeholder + AppState slot.
//! - **Phase 1 (this commit):** `events`, `subscription`, `watchers/{git,ledger}`,
//!   `scheduler`. 1h tick driver, no LLM yet — just ingestion.
//! - Phase 2: `consolidator`, `pulse`; emits `project-tracking://pulse-updated`.
//! - Phase 3: `push` — out-of-cadence trigger from local_http.
//! - Phase 6: `watchers/obsidian` (gated on Obsidian credential detection).

pub mod events;
pub mod scheduler;
pub mod subscription;
pub mod watchers;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::task::JoinHandle;

use crate::db::UserDbPool;

/// Engine project tracking subsystem.
///
/// Always present in [`AppState`](crate::AppState); the
/// `enabled` flag (set by the Companion master toggle) gates whether the
/// scheduler tick is doing work. This avoids the lifecycle complexity of
/// replacing an `Option<Arc<...>>` at runtime — the watcher loop checks
/// the flag each tick and short-circuits when off.
pub struct ProjectTracker {
    /// Master enable gate. Flipped from the Companion plugin's "Track
    /// development activity" toggle in setup.
    pub enabled: Arc<AtomicBool>,
    /// JoinHandle for the spawned scheduler loop. None until [`start`]
    /// is called from the Tauri setup hook.
    scheduler_handle: std::sync::Mutex<Option<JoinHandle<()>>>,
}

impl ProjectTracker {
    pub fn new() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(false)),
            scheduler_handle: std::sync::Mutex::new(None),
        }
    }

    /// Spawn the scheduler tokio task. Called once from Tauri's setup
    /// hook after `AppState` is built. Idempotent: a second call is a
    /// no-op (we don't want to multi-spawn the loop on accidental
    /// re-init paths like Tauri dev hot-reload).
    pub fn start(&self, pool: UserDbPool) {
        let mut guard = match self.scheduler_handle.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        if guard.is_some() {
            tracing::debug!(
                "project_tracking: scheduler already started; ignoring duplicate start()"
            );
            return;
        }
        let handle = scheduler::spawn(pool, self.enabled.clone());
        *guard = Some(handle);
    }

    /// Flip the master enable gate. The next scheduler tick observes
    /// the new value and acts accordingly.
    pub fn set_enabled(&self, on: bool) {
        self.enabled.store(on, Ordering::Relaxed);
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }
}

impl Default for ProjectTracker {
    fn default() -> Self {
        Self::new()
    }
}
