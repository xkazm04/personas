//! Fleet → proactive trigger evaluators.
//!
//! Reads the live fleet registry (in-process, no DB hit) and emits
//! Nudges for sessions that warrant the user's attention. Tier-1
//! ("quiet") noise floor:
//!
//!   * `fleet_failed`   — a session exited with a non-zero code
//!     within the last `FAILURE_WINDOW`.
//!   * `fleet_stale`    — a session reached the `Stale` state (no
//!     activity for the fleet staleness cutoff, currently 5 min).
//!
//! `AwaitingInput` sessions are deliberately NOT nudged here. In
//! autonomous mode — the only mode this evaluator runs in — they are
//! owned by `fleet_bridge::orchestrate_on_awaiting`, which reads the
//! session's *real screen* and answers or consults with a recommendation.
//! A blind "want me to peek?" nudge just shadowed that smarter path (it
//! asked permission to look at a session Athena can already read). A
//! session the event-driven path couldn't resolve is re-assessed on the
//! proactive tick by `fleet_bridge::reassess_stale_awaiting`, not surfaced
//! as an ask-only card.
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
            // AwaitingInput is owned by orchestrate_on_awaiting /
            // reassess_stale_awaiting (see module docs) — no blind nudge.
            FleetSessionState::Spawning
            | FleetSessionState::Running
            | FleetSessionState::Idle
            | FleetSessionState::AwaitingInput
            | FleetSessionState::Finished
            | FleetSessionState::Hibernated => {}
        }
    }
    out
}
