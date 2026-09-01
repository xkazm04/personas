//! Event-driven wait/expect primitives over a session's screen and lifecycle
//! state.
//!
//! **Waiters never poll.** Every `OutputRing::push` bumps a `watch` generation
//! and every state emit bumps a second one; conditions are re-checked only when
//! a generation moves. That replaces two magic constants in the confirmed-submit
//! path — a fixed 350 ms "let the composer ingest it" sleep and a 10 × 400 ms
//! state poll — with (a) *wait until the TUI actually stopped redrawing* and
//! (b) *wake the instant the session flips `Running`*. On a slow machine the
//! old sleep was too short; on a fast one the old poll wasted up to 400 ms per
//! check. Both are now adaptive.
//!
//! A timed-out wait carries [`WaitDiagnostics`] describing what was on screen
//! when it gave up, so the caller never needs a follow-up call to find out why.
//! The 2026-07-24 tabbed-`AskUserQuestion` bug had to be diagnosed by driving a
//! stuck session key-by-key over the bridge; that evidence is now captured at
//! the moment of failure.
//!
//! Pattern adapted from xAI's `ptyctl` (`grok-build`), whose `wait_for` is
//! generation-driven over an `alacritty_terminal` grid and attaches a screen
//! snapshot to every timeout.
//!
//! **Privacy boundary:** diagnostics contain the user's code and paths. They are
//! NEVER written to the shareable `fleet-debug/*.log` (see the "what it
//! deliberately does NOT record" rule in `docs/features/plugins/dev tools/fleet.md`)
//! — that file gets only the *shape* (`screen=1841ch`). Full text goes to
//! `tracing` behind `PERSONAS_FLEET_DEBUG`, the established local-verbose knob.

use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tokio::sync::watch;

use super::registry::{registry, OutputRing};
use super::types::FleetSessionState;

/// Max bytes of recent raw PTY output attached to a timed-out wait.
const RAW_TAIL_CAP: usize = 2048;

/// Backstop re-check interval for state waits. The watch bump is the primary
/// wake; this is what a wait falls back on when a transition lands without one.
///
/// **Measured residual (2026-09-01), after the registry state door landed.**
/// [`note_state_changed`] now fires from inside `registry::apply_transition`
/// itself, not only from `pty::emit_session_state` — so a transition can no
/// longer skip the wake by taking a lane that emits `registry-changed` instead
/// of `session-state`, which three of them did (`mark_alive` from the PTY
/// reader and from the headless reader, `park_recovered` from boot recovery).
/// What is left, and the only reason this constant still exists:
///
/// - `transcript.rs:207` and `transcript.rs:249` still assign `session.state`
///   inline under the registry lock instead of going through the door, so an
///   `Idle` verdict from the transcript watcher wakes nothing. That is the last
///   bypass in the fleet module; when it is converted, this backstop can go.
/// - `registry::mark_exited` writes `Exited` directly on purpose (the door
///   refuses every edge out of a terminal state, and a second reap must still
///   stamp the fresher exit code) — its own caller emits, so it is covered.
///
/// Until the transcript lane is converted, a wait must not be able to hang for
/// its full timeout on a session that already moved.
const STATE_BACKSTOP: Duration = Duration::from_millis(500);

/// A condition a wait blocks on.
///
/// `StableMs` is the one the confirmed-submit path uses today. `Text`/`Gone`/
/// `Regex` are the general screen predicates the keystroke driver will use when
/// `multiselect_keystrokes` is converted off its fixed sleeps — kept here so the
/// primitive is complete rather than shaped around a single caller.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub enum WaitCondition {
    /// Text appears in the rendered screen.
    Text(String),
    /// Text is absent from the rendered screen.
    Gone(String),
    /// Regex matches the rendered screen.
    Regex(String),
    /// The screen has been unchanged for this many milliseconds.
    StableMs(u64),
}

/// Screen state captured when a wait times out.
#[derive(Debug, Clone, serde::Serialize)]
pub struct WaitDiagnostics {
    /// Rendered screen text — the exact text the condition was evaluated against.
    pub screen: String,
    /// Last bytes of raw PTY output (lossy UTF-8, at most [`RAW_TAIL_CAP`]).
    pub raw_tail: String,
    /// Ring generation at timeout.
    pub generation: u32,
    /// Lifecycle state at timeout, if the session still exists.
    pub state: Option<FleetSessionState>,
    /// True when the session was gone or `Exited` before the deadline — the
    /// condition could never have been met. Distinguishes "we typed into a dead
    /// PTY" from "the TUI ignored us", which previously both surfaced as a bare
    /// `AUTO_FAILED`.
    pub ended: bool,
}

impl WaitDiagnostics {
    /// One-line, content-free summary safe for the shareable debug log.
    pub fn shape(&self) -> String {
        let screen = if self.screen.is_empty() {
            "EMPTY".to_string()
        } else {
            format!("{}ch", self.screen.chars().count())
        };
        format!(
            "screen={screen} · gen={} · state={} · ended={}",
            self.generation,
            self.state
                .map(|s| super::types::state_to_token(s).to_string())
                .unwrap_or_else(|| "gone".into()),
            self.ended
        )
    }
}

/// Result of a wait.
#[derive(Debug, Clone, serde::Serialize)]
pub struct WaitOutcome {
    pub matched: bool,
    pub elapsed_ms: u64,
    /// Present only on a miss, so a successful wait costs no screen render.
    pub diagnostics: Option<WaitDiagnostics>,
}

impl WaitOutcome {
    fn hit(start: Instant) -> Self {
        Self {
            matched: true,
            elapsed_ms: start.elapsed().as_millis() as u64,
            diagnostics: None,
        }
    }
}

// ── State generation ───────────────────────────────────────────────────────

static STATE_GEN: OnceLock<watch::Sender<u64>> = OnceLock::new();

fn state_gen() -> &'static watch::Sender<u64> {
    STATE_GEN.get_or_init(|| watch::channel(0).0)
}

/// Bump the state generation. Called from `pty::emit_session_state`, the single
/// choke point all four state lanes funnel through — so every transition wakes
/// any waiter without each lane knowing waiters exist.
pub fn note_state_changed() {
    state_gen().send_modify(|v| *v = v.wrapping_add(1));
}

// ── Screen waits ───────────────────────────────────────────────────────────

/// Everything a wait needs, cloned out of the registry up front so the wait
/// never holds the registry lock while sleeping. Holding it would block every
/// PTY writer and the staleness ticker for the whole wait.
struct WaitHandle {
    session_id: String,
    output: Arc<Mutex<OutputRing>>,
    gen_rx: watch::Receiver<u32>,
    rows: u16,
    cols: u16,
}

impl WaitHandle {
    fn open(session_id: &str) -> Option<Self> {
        let (output, rows, cols) = registry().wait_handle(session_id)?;
        let gen_rx = {
            let ring = output.lock().unwrap_or_else(|e| e.into_inner());
            ring.subscribe()
        };
        Some(Self {
            session_id: session_id.to_string(),
            output,
            gen_rx,
            rows,
            cols,
        })
    }

    fn screen_text(&self) -> String {
        let mut ring = self.output.lock().unwrap_or_else(|e| e.into_inner());
        ring.render_screen(self.rows, self.cols).join("\n")
    }

    fn diagnostics(&self) -> WaitDiagnostics {
        let (screen, raw_tail, generation) = {
            let mut ring = self.output.lock().unwrap_or_else(|e| e.into_inner());
            let screen = ring.render_screen(self.rows, self.cols).join("\n");
            let snap = ring.snapshot();
            // Walk forward to a char boundary before slicing.
            //
            // `snap[snap.len() - RAW_TAIL_CAP..]` is a BYTE index into a UTF-8
            // string, and terminal output is full of multi-byte glyphs. It
            // panicked three times on this machine — twice on 2026-08-05, once
            // on 08-06 — on `'─'` and `'❯'`, both 3 bytes.
            //
            // The task holding this is detached (`fleet/registry.rs:753`), so
            // the panic vanished: the Enter-submit confirmation and its retry
            // were silently skipped while `write_text_line` had already returned
            // `Ok(())`. Nothing upstream could tell.
            //
            // The identical class was fixed in `eval.rs` seven weeks earlier —
            // but that pass searched for a literal this site never contained,
            // which is the doctrine's "fix the class, not the instances" with
            // dates on both sides.
            let tail = if snap.len() > RAW_TAIL_CAP {
                let mut start = snap.len() - RAW_TAIL_CAP;
                while start < snap.len() && !snap.is_char_boundary(start) {
                    start += 1;
                }
                snap[start..].to_string()
            } else {
                snap
            };
            (screen, tail, ring.rev())
        };
        let state = registry().session_state(&self.session_id);
        WaitDiagnostics {
            screen,
            raw_tail,
            generation,
            state,
            ended: ended(&self.session_id),
        }
    }

    fn miss(&self, start: Instant) -> WaitOutcome {
        WaitOutcome {
            matched: false,
            elapsed_ms: start.elapsed().as_millis() as u64,
            diagnostics: Some(self.diagnostics()),
        }
    }
}

/// A session is "ended" when it is gone from the registry or reached `Exited`.
/// Either way no further screen change can occur, so a pending condition can
/// never be met.
fn ended(session_id: &str) -> bool {
    match registry().session_state(session_id) {
        None => true,
        Some(state) => matches!(state, FleetSessionState::Exited),
    }
}

/// Outcome used when the session vanished before the wait could even start.
fn no_session(start: Instant) -> WaitOutcome {
    WaitOutcome {
        matched: false,
        elapsed_ms: start.elapsed().as_millis() as u64,
        diagnostics: Some(WaitDiagnostics {
            screen: String::new(),
            raw_tail: String::new(),
            generation: 0,
            state: None,
            ended: true,
        }),
    }
}

/// Wait until `condition` holds on the session's rendered screen, or `timeout`
/// elapses. Event-driven: the screen is re-rendered only when the ring's
/// generation moves.
pub async fn wait_for_screen(
    session_id: &str,
    condition: WaitCondition,
    timeout: Duration,
) -> WaitOutcome {
    let start = Instant::now();
    let deadline = tokio::time::Instant::now() + timeout;
    let Some(mut handle) = WaitHandle::open(session_id) else {
        return no_session(start);
    };

    if let WaitCondition::StableMs(window_ms) = condition {
        return wait_stable(
            &mut handle,
            Duration::from_millis(window_ms),
            start,
            deadline,
        )
        .await;
    }

    // Compile once so a bad pattern fails immediately rather than per check.
    let regex = match &condition {
        WaitCondition::Regex(pattern) => match regex::Regex::new(pattern) {
            Ok(re) => Some(re),
            Err(e) => {
                tracing::warn!(session_id, error = %e, "fleet wait: invalid regex");
                return handle.miss(start);
            }
        },
        _ => None,
    };

    loop {
        // Mark the current generation seen BEFORE checking, so a push racing
        // the check still wakes `changed()` instead of being missed.
        handle.gen_rx.borrow_and_update();
        let text = handle.screen_text();
        let met = match &condition {
            WaitCondition::Text(needle) => text.contains(needle.as_str()),
            WaitCondition::Gone(needle) => !text.contains(needle.as_str()),
            WaitCondition::Regex(_) => regex.as_ref().is_some_and(|re| re.is_match(&text)),
            WaitCondition::StableMs(_) => unreachable!("handled above"),
        };
        if met {
            return WaitOutcome::hit(start);
        }
        if ended(session_id) {
            return handle.miss(start);
        }
        tokio::select! {
            changed = handle.gen_rx.changed() => {
                if changed.is_err() {
                    // Ring sender gone: no further output is possible.
                    return handle.miss(start);
                }
            }
            _ = tokio::time::sleep_until(deadline) => return handle.miss(start),
        }
    }
}

/// Wait until the screen has been unchanged for `window`, bounded by `deadline`.
/// This is the adaptive replacement for a fixed "give the TUI a beat" sleep.
async fn wait_stable(
    handle: &mut WaitHandle,
    window: Duration,
    start: Instant,
    deadline: tokio::time::Instant,
) -> WaitOutcome {
    // Once the sender is gone the screen is final, so the remaining window
    // always completes rather than spinning on a closed channel.
    let mut sender_gone = false;
    loop {
        handle.gen_rx.borrow_and_update();
        let window_end = tokio::time::Instant::now() + window;
        tokio::select! {
            changed = handle.gen_rx.changed(), if !sender_gone => {
                if changed.is_err() {
                    sender_gone = true;
                }
                // Output arrived: restart the stability window, unless out of time.
                if tokio::time::Instant::now() >= deadline {
                    return handle.miss(start);
                }
            }
            _ = tokio::time::sleep_until(window_end.min(deadline)) => {
                if window_end <= deadline {
                    return WaitOutcome::hit(start);
                }
                return handle.miss(start);
            }
        }
    }
}

// ── State waits ────────────────────────────────────────────────────────────

/// Wait until the session reports `Running` — the submission proof used by the
/// confirmed-submit primitive (the `UserPromptSubmit` hook, or a tool hook
/// reviving it). A session that disappears counts as satisfied, matching the
/// prior polling behaviour: there is nothing left to confirm against.
pub async fn wait_for_running(session_id: &str, timeout: Duration) -> WaitOutcome {
    let start = Instant::now();
    let deadline = tokio::time::Instant::now() + timeout;
    let mut rx = state_gen().subscribe();

    loop {
        rx.borrow_and_update();
        match registry().session_state(session_id) {
            Some(FleetSessionState::Running) | None => return WaitOutcome::hit(start),
            _ => {}
        }
        tokio::select! {
            _ = rx.changed() => {}
            // Backstop, not the primary wake — see STATE_BACKSTOP.
            _ = tokio::time::sleep(STATE_BACKSTOP) => {}
            _ = tokio::time::sleep_until(deadline) => {
                return match WaitHandle::open(session_id) {
                    Some(handle) => handle.miss(start),
                    None => no_session(start),
                };
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shape_is_content_free() {
        let d = WaitDiagnostics {
            screen: "secret/path/to/user/code.rs".into(),
            raw_tail: "also secret".into(),
            generation: 7,
            state: Some(FleetSessionState::AwaitingInput),
            ended: false,
        };
        let shape = d.shape();
        assert!(
            !shape.contains("secret"),
            "shape leaked screen content: {shape}"
        );
        assert!(shape.contains("27ch"));
        assert!(shape.contains("gen=7"));
        assert!(shape.contains("ended=false"));
    }

    #[test]
    fn shape_marks_empty_screen() {
        let d = WaitDiagnostics {
            screen: String::new(),
            raw_tail: String::new(),
            generation: 0,
            state: None,
            ended: true,
        };
        let shape = d.shape();
        assert!(shape.contains("screen=EMPTY"));
        assert!(shape.contains("state=gone"));
        assert!(shape.contains("ended=true"));
    }

    #[tokio::test]
    async fn unknown_session_reports_ended_immediately() {
        let outcome = wait_for_screen(
            "no-such-session",
            WaitCondition::Text("anything".into()),
            Duration::from_millis(50),
        )
        .await;
        assert!(!outcome.matched);
        let d = outcome.diagnostics.expect("miss carries diagnostics");
        assert!(d.ended);
        assert!(d.state.is_none());
    }

    #[tokio::test]
    async fn state_generation_bump_is_receiver_safe() {
        // No receivers exist yet — a bump must not panic.
        note_state_changed();
        let mut rx = state_gen().subscribe();
        rx.borrow_and_update();
        note_state_changed();
        // A bump after subscribing must be observable.
        assert!(rx.has_changed().unwrap_or(false));
    }
}
