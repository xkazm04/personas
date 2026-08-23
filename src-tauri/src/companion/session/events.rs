//! The wire: every Tauri event name a turn emits, the payload structs behind
//! them, and the two emit helpers.
//!
//! Moved verbatim out of the former single-file `session.rs`.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Tauri event channel that streams every CLI line to the frontend.
pub const STREAM_EVENT: &str = "companion://stream";

/// Tauri event channel for approval-card creation (Phase 3). Fires once
/// per turn that produced any new approvals.
pub const APPROVALS_EVENT: &str = "companion://approvals";

/// Tauri event channel for a `ClientAction` produced by an approval that
/// resolved WITHOUT a card — i.e. autonomous-mode auto-fire. On the manual
/// path the frontend gets the client action back as part of the
/// `companion_approve_action` return value and dispatches it inline; with no
/// card there is no return value to ride on, so the same payload is emitted
/// here and `useAthenaChatNavigation` applies it identically. Without this an
/// auto-fired `prefill_persona_create` / `open_test_env` would silently do
/// nothing on screen.
pub const CLIENT_ACTION_EVENT: &str = "companion://client-action";

/// Tauri event channel for direct sidebar navigations triggered by
/// Athena's `open_route` op. Fires once per navigation. Frontend
/// listens and calls `setSidebarSection(route)` without collapsing
/// the chat panel — chat-driven nav is meant to feel transparent.
pub const NAVIGATE_EVENT: &str = "companion://navigate";

/// Tauri event for `start_guided_walkthrough` auto-fire. Payload is
/// `{ topic }`. The frontend runner (`useGuidanceRunner`) starts the
/// registry-defined walkthrough — orb glides + element glow + narration.
pub const GUIDE_EVENT: &str = "companion://guide";

/// Tauri event for "open this persona's lab tab and select mode X" —
/// Athena's `open_lab` op. Payload: `{ personaId, mode }`. Bypasses
/// approval like NAVIGATE_EVENT; the persona editor reads this and
/// jumps the user there.
pub const OPEN_LAB_EVENT: &str = "companion://open-lab";

/// Tauri event for `compose_dashboard` auto-fire. Payload is empty —
/// the spec is already persisted server-side; the frontend just needs
/// to navigate to the Companion → Dashboard tab so the user sees it.
pub const COMPOSE_DASHBOARD_EVENT: &str = "companion://compose-dashboard";

/// Tauri event for `compose_cockpit` auto-fire. Same shape as
/// `COMPOSE_DASHBOARD_EVENT` — empty payload; the spec is already
/// persisted; the frontend navigates to Home → Cockpit on receipt.
pub const COMPOSE_COCKPIT_EVENT: &str = "companion://compose-cockpit";

/// Tauri event for `explain_in_cockpit` auto-fire. UNLIKE compose, the
/// payload carries the full spec JSON (`{ "spec": "<json string>" }`) and
/// nothing is persisted — the frontend renders it as a contextual overlay
/// (Home → Cockpit) that dies with dismissal, leaving the user's
/// persistent cockpit untouched.
pub const EXPLAIN_COCKPIT_EVENT: &str = "companion://explain-cockpit";

/// Tauri event for `compose_canvas_panel` auto-fire (WP3). Payload is
/// `{ slug, specVersion, spec }` where `spec` is the serialized SurfaceSpec.
/// Nothing is persisted server-side: a canvas panel belongs to the canvas
/// LAYOUT document (`mastermind.layout.v1` → `athenaPanels[slug]`), which the
/// frontend owns, and which is the only place its per-project reset control
/// can reach it.
pub const COMPOSE_CANVAS_PANEL_EVENT: &str = "companion://compose-canvas-panel";

/// Tauri event for `canvas_control` auto-fire (WP4 — steering the Mastermind
/// canvas). Payload is `{ sessionId, action }` where `action` is the
/// serialized, dispatcher-validated `CanvasActionRequest` JSON. Nothing is
/// persisted: steering is view state. The frontend bridge dispatches into the
/// canvas action grammar and reports the settled result back through the
/// `companion_canvas_control_result` command (a System episode keyed by the
/// echoed `sessionId`), which is why the session id rides in the payload.
pub const CANVAS_CONTROL_EVENT: &str = "companion://canvas-control";

/// Tauri event for inline chat-cards emitted via `show_persona_overview`,
/// `show_connected_services`, `show_decisions`. Payload is the list of cards
/// for this turn; the frontend appends them to the latest assistant bubble.
/// Auto-fire — no approval, no server-side persistence (transient UI).
pub const CHAT_CARDS_EVENT: &str = "companion://chat-cards";

/// Per-turn rollup of what Athena's brain pulled into the system prompt:
/// counts + glanceable titles per memory kind. Emitted once per turn, right
/// after the prompt is built and right before the CLI spawn. Payload is a
/// `RecallPreviewEvent { sessionId, turnId, preview }`. The frontend renders
/// a small "Athena consulted N memories" strip above the streaming bubble.
pub const RECALL_PREVIEW_EVENT: &str = "companion://recall-preview";

/// Wire shape for `RECALL_PREVIEW_EVENT`. `preview` is the same shape as
/// `prompt::RecallPreview` (serialized camelCase). Carrying `turn_id` lets
/// the frontend correlate the strip with the streaming bubble that's
/// about to fill in for this turn; carrying `session_id` mirrors every
/// other companion event for forward compatibility (multi-session is on
/// the roadmap, even though Phase 1 ships a single default session).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallPreviewEvent {
    pub session_id: String,
    pub turn_id: String,
    pub preview: crate::companion::prompt::RecallPreview,
}

/// Per-turn rollup of side-effects the dispatcher produced from Athena's
/// reply: how many approvals were filed, how many direct nav/lab/dashboard/
/// cockpit/chat-card auto-fires happened, and whether she requested an
/// autonomous continuation. Emitted once after the dispatcher block, with
/// `assistant_episode_id` already known so the frontend can key the chip
/// directly under the persisted bubble. No persistence — the chip is
/// session-scoped UI, same lifecycle as `RECALL_PREVIEW_EVENT`.
pub const TURN_SUMMARY_EVENT: &str = "companion://turn-summary";

/// A paired device asked THIS device to run something, and the turn that
/// answers it is starting / has finished. Payload is a
/// [`RemoteJobTurnEvent`]. The turn itself runs with `suppress_chat` (see
/// `remote_device_source`), so this event is the ONLY signal the frontend
/// gets that Athena is doing someone else's errand — the orb notice hangs
/// off it. No persistence: the durable record is the `remote_jobs` row,
/// which has its own `network:remote-job-updated` event.
// Only the `p2p` build has a consumer (the remote-job executor). The
// declaration stays unconditional so this file reads the same in both
// feature sets rather than growing a cfg maze around one string.
#[cfg_attr(not(feature = "p2p"), allow(dead_code))]
pub const REMOTE_JOB_TURN_EVENT: &str = "companion://remote-job-turn";

/// Wire shape for [`REMOTE_JOB_TURN_EVENT`]. `phase` is
/// `"started" | "completed" | "failed"`; `summary` is empty on `started`.
#[cfg_attr(not(feature = "p2p"), allow(dead_code))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteJobTurnEvent {
    pub job_id: String,
    /// The originating device's display name, as confirmed at pairing time.
    pub source: String,
    pub instruction: String,
    pub phase: String,
    pub summary: String,
}

/// Suffix that marks a [`TurnOrigin::External`] source as "another one of the
/// user's own devices asked for this", rather than a frontend surface of THIS
/// app (Fleet's "Ask Athena", …).
///
/// It is deliberately part of the human-readable label instead of a new
/// `TurnOrigin` variant: the string is what the model sees on stdin
/// (`[Automated request from Laptop (paired device) — not the user]`) and what
/// the transcript marker would read, so the provenance is legible in the one
/// place it matters. Everything that must branch on it — the `suppress_chat`
/// decision below — goes through [`is_remote_device_source`], so the coupling
/// is one function, not a scattered string compare.
const REMOTE_DEVICE_SOURCE_SUFFIX: &str = " (paired device)";

/// Build the `TurnOrigin::External::source` label for an instruction that
/// arrived from a paired device.
#[cfg_attr(not(feature = "p2p"), allow(dead_code))]
pub fn remote_device_source(display_name: &str) -> String {
    let name = display_name.trim();
    let name = if name.is_empty() {
        "A paired device"
    } else {
        name
    };
    format!("{name}{REMOTE_DEVICE_SOURCE_SUFFIX}")
}

/// True when an `External` turn came from a paired device rather than from a
/// surface of this app.
pub fn is_remote_device_source(source: &str) -> bool {
    source.ends_with(REMOTE_DEVICE_SOURCE_SUFFIX)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSummaryEvent {
    pub session_id: String,
    pub turn_id: String,
    pub assistant_episode_id: String,
    pub approvals: u32,
    pub navigations: u32,
    pub lab_opens: u32,
    pub dashboards: u32,
    pub cockpits: u32,
    pub chat_cards: u32,
    /// Athena emitted `OP: continue_autonomously` — the next tick is
    /// either scheduled or capped (caller decides). Surfaced as a flag
    /// because "she said she'd keep going" is its own glanceable signal.
    pub continuation: bool,
}

/// What `send_turn` returns to the chat command. The IDs let the UI
/// reconcile the optimistic bubble with persisted episodes; the
/// `quick_replies` carry Athena's QR offerings for this specific turn
/// (transient — UI shows them on the latest assistant bubble until the
/// next send fires); `tts_text` carries her spoken-version line if she
/// emitted one (frontend feeds this into ElevenLabs playback).
#[derive(Debug, Clone)]
pub struct TurnResult {
    pub user_episode_id: String,
    pub assistant_episode_id: String,
    /// The considered final reply, cleaned of `OP:` lines — the same text that
    /// becomes the assistant episode. Carried separately because a
    /// `suppress_chat` turn persists NO episode, so `assistant_episode_id` is
    /// empty and the text would otherwise be unreachable. The remote-job
    /// executor reports this back to the device that asked.
    #[cfg_attr(not(feature = "p2p"), allow(dead_code))]
    pub assistant_text: String,
    pub quick_replies: Vec<String>,
    pub tts_text: Option<String>,
}

/// Hard ceiling per turn — Athena is designed to run long background
/// tasks (codebase scans, idea generation, multi-step reasoning).
/// 25 minutes gives heavy multi-step / subagent-driven flows plenty of
/// headroom without holding a stuck CLI forever. Mirrors the frontend's
/// `COMPANION_TURN_TIMEOUT_MS`; if you change one, change the other.
pub(super) const TURN_TIMEOUT: Duration = Duration::from_secs(25 * 60);

/// One streamed event sent to the frontend. The JSON `payload` is the raw
/// stream-json line so the UI can render thinking/tool-use/text indicators
/// as they arrive without a server-side state machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub session_id: String,
    pub turn_id: String,
    pub kind: StreamEventKind,
    /// Raw stream-json line for `kind=Cli`, free-form text otherwise.
    pub payload: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamEventKind {
    /// Spawn started, persisted user episode id is in payload.
    Started,
    /// One stream-json line from the CLI.
    Cli,
    /// Final assistant episode persisted, payload is the assistant episode id.
    Finished,
    /// Anything that prevented finishing.
    Error,
}

pub(super) fn emit(app: &AppHandle, ev: StreamEvent) {
    if let Err(e) = app.emit(STREAM_EVENT, &ev) {
        tracing::warn!(error = %e, "companion stream emit failed");
    }
}

pub(super) fn emit_error(app: &AppHandle, session_id: &str, turn_id: &str, msg: &str) {
    emit(
        app,
        StreamEvent {
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            kind: StreamEventKind::Error,
            payload: msg.to_string(),
        },
    );
}
