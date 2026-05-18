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

use crate::commands::fleet::registry::registry;
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
    StateChanged { state: FleetSessionState, reason: Option<&'a str> },
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
/// the structured marker tokens so BM25 / FTS can find this episode by
/// any of {session id, claude session id, state, project label}.
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
                event.session_id, event.project_label, state_label(*state),
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
        FleetSessionState::Spawning       => "spawning",
        FleetSessionState::Running        => "running",
        FleetSessionState::AwaitingInput  => "awaiting_input",
        FleetSessionState::Idle           => "idle",
        FleetSessionState::Stale          => "stale",
        FleetSessionState::Exited         => "exited",
    }
}

fn state_label(s: FleetSessionState) -> &'static str {
    match s {
        FleetSessionState::Spawning       => "spawning",
        FleetSessionState::Running        => "working",
        FleetSessionState::AwaitingInput  => "awaiting input",
        FleetSessionState::Idle           => "idle",
        FleetSessionState::Stale          => "stale",
        FleetSessionState::Exited         => "exited",
    }
}

/// One-block prompt digest of the *current* fleet state. Empty string
/// when no non-exited sessions exist (so the prompt stays clean when
/// fleet isn't in use). Called from `prompt::build_system_prompt` and
/// appended into the observability section.
pub fn current_state_digest() -> String {
    let dtos = registry().list_dto();
    let active: Vec<_> = dtos
        .into_iter()
        .filter(|s| !matches!(s.state, FleetSessionState::Exited))
        .collect();
    if active.is_empty() {
        return String::new();
    }

    let mut waiting = 0usize;
    let mut working = 0usize;
    let mut idle = 0usize;
    let mut stale = 0usize;
    let mut spawning = 0usize;
    for s in &active {
        match s.state {
            FleetSessionState::AwaitingInput => waiting += 1,
            FleetSessionState::Running       => working += 1,
            FleetSessionState::Idle          => idle += 1,
            FleetSessionState::Stale         => stale += 1,
            FleetSessionState::Spawning      => spawning += 1,
            FleetSessionState::Exited        => {}
        }
    }

    let mut s = String::from("\n## Active Fleet (Claude Code sessions)\n");
    s.push_str(&format!(
        "{} session{} live — {} awaiting input · {} working · {} idle · {} stale · {} spawning.\n",
        active.len(),
        if active.len() == 1 { "" } else { "s" },
        waiting, working, idle, stale, spawning,
    ));
    s.push_str("Per-session:\n");
    for sess in active.iter().take(10) {
        let name = sess.name.as_deref().map(|n| format!(" — \"{n}\"")).unwrap_or_default();
        s.push_str(&format!(
            "- `{id}` ({proj}{name}): {state}\n",
            id = &sess.id[..sess.id.len().min(8)],
            proj = sess.project_label,
            name = name,
            state = state_label(sess.state),
        ));
    }
    if active.len() > 10 {
        s.push_str(&format!("- … {} more not shown\n", active.len() - 10));
    }
    s.push_str(
        "\nYou may reference these sessions by id, project, or name. When \
the user asks about \"the fleet\", \"sessions\", \"what's running\", or \
similar, ground the answer in this list.\n",
    );
    s
}
