//! Speech-to-text IPC for Athena's voice input.
//!
//! Thin layer over `companion::stt`. The frontend captures mic audio,
//! encodes it as a 16 kHz mono PCM WAV, base64s it, and sends it here for
//! on-device transcription via the local whisper.cpp sidecar. The browser
//! Web Speech engine never calls these commands — it transcribes in the
//! renderer — so the only audio that reaches Rust is the local-engine path.

use std::sync::Arc;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::companion::stt::{
    self,
    catalog::{WhisperModelEntry, WHISPER_MODELS},
    downloader, validate_audio_len, validate_language,
};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Transcribe a base64-encoded 16 kHz mono PCM WAV with the local engine.
/// `language` is an optional whisper hint (`en`, `cs`, …); omit / null to
/// auto-detect (multilingual models only).
#[tauri::command]
pub async fn companion_stt_transcribe(
    state: State<'_, Arc<AppState>>,
    audio_base64: String,
    model_id: String,
    language: Option<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|e| AppError::Validation(format!("companion_stt: invalid base64 audio: {e}")))?;
    validate_audio_len(bytes.len())?;

    let lang = match language.as_deref() {
        Some(l) => Some(validate_language(l)?.to_string()),
        None => None,
    };

    stt::whisper::transcribe(&bytes, &model_id, lang.as_deref()).await
}

/// One row in the Voice tab's whisper-model browser: catalog metadata +
/// `is_downloaded` so the UI picks the right affordance (Download / Use).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelListing {
    #[serde(flatten)]
    pub entry: WhisperModelEntry,
    pub is_downloaded: bool,
}

#[tauri::command]
pub async fn companion_stt_list_models(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<WhisperModelListing>, AppError> {
    require_auth(&state).await?;
    let mut out = Vec::with_capacity(WHISPER_MODELS.len());
    for entry in WHISPER_MODELS {
        out.push(WhisperModelListing {
            entry: entry.clone(),
            is_downloaded: downloader::is_model_downloaded(entry.model_id),
        });
    }
    Ok(out)
}

/// Start a whisper-model download. Resolves once the `.bin` is on disk;
/// progress streams on `companion://stt-download` while this runs.
#[tauri::command]
pub async fn companion_stt_download_model(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    model_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    downloader::download_model(&model_id, &app).await
}

/// Remove a downloaded whisper model. Idempotent.
#[tauri::command]
pub async fn companion_stt_delete_model(
    state: State<'_, Arc<AppState>>,
    model_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    downloader::delete_model(&model_id)
}

/// Report whether the whisper engine binary is installed and where it would
/// be found / should be installed.
#[tauri::command]
pub async fn companion_stt_engine_status(
    state: State<'_, Arc<AppState>>,
) -> Result<stt::whisper::EngineStatus, AppError> {
    require_auth(&state).await?;
    stt::whisper::engine_status()
}
