//! Pocket TTS local engine — HTTP sidecar-service inference.
//!
//! Why an HTTP service instead of a subprocess-per-call sidecar (Piper) or
//! an in-process `ort` session:
//! - Pocket TTS (kyutai-labs) is a 100M-param PyTorch model with zero-shot
//!   voice cloning. There is no self-contained CLI binary that runs its
//!   8-graph ONNX export, and bundling Python/PyTorch into the app is a
//!   non-starter — but a *long-lived local HTTP service* keeps the model
//!   warm (one-shot spawn would pay a multi-second model load per call)
//!   and stays out-of-process, so it can't collide with our pinned
//!   in-process `ort 2.0.0-rc.9` (the same DLL hazard `piper.rs` documents).
//! - The service (see `pocket-tts` repo, `service/app.py`) exposes an
//!   ElevenLabs-shaped API, so this module is structurally a twin of
//!   `elevenlabs.rs` with a localhost base URL and no credential.
//! - Voice cloning: dropping a `<name>.safetensors` embedding into the
//!   service's `voices/` dir makes `<name>` a valid `voice_id` here — the
//!   user's own cloned voice speaks Athena's replies.
//!
//! The service is expected at `http://127.0.0.1:8080` (override with the
//! `PERSONAS_POCKET_TTS_URL` env var). It applies its own bounded queue and
//! replies 429 under overload, so no client-side semaphore is needed.

use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::companion::tts::{TtsAudio, TtsSynthesisRequest};
use crate::error::AppError;

/// Where the local service listens unless overridden.
const DEFAULT_BASE_URL: &str = "http://127.0.0.1:8080";

/// Synthesis round-trip cap. Local CPU inference for a 1-3 sentence reply is
/// seconds; a queued request under parallel load can wait longer. 90s matches
/// Kokoro's generosity.
const POCKET_TIMEOUT: Duration = Duration::from_secs(90);

/// Health/voices probes should be snappy — the Voice tab polls this.
const POCKET_PROBE_TIMEOUT: Duration = Duration::from_secs(3);

pub fn base_url() -> String {
    std::env::var("PERSONAS_POCKET_TTS_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim_end_matches('/').to_string())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
}

/// Status payload for the Voice tab's Pocket service card.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PocketStatus {
    /// True when GET /health returned 200 (service up, models loaded).
    pub running: bool,
    /// The base URL we probed — surfaced so the user can see/override it.
    pub base_url: String,
    /// Worker-pool size reported by the service, when running.
    pub workers: Option<u32>,
}

/// One voice row from the service's `GET /v1/voices`. `category` is
/// `"cloned"` for user embeddings in the service's voices dir and
/// `"premade"` for the built-in Kyutai catalog.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PocketVoiceEntry {
    pub voice_id: String,
    pub name: String,
    pub category: String,
}

#[derive(Deserialize)]
struct VoicesResponse {
    voices: Vec<PocketVoiceEntry>,
}

fn probe_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(POCKET_PROBE_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("pocket tts http client: {e}")))
}

pub async fn status() -> Result<PocketStatus, AppError> {
    let base = base_url();
    let client = probe_client()?;
    match client.get(format!("{base}/health")).send().await {
        Ok(resp) if resp.status().is_success() => {
            let workers = resp
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|v| v["config"]["workers"].as_u64())
                .map(|w| w as u32);
            Ok(PocketStatus { running: true, base_url: base, workers })
        }
        // Both "connection refused" (service down) and non-200 (loading)
        // render as not-running; the Voice tab offers a re-check.
        _ => Ok(PocketStatus { running: false, base_url: base, workers: None }),
    }
}

pub async fn list_voices() -> Result<Vec<PocketVoiceEntry>, AppError> {
    let base = base_url();
    let client = probe_client()?;
    let resp = client
        .get(format!("{base}/v1/voices"))
        .send()
        .await
        .map_err(|_| not_running_error(&base))?;
    if !resp.status().is_success() {
        return Err(not_running_error(&base));
    }
    let parsed: VoicesResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("pocket tts voices parse: {e}")))?;
    Ok(parsed.voices)
}

fn not_running_error(base: &str) -> AppError {
    AppError::Validation(format!(
        "Pocket TTS service is not reachable at {base}. Start it (uv run python -m service.app \
         in the pocket-tts repo) or set PERSONAS_POCKET_TTS_URL, then re-check in the Voice tab."
    ))
}

pub async fn synthesize(request: &TtsSynthesisRequest<'_>) -> Result<TtsAudio, AppError> {
    let base = base_url();
    let client = reqwest::Client::builder()
        .timeout(POCKET_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("pocket tts http client: {e}")))?;

    let url = format!(
        "{base}/v1/text-to-speech/{}?output_format=wav_24000",
        request.voice_id
    );
    let body = serde_json::json!({
        "text": request.text,
        "model_id": "pocket_tts",
    });

    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                not_running_error(&base)
            } else {
                AppError::Internal(format!("pocket tts request: {e}"))
            }
        })?;

    let status = resp.status();
    if status.as_u16() == 429 {
        // The service's bounded queue is full — surface as a user-actionable
        // condition rather than an opaque internal error.
        return Err(AppError::Validation(
            "Pocket TTS service is at capacity (queue full) — try again in a moment".into(),
        ));
    }
    if !status.is_success() {
        let body_text = resp.text().await.unwrap_or_default();
        let snippet = if body_text.len() > 400 {
            format!(
                "{}…",
                crate::utils::text::truncate_on_char_boundary(&body_text, 400)
            )
        } else {
            body_text
        };
        return Err(AppError::Internal(format!(
            "Pocket TTS service returned {status}: {snippet}"
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("pocket tts read body: {e}")))?;
    let byte_size = bytes.len();
    let audio_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    Ok(TtsAudio {
        audio_base64,
        mime_type: "audio/wav".into(),
        byte_size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_defaults_and_trims_override() {
        std::env::remove_var("PERSONAS_POCKET_TTS_URL");
        assert_eq!(base_url(), DEFAULT_BASE_URL);

        std::env::set_var("PERSONAS_POCKET_TTS_URL", "http://127.0.0.1:9090/");
        assert_eq!(base_url(), "http://127.0.0.1:9090");
        std::env::remove_var("PERSONAS_POCKET_TTS_URL");

        // Blank override falls back to the default rather than producing
        // a request to an empty host.
        std::env::set_var("PERSONAS_POCKET_TTS_URL", "  ");
        assert_eq!(base_url(), DEFAULT_BASE_URL);
        std::env::remove_var("PERSONAS_POCKET_TTS_URL");
    }
}
