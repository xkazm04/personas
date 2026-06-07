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

/// Validate that the decoded bytes are a well-formed 16 kHz mono 16-bit PCM WAV
/// — the format the frontend contract promises and whisper.cpp expects. Length
/// checks alone let a truncated/partial capture, a non-WAV container, or random
/// bytes reach the engine, which then emits empty/garbage output or a raw
/// `whisper exited with …` error instead of a clean "couldn't hear that"
/// (bug-hunt 2026-06-07 companion #6). Parsing is fully bounds-checked so a
/// malformed header can never panic.
pub fn validate_wav_format(bytes: &[u8]) -> Result<(), AppError> {
    fn err(msg: &str) -> AppError {
        AppError::Validation(format!("companion_stt: {msg}"))
    }
    let le_u16 = |b: &[u8]| u16::from_le_bytes([b[0], b[1]]);
    let le_u32 = |b: &[u8]| u32::from_le_bytes([b[0], b[1], b[2], b[3]]);

    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(err("audio is not a RIFF/WAVE file"));
    }

    // Walk the chunk list after the 12-byte RIFF/WAVE header.
    let mut pos = 12usize;
    let mut fmt_ok = false;
    let mut data_len = 0usize;
    while pos + 8 <= bytes.len() {
        let chunk_id = &bytes[pos..pos + 4];
        let chunk_size = le_u32(&bytes[pos + 4..pos + 8]) as usize;
        let body_start = pos + 8;
        let body_end = body_start.saturating_add(chunk_size);
        if body_end > bytes.len() {
            return Err(err("audio has a truncated chunk (size larger than payload)"));
        }
        if chunk_id == b"fmt " {
            if chunk_size < 16 {
                return Err(err("audio fmt chunk is malformed"));
            }
            let body = &bytes[body_start..body_start + 16];
            if le_u16(&body[0..2]) != 1 {
                return Err(err("audio must be uncompressed PCM"));
            }
            if le_u16(&body[2..4]) != 1 {
                return Err(err("audio must be mono (1 channel)"));
            }
            if le_u32(&body[4..8]) != 16_000 {
                return Err(err("audio must be 16 kHz"));
            }
            if le_u16(&body[14..16]) != 16 {
                return Err(err("audio must be 16-bit PCM"));
            }
            fmt_ok = true;
        } else if chunk_id == b"data" {
            data_len = chunk_size;
        }
        // Chunks are word-aligned: skip a pad byte when the size is odd.
        pos = body_end + (chunk_size & 1);
    }

    if !fmt_ok {
        return Err(err("audio is missing a PCM fmt chunk"));
    }
    if data_len < 32 {
        return Err(err("audio has no meaningful sample data"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_wav() -> Vec<u8> {
        let data = [0u8; 64];
        let fmt_len: u32 = 16;
        let data_len = data.len() as u32;
        let riff_len = 4 + (8 + fmt_len) + (8 + data_len);
        let mut w = Vec::new();
        w.extend_from_slice(b"RIFF");
        w.extend_from_slice(&riff_len.to_le_bytes());
        w.extend_from_slice(b"WAVE");
        w.extend_from_slice(b"fmt ");
        w.extend_from_slice(&fmt_len.to_le_bytes());
        w.extend_from_slice(&1u16.to_le_bytes()); // PCM
        w.extend_from_slice(&1u16.to_le_bytes()); // mono
        w.extend_from_slice(&16_000u32.to_le_bytes()); // 16 kHz
        w.extend_from_slice(&32_000u32.to_le_bytes()); // byte rate
        w.extend_from_slice(&2u16.to_le_bytes()); // block align
        w.extend_from_slice(&16u16.to_le_bytes()); // 16-bit
        w.extend_from_slice(b"data");
        w.extend_from_slice(&data_len.to_le_bytes());
        w.extend_from_slice(&data);
        w
    }

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

    #[test]
    fn wav_format_accepts_valid_16k_mono_pcm() {
        assert!(validate_wav_format(&minimal_wav()).is_ok());
    }

    #[test]
    fn wav_format_rejects_non_wav_and_wrong_shape() {
        // Not a RIFF/WAVE container.
        assert!(validate_wav_format(b"this is not audio, just text padding bytes").is_err());
        // Stereo (channels field at byte offset 22) must be rejected.
        let mut stereo = minimal_wav();
        stereo[22] = 2;
        assert!(validate_wav_format(&stereo).is_err());
        // Truncated payload (header claims more than is present).
        let truncated = minimal_wav();
        assert!(validate_wav_format(&truncated[..40]).is_err());
    }
}
