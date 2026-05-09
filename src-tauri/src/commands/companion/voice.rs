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

use serde::Serialize;
use tauri::{AppHandle, State};

// Re-export the engine-agnostic types so the existing
// `commands::companion::voice::TtsAudio` import path stays valid for any
// callers that referenced these via the command module.
pub use crate::companion::tts::{TtsAudio, TtsEngineId, TtsSettings};

use crate::companion::tts::{
    self,
    catalog::{PiperVoiceEntry, PIPER_VOICES},
    downloader, validate_text, validate_voice_id, TtsSynthesisRequest,
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

/// One row in the Voice tab's Piper voice browser. Combines the curated
/// catalog metadata with `is_downloaded` so the UI can pick the right
/// affordance per row (Download / Use / Re-download).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiperVoiceListing {
    #[serde(flatten)]
    pub entry: PiperVoiceEntry,
    pub is_downloaded: bool,
}

/// Return the curated Piper voice catalog with each row's `is_downloaded`
/// status checked from disk. Cheap (one stat per voice on the order of
/// 20 voices) so it's safe to call on every Voice-tab open.
#[tauri::command]
pub async fn companion_tts_list_piper_voices(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PiperVoiceListing>, AppError> {
    require_auth(&state).await?;
    let mut out = Vec::with_capacity(PIPER_VOICES.len());
    for entry in PIPER_VOICES {
        out.push(PiperVoiceListing {
            entry: entry.clone(),
            is_downloaded: downloader::is_voice_downloaded(entry.voice_id),
        });
    }
    Ok(out)
}

/// Start a Piper voice download. Returns once both files are on disk; the
/// frontend renders progress through the streaming `companion://tts-download`
/// events emitted while the body of this command is running.
///
/// The `_inflight_guard` inside `download_voice` rejects a second concurrent
/// invocation for the same voice id, so a panicky double-click won't stack
/// duplicate downloads.
#[tauri::command]
pub async fn companion_tts_download_piper_voice(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    voice_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    let voice_id = validate_voice_id(&voice_id)?;
    downloader::download_voice(voice_id, &app).await
}

/// Remove a Piper voice's local files. Idempotent — if the voice was
/// never downloaded the call still returns Ok.
#[tauri::command]
pub async fn companion_tts_delete_piper_voice(
    state: State<'_, Arc<AppState>>,
    voice_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    let voice_id = validate_voice_id(&voice_id)?;
    downloader::delete_voice(voice_id)
}
