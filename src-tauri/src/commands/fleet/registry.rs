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

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use portable_pty::MasterPty;

use super::types::{FleetSession, FleetSessionState};

/// Default cap (bytes) for a session's output ring buffer. Bounds the desktop
/// app's memory per session regardless of how much a 1M-token run prints: a
/// background (unsubscribed) session drains its PTY into this ring and emits
/// nothing to the UI. ~512 KiB ≈ a few thousand lines of recent scrollback —
/// enough for a switch-back replay to feel continuous. The win that lets us
/// scale to 16 CLIs: the app's IPC + render work tracks the number of *watched*
/// sessions, not the number running.
pub const OUTPUT_RING_CAP: usize = 512 * 1024;

/// Bounded ring of recent raw PTY bytes for one session, plus whether the
/// frontend is currently rendering it live. The reader task ALWAYS pushes here
/// (so the PTY pipe never fills and claude never blocks); it only forwards
/// bytes over IPC when `subscribed` is set. On (re)subscribe the command
/// replays [`OutputRing::snapshot`] so a freshly-focused terminal hydrates from
/// the ring instead of from a re-streamed full history.
pub struct OutputRing {
    buf: VecDeque<u8>,
    cap: usize,
    subscribed: bool,
    /// Bumped on every `push` — a cheap change cursor for the preview poll.
    /// A caller that saw rev N and sees rev N again knows the ring hasn't
    /// changed and can skip re-cooking/re-rendering that tile entirely.
    /// Wrapping u32: only ever compared for equality, and a poller can't
    /// miss 2^32 pushes inside one poll interval.
    rev: u32,
}

impl OutputRing {
    pub fn new(cap: usize) -> Self {
        Self { buf: VecDeque::new(), cap, subscribed: false, rev: 0 }
    }

    /// Append raw PTY bytes, trimming the oldest beyond `cap`.
    pub fn push(&mut self, bytes: &[u8]) {
        self.rev = self.rev.wrapping_add(1);
        self.buf.extend(bytes.iter().copied());
        let len = self.buf.len();
        if len > self.cap {
            self.buf.drain(0..len - self.cap);
        }
    }

    /// Change cursor — see the `rev` field.
    pub fn rev(&self) -> u32 {
        self.rev
    }

    pub fn is_subscribed(&self) -> bool {
        self.subscribed
    }

    pub fn set_subscribed(&mut self, on: bool) {
        self.subscribed = on;
    }

    /// Current ring contents as a lossy UTF-8 string, for replay on subscribe.
    /// Lossy is fine: the oldest bytes may be a truncated escape sequence (the
    /// ring drops from the front), which xterm tolerates at the start of a write.
    pub fn snapshot(&self) -> String {
        let bytes: Vec<u8> = self.buf.iter().copied().collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// Cook the recent tail into the last `max_lines` plain-text lines for a
    /// glanceable grid preview — no xterm, no live stream. Strips ANSI/CSI/OSC
    /// escapes, applies `\n`/`\r`, and resets on screen-clear / alt-screen /
    /// erase-line so an interactive TUI's in-place redraws don't pile up as junk.
    /// Approximate by design: the focused tile gets a real terminal; this is the
    /// cheap "what's on screen" snapshot the *unwatched* tiles render, polled at
    /// a low rate. Only the tail is scanned so cost is bounded regardless of ring
    /// size (the oldest scanned line may be slightly garbled, but it's dropped
    /// anyway when we keep just the last `max_lines`).
    pub fn preview_lines(&self, max_lines: usize) -> Vec<String> {
        const SCAN: usize = 64 * 1024;
        let len = self.buf.len();
        let start = len.saturating_sub(SCAN);
        let bytes: Vec<u8> = self.buf.iter().copied().skip(start).collect();
        cook_lines(&bytes, max_lines)
    }
}

/// Trim `lines` in place to at most `max` entries, dropping from the front
/// (oldest). A tiny helper so the cook loop can cap as it goes.
fn trim_lines(lines: &mut Vec<String>, max: usize) {
    if lines.len() > max {
        let drop = lines.len() - max;
        lines.drain(0..drop);
    }
}

/// Cook raw PTY bytes into plain-text lines for a preview (see
/// [`OutputRing::preview_lines`]). Handles the escape sequences that actually
/// matter for a scrolling-buffer TUI like Claude Code:
///   - `\n` ends a line; `\r` overwrites the current line (spinner/progress).
///   - CSI `…J` (erase display) and alt-screen toggles (`…?1049h/l`) clear all.
///   - CSI `…K` (erase line) clears the current line (in-place input-box redraws).
///   - all other CSI / OSC / `ESC x` sequences are consumed and dropped.
/// Absolute cursor positioning isn't modeled (no grid) — fine for a glance.
fn cook_lines(bytes: &[u8], max_lines: usize) -> Vec<String> {
    let text = String::from_utf8_lossy(bytes);
    let mut lines: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\n' => {
                lines.push(std::mem::take(&mut cur));
                trim_lines(&mut lines, max_lines);
            }
            '\r' => cur.clear(),
            '\t' => cur.push(' '),
            '\u{1b}' => match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    let mut params = String::new();
                    while let Some(&p) = chars.peek() {
                        chars.next();
                        if ('\u{40}'..='\u{7e}').contains(&p) {
                            match p {
                                // Erase display. ONLY 2 (entire screen) and 3
                                // (screen + scrollback) are genuine clears that
                                // wipe everything. 0 (cursor→end), 1 (start→
                                // cursor) and the bare `\x1b[J` are PARTIAL erases
                                // that an inline TUI — Claude's input-box redraw —
                                // emits on every keystroke/redraw; treating those
                                // as a full wipe collapsed the cooked preview to
                                // empty (the unwatched grid tiles went black).
                                // Without a cursor grid we approximate the partial
                                // case by clearing only the in-progress line and
                                // preserving the scrollback above.
                                'J' => {
                                    let full = params
                                        .trim()
                                        .parse::<u32>()
                                        .map(|n| n == 2 || n == 3)
                                        .unwrap_or(false);
                                    cur.clear();
                                    if full {
                                        lines.clear();
                                    }
                                }
                                'h' | 'l' if params.contains("1049") => {
                                    cur.clear();
                                    lines.clear();
                                }
                                // Erase line → clear the in-progress line.
                                'K' => cur.clear(),
                                _ => {}
                            }
                            break;
                        }
                        params.push(p);
                    }
                }
                Some(']') => {
                    // OSC — consume to BEL or ST (ESC \).
                    chars.next();
                    while let Some(&p) = chars.peek() {
                        chars.next();
                        if p == '\u{7}' {
                            break;
                        }
                        if p == '\u{1b}' {
                            if chars.peek() == Some(&'\\') {
                                chars.next();
                            }
                            break;
                        }
                    }
                }
                Some(_) => {
                    chars.next();
                }
                None => {}
            },
            c if (c as u32) < 0x20 => {} // drop other control chars
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    trim_lines(&mut lines, max_lines);
    lines
}

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
    /// When the PTY last produced ANY bytes (including idle status redraws).
    /// claude redraws its status line even when idle, so total PTY silence is
    /// the "process is frozen" signal the staleness ticker's stall check keys
    /// on — while output *presence* proves nothing about work. 0 until the
    /// first byte. Never feeds `last_activity_ms`/freshness.
    pub last_pty_output_ms: i64,
    /// When the transcript last grew, written by the staleness ticker's size
    /// polling (0 = not yet observed). Surfaced as a provenance signal.
    pub last_grew_ms: i64,
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
    /// Bounded ring of recent PTY output + the live-subscription flag. Shared
    /// (`Arc`) with the reader task, which pushes every chunk here and forwards
    /// over IPC only while subscribed. See [`OutputRing`].
    pub output: Arc<Mutex<OutputRing>>,
    /// Kill handle cloned from the child at spawn (the reaper task owns the child
    /// itself). Lets close/hibernate actually TERMINATE the process — interactive
    /// `claude` ignores stdin EOF, so dropping the PTY handles alone leaves a
    /// zombie shell that keeps burning tokens. `None` only in test fixtures.
    pub killer: Option<Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>>,
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
            last_pty_output_ms: self.last_pty_output_ms,
            last_grew_ms: self.last_grew_ms,
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

    /// Record that the session's PTY produced output — any bytes, including
    /// the idle status-line redraws. Deliberately does NOT touch
    /// `last_activity_ms` or state (idle redraws would defeat staleness);
    /// the ONLY consumer is the ticker's frozen-process stall check, where
    /// total silence (claude stops redrawing entirely) is the signal.
    pub fn note_pty_output(&self, session_id: &str) {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = map.get_mut(session_id) {
            session.last_pty_output_ms = now_ms();
        }
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

    /// Promote a session to `Running` when concrete activity proves it's
    /// working: a tool invocation (PreToolUse/PostToolUse) is incompatible with
    /// sitting idle at a prompt waiting for the user. Transitions only out of
    /// the resting states (`AwaitingInput` / `Idle` / `Stale`); leaves
    /// `Spawning` / `Running` / `Exited` / `Hibernated` untouched. Returns
    /// `true` only when it actually changed state, so the hook caller emits a
    /// single refresh instead of one per tool call (PreToolUse is high-volume).
    ///
    /// This is the immediate corrector for the most common false-`AwaitingInput`:
    /// Claude Code fires its idle "waiting for input" Notification during a long
    /// tool wait or model-latency gap, parking an in-progress session — and
    /// since tool hooks no longer flow through the lifecycle state machine,
    /// nothing pulled it back. The next tool call now does, here. Regardless of
    /// transition, the call refreshes `last_activity_ms` (a tool firing is
    /// fresh activity) so the staleness ticker sees the session as alive.
    pub fn revive_to_running_on_activity(&self, session_id: &str) -> bool {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get_mut(session_id) else { return false; };
        session.last_activity_ms = now_ms();
        if matches!(
            session.state,
            FleetSessionState::AwaitingInput | FleetSessionState::Idle | FleetSessionState::Stale
        ) {
            session.state = FleetSessionState::Running;
            session.state_reason = Some("Tool activity — session is working".into());
            return true;
        }
        false
    }

    /// Mark a session's terminal subscribed (the frontend is now rendering it
    /// live) and return its ring snapshot so the freshly-focused terminal can
    /// hydrate. After this returns, the reader task forwards live chunks over
    /// IPC. `None` if the session is unknown. Low-frequency (one call per
    /// attach), so taking the map lock here is fine — the per-read hot path
    /// never touches the map (it holds the ring `Arc` directly).
    pub fn subscribe_output(&self, session_id: &str) -> Option<String> {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let session = map.get(session_id)?;
        let mut ring = session.output.lock().unwrap_or_else(|e| e.into_inner());
        ring.set_subscribed(true);
        Some(ring.snapshot())
    }

    /// Stop forwarding a session's PTY output over IPC (it keeps buffering into
    /// its ring, so a later re-subscribe replays the recent tail). No-op for
    /// unknown sessions.
    pub fn unsubscribe_output(&self, session_id: &str) {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = map.get(session_id) {
            session
                .output
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .set_subscribed(false);
        }
    }

    /// Cooked preview lines for several sessions at once — the data source for
    /// the grid's *unwatched* tiles (the watched/active tile renders a real
    /// terminal instead). Unknown sessions are skipped. One map lock + a brief
    /// per-session ring lock; called at a low poll rate, so cheap even at 16
    /// tiles. `max_lines` caps each entry.
    /// Cooked previews for the requested sessions, change-gated: each request
    /// carries the ring rev the caller last rendered (`None` = never seen).
    /// A session whose ring rev still equals the known rev is OMITTED from
    /// the result — its tile hasn't changed, so there's nothing to re-cook,
    /// re-serialize, or re-render. Idle tiles thus cost ~one u32 compare per
    /// poll instead of a 64 KiB ANSI cook.
    pub fn preview_outputs(
        &self,
        requests: &[(String, Option<u32>)],
        max_lines: usize,
    ) -> Vec<(String, u32, Vec<String>)> {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        requests
            .iter()
            .filter_map(|(id, known_rev)| {
                let session = map.get(id)?;
                let ring = session.output.lock().unwrap_or_else(|e| e.into_inner());
                let rev = ring.rev();
                if *known_rev == Some(rev) {
                    return None; // unchanged since the caller last looked
                }
                Some((id.clone(), rev, ring.preview_lines(max_lines)))
            })
            .collect()
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
                Some(c) => fleet_exit_reason(c),
                None => "Exited (signal or crash)".to_string(),
            });
            if let Ok(mut w) = session.writer.lock() { *w = None; }
            if let Ok(mut m) = session.master.lock() { *m = None; }
            // Confirmed exit: clear the tracked PID now (not on hibernate-intent),
            // so process_scan tracks the live PID for the session's whole life.
            session.child_pid = None;
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

    /// Clear the tracked child PID once the reaper confirms the process is gone.
    /// `mark_exited` handles the normal-exit path; the reaper's hibernation branch
    /// calls this so the live PID stays tracked through the whole kill→exit window
    /// and `process_scan` never mislabels it as an orphan.
    pub fn clear_child_pid(&self, session_id: &str) {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = map.get_mut(session_id) {
            session.child_pid = None;
        }
    }

    /// Soft-kill: drop the writer + master so the PTY child sees EOF on
    /// its slave fd. Mirrors the fleet UI's close-session behavior and
    /// is what Athena's `fleet_kill` dispatcher action calls. The reaper
    /// task picks up the eventual exit and marks the session `Exited`.
    /// Returns `false` if the session id is unknown.
    pub fn close_pty_handles(&self, session_id: &str) -> bool {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get(session_id) else { return false; };
        // Terminate the child first — interactive `claude` ignores stdin EOF, so
        // dropping the PTY handles alone leaves a zombie. The reaper then fires.
        if let Some(k) = &session.killer {
            if let Ok(mut k) = k.lock() { let _ = k.kill(); }
        }
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
        // Terminate the child (interactive claude won't exit on stdin EOF). KEEP
        // child_pid until the reaper confirms exit (cleared via clear_child_pid in
        // the reaper's hibernation branch) so process_scan doesn't mislabel the
        // still-live process as an untracked orphan during the kill→exit window.
        if let Some(k) = &session.killer {
            if let Ok(mut k) = k.lock() { let _ = k.kill(); }
        }
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

/// Human-readable reason for a non-zero Fleet child exit. Renders the OS code
/// in hex (the form Windows documents NTSTATUS in) and special-cases the codes
/// we've actually seen, so the UI can explain an exit the user would otherwise
/// read as "vanished without warning" (the bare decimal of an NTSTATUS is
/// meaningless to a human).
fn fleet_exit_reason(code: i32) -> String {
    let raw = code as u32;
    let hex = format!("0x{raw:08X}");
    match raw {
        // STATUS_DLL_INIT_FAILED — on Windows this is overwhelmingly a console
        // allocation failure: a GUI process spawned too many console children
        // and the window-station desktop heap is exhausted. See
        // `companion::session::apply_no_console_window`.
        0xC000_0142 => format!(
            "Exited with code {hex} (Windows could not start the process — \
             usually too many CLI sessions open at once; close some and retry)"
        ),
        // STATUS_CONTROL_C_EXIT — Ctrl-C / console closed.
        0xC000_013A => format!("Exited with code {hex} (interrupted / console closed)"),
        _ => format!("Exited with code {code} ({hex})"),
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
            last_pty_output_ms: 0,
            last_grew_ms: 0,
            created_at_ms: now_ms(),
            child_pid: Some(1234),
            exit_code: None,
            state_reason: None,
            master: Mutex::new(None),
            writer: Mutex::new(None),
            hibernating: AtomicBool::new(false),
            output: Arc::new(Mutex::new(OutputRing::new(OUTPUT_RING_CAP))),
            killer: None,
        }
    }

    #[test]
    fn output_ring_caps_and_keeps_tail() {
        let mut r = OutputRing::new(8);
        r.push(b"abcdef");
        assert_eq!(r.snapshot(), "abcdef");
        r.push(b"ghij"); // total 10 > cap 8 → drop oldest 2
        assert_eq!(r.snapshot(), "cdefghij");
        assert_eq!(r.snapshot().len(), 8);
    }

    #[test]
    fn cook_strips_ansi_and_splits_lines() {
        // SGR colour codes stripped; newlines split.
        let out = cook_lines(b"\x1b[31mred\x1b[0m line\nsecond\n", 10);
        assert_eq!(out, vec!["red line".to_string(), "second".to_string()]);
    }

    #[test]
    fn cook_carriage_return_overwrites_current_line() {
        // A spinner redraw: "10%\r20%\r30%" → only the final survives.
        let out = cook_lines(b"working 10%\rworking 20%\rworking 30%", 10);
        assert_eq!(out, vec!["working 30%".to_string()]);
    }

    #[test]
    fn cook_erase_display_clears_scrollback() {
        let out = cook_lines(b"old line\nmore\n\x1b[2Jfresh\n", 10);
        assert_eq!(out, vec!["fresh".to_string()]);
    }

    #[test]
    fn cook_alt_screen_enter_clears() {
        let out = cook_lines(b"before\n\x1b[?1049hafter\n", 10);
        assert_eq!(out, vec!["after".to_string()]);
    }

    #[test]
    fn cook_caps_to_max_lines_keeping_tail() {
        let out = cook_lines(b"a\nb\nc\nd\ne\n", 3);
        assert_eq!(out, vec!["c".to_string(), "d".to_string(), "e".to_string()]);
    }

    #[test]
    fn output_ring_subscription_flag_round_trips() {
        let mut r = OutputRing::new(16);
        assert!(!r.is_subscribed());
        r.set_subscribed(true);
        assert!(r.is_subscribed());
        r.set_subscribed(false);
        assert!(!r.is_subscribed());
    }

    #[test]
    fn subscribe_output_sets_flag_and_returns_snapshot() {
        let reg = FleetRegistry::default();
        reg.insert(session("s", FleetSessionState::Running, Some("cc")));
        // Seed some buffered output as the reader would.
        {
            let map = reg.sessions.lock().unwrap();
            map.get("s").unwrap().output.lock().unwrap().push(b"hello world");
        }
        let snap = reg.subscribe_output("s");
        assert_eq!(snap.as_deref(), Some("hello world"));
        assert!(reg.sessions.lock().unwrap().get("s").unwrap().output.lock().unwrap().is_subscribed());
        reg.unsubscribe_output("s");
        assert!(!reg.sessions.lock().unwrap().get("s").unwrap().output.lock().unwrap().is_subscribed());
        // Unknown session → None / no panic.
        assert_eq!(reg.subscribe_output("missing"), None);
        reg.unsubscribe_output("missing");
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
    fn revive_to_running_pulls_resting_states_up_only() {
        // Tool activity (PreToolUse/PostToolUse) must pull a session out of the
        // resting states it could have been wrongly parked in, but never disturb
        // Spawning/Running/terminal sessions.
        let reg = FleetRegistry::default();
        reg.insert(session("await", FleetSessionState::AwaitingInput, Some("cc-a")));
        reg.insert(session("idle", FleetSessionState::Idle, Some("cc-i")));
        reg.insert(session("stale", FleetSessionState::Stale, Some("cc-s")));
        reg.insert(session("run", FleetSessionState::Running, Some("cc-r")));
        reg.insert(session("spawn", FleetSessionState::Spawning, None));

        // Resting → Running, and reports the transition.
        assert!(reg.revive_to_running_on_activity("await"));
        assert!(reg.revive_to_running_on_activity("idle"));
        assert!(reg.revive_to_running_on_activity("stale"));
        // No transition needed / not applicable → false (so the hook stays quiet).
        assert!(!reg.revive_to_running_on_activity("run"));
        assert!(!reg.revive_to_running_on_activity("spawn"));
        assert!(!reg.revive_to_running_on_activity("missing"));

        assert_eq!(state_of(&reg, "await"), FleetSessionState::Running);
        assert_eq!(state_of(&reg, "idle"), FleetSessionState::Running);
        assert_eq!(state_of(&reg, "stale"), FleetSessionState::Running);
        assert_eq!(state_of(&reg, "spawn"), FleetSessionState::Spawning);
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
