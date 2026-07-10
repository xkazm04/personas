//! Text-to-speech engine abstraction for Athena's spoken replies.
//!
//! The `commands::companion::voice` IPC layer is a thin dispatcher; the real
//! work — sherpa-onnx sidecar inference — lives in the per-engine submodules
//! here. Common types (settings, audio output, validation) are hoisted into
//! this module so engines stay consistent about input shape and frontend
//! marshalling.
//!
//! Two engines ship today: **Kokoro** (primary — curated high-quality
//! voices) and **Pocket TTS** (experimental — zero-shot voice cloning).
//! The earlier ElevenLabs (cloud, credential-gated) and Piper (per-voice
//! ONNX) engines were descoped 2026-07-10 — two local engines cover the
//! quality × cloning space without a cloud bill or a per-voice download UX.
//!
//! Adding a new engine = drop a new submodule alongside `kokoro.rs` /
//! `pocket.rs` exposing `synthesize(...) -> Result<TtsAudio, AppError>`,
//! add a variant to `TtsEngineId`, and wire it into `voice.rs` dispatch.

pub mod kokoro;
pub mod kokoro_catalog;
pub mod kokoro_installer;
pub mod pocket;
pub mod pocket_installer;

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Shared engine-binary dir: `~/.personas/companion-tts/bin/`. Honors the
/// `PERSONAS_HOME` override like the rest of the TTS stack. (Formerly lived
/// in `piper.rs`; hoisted here when Piper was descoped since Kokoro + Pocket
/// share the same sherpa-onnx binary in this dir.)
pub fn engine_dir() -> Result<PathBuf, AppError> {
    let base = if let Ok(override_dir) = std::env::var("PERSONAS_HOME") {
        PathBuf::from(override_dir)
    } else {
        dirs::home_dir()
            .ok_or_else(|| AppError::Internal("could not resolve home directory".into()))?
            .join(".personas")
    };
    Ok(base.join("companion-tts").join("bin"))
}

/// Hard ceiling on the TTS payload — Athena should send 1-3 sentences.
/// Anything longer is a prompt-following bug, not a real spoken summary.
/// The same ceiling applies to every engine so we can't accidentally
/// route a giant string at a local model that would take 30s to render.
pub const TTS_MAX_CHARS: usize = 1200;

/// Cap on remote TTS round-trip (used by the Pocket HTTP-service backend).
pub const TTS_REMOTE_TIMEOUT: Duration = Duration::from_secs(30);

/// Identifier for which engine should fulfill a TTS request. Serializes as
/// a snake_case string — matches the wire format the frontend already uses
/// for every other token-based identifier in the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TtsEngineId {
    /// Local Kokoro TTS via the sherpa-onnx sidecar (primary engine).
    /// Requires the engine binary + the (shared) Kokoro model package.
    Kokoro,
    /// Local Pocket TTS (kyutai) — experimental. The only engine with
    /// zero-shot voice cloning; packaged sherpa-onnx sidecar or optional
    /// local HTTP service (see `pocket.rs`).
    PocketTts,
}

impl TtsEngineId {
    pub fn as_str(self) -> &'static str {
        match self {
            TtsEngineId::Kokoro => "kokoro",
            TtsEngineId::PocketTts => "pocket_tts",
        }
    }
}

impl Default for TtsEngineId {
    fn default() -> Self {
        // Kokoro is the primary engine since the 2026-07-10 descope of
        // ElevenLabs/Piper. Callers that don't pass `engine` (legacy
        // persisted state) get the curated local voices.
        TtsEngineId::Kokoro
    }
}

/// Optional per-call voice tuning. The frontend bundles whichever fields
/// the user has customized; missing fields fall back to per-engine defaults.
/// Unknown fields from older frontends (the descoped ElevenLabs tuning set)
/// are ignored by serde, so stale persisted settings can't break the wire.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSettings {
    /// Speech rate (0.7..=1.2 convention). Kokoro maps this onto the
    /// sidecar's inverted length-scale; engines clamp on the way through.
    pub speed: Option<f32>,
    /// Direct length-scale override (slower > 1.0 < faster). Takes
    /// priority over `speed` when both are set. Sensible band: 0.7..=1.4.
    pub length_scale: Option<f32>,
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
            serde_json::to_string(&TtsEngineId::Kokoro).unwrap(),
            "\"kokoro\""
        );
        assert_eq!(
            serde_json::to_string(&TtsEngineId::PocketTts).unwrap(),
            "\"pocket_tts\""
        );
    }

    #[test]
    fn engine_id_default_is_kokoro() {
        // Kokoro is the primary engine post-descope. Changing this default
        // is a breaking change for the IPC surface — don't touch it casually.
        assert_eq!(TtsEngineId::default(), TtsEngineId::Kokoro);
    }

    #[test]
    fn tts_settings_ignores_legacy_elevenlabs_fields() {
        // Older frontends / persisted stores may still send the descoped
        // ElevenLabs tuning fields — they must parse cleanly, not error.
        let s: TtsSettings = serde_json::from_str(
            r#"{"modelId":"eleven_v3","stability":0.5,"similarityBoost":0.7,"style":0.1,"speed":1.1}"#,
        )
        .expect("legacy fields must be ignored");
        assert_eq!(s.speed, Some(1.1));
        assert_eq!(s.length_scale, None);
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
