//! ElevenLabs TTS proxy for Athena's spoken replies.
//!
//! Frontend hands us the credential id + voice id + text; we read the
//! decrypted API key from the vault, call ElevenLabs, and return the
//! audio bytes as base64 so it crosses the Tauri IPC boundary cleanly.
//! Frontend wraps the bytes in a Blob and plays via `<audio>`.
//!
//! Deliberate choices:
//! - Backend proxy (not direct from JS) so the API key stays in the
//!   encrypted vault and never reaches the renderer process.
//! - Base64 over IPC. Tauri's invoke serializer handles strings well
//!   but binary is brittle; the ~33% inflation is fine for ~50KB clips.
//! - `eleven_turbo_v2_5` model — cheaper + lower latency than the
//!   flagship and good enough for short conversational replies.
//! - Fixed voice settings (stability 0.5, similarity 0.75); nothing
//!   user-tunable yet — we surface those in the Voice panel later.

use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri::State;

use crate::db::repos::resources::credentials;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

const TTS_ENDPOINT_PREFIX: &str = "https://api.elevenlabs.io/v1/text-to-speech/";
const TTS_MODEL: &str = "eleven_turbo_v2_5";
const TTS_TIMEOUT: Duration = Duration::from_secs(30);
/// Hard ceiling on the TTS payload — Athena should send 1-3 sentences.
/// Anything longer is a prompt-following bug, not a real spoken summary.
const TTS_MAX_CHARS: usize = 1200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsAudio {
    /// Base64-encoded audio (`audio/mpeg`).
    pub audio_base64: String,
    pub mime_type: String,
    pub byte_size: usize,
}

#[tauri::command]
pub async fn companion_tts(
    state: State<'_, Arc<AppState>>,
    text: String,
    credential_id: String,
    voice_id: String,
) -> Result<TtsAudio, AppError> {
    require_auth(&state).await?;

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("companion_tts: empty text".into()));
    }
    if trimmed.len() > TTS_MAX_CHARS {
        return Err(AppError::Validation(format!(
            "companion_tts: text too long ({} chars, max {})",
            trimmed.len(),
            TTS_MAX_CHARS
        )));
    }
    let voice_id = voice_id.trim();
    if voice_id.is_empty() {
        return Err(AppError::Validation("companion_tts: empty voice_id".into()));
    }
    // ElevenLabs voice ids are short alphanumeric strings; reject anything
    // with shell-or-URL meta-chars to keep the URL we build innocent.
    if !voice_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Validation(
            "companion_tts: voice_id has unexpected characters".into(),
        ));
    }

    let cred = credentials::get_by_id(&state.db, &credential_id)?;
    if cred.service_type.to_lowercase() != "elevenlabs" {
        return Err(AppError::Validation(format!(
            "credential `{}` is not an ElevenLabs credential (service_type='{}')",
            cred.name, cred.service_type
        )));
    }
    let fields = credentials::get_decrypted_fields(&state.db, &cred)?;
    let api_key = fields
        .get("api_key")
        .or_else(|| fields.get("apiKey"))
        .ok_or_else(|| {
            AppError::Validation("ElevenLabs credential is missing an `api_key` field".into())
        })?
        .clone();

    let client = reqwest::Client::builder()
        .timeout(TTS_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("tts http client: {e}")))?;

    let url = format!("{TTS_ENDPOINT_PREFIX}{voice_id}");
    let body = serde_json::json!({
        "text": trimmed,
        "model_id": TTS_MODEL,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
        }
    });

    let resp = client
        .post(&url)
        .header("xi-api-key", api_key)
        .header("accept", "audio/mpeg")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("tts request: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        let snippet = if body_text.len() > 400 {
            format!("{}…", &body_text[..400])
        } else {
            body_text
        };
        return Err(AppError::Internal(format!(
            "ElevenLabs returned {status}: {snippet}"
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("tts read body: {e}")))?;
    let byte_size = bytes.len();
    let audio_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    Ok(TtsAudio {
        audio_base64,
        mime_type: "audio/mpeg".into(),
        byte_size,
    })
}
