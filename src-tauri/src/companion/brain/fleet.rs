//! Fleet ↔ companion bridge — episodic memory + state digest.
//!
//! Athena does not own the Fleet registry; she is a *consumer* of fleet
//! state. Two surfaces:
//!
//! 1. **Episode writer.** `record_fleet_event` persists a System episode
//!    each time a fleet session transitions or exits. The episode body
//!    is structured markdown that Athena's retrieval layer can grep
//!    (`session:<id>`, `state:<state>`, etc.) and her prompt can quote.
//!
//! 2. **State digest.** `current_state_digest` reads the live fleet
//!    registry and renders a one-block summary that the prompt builder
//!    appends into the observability section ("3 fleet sessions:
//!    1 awaiting input · 2 working"). Always-current, no DB round-trip.
//!
//! Together these give Athena both *history* (episodic memory of fleet
//! activity over time) and *now* (digest of what the fleet is doing this
//! instant), without requiring her to call any tools.

use crate::commands::fleet::types::FleetSessionState;
use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::session::DEFAULT_SESSION_ID;
use crate::db::UserDbPool;
use crate::error::AppError;

/// One fleet event to record. The Tauri command translates the inbound
/// FLEET_SESSION_STATE / FLEET_SESSION_EXITED / FLEET_REGISTRY_CHANGED
/// payloads into this normalized shape before calling `record_fleet_event`.
#[derive(Debug, Clone)]
pub struct FleetEpisodeInput<'a> {
    pub session_id: &'a str,
    pub claude_session_id: Option<&'a str>,
    pub project_label: &'a str,
    pub cwd: &'a str,
    pub kind: FleetEventKind<'a>,
}

#[derive(Debug, Clone)]
pub enum FleetEventKind<'a> {
    /// Session was spawned by the user (or by Athena via fleet_spawn — the
    /// caller tags those distinctly so proactive triggers can skip them).
    Spawned { athena_owned: bool },
    /// State transition driven by a Claude Code hook.
    StateChanged {
        state: FleetSessionState,
        reason: Option<&'a str>,
    },
    /// Process exited (clean or otherwise).
    Exited { exit_code: Option<i32> },
}

/// Write a System episode for `event`. Idempotent at the call-site level
/// (we don't dedupe identical consecutive transitions — the cost is one
/// episode write per event, which is bounded by the fleet event rate).
pub fn record_fleet_event(
    pool: &UserDbPool,
    event: FleetEpisodeInput<'_>,
) -> Result<String, AppError> {
    let body = format_episode_body(&event);
    // Single-session-id companion: every episode lands in DEFAULT_SESSION_ID.
    // The fleet session id is searchable via the body marker line, not the
    // companion session_id column.
    episodic::append_episode(pool, DEFAULT_SESSION_ID, EpisodeRole::System, &body)
}

/// Render the fleet event as searchable markdown. The first line carries
/// structured marker tokens — {session id, claude session id, state, project
/// label} — so the episode can be found by any of them.
///
/// Those tokens reach recall through the episode BODY: it is what gets
/// embedded, and what the on-disk markdown holds. This comment used to say
/// "BM25 / FTS", which was never true — the `companion_fts` mirror those
/// writes fed had no reader anywhere in the tree and has since been dropped.
fn format_episode_body(event: &FleetEpisodeInput<'_>) -> String {
    let marker_state = match &event.kind {
        FleetEventKind::Spawned { .. } => "spawned".to_string(),
        FleetEventKind::StateChanged { state, .. } => state_token(*state).to_string(),
        FleetEventKind::Exited { .. } => "exited".to_string(),
    };
    let csid = event.claude_session_id.unwrap_or("-");
    let mut s = format!(
        "fleet-event session:{sid} cc:{csid} state:{st} project:{proj}\n\n",
        sid = event.session_id,
        st = marker_state,
        proj = event.project_label,
    );

    match &event.kind {
        FleetEventKind::Spawned { athena_owned } => {
            let who = if *athena_owned { "Athena" } else { "the user" };
            s.push_str(&format!(
                "Fleet session **{}** spawned by {} in `{}`.\n",
                event.session_id, who, event.cwd
            ));
        }
        FleetEventKind::StateChanged { state, reason } => {
            s.push_str(&format!(
                "Fleet session **{}** ({}) → **{}**.",
                event.session_id,
                event.project_label,
                state_label(*state),
            ));
            if let Some(r) = reason {
                s.push_str(&format!(" Reason: {r}."));
            }
            s.push('\n');
        }
        FleetEventKind::Exited { exit_code } => {
            let summary = match exit_code {
                Some(0) => "exited cleanly (code 0)".to_string(),
                Some(c) => format!("exited with code {c} (non-zero — likely a failure)"),
                None => "exited unexpectedly (signal or crash)".to_string(),
            };
            s.push_str(&format!(
                "Fleet session **{}** ({}) {}.\n",
                event.session_id, event.project_label, summary
            ));
        }
    }
    s
}

fn state_token(s: FleetSessionState) -> &'static str {
    match s {
        FleetSessionState::Spawning => "spawning",
        FleetSessionState::Running => "running",
        FleetSessionState::AwaitingInput => "awaiting_input",
        FleetSessionState::Idle => "idle",
        FleetSessionState::Stale => "stale",
        FleetSessionState::Finished => "finished",
        FleetSessionState::Hibernated => "hibernated",
        FleetSessionState::Exited => "exited",
    }
}

fn state_label(s: FleetSessionState) -> &'static str {
    match s {
        FleetSessionState::Spawning => "spawning",
        FleetSessionState::Running => "working",
        FleetSessionState::AwaitingInput => "awaiting input",
        FleetSessionState::Idle => "idle",
        FleetSessionState::Stale => "stale",
        FleetSessionState::Finished => "task complete",
        FleetSessionState::Hibernated => "hibernated",
        FleetSessionState::Exited => "exited",
    }
}
