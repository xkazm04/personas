//! Fleet → proactive trigger evaluators.
//!
//! Reads the live fleet registry (in-process, no DB hit) and emits
//! Nudges for sessions that warrant the user's attention. Tier-1
//! ("quiet") noise floor:
//!
//!   * `fleet_failed`   — a session exited with a non-zero code
//!     within the last `FAILURE_WINDOW`.
//!   * `fleet_awaiting` — a session has been `AwaitingInput` for
//!     longer than `AWAIT_THRESHOLD`.
//!   * `fleet_stale`    — a session reached the `Stale` state (no
//!     activity for the fleet staleness cutoff, currently 5 min).
//!
//! Spawning, transitions to Running/Idle, and short awaiting windows
//! are silent — they still create episodes via the bridge (so Athena
//! can talk about them on demand), but they don't push notifications.
//!
//! Dedupe: `trigger_ref` is the fleet session id, so the proactive
//! engine's existing per-ref dedupe + budget guards apply uniformly
//! with the time/state-based triggers (no separate cooldown logic
//! needed here).
//!
//! Adaptive noise (Phase A scope note): the user's autonomous-mode
//! flag is not currently persisted in user_db, so we cannot read it
//! from this synchronous evaluator. The "active mode = announce every
//! transition" variant is deferred to Phase E; for now this evaluator
//! is the quiet baseline.

use crate::commands::fleet::registry::registry;
use crate::commands::fleet::types::FleetSessionState;

use super::Nudge;

/// How long an `AwaitingInput` session must wait before we surface
/// a nudge. 2 minutes — short enough that the user notices before
/// drifting away, long enough that brief permission prompts the
/// user is actively reading don't fire.
const AWAIT_THRESHOLD_MS: i64 = 2 * 60 * 1000;

/// How recent an `Exited` failure has to be to nudge. Older failures
/// are noise (the user has likely moved on). 10 minutes covers a
/// realistic "I stepped away and came back to a failed run" window.
const FAILURE_WINDOW_MS: i64 = 10 * 60 * 1000;

pub fn fleet_attention() -> Vec<Nudge> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let dtos = registry().list_dto();
    let mut out = Vec::new();

    for s in &dtos {
        let id_prefix = &s.id[..s.id.len().min(8)];
        let label = match s.name.as_deref() {
            Some(n) => format!("{} — {}", s.project_label, n),
            None => s.project_label.clone(),
        };
        match s.state {
            FleetSessionState::AwaitingInput => {
                let waited_ms = now_ms - s.last_activity_ms;
                if waited_ms >= AWAIT_THRESHOLD_MS {
                    let minutes = waited_ms / 60_000;
                    out.push(Nudge {
                        trigger_kind: "fleet_awaiting".into(),
                        trigger_ref: Some(s.id.clone()),
                        message: format!(
                            "Fleet session `{}` ({}) has been awaiting your input for ~{} min. Want me to peek at what it needs?",
                            id_prefix, label, minutes,
                        ),
                    });
                }
            }
            FleetSessionState::Stale => {
                out.push(Nudge {
                    trigger_kind: "fleet_stale".into(),
                    trigger_ref: Some(s.id.clone()),
                    message: format!(
                        "Fleet session `{}` ({}) has gone stale — no activity for 5+ minutes. Pick it back up or close it out?",
                        id_prefix, label,
                    ),
                });
            }
            FleetSessionState::Exited => {
                let exited_recently = (now_ms - s.last_activity_ms) <= FAILURE_WINDOW_MS;
                let bad_exit = matches!(s.exit_code, Some(code) if code != 0) || s.exit_code.is_none();
                if exited_recently && bad_exit {
                    let detail = match s.exit_code {
                        Some(c) => format!("exit code {c}"),
                        None => "process died abnormally (signal or crash)".to_string(),
                    };
                    out.push(Nudge {
                        trigger_kind: "fleet_failed".into(),
                        trigger_ref: Some(s.id.clone()),
                        message: format!(
                            "Fleet session `{}` ({}) failed — {}. Want me to look at the log?",
                            id_prefix, label, detail,
                        ),
                    });
                }
            }
            FleetSessionState::Spawning
            | FleetSessionState::Running
            | FleetSessionState::Idle
            | FleetSessionState::Hibernated => {}
        }
    }
    out
}

/// How long a session in a dispatched_by_athena op must sit with a
/// `recent_failure` set AND no new event before we surface it as a
/// stuck-session candidate. 4 minutes — short enough that the user
/// catches a stall before they've moved on, long enough to filter out
/// brief failures that the session is already recovering from.
const STUCK_THRESHOLD_MS: i64 = 4 * 60 * 1000;

/// D9 — stuck-session detector. Scans operative memory for sessions
/// in `dispatched_by_athena` ops that look stuck (recent_failure
/// stamped, no event in `STUCK_THRESHOLD_MS`) AND haven't been
/// intervened on yet (the operative_memory cap allows one
/// intervention per session). Emits one Nudge per stuck session with
/// a suggested intervention prompt — the user can act on it via the
/// normal chat/approval flow, or Athena can pick it up on her next
/// turn and propose a `fleet_intervene` action.
///
/// Deliberately informational, not auto-fire — at this maturity we
/// want a human (or Athena under explicit autonomous-mode consent)
/// to decide whether to write into a running session's stdin.
pub fn stuck_dispatched_sessions() -> Vec<Nudge> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let mem = crate::companion::orchestration::operative_memory::memory();
    let mut out = Vec::new();
    for op in mem.snapshot_all_operations() {
        if !op.dispatched_by_athena {
            continue;
        }
        for s in &op.sessions {
            if matches!(
                s.last_state,
                FleetSessionState::Exited | FleetSessionState::Idle
            ) {
                continue; // not a live, working session
            }
            let Some(failure) = s.recent_failure.as_ref() else {
                continue;
            };
            if s.interventions > 0 {
                continue; // already intervened — escalating would loop
            }
            let stuck_for_ms = now_ms - s.last_event_at_ms;
            if stuck_for_ms < STUCK_THRESHOLD_MS {
                continue;
            }
            let role = s.role.as_deref().unwrap_or("session");
            let id_prefix = &s.fleet_session_id[..s.fleet_session_id.len().min(8)];
            let op_id_short = &op.id[..op.id.len().min(8)];
            let minutes = stuck_for_ms / 60_000;
            // Truncate the failure tail to keep the nudge body short.
            let tail = truncate_one_line(failure, 160);
            out.push(Nudge {
                trigger_kind: "fleet_session_stuck".into(),
                trigger_ref: Some(s.fleet_session_id.clone()),
                message: format!(
                    "Dispatched session `{id_prefix}` ({role}) in op `{op_id_short}` looks stuck — no \
event for ~{minutes}m and the last failure was: {tail}. Want me to propose a `fleet_intervene`?"
                ),
            });
        }
    }
    out
}

fn truncate_one_line(s: &str, max: usize) -> String {
    let one_line = s.replace('\n', " / ").replace('\r', "");
    if one_line.chars().count() <= max {
        one_line
    } else {
        let mut out: String = one_line.chars().take(max).collect();
        out.push('…');
        out
    }
}
