//! Bridge command — frontend pushes Fleet lifecycle events into Athena's
//! episodic memory.
//!
//! The Fleet plugin emits `FLEET_SESSION_STATE`, `FLEET_SESSION_EXITED`
//! and `FLEET_REGISTRY_CHANGED` Tauri events. The companion store
//! subscribes to those events in the frontend and calls this command to
//! persist a System episode + (optionally) raise a proactive nudge.
//!
//! Persistence (not nudges) is the unconditional behaviour — every
//! relevant fleet event becomes a single episode. Nudge gating is the
//! "adaptive noise floor": quiet by default; the dispatch loop already
//! reads `companion_autonomous_mode` and the proactive evaluator chooses
//! whether to fire (see `proactive::fleet_triggers`).
//!
//! The command shape is intentionally narrow — frontend already has the
//! session metadata (project label, cwd, state) from its FleetSession
//! cache, so it ships everything in one call and the Rust side avoids
//! a second round-trip to the fleet registry.
//!
//! All fields are owned strings to keep the command shape simple. Volume
//! is low (state transitions happen on hook events, capped by Claude
//! Code's hook firing rate).

use std::sync::Arc;

use tauri::State;

use crate::commands::fleet::types::FleetSessionState;
use crate::companion::brain::fleet::{record_fleet_event, FleetEpisodeInput, FleetEventKind};
use crate::error::AppError;
use crate::AppState;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionRecordFleetEventInput {
    pub session_id: String,
    pub claude_session_id: Option<String>,
    pub project_label: String,
    pub cwd: String,
    /// Discriminator: "state_changed" | "exited" | "spawned".
    pub kind: String,
    /// For `state_changed`: the new lifecycle state token.
    pub state: Option<String>,
    /// For `state_changed`: optional reason (last hook reason).
    pub reason: Option<String>,
    /// For `exited`: process exit code, or null on signal/crash.
    pub exit_code: Option<i32>,
    /// For `spawned`: true when Athena spawned the session via
    /// `fleet_spawn` (skips proactive nudges to avoid feedback loops).
    pub athena_owned: Option<bool>,
}

#[tauri::command]
pub async fn companion_record_fleet_event(
    state: State<'_, Arc<AppState>>,
    input: CompanionRecordFleetEventInput,
) -> Result<String, AppError> {
    crate::ipc_auth::require_auth(&state).await?;

    let kind = match input.kind.as_str() {
        "spawned" => FleetEventKind::Spawned {
            athena_owned: input.athena_owned.unwrap_or(false),
        },
        "exited" => FleetEventKind::Exited {
            exit_code: input.exit_code,
        },
        "state_changed" => {
            let st = parse_state_token(input.state.as_deref().unwrap_or(""))
                .ok_or_else(|| AppError::Validation(format!(
                    "unknown fleet state token: {:?}", input.state,
                )))?;
            FleetEventKind::StateChanged {
                state: st,
                reason: input.reason.as_deref(),
            }
        }
        other => {
            return Err(AppError::Validation(format!(
                "unknown fleet event kind: {other}",
            )));
        }
    };

    let event = FleetEpisodeInput {
        session_id: &input.session_id,
        claude_session_id: input.claude_session_id.as_deref(),
        project_label: &input.project_label,
        cwd: &input.cwd,
        kind: kind.clone(),
    };

    // Update operative memory alongside the episode write. Operative
    // memory is in-process, no DB; the call is sync and cheap. Doing
    // it here (not in a separate command) keeps Athena's "what's
    // happening now" view consistent with her "what happened" memory.
    let mem = crate::companion::orchestration::operative_memory::memory();
    match &kind {
        FleetEventKind::StateChanged { state: fs_state, .. } => {
            mem.record_session_event(
                &input.session_id,
                input.claude_session_id.as_deref(),
                &input.project_label,
                &input.cwd,
                *fs_state,
            );
        }
        FleetEventKind::Spawned { .. } => {
            mem.record_session_event(
                &input.session_id,
                input.claude_session_id.as_deref(),
                &input.project_label,
                &input.cwd,
                crate::commands::fleet::types::FleetSessionState::Spawning,
            );
        }
        FleetEventKind::Exited { exit_code } => {
            // Run the synthesizer first so the SessionRef.summary is
            // populated before record_fleet_event reads it for the
            // episode body (Direction 4 — replaces UUID-only episodes
            // with synthesized work logs).
            let synthesized = mem.synthesize_session_summary(&input.session_id, *exit_code);
            mem.record_session_event(
                &input.session_id,
                input.claude_session_id.as_deref(),
                &input.project_label,
                &input.cwd,
                crate::commands::fleet::types::FleetSessionState::Exited,
            );
            // The synthesized summary is available via SessionRef but
            // not currently propagated into the episode body — that
            // path requires record_fleet_event to consult operative
            // memory. We pull that thread inline below.
            if let Some(summary) = synthesized {
                return write_episode_with_summary(
                    &state.user_db,
                    &input,
                    *exit_code,
                    &summary,
                );
            }
        }
    }

    record_fleet_event(&state.user_db, event)
}

/// Direction 4 helper — write an Exited episode whose body uses the
/// operative-memory synthesized summary instead of the bare
/// "exited code N" line. The marker tokens stay so retrieval still
/// works; the human-readable summary is appended below.
fn write_episode_with_summary(
    pool: &crate::db::UserDbPool,
    input: &CompanionRecordFleetEventInput,
    exit_code: Option<i32>,
    summary: &str,
) -> Result<String, AppError> {
    use crate::companion::brain::episodic::{append_episode, EpisodeRole};
    use crate::companion::session::DEFAULT_SESSION_ID;

    let csid = input.claude_session_id.as_deref().unwrap_or("-");
    let exit_token = match exit_code {
        Some(0) => "exited_clean",
        Some(_) => "exited_failed",
        None => "exited_abnormal",
    };
    let body = format!(
        "fleet-event session:{sid} cc:{csid} state:{tok} project:{proj}\n\nSession **{sid}** ({proj}) {summary}",
        sid = input.session_id,
        tok = exit_token,
        proj = input.project_label,
    );
    append_episode(pool, DEFAULT_SESSION_ID, EpisodeRole::System, &body)
}

fn parse_state_token(s: &str) -> Option<FleetSessionState> {
    match s {
        "spawning"       => Some(FleetSessionState::Spawning),
        "running"        => Some(FleetSessionState::Running),
        "awaiting_input" => Some(FleetSessionState::AwaitingInput),
        "idle"           => Some(FleetSessionState::Idle),
        "stale"          => Some(FleetSessionState::Stale),
        "exited"         => Some(FleetSessionState::Exited),
        _ => None,
    }
}
