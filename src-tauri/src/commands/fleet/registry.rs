//! Process-wide registry of active Fleet sessions.
//!
//! One global `FleetRegistry` holds every active PTY-backed Claude Code
//! session keyed by our internal `id` (UUID v4 string). Phase 2 lives here
//! in skeleton form; phase 6 extends it with the full state machine and
//! JSONL-driven staleness reaper.
//!
//! Resource ownership:
//! - `master` (for resize) and `writer` (for write_input) are stored
//!   here behind `parking_lot::Mutex<Option<...>>`.
//! - The PTY **reader** and the spawned **child** are NOT held here — they
//!   move into their respective tokio blocking tasks (see `pty::spawn_session`).
//!   This avoids cross-task lock dances when the reader is blocked on read.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use portable_pty::MasterPty;

use super::types::{FleetSession, FleetSessionState};

/// Inner per-session record. The shape returned to the UI is
/// [`FleetSession`] (built via [`FleetSessionInner::to_dto`]).
pub struct FleetSessionInner {
    pub id: String,
    pub claude_session_id: Option<String>,
    pub cwd: PathBuf,
    pub project_label: String,
    /// User-supplied display name. None by default; settable via
    /// fleet_rename_session.
    pub name: Option<String>,
    pub args: Vec<String>,
    pub state: FleetSessionState,
    pub last_activity_ms: i64,
    pub created_at_ms: i64,
    pub child_pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub state_reason: Option<String>,
    /// PTY master — needed for resize. `None` after exit.
    pub master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    /// PTY writer — for write_input. `None` after exit.
    pub writer: Mutex<Option<Box<dyn std::io::Write + Send>>>,
}

impl FleetSessionInner {
    pub fn to_dto(&self) -> FleetSession {
        FleetSession {
            id: self.id.clone(),
            claude_session_id: self.claude_session_id.clone(),
            cwd: self.cwd.to_string_lossy().into_owned(),
            project_label: self.project_label.clone(),
            name: self.name.clone(),
            args: self.args.clone(),
            state: self.state,
            last_activity_ms: self.last_activity_ms,
            created_at_ms: self.created_at_ms,
            child_pid: self.child_pid,
            exit_code: self.exit_code,
            state_reason: self.state_reason.clone(),
        }
    }
}

/// The single global registry. Use [`registry`] to access.
#[derive(Default)]
pub struct FleetRegistry {
    pub(super) sessions: Mutex<HashMap<String, FleetSessionInner>>,
}

static REGISTRY: OnceLock<FleetRegistry> = OnceLock::new();

/// Returns the process-wide singleton registry. Lazy-initialised on first
/// access. Thread-safe via `OnceLock`.
pub fn registry() -> &'static FleetRegistry {
    REGISTRY.get_or_init(FleetRegistry::default)
}

impl FleetRegistry {
    /// Inserts a freshly-spawned session. Returns the same id back for
    /// caller convenience.
    pub fn insert(&self, inner: FleetSessionInner) -> String {
        let id = inner.id.clone();
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(id.clone(), inner);
        id
    }

    /// Returns a DTO snapshot of every tracked session.
    pub fn list_dto(&self) -> Vec<FleetSession> {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let mut out: Vec<FleetSession> = map.values().map(|s| s.to_dto()).collect();
        out.sort_by_key(|s| -s.created_at_ms); // newest first
        out
    }

    /// Look up `(project_label, cwd)` for a session id. Returns
    /// `None` when the session has been pruned or never existed.
    ///
    /// Used by the MCP layer to label operative-memory entries when
    /// a session reports its intent before any lifecycle hook has
    /// fired (the registry has the metadata; operative memory
    /// doesn't yet).
    pub fn lookup_meta(&self, session_id: &str) -> Option<(String, String)> {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.get(session_id).map(|s| {
            (
                s.project_label.clone(),
                s.cwd.to_string_lossy().into_owned(),
            )
        })
    }

    /// Returns `true` if a non-exited session with this `cwd` is tracked.
    /// Drives the duplicate-spawn guard.
    pub fn has_active_cwd(&self, cwd: &std::path::Path) -> bool {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.values().any(|s| {
            !matches!(s.state, FleetSessionState::Exited) && s.cwd == cwd
        })
    }

    /// Writes `bytes` to the session's PTY stdin. No-op if missing/exited.
    pub fn write_input(&self, session_id: &str, bytes: &[u8]) -> Result<(), String> {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get(session_id) else {
            return Err(format!("session not found: {session_id}"));
        };
        let mut writer_guard = session.writer.lock().unwrap_or_else(|e| e.into_inner());
        let Some(writer) = writer_guard.as_mut() else {
            return Err(format!("session writer dropped: {session_id}"));
        };
        writer
            .write_all(bytes)
            .map_err(|e| format!("write failed: {e}"))?;
        writer.flush().map_err(|e| format!("flush failed: {e}"))?;
        Ok(())
    }

    /// Resize the PTY for `session_id`.
    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get(session_id) else {
            return Err(format!("session not found: {session_id}"));
        };
        let master_guard = session.master.lock().unwrap_or_else(|e| e.into_inner());
        let Some(master) = master_guard.as_ref() else {
            return Err(format!("session master dropped: {session_id}"));
        };
        master
            .resize(portable_pty::PtySize {
                rows: rows.max(8),
                cols: cols.max(40),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize failed: {e}"))
    }

    /// Records that the child has exited. Updates state and clears the
    /// PTY resource slots. Called from the reaper task.
    pub fn mark_exited(&self, session_id: &str, exit_code: Option<i32>) {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = map.get_mut(session_id) {
            session.state = FleetSessionState::Exited;
            session.exit_code = exit_code;
            session.last_activity_ms = now_ms();
            session.state_reason = Some(match exit_code {
                Some(0) => "Exited cleanly".to_string(),
                Some(c) => format!("Exited with code {c}"),
                None => "Exited (signal or crash)".to_string(),
            });
            if let Ok(mut w) = session.writer.lock() { *w = None; }
            if let Ok(mut m) = session.master.lock() { *m = None; }
        }
    }

    /// Sets (or clears with `None` / empty string) the per-session display
    /// name. Returns `true` if a session was found and updated.
    pub fn rename(&self, session_id: &str, name: Option<String>) -> bool {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get_mut(session_id) else {
            return false;
        };
        // Treat empty / whitespace-only as None so the UI can "clear" by
        // submitting an empty input.
        session.name = match name {
            Some(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
            _ => None,
        };
        true
    }

    /// Soft-kill: drop the writer + master so the PTY child sees EOF on
    /// its slave fd. Mirrors the fleet UI's close-session behavior and
    /// is what Athena's `fleet_kill` dispatcher action calls. The reaper
    /// task picks up the eventual exit and marks the session `Exited`.
    /// Returns `false` if the session id is unknown.
    pub fn close_pty_handles(&self, session_id: &str) -> bool {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get(session_id) else { return false; };
        if let Ok(mut w) = session.writer.lock() { *w = None; }
        if let Ok(mut m) = session.master.lock() { *m = None; }
        true
    }

    /// Removes a session entirely. Used by the UI to dismiss exited rows.
    pub fn remove(&self, session_id: &str) -> bool {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(session_id).is_some()
    }
}

/// Wall-clock ms since UNIX epoch. Used for `last_activity_ms` /
/// `created_at_ms`.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
