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

use super::types::{state_to_token, FleetSession, FleetSessionMode, FleetSessionState};

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
    /// Persistent VT screen model (fleet-scale Tier C). Lazily built on the
    /// first `render_screen` call (catching up from the ring once), then fed
    /// **incrementally** by every `push` — so steady-state screen reads are
    /// O(screen) instead of re-parsing up to 512 KiB per call. That matters at
    /// scale: orchestration wakes, screen-hash dedupes, execution-time
    /// re-checks, and previews all read screens, and a 40-session fleet was
    /// paying a full ring re-parse for each. Rebuilt (one catch-up feed) when
    /// the requested dims change (PTY resize). Memory: one rows×cols cell grid
    /// per session — tens of KB.
    parser: Option<vt100::Parser>,
    /// Dims the parser currently models — a mismatch triggers a rebuild.
    parser_dims: (u16, u16),
}

impl OutputRing {
    pub fn new(cap: usize) -> Self {
        Self {
            buf: VecDeque::new(),
            cap,
            subscribed: false,
            rev: 0,
            parser: None,
            parser_dims: (0, 0),
        }
    }

    /// Append raw PTY bytes, trimming the oldest beyond `cap`, and feed the
    /// live screen model (if one has been materialized) incrementally.
    pub fn push(&mut self, bytes: &[u8]) {
        self.rev = self.rev.wrapping_add(1);
        self.buf.extend(bytes.iter().copied());
        let len = self.buf.len();
        if len > self.cap {
            self.buf.drain(0..len - self.cap);
        }
        if let Some(p) = self.parser.as_mut() {
            p.process(bytes);
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

    /// Reconstruct the CURRENTLY-RENDERED screen from the raw ring bytes via a
    /// real VT emulator, returning the visible grid as plain-text lines
    /// (trailing blank lines trimmed). Unlike `preview_lines`' line-cooker, this
    /// models cursor positioning + alt-screen, so an interactive cursor-addressed
    /// TUI — an `AskUserQuestion` menu, a permission prompt — renders as the
    /// operator actually sees it instead of collapsing to fragments. `cols` MUST
    /// match the size claude drew at, or a cursor-positioned line wraps wrong.
    pub fn render_screen(&mut self, rows: u16, cols: u16) -> Vec<String> {
        let rows = rows.max(8);
        let cols = cols.max(40);
        // Materialize (or rebuild after a resize) the persistent screen model:
        // one catch-up feed of the whole ring, then `push` keeps it current
        // incrementally, making every later call O(screen). The oldest ring
        // bytes may be a truncated escape (the ring drops from the front) —
        // vt100 resynchronizes, and the final screen is set by the last
        // complete repaint regardless.
        if self.parser.is_none() || self.parser_dims != (rows, cols) {
            let mut parser = vt100::Parser::new(rows, cols, 0);
            let bytes: Vec<u8> = self.buf.iter().copied().collect();
            parser.process(&bytes);
            self.parser = Some(parser);
            self.parser_dims = (rows, cols);
        }
        let contents = self
            .parser
            .as_ref()
            .expect("parser materialized above")
            .screen()
            .contents();
        let mut lines: Vec<String> = contents.lines().map(str::to_string).collect();
        while lines.last().is_some_and(|l| l.trim().is_empty()) {
            lines.pop();
        }
        lines
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
    /// Live OSC terminal title from Claude Code (task summary), captured from the
    /// PTY stream by the reader loop. `None` until Claude sets one.
    pub title: Option<String>,
    /// Wall-clock ms until which Athena is considered to be actively working this
    /// session's awaiting-input ticket (set by `orchestrate_on_awaiting`; a short
    /// self-expiring window). `0` = not active. Drives the `athena_active` DTO.
    pub athena_active_until_ms: i64,
    pub args: Vec<String>,
    /// Interactive PTY vs headless stream-json — see [`FleetSessionMode`].
    /// Decides how `write_input` treats bytes (raw PTY keys vs one wrapped
    /// stream-json user message) and whether the UI may attach an xterm.
    pub mode: FleetSessionMode,
    /// PTY dimensions (kept in sync with `resize`). Used to reconstruct the
    /// rendered screen grid from the raw ring via vt100 — the cols especially
    /// must match what claude drew at, or a cursor-addressed TUI wraps wrong.
    pub cols: u16,
    pub rows: u16,
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
    /// Light sleep ("doze"): the process was killed to free resources while the
    /// session sat in `Stale`/`AwaitingInput`, but — unlike `Hibernated` — the
    /// DISPLAYED state is left untouched so the operator still sees what the
    /// session was doing; the UI shows a small sleep indicator instead and
    /// wakes the session (via `claude --resume`) when they return to it. Set by
    /// [`FleetRegistry::doze`]; consumed by the reaper (keep state, don't mark
    /// `Exited`); cleared implicitly when the row is replaced on wake.
    pub dozing: bool,
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
            title: self.title.clone(),
            args: self.args.clone(),
            mode: self.mode,
            state: self.state,
            last_activity_ms: self.last_activity_ms,
            last_pty_output_ms: self.last_pty_output_ms,
            last_grew_ms: self.last_grew_ms,
            created_at_ms: self.created_at_ms,
            child_pid: self.child_pid,
            exit_code: self.exit_code,
            state_reason: self.state_reason.clone(),
            // "Athena's on it" only reads true while she's still within her work
            // window AND the session is still awaiting — once she acts (→ Running)
            // or the window lapses, the tile drops back to its real state.
            athena_active: self.athena_active_until_ms > now_ms()
                && matches!(self.state, FleetSessionState::AwaitingInput),
            dozing: self.dozing,
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

    /// Current `state_reason` without blocking — the debug log's detail column
    /// for an exit, where the reason already carries claude's own final line.
    /// See `try_lookup_label` for why this must not block.
    pub fn try_state_reason(&self, session_id: &str) -> Option<String> {
        let map = self.sessions.try_lock().ok()?;
        map.get(session_id).and_then(|s| s.state_reason.clone())
    }

    /// Best-effort label (`name` if the operator renamed it, else the project
    /// label) that **never blocks**.
    ///
    /// Exists for [`super::debug_log`], which is called from inside the fleet's
    /// hot paths — including some that already hold this very lock. `Mutex` is
    /// not reentrant, so a blocking lookup there would deadlock the app in a
    /// debugging tool. Contention is instead reported as `None` and the caller
    /// degrades to the short session id.
    pub fn try_lookup_label(&self, session_id: &str) -> Option<String> {
        let map = self.sessions.try_lock().ok()?;
        map.get(session_id)
            .map(|s| s.name.clone().unwrap_or_else(|| s.project_label.clone()))
    }

    /// `(id, label, state)` for every tracked session, without blocking — the
    /// debug log's start banner. `None` means "the registry was busy", which
    /// the banner reports as "none tracked yet" rather than stalling a
    /// user-initiated start.
    pub fn try_session_summaries(&self) -> Option<Vec<(String, String, &'static str)>> {
        let map = self.sessions.try_lock().ok()?;
        Some(
            map.iter()
                .map(|(id, s)| {
                    (
                        id.clone(),
                        s.name.clone().unwrap_or_else(|| s.project_label.clone()),
                        state_to_token(s.state),
                    )
                })
                .collect(),
        )
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

    /// Writes `bytes` to the session's stdin. No-op if missing/exited.
    ///
    /// Interactive: raw PTY key bytes, exactly as callers ship them.
    /// Headless: the payload is treated as ONE complete user message — trailing
    /// CR/LF is stripped and the text is wrapped into a stream-json
    /// `{"type":"user",...}` line (the `-p --input-format stream-json` protocol).
    /// All real callers on this lane (broadcast, quick-reply, Athena's
    /// `fleet_send_input`) send whole lines; an xterm never attaches to a
    /// headless session, so per-keystroke writes can't occur.
    pub fn write_input(&self, session_id: &str, bytes: &[u8]) -> Result<(), String> {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get(session_id) else {
            return Err(format!("session not found: {session_id}"));
        };
        let wrapped: Option<Vec<u8>> = match session.mode {
            FleetSessionMode::Interactive => None,
            FleetSessionMode::Headless => {
                let text = String::from_utf8_lossy(bytes);
                let text = text.trim_end_matches(['\r', '\n']);
                if text.is_empty() {
                    // A bare Enter has no headless meaning — swallow it.
                    return Ok(());
                }
                Some(headless_user_message(text).into_bytes())
            }
        };
        let mut writer_guard = session.writer.lock().unwrap_or_else(|e| e.into_inner());
        let Some(writer) = writer_guard.as_mut() else {
            return Err(format!("session writer dropped: {session_id}"));
        };
        writer
            .write_all(wrapped.as_deref().unwrap_or(bytes))
            .map_err(|e| format!("write failed: {e}"))?;
        writer.flush().map_err(|e| format!("flush failed: {e}"))?;
        drop(writer_guard);
        drop(map);
        // Any write is an interaction — stamp activity so the doze pass never
        // sleeps a session someone (operator or Athena) just typed into.
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = map.get_mut(session_id) {
            session.last_activity_ms = now_ms();
        }
        Ok(())
    }

    /// Current lifecycle state, or `None` for an unknown session.
    pub fn session_state(&self, session_id: &str) -> Option<FleetSessionState> {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.get(session_id).map(|s| s.state)
    }

    /// Deliver one **line of text** to an interactive session and make sure it
    /// actually SUBMITS — the primitive every programmatic text path must use
    /// (Athena's `fleet_send_input`/`fleet_intervene`, the Needs-You quick
    /// reply, broadcast, skill apply).
    ///
    /// Why this exists: Claude Code's composer distinguishes a *typed* Enter (a
    /// lone `\r` chunk) from a *pasted* one (a `\r` arriving inside a larger
    /// chunk) — a paste with a trailing newline inserts a soft line-break and
    /// does NOT submit. Every path here used to ship `format!("{text}\r")` as
    /// one write, so the text sat in the composer unsubmitted; observed live
    /// 2026-07-24: Athena AUTO_FIRED a fix instruction, no `UserPromptSubmit`
    /// ever came, and the doze pass reaped the session with her message still
    /// stranded in the composer.
    ///
    /// So: write the text alone, give the TUI a beat to ingest it, then send
    /// `\r` as its own chunk — and CONFIRM the submit (the session flipping
    /// `Running` via the `UserPromptSubmit`/tool hooks), retrying Enter once.
    /// An unconfirmed submit is loudly logged instead of silently lost.
    /// Headless sessions skip all of this — their lane wraps the text into one
    /// stream-json user message with no composer in the way.
    pub fn write_text_line(&self, session_id: &str, text: &str) -> Result<(), String> {
        let text = text.trim_end_matches(['\r', '\n']);
        {
            let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            let Some(session) = map.get(session_id) else {
                return Err(format!("session not found: {session_id}"));
            };
            if matches!(session.mode, FleetSessionMode::Headless) {
                drop(map);
                return self.write_input(session_id, text.as_bytes());
            }
        }
        self.write_input(session_id, text.as_bytes())?;

        let sid = session_id.to_string();
        tauri::async_runtime::spawn(async move {
            // Let the composer ingest the paste before the submit keystroke.
            tokio::time::sleep(std::time::Duration::from_millis(350)).await;
            for attempt in 1..=2u32 {
                if registry().write_input(&sid, b"\r").is_err() {
                    return; // writer gone (killed / dozed mid-flight) — nothing to confirm
                }
                // Submission proof: the session flips Running (UserPromptSubmit
                // hook, or a tool hook reviving it). Poll briefly.
                for _ in 0..10 {
                    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                    if matches!(
                        registry().session_state(&sid),
                        Some(FleetSessionState::Running) | None
                    ) {
                        super::debug_log::athena(
                            &sid,
                            "input submitted",
                            &format!("confirmed running (enter attempt {attempt})"),
                        );
                        return;
                    }
                }
                // An extra lone Enter is a no-op in an empty composer, so one
                // retry is safe; more would risk driving an unrelated prompt.
            }
            super::debug_log::athena(
                &sid,
                "input NOT confirmed",
                "typed text + 2× Enter but the session never flipped Running — the composer may still hold the text",
            );
            tracing::warn!(
                session_id = %sid,
                "fleet write_text_line: submit unconfirmed after 2 Enter attempts"
            );
        });
        Ok(())
    }

    /// Direct state transition for lanes that observe the process itself
    /// (the headless stream-json reader) rather than hooks. Sets state +
    /// reason + freshens activity; returns `true` only on a real change so
    /// the caller emits one event per transition. Never resurrects terminal
    /// states (`Exited` / `Hibernated`).
    pub fn set_state_direct(
        &self,
        session_id: &str,
        state: FleetSessionState,
        reason: &str,
    ) -> bool {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get_mut(session_id) else { return false; };
        if matches!(session.state, FleetSessionState::Exited | FleetSessionState::Hibernated) {
            return false;
        }
        session.last_activity_ms = now_ms();
        if session.state == state {
            return false;
        }
        session.state = state;
        session.state_reason = Some(reason.to_string());
        true
    }

    /// Resize the PTY for `session_id`.
    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get_mut(session_id) else {
            return Err(format!("session not found: {session_id}"));
        };
        let rows = rows.max(8);
        let cols = cols.max(40);
        // Keep the stored dims in sync so screen reconstruction (render_screen)
        // renders at the size claude is actually drawing to.
        session.cols = cols;
        session.rows = rows;
        let master_guard = session.master.lock().unwrap_or_else(|e| e.into_inner());
        let Some(master) = master_guard.as_ref() else {
            return Err(format!("session master dropped: {session_id}"));
        };
        master
            .resize(portable_pty::PtySize {
                rows,
                cols,
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

    /// Update a session's live terminal title (captured from the OSC stream).
    /// Returns `true` only when the title actually changed, so the reader emits a
    /// registry-changed event just on real changes (Claude retitles often).
    pub fn set_title(&self, session_id: &str, title: &str) -> bool {
        let trimmed = title.trim();
        // Claude Code's generic terminal title is just "claude" / "Claude Code"
        // (optionally with a leading status glyph like "✳ ") for EVERY session —
        // ignore it (and empties) so it never clobbers the LLM-assigned name or a
        // real task summary. A title with MORE than the bare word ("claude —
        // fixing auth") is a genuine summary and passes. We only ever set the
        // title to a meaningful value.
        if trimmed.is_empty() || is_generic_claude_title(trimmed) {
            return false;
        }
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get_mut(session_id) else {
            return false;
        };
        if session.title.as_deref() == Some(trimmed) {
            return false;
        }
        session.title = Some(trimmed.to_string());
        true
    }

    /// Mark Athena as actively working this session's awaiting-input ticket for a
    /// short window, so the tile shows the light-blue "Athena's on it" affordance.
    /// Returns true if the session exists (so the caller emits registry-changed).
    pub fn mark_athena_active(&self, session_id: &str) -> bool {
        const ATHENA_ACTIVE_WINDOW_MS: i64 = 120_000;
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get_mut(session_id) else {
            return false;
        };
        session.athena_active_until_ms = now_ms() + ATHENA_ACTIVE_WINDOW_MS;
        true
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

    /// Reconstruct the rendered screen for one session (its `rev` + the visible
    /// grid as lines), using the session's stored PTY dims. `None` for an unknown
    /// session. The companion orchestration uses this to actually READ what a
    /// paused session is blocked on (a cursor-addressed TUI the line-cooker can't
    /// render). See [`OutputRing::render_screen`].
    pub fn render_screen_for(&self, session_id: &str) -> Option<(u32, Vec<String>)> {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let session = map.get(session_id)?;
        let mut ring = session.output.lock().unwrap_or_else(|e| e.into_inner());
        let rev = ring.rev();
        Some((rev, ring.render_screen(session.rows, session.cols)))
    }

    /// Records that the child has exited. Updates state and clears the
    /// PTY resource slots. Called from the reaper task.
    pub fn mark_exited(&self, session_id: &str, exit_code: Option<i32>) {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = map.get_mut(session_id) {
            session.state = FleetSessionState::Exited;
            session.exit_code = exit_code;
            session.last_activity_ms = now_ms();
            // For a non-zero exit, fold claude's FINAL on-screen output into the
            // reason. Claude prints its error (e.g. a refused `--resume`: "No
            // deferred tool marker found … provide a prompt to continue") then
            // exits, so the rendered-screen tail still holds it — without this the
            // UI showed only "Exited with code 1" and the real cause died with the
            // PTY. (Detection half of the resume-failure fix.)
            let reason = match exit_code {
                Some(0) => "Exited cleanly".to_string(),
                Some(c) => {
                    let base = fleet_exit_reason(c);
                    let tail = {
                        let mut ring = session.output.lock().unwrap_or_else(|e| e.into_inner());
                        ring.render_screen(session.rows, session.cols)
                    };
                    match last_meaningful_line(&tail) {
                        Some(msg) => format!("{base} — claude said: \u{201c}{msg}\u{201d}"),
                        None => base,
                    }
                }
                None => "Exited (signal or crash)".to_string(),
            };
            session.state_reason = Some(reason);
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

    /// Light sleep — free the process of a session parked in `Stale` /
    /// `AwaitingInput`, WITHOUT changing its displayed state (contrast
    /// [`Self::hibernate`], which flips the row to `Hibernated`). The operator
    /// keeps seeing what the session was doing; the `dozing` DTO flag drives a
    /// small sleep indicator, and returning to the session wakes it via
    /// `claude --resume`.
    ///
    /// Re-validates everything under the lock (the ticker's snapshot is stale
    /// by the time this runs): still in a doze-eligible state, an actual live
    /// process to free, and a bound `claude_session_id` to resume from —
    /// never-attached sessions fail the last check by construction, which is
    /// right: there is no conversation to come back to.
    pub fn doze(&self, session_id: &str) -> bool {
        use std::sync::atomic::Ordering;
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get_mut(session_id) else { return false };
        if session.dozing
            || !matches!(
                session.state,
                FleetSessionState::Stale | FleetSessionState::AwaitingInput
            )
            || !matches!(session.mode, FleetSessionMode::Interactive)
            || session.claude_session_id.is_none()
            || session.child_pid.is_none()
        {
            return false;
        }
        session.dozing = true;
        // NOT `hibernating` — the reaper's dozing branch keeps the state.
        session.hibernating.store(false, Ordering::SeqCst);
        if let Some(k) = &session.killer {
            if let Ok(mut k) = k.lock() {
                let _ = k.kill();
            }
        }
        if let Ok(mut w) = session.writer.lock() { *w = None; }
        if let Ok(mut m) = session.master.lock() { *m = None; }
        true
    }

    /// Whether the session is in the light-sleep state (see [`Self::doze`]).
    pub fn is_dozing(&self, session_id: &str) -> bool {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.get(session_id).map(|s| s.dozing).unwrap_or(false)
    }

    /// Drop the "Athena's on it" window immediately — called when her
    /// assessment RESOLVES (auto-fire, consult, or a prose defer) so the tile
    /// flips to the session's real state the moment there is an outcome,
    /// instead of wearing light-blue until the window lapses. Returns true if
    /// a window was actually cleared (caller emits registry-changed).
    pub fn clear_athena_active(&self, session_id: &str) -> bool {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(session) = map.get_mut(session_id) else { return false };
        let was = session.athena_active_until_ms != 0;
        session.athena_active_until_ms = 0;
        was
    }

    /// Expire lapsed "Athena's on it" windows and return the affected ids.
    ///
    /// The DTO computes `athena_active` from the deadline at SNAPSHOT time, but
    /// the frontend only re-snapshots on an event — so without this sweep a
    /// lapsed window kept the tile light-blue forever (observed live 2026-07-23:
    /// three tiles stuck "Athena" masking their violet awaiting state). The
    /// ticker calls this each tick and emits registry-changed for each id.
    pub fn sweep_expired_athena(&self) -> Vec<String> {
        let now = now_ms();
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let mut expired = Vec::new();
        for session in map.values_mut() {
            if session.athena_active_until_ms != 0 && session.athena_active_until_ms <= now {
                session.athena_active_until_ms = 0;
                expired.push(session.id.clone());
            }
        }
        expired
    }

    /// Make a session visibly need the operator: force `AwaitingInput` with
    /// `reason` (unless the session is terminal), clearing any "Athena's on it"
    /// window so the violet state can actually show. Returns the previous state
    /// token when anything changed, `None` for terminal/missing sessions —
    /// the caller emits the state event outside the lock.
    ///
    /// This is the "Athena looked and it's genuinely your call" escalation:
    /// her defer used to leave only an orb card, which is easy to miss — the
    /// session itself is the thing the operator watches, so the session is
    /// what must say "needs you".
    pub fn escalate_to_awaiting(&self, session_id: &str, reason: &str) -> Option<&'static str> {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let session = map.get_mut(session_id)?;
        // Only park-able states escalate. A session that is Running/Spawning
        // again MOVED ON while Athena's turn was in flight — stamping it back
        // to "awaiting" would stomp fresher truth (observed live: a defer
        // note reading "actively progressing, leaving it to finish" flipped a
        // Running session to awaiting_input). Terminal states have nothing to
        // escalate.
        if !matches!(
            session.state,
            FleetSessionState::AwaitingInput | FleetSessionState::Stale | FleetSessionState::Idle
        ) {
            return None;
        }
        let prev = state_to_token(session.state);
        session.athena_active_until_ms = 0;
        session.state = FleetSessionState::AwaitingInput;
        session.state_reason = Some(reason.to_string());
        session.last_activity_ms = now_ms();
        Some(prev)
    }

    /// `(created_at_ms, name)` of a session — read by `fleet_wake_session`
    /// before it replaces the row, so the resumed session can inherit them.
    pub fn lineage_of(&self, session_id: &str) -> Option<(i64, Option<String>)> {
        let map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.get(session_id).map(|s| (s.created_at_ms, s.name.clone()))
    }

    /// Stamp an inherited `created_at_ms` (+ user rename) onto a freshly
    /// spawned row. Grid tiles are ordered by spawn time so their positions
    /// stay put; without this, waking a hibernated/dozing session minted a new
    /// row with a NEW timestamp and the tile jumped to the end of the grid —
    /// the resumed conversation is a continuation, so it keeps its slot.
    pub fn adopt_lineage(&self, session_id: &str, created_at_ms: i64, name: Option<String>) {
        let mut map = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = map.get_mut(session_id) {
            session.created_at_ms = created_at_ms;
            if session.name.is_none() {
                session.name = name;
            }
        }
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
        // Hibernated rows AND dozing rows (light sleep — process freed, state
        // kept) are both resumable; everything else has a live process or
        // nothing to come back to.
        if !matches!(s.state, FleetSessionState::Hibernated) && !s.dozing {
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

/// Serialize one user turn as a stream-json input line for a headless
/// (`claude -p --input-format stream-json`) session. Trailing newline
/// included — the protocol is line-delimited JSON.
pub fn headless_user_message(text: &str) -> String {
    let msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "text", "text": text }] }
    });
    let mut line = msg.to_string();
    line.push('\n');
    line
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

/// Pull the most informative line from a session's final rendered screen so a
/// non-zero exit can name *why* in the UI. Prefers an explicit error line
/// (claude prints `Error: …` then exits), else the last substantive line;
/// skips blanks, rule/box-drawing lines, the prompt caret, and the permissions
/// footer. Capped so a stray wide line can't bloat the reason.
fn last_meaningful_line(lines: &[String]) -> Option<String> {
    let clean = |s: &str| -> String { s.trim().chars().take(220).collect() };
    let is_noise = |s: &str| {
        let t = s.trim();
        t.is_empty()
            || !t.chars().any(|c| c.is_alphanumeric()) // rules / box-drawing
            || t.starts_with('\u{276f}') // ❯ prompt caret
            || t.contains("bypass permissions")
            || t.contains("shift+tab")
    };
    // Prefer an explicit error / resume-refusal line.
    if let Some(err) = lines.iter().rev().find(|l| {
        let t = l.to_lowercase();
        t.contains("error") || t.contains("provide a prompt") || t.contains("not found")
    }) {
        return Some(clean(err));
    }
    lines.iter().rev().find(|l| !is_noise(l)).map(|l| clean(l))
}

/// True when an OSC terminal title is just Claude Code's bare generic name —
/// "claude" / "Claude Code", optionally with a leading status glyph (✳, ●, ·)
/// and surrounding whitespace. A title carrying MORE than the bare word (a real
/// task summary like "claude — fixing auth") returns false and is kept. Used by
/// `set_title` to stop the generic value clobbering the LLM-assigned name.
fn is_generic_claude_title(title: &str) -> bool {
    let core = title
        .trim()
        .trim_start_matches(|c: char| !c.is_alphanumeric())
        .trim();
    core.eq_ignore_ascii_case("claude") || core.eq_ignore_ascii_case("claude code")
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

    #[test]
    fn generic_claude_titles_are_filtered_but_real_summaries_kept() {
        // Generic — filtered (won't clobber the LLM name).
        assert!(is_generic_claude_title("claude"));
        assert!(is_generic_claude_title("Claude Code"));
        assert!(is_generic_claude_title("✳ claude"));
        assert!(is_generic_claude_title("  ● Claude Code  "));
        // Real summaries / assigned names — kept.
        assert!(!is_generic_claude_title("claude — fixing auth"));
        assert!(!is_generic_claude_title("JWT Auth Refactor"));
        assert!(!is_generic_claude_title("Dark Mode Toggle"));
    }

    #[test]
    fn last_meaningful_line_surfaces_the_resume_refusal() {
        // The real failure: claude prints its error, then redraws a blank prompt
        // region. We must surface the error, not the trailing caret / footer.
        let screen = vec![
            "".to_string(),
            "Error: No deferred tool marker found in the resumed session. Provide a prompt to continue the conversation.".to_string(),
            "─────────────────────────".to_string(),
            "❯ ".to_string(),
            "  ⏵⏵ bypass permissions on (shift+tab to cycle)".to_string(),
        ];
        let got = last_meaningful_line(&screen).unwrap();
        assert!(got.starts_with("Error:"), "got: {got}");
        assert!(
            got.to_lowercase().contains("provide a prompt"),
            "got: {got}"
        );
    }

    #[test]
    fn last_meaningful_line_falls_back_to_last_substantive_line() {
        let screen = vec![
            "Done. Files written.".to_string(),
            "════════════".to_string(),
            "❯".to_string(),
        ];
        assert_eq!(
            last_meaningful_line(&screen).as_deref(),
            Some("Done. Files written.")
        );
        // All-noise screen → nothing to report.
        assert_eq!(last_meaningful_line(&["".to_string(), "──".to_string()]), None);
    }

    /// Build a minimal session record with no live PTY (master/writer `None`),
    /// so `hibernate` can be exercised without spawning a real child.
    fn session(id: &str, state: FleetSessionState, csid: Option<&str>) -> FleetSessionInner {
        FleetSessionInner {
            id: id.to_string(),
            claude_session_id: csid.map(|s| s.to_string()),
            cwd: PathBuf::from("/tmp/test"),
            project_label: "test".to_string(),
            name: None,
            title: None,
            athena_active_until_ms: 0,
            args: Vec::new(),
            mode: FleetSessionMode::Interactive,
            cols: 120,
            rows: 32,
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
            dozing: false,
            output: Arc::new(Mutex::new(OutputRing::new(OUTPUT_RING_CAP))),
            killer: None,
        }
    }

    #[test]
    fn render_screen_reconstructs_cursor_addressed_tui() {
        let mut ring = OutputRing::new(OUTPUT_RING_CAP);
        // Enter alt-screen, clear, then draw a menu via cursor positioning
        // (CSI row;col H) — exactly the shape an AskUserQuestion menu uses and
        // the line-cooker collapses (it resets on ?1049h/2J and ignores cursor
        // moves, so it would yield only the last fragment).
        let seq = b"\x1b[?1049h\x1b[2J\
            \x1b[1;1HChoose validation strategy:\
            \x1b[3;3H1. Throw\x1b[4;3H2. Return null\
            \x1b[6;1HEnter to select";
        ring.push(seq);
        let joined = ring.render_screen(10, 80).join("\n");
        assert!(joined.contains("Choose validation strategy:"), "got: {joined}");
        assert!(joined.contains("1. Throw"), "got: {joined}");
        assert!(joined.contains("2. Return null"), "got: {joined}");
        assert!(joined.contains("Enter to select"), "got: {joined}");
        // The cooker would NOT reconstruct these cursor-addressed rows.
        assert!(cook_lines(seq, 40).join("\n").trim() != joined.trim());
    }

    #[test]
    fn render_screen_incremental_feed_matches_full_reparse() {
        // Tier C: after the parser is materialized by a first render, later
        // pushes feed it incrementally — the resulting screen must equal what
        // a from-scratch re-parse of the same bytes produces.
        let part1: &[u8] = b"\x1b[?1049h\x1b[2J\x1b[1;1HChoose validation strategy:";
        let part2: &[u8] = b"\x1b[3;3H1. Throw\x1b[4;3H2. Return null\x1b[6;1HEnter to select";

        let mut incremental = OutputRing::new(OUTPUT_RING_CAP);
        incremental.push(part1);
        let _ = incremental.render_screen(10, 80); // materializes the parser
        incremental.push(part2); // fed incrementally

        let mut full = OutputRing::new(OUTPUT_RING_CAP);
        full.push(part1);
        full.push(part2);

        assert_eq!(incremental.render_screen(10, 80), full.render_screen(10, 80));
    }

    #[test]
    fn render_screen_rebuilds_on_dim_change() {
        let mut ring = OutputRing::new(OUTPUT_RING_CAP);
        ring.push(b"\x1b[1;1Hhello");
        let at80 = ring.render_screen(10, 80);
        assert!(at80.join("\n").contains("hello"));
        // Resize → rebuild from the ring at the new dims; content survives.
        let at120 = ring.render_screen(20, 120);
        assert!(at120.join("\n").contains("hello"));
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
