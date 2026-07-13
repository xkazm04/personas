//! TTS dispatch IPC for Athena's spoken replies.
//!
//! Thin layer over `companion::tts` engines. The frontend sends the text +
//! engine selector + voice id; we validate, route to the correct engine,
//! and return base64 audio + mime metadata.
//!
//! Backwards compat: `engine` is optional and defaults to Kokoro (the
//! primary engine since the 2026-07-10 ElevenLabs/Piper descope). The
//! `credential_id` parameter is accepted-and-ignored so pre-descope callers
//! with persisted state keep working without IPC errors.

use std::sync::Arc;

use base64::Engine;
use tauri::{AppHandle, State};

// Re-export the engine-agnostic types so the existing
// `commands::companion::voice::TtsAudio` import path stays valid for any
// callers that referenced these via the command module.
pub use crate::companion::tts::{TtsAudio, TtsEngineId, TtsSettings};

use crate::companion::tts::{
    self,
    kokoro_catalog::{KokoroVoiceEntry, KOKORO_VOICES},
    validate_text, validate_voice_id, TtsSynthesisRequest,
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
    #[allow(unused_variables)] credential_id: Option<String>,
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
        TtsEngineId::Kokoro => {
            // Same local-sidecar backpressure as Piper — one Kokoro subprocess
            // reloads the ~310MB model, so unbounded concurrency would thrash.
            let _permit = state
                .companion_tts_semaphore
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| {
                    AppError::Internal("companion_tts: synthesis semaphore closed".into())
                })?;
            tts::kokoro::synthesize(&state, &request).await
        }
        TtsEngineId::PocketTts => {
            // No client-side semaphore: the long-lived service applies its own
            // bounded worker pool + queue and answers 429 under overload,
            // which `pocket::synthesize` maps to a user-facing message.
            tts::pocket::synthesize(&request).await
        }
    }
}

/// Return the curated Kokoro voice catalog. There is no
/// per-voice download status — the model is monolithic, so `companion_tts_
/// kokoro_status` reports whether the (single) model package is installed.
#[tauri::command]
pub async fn companion_tts_list_kokoro_voices(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<KokoroVoiceEntry>, AppError> {
    require_auth(&state).await?;
    Ok(KOKORO_VOICES.to_vec())
}

/// Report whether the Kokoro sidecar binary and model package are installed,
/// plus the expected install paths + download URLs. The Voice tab uses this
/// to render a two-step setup card (engine binary, then model package).
#[tauri::command]
pub async fn companion_tts_kokoro_status(
    state: State<'_, Arc<AppState>>,
) -> Result<tts::kokoro::KokoroStatus, AppError> {
    require_auth(&state).await?;
    tts::kokoro::status()
}

/// Report whether the local Pocket TTS sidecar service is reachable (and its
/// worker-pool size). The Voice tab gates the Pocket engine behind this so a
/// stopped service surfaces as a setup card, not a synthesis error.
#[tauri::command]
pub async fn companion_tts_pocket_status(
    state: State<'_, Arc<AppState>>,
) -> Result<tts::pocket::PocketStatus, AppError> {
    require_auth(&state).await?;
    tts::pocket::status().await
}

/// List the Pocket TTS service's voices — the user's cloned `.safetensors`
/// embeddings (category `cloned`) plus the built-in Kyutai catalog
/// (category `premade`).
#[tauri::command]
pub async fn companion_tts_list_pocket_voices(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<tts::pocket::PocketVoiceEntry>, AppError> {
    require_auth(&state).await?;
    tts::pocket::list_voices().await
}

/// Save an uploaded voice recording as a Pocket cloned voice. The payload is
/// a base64 WAV the frontend already converted (Web Audio API → 24kHz mono
/// PCM16, trimmed to ~30s), so this decodes, validates, and writes it into
/// the pocket-voices dir under `voice_id`.
#[tauri::command]
pub async fn companion_tts_pocket_import_voice(
    state: State<'_, Arc<AppState>>,
    voice_id: String,
    audio_base64: String,
) -> Result<tts::pocket::PocketVoiceEntry, AppError> {
    require_auth(&state).await?;
    let voice_id = validate_voice_id(&voice_id)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|e| AppError::Validation(format!("voice upload: invalid base64: {e}")))?;
    tts::pocket::import_voice(voice_id, &bytes)
}

/// Remove a Pocket cloned voice's reference recording. Idempotent.
#[tauri::command]
pub async fn companion_tts_pocket_delete_voice(
    state: State<'_, Arc<AppState>>,
    voice_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    let voice_id = validate_voice_id(&voice_id)?;
    tts::pocket::delete_voice(voice_id)
}

/// One-click download + extract of the Pocket TTS sidecar binary (arch-aware:
/// win-arm64 or win-x64) + the int8 ONNX model package into
/// `~/.personas/companion-tts/`. Progress streams on `companion://pocket-install`.
#[tauri::command]
pub async fn companion_tts_pocket_download(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    tts::pocket_installer::install(&app).await
}

/// One-click download + extract of the Kokoro sidecar binary + model package
/// into `~/.personas/companion-tts/`. Progress streams on the
/// `companion://kokoro-install` event channel; resolves once both are in place
/// (and verified) or errors. Windows-only (the prebuilt sidecar is win-x64).
#[tauri::command]
pub async fn companion_tts_kokoro_download(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    tts::kokoro_installer::install(&app).await
}
