//! TTS dispatch IPC for Athena's spoken replies.
//!
//! Thin layer over `companion::tts` engines. The frontend sends the text +
//! engine selector + per-engine identity (credential id for ElevenLabs,
//! voice id for both); we validate, route to the correct engine, and
//! return base64 audio + mime metadata.
//!
//! Backwards compat: `engine` is optional and defaults to ElevenLabs so
//! pre-Piper callers keep working without code changes. Once the frontend
//! migrates to always passing `engine`, the default is still safe — it
//! just becomes a redundant assertion of intent.

use std::sync::Arc;

use tauri::State;

// Re-export the engine-agnostic types so the existing
// `commands::companion::voice::TtsAudio` import path stays valid for any
// callers that referenced these via the command module.
pub use crate::companion::tts::{TtsAudio, TtsEngineId, TtsSettings};

use crate::companion::tts::{
    self, validate_text, validate_voice_id, TtsSynthesisRequest,
};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

#[tauri::command]
pub async fn companion_tts(
    state: State<'_, Arc<AppState>>,
    text: String,
    voice_id: String,
    engine: Option<TtsEngineId>,
    credential_id: Option<String>,
    settings: Option<TtsSettings>,
) -> Result<TtsAudio, AppError> {
    require_auth(&state).await?;

    let trimmed = validate_text(&text)?;
    let voice_id = validate_voice_id(&voice_id)?;
    let settings = settings.unwrap_or_default();
    let engine = engine.unwrap_or_default();

    let request = TtsSynthesisRequest {
        text: trimmed,
        voice_id,
        settings: &settings,
    };

    match engine {
        TtsEngineId::Elevenlabs => {
            let cred_id = credential_id.ok_or_else(|| {
                AppError::Validation(
                    "companion_tts: ElevenLabs engine requires a credential_id".into(),
                )
            })?;
            tts::elevenlabs::synthesize(&state, &cred_id, &request).await
        }
        TtsEngineId::Piper => tts::piper::synthesize(&state, &request).await,
    }
}
