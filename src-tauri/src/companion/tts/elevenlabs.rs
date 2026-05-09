//! ElevenLabs cloud TTS engine.
//!
//! Backend HTTP proxy so the API key stays in the encrypted vault and
//! never reaches the renderer process. Returns base64 over IPC because
//! Tauri's invoke serializer handles strings well but binary is brittle;
//! the ~33% inflation is fine for ~50KB clips.

use std::sync::Arc;

use base64::Engine;
use tauri::State;

use crate::companion::tts::{TtsAudio, TtsSynthesisRequest, TTS_REMOTE_TIMEOUT};
use crate::db::repos::resources::credentials;
use crate::error::AppError;
use crate::AppState;

const TTS_ENDPOINT_PREFIX: &str = "https://api.elevenlabs.io/v1/text-to-speech/";
const TTS_DEFAULT_MODEL: &str = "eleven_turbo_v2_5";
const TTS_DEFAULT_STABILITY: f32 = 0.5;
const TTS_DEFAULT_SIMILARITY: f32 = 0.75;

/// Allowlist of ElevenLabs models the Voice tab is allowed to send. Keeping
/// this server-side prevents a typo'd model id from surfacing as a confusing
/// 422 from the upstream API; if we add a model the user wants, we add it
/// here. Order is roughly latency-ascending (turbo < flash < multilingual).
const TTS_ALLOWED_MODELS: &[&str] = &[
    "eleven_turbo_v2_5",
    "eleven_flash_v2_5",
    "eleven_multilingual_v2",
    "eleven_v3",
];

pub async fn synthesize(
    state: &State<'_, Arc<AppState>>,
    credential_id: &str,
    request: &TtsSynthesisRequest<'_>,
) -> Result<TtsAudio, AppError> {
    let cred = credentials::get_by_id(&state.db, credential_id)?;
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
        .timeout(TTS_REMOTE_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("tts http client: {e}")))?;

    let s = request.settings;
    let model_id = match s.model_id.as_deref() {
        Some(m) if !m.is_empty() => {
            if !TTS_ALLOWED_MODELS.contains(&m) {
                return Err(AppError::Validation(format!(
                    "companion_tts: unsupported model_id `{}` (allowed: {})",
                    m,
                    TTS_ALLOWED_MODELS.join(", ")
                )));
            }
            m
        }
        _ => TTS_DEFAULT_MODEL,
    };
    let stability = s
        .stability
        .map(|v| v.clamp(0.0, 1.0))
        .unwrap_or(TTS_DEFAULT_STABILITY);
    let similarity = s
        .similarity_boost
        .map(|v| v.clamp(0.0, 1.0))
        .unwrap_or(TTS_DEFAULT_SIMILARITY);

    let mut voice_settings = serde_json::json!({
        "stability": stability,
        "similarity_boost": similarity,
    });
    // Speed and style are only sent when the user opted in — sending defaults
    // would burn the same band of bytes ElevenLabs would compute server-side.
    if let Some(speed) = s.speed {
        voice_settings["speed"] = serde_json::json!(speed.clamp(0.7, 1.2));
    }
    if let Some(style) = s.style {
        voice_settings["style"] = serde_json::json!(style.clamp(0.0, 1.0));
    }

    let url = format!("{TTS_ENDPOINT_PREFIX}{}", request.voice_id);
    let body = serde_json::json!({
        "text": request.text,
        "model_id": model_id,
        "voice_settings": voice_settings,
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
