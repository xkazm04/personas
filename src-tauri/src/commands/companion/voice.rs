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
    downloader,
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
        TtsEngineId::Piper => {
            // Backpressure: cap concurrent local piper sidecars so chunked
            // replies / TTS-while-STT don't stack unbounded ONNX-voice loads.
            // Held across the synth call; released on every exit path via the
            // permit's Drop. ElevenLabs is a network call and isn't gated here.
            // (combined-scan 2026-06-25 #3)
            let _permit = state
                .companion_tts_semaphore
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| {
                    AppError::Internal("companion_tts: synthesis semaphore closed".into())
                })?;
            tts::piper::synthesize(&state, &request).await
        }
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

/// Report whether the Piper engine binary is installed and where it
/// would be found / where the user should install it. UI uses this to
/// gate Piper synthesis behind a clear install affordance instead of
/// surfacing a confusing runtime error from `companion_tts`.
#[tauri::command]
pub async fn companion_tts_piper_engine_status(
    state: State<'_, Arc<AppState>>,
) -> Result<tts::piper::EngineStatus, AppError> {
    require_auth(&state).await?;
    tts::piper::engine_status()
}

/// Return the curated Kokoro voice catalog. Unlike Piper there is no
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
