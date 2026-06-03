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

/// Visible-name sentinel stamped on every Fleet session Athena spawns
/// herself (`fleet_spawn` → `"athena"`, `fleet_dispatch` → `"athena-<role>"`).
/// It's the recursion-guard marker the proactive evaluator keys off of, and —
/// more critically — the marker the autonomous `fleet_send_input` autoapprove
/// guard checks: autonomous Athena may only drive PTYs she created herself,
/// never the user's own live terminals. Defined here so the spawn-time tag
/// (`commands::companion::approvals`) and the read-time guard
/// ([`FleetRegistry::is_athena_owned`]) can't drift apart.
pub const ATHENA_SESSION_NAME_SENTINEL: &str = "athena";

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
    /// Set true by `hibernate` before the PTY is closed, so the reaper records
    /// the child's exit as `Hibernated` (resumable) instead of `Exited` (dead)
    /// and skips exit reconciliation. Reset on wake/respawn.
    pub hibernating: std::sync::atomic::AtomicBool,
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

    /// Whether `session_id` names a tracked session that Athena spawned
    /// herself — its visible name carries the [`ATHENA_SESSION_NAME_SENTINEL`]
    /// stamped at spawn (`"athena"` from `fleet_spawn`, `"athena-<role>"` from
    /// `fleet_dispatch`). This is the safety gate for the autonomous
    /// `fleet_send_input` autoapprove path: a hallucinated or stale `session_id`
    /// — or a user-spawned session that drifted into `AwaitingInput` — must not
    /// let autonomous Athena type into a PTY she didn't create. Returns `false`
    /// for unknown / unnamed / user-owned sessions (fail-closed).
    pub fn is_athena_owned(&self, session_id: &str) -> bool {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.get(session_id)
            .and_then(|s| s.name.as_deref())
            .map(|name| name.starts_with(ATHENA_SESSION_NAME_SENTINEL))
            .unwrap_or(false)
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

    /// First PTY output proves the child actually came up and reached its
    /// prompt. Promote a `Spawning` session to `Idle` (alive + ready for its
    /// first message) so it isn't mislabeled never-attached/stale before it
    /// writes a transcript — a fresh interactive `claude` sits at the prompt
    /// with no transcript and no hook until the user submits something.
    /// One-shot: only transitions out of `Spawning`. Returns `true` if it
    /// changed state (so the caller emits a refresh once).
    pub fn mark_alive(&self, session_id: &str) -> bool {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = map.get_mut(session_id) {
            if matches!(session.state, FleetSessionState::Spawning) {
                session.state = FleetSessionState::Idle;
                session.last_activity_ms = now_ms();
                session.state_reason = Some("Ready — claude is at the prompt".into());
                return true;
            }
        }
        false
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

    /// Hibernate: mark the session `Hibernated`, flag it so the reaper records
    /// the imminent child exit as a sleep (not a death), and close the PTY to
    /// free the process. `claude_session_id` + `cwd` are retained for wake.
    ///
    /// `require_resting` closes a TOCTOU race in the auto-hibernate path: the
    /// staleness ticker collects `Idle`/`Stale` candidates under the lock,
    /// releases it, then calls this per candidate. In that window a hook can
    /// flip the session to `Running` (PreToolUse / UserPromptSubmit) or
    /// `AwaitingInput` (Notification), and acting on the now-stale snapshot
    /// would kill a freshly-resumed turn or a session waiting on the user —
    /// the silent "ate my work at 2am" failure. With `require_resting = true`
    /// we re-check the state *inside this same lock* (atomic with the mutation)
    /// and bail unless it's still `Idle`/`Stale`. The manual
    /// `fleet_hibernate_session` command passes `false`: the user explicitly
    /// chose to sleep whatever is currently running.
    ///
    /// Returns `false` if the id is unknown or the session can't be hibernated
    /// (already exited / hibernated, never bound a `claude_session_id`, or
    /// `require_resting` and it has re-engaged since the snapshot).
    pub fn hibernate(&self, session_id: &str, require_resting: bool) -> bool {
        use std::sync::atomic::Ordering;
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get_mut(session_id) else { return false; };
        if matches!(session.state, FleetSessionState::Exited | FleetSessionState::Hibernated) {
            return false;
        }
        if require_resting
            && !matches!(session.state, FleetSessionState::Idle | FleetSessionState::Stale)
        {
            // Re-engaged (Running) or now waiting on the user (AwaitingInput)
            // since the ticker snapshotted it — never sleep a live turn.
            return false;
        }
        if session.claude_session_id.is_none() {
            return false; // can't resume what we can't name
        }
        session.hibernating.store(true, Ordering::SeqCst);
        session.state = FleetSessionState::Hibernated;
        session.last_activity_ms = now_ms();
        session.state_reason = Some("Hibernated — process freed; resume with claude --resume".to_string());
        session.child_pid = None;
        if let Ok(mut w) = session.writer.lock() { *w = None; }
        if let Ok(mut m) = session.master.lock() { *m = None; }
        true
    }

    /// Whether `hibernate` was called on this session (consumed by the reaper
    /// to choose Hibernated vs Exited on child exit).
    pub fn is_hibernating(&self, session_id: &str) -> bool {
        use std::sync::atomic::Ordering;
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.get(session_id)
            .map(|s| s.hibernating.load(Ordering::SeqCst))
            .unwrap_or(false)
    }

    /// Resume target `(claude_session_id, cwd)` for a hibernated session, used
    /// by `fleet_wake_session` to respawn `claude --resume`. `None` if the
    /// session isn't hibernated or never bound a `claude_session_id`.
    pub fn resume_target(&self, session_id: &str) -> Option<(String, PathBuf)> {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let s = map.get(session_id)?;
        if !matches!(s.state, FleetSessionState::Hibernated) {
            return None;
        }
        let csid = s.claude_session_id.clone()?;
        Some((csid, s.cwd.clone()))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    /// Build a minimal session record with no live PTY (master/writer `None`),
    /// so `hibernate` can be exercised without spawning a real child.
    fn session(id: &str, state: FleetSessionState, csid: Option<&str>) -> FleetSessionInner {
        FleetSessionInner {
            id: id.to_string(),
            claude_session_id: csid.map(|s| s.to_string()),
            cwd: PathBuf::from("/tmp/test"),
            project_label: "test".to_string(),
            name: None,
            args: Vec::new(),
            state,
            last_activity_ms: now_ms(),
            created_at_ms: now_ms(),
            child_pid: Some(1234),
            exit_code: None,
            state_reason: None,
            master: Mutex::new(None),
            writer: Mutex::new(None),
            hibernating: AtomicBool::new(false),
        }
    }

    fn state_of(reg: &FleetRegistry, id: &str) -> FleetSessionState {
        let map = reg.sessions.lock().unwrap();
        map.get(id).unwrap().state
    }

    #[test]
    fn is_athena_owned_keys_off_the_spawn_sentinel() {
        // Mirrors how the two Athena spawn paths tag sessions:
        // `fleet_spawn` → "athena", `fleet_dispatch` → "athena-<role>".
        // The guard must accept those and reject everything else, so a
        // hallucinated/stale id or a user-owned terminal can't be driven
        // by the autonomous fleet_send_input autoapprove path.
        let reg = FleetRegistry::default();
        reg.insert(session("spawn", FleetSessionState::Idle, Some("cc-spawn")));
        reg.insert(session("dispatch", FleetSessionState::Idle, Some("cc-dispatch")));
        reg.insert(session("user", FleetSessionState::Idle, Some("cc-user")));
        reg.insert(session("anon", FleetSessionState::Idle, Some("cc-anon")));

        reg.rename("spawn", Some(ATHENA_SESSION_NAME_SENTINEL.to_string()));
        reg.rename("dispatch", Some(format!("{ATHENA_SESSION_NAME_SENTINEL}-writer")));
        // A user-spawned session the user renamed for themselves.
        reg.rename("user", Some("my debugging terminal".to_string()));
        // "anon" keeps its default name: None.

        assert!(reg.is_athena_owned("spawn"));
        assert!(reg.is_athena_owned("dispatch"));
        assert!(!reg.is_athena_owned("user"));
        assert!(!reg.is_athena_owned("anon"));
        // Unknown id — the hallucinated/stale-session_id case the guard exists for.
        assert!(!reg.is_athena_owned("does-not-exist"));
    }

    #[test]
    fn require_resting_hibernates_idle_and_stale() {
        let reg = FleetRegistry::default();
        reg.insert(session("idle", FleetSessionState::Idle, Some("cc-idle")));
        reg.insert(session("stale", FleetSessionState::Stale, Some("cc-stale")));

        assert!(reg.hibernate("idle", true));
        assert!(reg.hibernate("stale", true));
        assert_eq!(state_of(&reg, "idle"), FleetSessionState::Hibernated);
        assert_eq!(state_of(&reg, "stale"), FleetSessionState::Hibernated);
    }

    #[test]
    fn require_resting_refuses_running_and_awaiting_input() {
        // The TOCTOU guard: a session that re-engaged (Running) or started
        // waiting on the user (AwaitingInput) since the ticker snapshotted it
        // must NOT be slept — its in-flight turn would be dropped silently.
        let reg = FleetRegistry::default();
        reg.insert(session("run", FleetSessionState::Running, Some("cc-run")));
        reg.insert(session("await", FleetSessionState::AwaitingInput, Some("cc-await")));

        assert!(!reg.hibernate("run", true));
        assert!(!reg.hibernate("await", true));
        // State is untouched — no process killed, no turn lost.
        assert_eq!(state_of(&reg, "run"), FleetSessionState::Running);
        assert_eq!(state_of(&reg, "await"), FleetSessionState::AwaitingInput);
    }

    #[test]
    fn manual_path_sleeps_running_session() {
        // The manual `fleet_hibernate_session` command passes `require_resting
        // = false`: the user explicitly chose to sleep whatever is running.
        let reg = FleetRegistry::default();
        reg.insert(session("run", FleetSessionState::Running, Some("cc-run")));

        assert!(reg.hibernate("run", false));
        assert_eq!(state_of(&reg, "run"), FleetSessionState::Hibernated);
    }

    #[test]
    fn hibernate_refuses_unresumable_and_terminal_regardless_of_flag() {
        let reg = FleetRegistry::default();
        // No claude_session_id → can't resume what we can't name.
        reg.insert(session("nocsid", FleetSessionState::Idle, None));
        // Already terminal / already asleep.
        reg.insert(session("exited", FleetSessionState::Exited, Some("cc-x")));
        reg.insert(session("slept", FleetSessionState::Hibernated, Some("cc-s")));

        for flag in [true, false] {
            assert!(!reg.hibernate("nocsid", flag));
            assert!(!reg.hibernate("exited", flag));
            assert!(!reg.hibernate("slept", flag));
            assert!(!reg.hibernate("missing", flag));
        }
    }
}
