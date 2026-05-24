//! Speech-to-text for Athena's voice input — on-device via whisper.cpp.
//!
//! Mirrors the `companion::tts` layout: a thin command layer
//! (`commands::companion::stt`) over the real work here. The browser Web
//! Speech engine is handled entirely in the frontend (`useDictation`) and
//! never reaches this module — only the local Whisper engine does, so the
//! audio bytes captured from the user's mic stay on the device.
//!
//! Adding the engine = drop a sidecar `whisper-cli` binary + a ggml model;
//! `whisper.rs` spawns the binary per transcription. Subprocess isolation
//! (same rationale as Piper TTS) keeps whisper.cpp's own ggml/BLAS stack out
//! of our process — though unlike Piper this is mostly future-proofing, since
//! whisper.cpp doesn't link ONNX Runtime at all.

pub mod catalog;
pub mod downloader;
pub mod whisper;

use crate::error::AppError;

/// Hard ceiling on the decoded WAV payload accepted over IPC. A voice turn
/// is a sentence or two; 25 MB of 16 kHz mono 16-bit PCM is ~13 minutes —
/// far beyond a single turn, so this is purely a safety cap against a
/// runaway capture, not a normal-path limit.
pub const STT_MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;

/// Minimum plausible WAV payload (44-byte header + a few samples). Rejects
/// empty / truncated uploads before we bother spawning the engine.
pub const STT_MIN_AUDIO_BYTES: usize = 44 + 32;

/// Validate the decoded audio byte length sits in a sane band.
pub fn validate_audio_len(len: usize) -> Result<(), AppError> {
    if len < STT_MIN_AUDIO_BYTES {
        return Err(AppError::Validation(format!(
            "companion_stt: audio too short ({len} bytes)"
        )));
    }
    if len > STT_MAX_AUDIO_BYTES {
        return Err(AppError::Validation(format!(
            "companion_stt: audio too large ({} bytes, max {})",
            len, STT_MAX_AUDIO_BYTES
        )));
    }
    Ok(())
}

/// Validate a BCP-47-ish language hint (`en`, `cs`, `en-US`, or `auto`).
/// Whisper accepts a short language code; we keep it to letters + a hyphen
/// so it can't smuggle shell/path metacharacters into the spawn args.
pub fn validate_language(lang: &str) -> Result<&str, AppError> {
    let trimmed = lang.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("companion_stt: empty language".into()));
    }
    if trimmed.len() > 8
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphabetic() || c == '-')
    {
        return Err(AppError::Validation(
            "companion_stt: language has unexpected characters".into(),
        ));
    }
    Ok(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_len_rejects_empty_and_huge() {
        assert!(validate_audio_len(0).is_err());
        assert!(validate_audio_len(10).is_err());
        assert!(validate_audio_len(STT_MAX_AUDIO_BYTES + 1).is_err());
        assert!(validate_audio_len(100_000).is_ok());
    }

    #[test]
    fn language_accepts_codes_rejects_meta() {
        assert!(validate_language("en").is_ok());
        assert!(validate_language("en-US").is_ok());
        assert!(validate_language("auto").is_ok());
        assert!(validate_language("../etc").is_err());
        assert!(validate_language("en;rm -rf").is_err());
        assert!(validate_language("").is_err());
    }
}
