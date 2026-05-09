//! Piper local TTS engine — ONNX inference against per-voice models.
//!
//! Chunk 1 ships the dispatcher wiring with this stub so the IPC surface
//! is end-to-end testable. Chunk 3 replaces the body with real inference
//! via the `piper-rs` crate against the existing `ort` runtime.
//!
//! When a real impl lands, voice models will live at
//! `~/.personas/companion-tts/piper/<voice-id>/{model.onnx, model.onnx.json}`,
//! managed by `companion::tts::downloader` (Chunk 2).

use std::sync::Arc;

use tauri::State;

use crate::companion::tts::{TtsAudio, TtsSynthesisRequest};
use crate::error::AppError;
use crate::AppState;

pub async fn synthesize(
    _state: &State<'_, Arc<AppState>>,
    _request: &TtsSynthesisRequest<'_>,
) -> Result<TtsAudio, AppError> {
    Err(AppError::Internal(
        "piper engine not yet wired (Chunk 3 — ONNX inference path)".into(),
    ))
}
