//! Text-to-speech engine abstraction for Athena's spoken replies.
//!
//! The `commands::companion::voice` IPC layer is a thin dispatcher; the real
//! work — HTTP calls to ElevenLabs, ONNX inference for Piper — lives in the
//! per-engine submodules here. Common types (settings, audio output,
//! validation) are hoisted into this module so engines stay consistent
//! about input shape and frontend marshalling.
//!
//! Adding a new engine = drop a new submodule alongside `elevenlabs.rs` /
//! `piper.rs` exposing `synthesize(...) -> Result<TtsAudio, AppError>`,
//! add a variant to `TtsEngineId`, and wire it into `voice.rs` dispatch.

pub mod catalog;
pub mod downloader;
pub mod elevenlabs;
pub mod piper;

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Hard ceiling on the TTS payload — Athena should send 1-3 sentences.
/// Anything longer is a prompt-following bug, not a real spoken summary.
/// The same ceiling applies to every engine so we can't accidentally
/// route a giant string at a local model that would take 30s to render.
pub const TTS_MAX_CHARS: usize = 1200;

/// Cap on remote TTS round-trip. Local engines do their own bounded loop
/// inside the synth call so they don't need this.
pub const TTS_REMOTE_TIMEOUT: Duration = Duration::from_secs(30);

/// Identifier for which engine should fulfill a TTS request. Serializes as
/// a snake_case string — matches the wire format the frontend already uses
/// for every other token-based identifier in the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TtsEngineId {
    /// ElevenLabs cloud TTS. Requires a vault credential + voice id.
    Elevenlabs,
    /// Local Piper TTS via ONNX. Requires a downloaded voice model.
    Piper,
}

impl TtsEngineId {
    pub fn as_str(self) -> &'static str {
        match self {
            TtsEngineId::Elevenlabs => "elevenlabs",
            TtsEngineId::Piper => "piper",
        }
    }
}

impl Default for TtsEngineId {
    fn default() -> Self {
        TtsEngineId::Elevenlabs
    }
}

/// Optional per-call voice tuning. The frontend bundles whichever fields
/// the user has customized; missing fields fall back to per-engine defaults.
/// Some fields only make sense on certain engines (e.g. `stability` is
/// ElevenLabs-specific, `length_scale` is Piper-specific) — engines ignore
/// fields that don't apply.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSettings {
    // ElevenLabs fields
    pub model_id: Option<String>,
    pub stability: Option<f32>,
    pub similarity_boost: Option<f32>,
    /// Speech rate. ElevenLabs accepts 0.7..=1.2; values outside the band
    /// degrade audio quality, so engines clamp on the way through.
    pub speed: Option<f32>,
    /// Style exaggeration (0..=1). Only meaningful on multilingual_v2 / v3.
    pub style: Option<f32>,
    // Piper fields
    /// Length scale (slower > 1.0 < faster). Piper-specific; ElevenLabs
    /// ignores this. Sensible band: 0.7..=1.4.
    pub length_scale: Option<f32>,
    /// Per-sample noise. Higher values = more variation. Piper-specific.
    pub noise_scale: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsAudio {
    /// Base64-encoded audio bytes.
    pub audio_base64: String,
    /// MIME type — `audio/mpeg` for ElevenLabs (MP3), `audio/wav` for Piper.
    pub mime_type: String,
    pub byte_size: usize,
}

/// Engine-agnostic synthesis input. Engines pick the relevant fields from
/// `settings` and ignore the rest.
pub struct TtsSynthesisRequest<'a> {
    pub text: &'a str,
    pub voice_id: &'a str,
    pub settings: &'a TtsSettings,
}

/// Validate the text payload — non-empty after trim and within the char cap.
/// Returns the trimmed slice on success.
pub fn validate_text(text: &str) -> Result<&str, AppError> {
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
    Ok(trimmed)
}

/// Validate a voice id. Both ElevenLabs and Piper voice ids fit the same
/// shape (alphanumeric + `-` + `_`); rejecting URL/path meta-chars keeps
/// the URLs/paths we build downstream innocent.
pub fn validate_voice_id(voice_id: &str) -> Result<&str, AppError> {
    let trimmed = voice_id.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("companion_tts: empty voice_id".into()));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Validation(
            "companion_tts: voice_id has unexpected characters".into(),
        ));
    }
    Ok(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_id_serializes_as_snake_case() {
        assert_eq!(
            serde_json::to_string(&TtsEngineId::Elevenlabs).unwrap(),
            "\"elevenlabs\""
        );
        assert_eq!(
            serde_json::to_string(&TtsEngineId::Piper).unwrap(),
            "\"piper\""
        );
    }

    #[test]
    fn engine_id_default_is_elevenlabs_for_backcompat() {
        // Existing frontend callers that don't pass an engine field get
        // the original behavior. Changing this default is a breaking
        // change for the IPC surface — don't touch it casually.
        assert_eq!(TtsEngineId::default(), TtsEngineId::Elevenlabs);
    }

    #[test]
    fn validate_text_rejects_empty() {
        assert!(validate_text("   ").is_err());
        assert!(validate_text("").is_err());
    }

    #[test]
    fn validate_text_rejects_oversized() {
        let too_long = "x".repeat(TTS_MAX_CHARS + 1);
        assert!(validate_text(&too_long).is_err());
    }

    #[test]
    fn validate_text_trims() {
        assert_eq!(validate_text("  hello  ").unwrap(), "hello");
    }

    #[test]
    fn validate_voice_id_accepts_piper_format() {
        // Piper voices look like `en_US-amy-medium` / `cs_CZ-jirka-medium`.
        assert!(validate_voice_id("en_US-amy-medium").is_ok());
        assert!(validate_voice_id("cs_CZ-jirka-medium").is_ok());
    }

    #[test]
    fn validate_voice_id_accepts_elevenlabs_format() {
        // ElevenLabs voices are 20-char alphanumeric.
        assert!(validate_voice_id("21m00Tcm4TlvDq8ikWAM").is_ok());
    }

    #[test]
    fn validate_voice_id_rejects_path_traversal() {
        assert!(validate_voice_id("../etc/passwd").is_err());
        assert!(validate_voice_id("voice/with/slashes").is_err());
        assert!(validate_voice_id("voice with spaces").is_err());
    }
}
