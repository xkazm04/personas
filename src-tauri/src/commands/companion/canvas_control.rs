//! Result feedback for `canvas_control` (WP4 — steering the Mastermind canvas).
//!
//! The op auto-fires as a Tauri event; the frontend bridge dispatches it into
//! the canvas action grammar (`canvasActionStore.ts`) and calls this command
//! with the settled result envelope. The result lands as a System episode in
//! the session the op came from — the same channel `note_read_op_result` uses
//! — so Athena reads on her NEXT turn where the camera actually ended up
//! (band, visible islands) or why the action refused (`band_too_far`,
//! `unknown_target`, `canvas_closed`).

use std::sync::Arc;

use tauri::State;

use crate::error::AppError;
use crate::AppState;

/// Hard cap on the episode body. The envelope is small by construction (the
/// bridge truncates `visibleSlugs`), but a cap here means a buggy caller can
/// never flood the transcript.
const CANVAS_CONTROL_RESULT_CHARS: usize = 1200;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionCanvasControlResultInput {
    /// Companion session the op was dispatched from (echoed off the event).
    pub session_id: String,
    /// The action kind that settled, e.g. `camera.focus` — names the note.
    pub kind: String,
    /// Serialized `CanvasActionResult` envelope from the grammar.
    pub result: String,
}

#[tauri::command]
pub async fn companion_canvas_control_result(
    state: State<'_, Arc<AppState>>,
    input: CompanionCanvasControlResultInput,
) -> Result<(), AppError> {
    crate::ipc_auth::require_auth(&state).await?;

    let session_id = input.session_id.trim();
    if session_id.is_empty() || session_id.len() > 128 {
        return Err(AppError::Validation("sessionId must be a session id".into()));
    }
    let mut result = input.result;
    if result.len() > CANVAS_CONTROL_RESULT_CHARS {
        result.truncate(CANVAS_CONTROL_RESULT_CHARS);
        result.push('…');
    }
    let body = format!(
        "[canvas] Result of your `canvas_control` ({kind}):\n\n{result}\n\n\
         `camera.band` is what the user now sees. If `ok` is false, the \
         `reason` names why — do not silently re-emit the same action; adjust \
         or tell the user.",
        kind = input.kind,
        result = result,
    );
    if let Err(e) = crate::companion::brain::episodic::append_episode(
        &state.user_db,
        session_id,
        crate::companion::brain::episodic::EpisodeRole::System,
        &body,
    ) {
        tracing::warn!(
            session = session_id,
            error = %e,
            "companion_canvas_control_result: failed to append system episode"
        );
    }
    Ok(())
}
