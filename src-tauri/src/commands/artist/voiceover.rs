//! Voiceover synthesis for the Media Studio.
//!
//! The Media Studio composes video, images, titles, and audio — but the audio
//! always came from a file the user picked. This command closes the loop the
//! "explainer video" workflow needs: turn a line of narration text into a WAV
//! on disk that the timeline can drop onto its audio lane, using the local
//! Kokoro TTS sidecar the companion already ships.
//!
//! It writes a file rather than returning base64 because the Media Studio's
//! audio lane is file-backed (every `AudioClip.filePath` is a real path fed to
//! ffmpeg on export). The frontend probes the returned path with
//! `artist_probe_media` for duration — the same path the file-picker flow
//! takes — then adds the clip.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::companion::tts::{
    self, kokoro, validate_text, validate_voice_id, TtsEngineId, TtsSettings, TtsSynthesisRequest,
};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VoiceoverResult {
    /// Absolute path to the written WAV. The frontend probes this for duration
    /// and adds it to the timeline as an AudioClip.
    pub file_path: String,
    pub byte_size: usize,
}

/// Synthesize `text` into a WAV under `dir` (or the default Artist audio
/// folder) via the local Kokoro sidecar, and return the file path.
///
/// Kokoro is the only wired engine today (matching the companion's
/// 2026-07-10 descope of ElevenLabs/Piper); `engine` is accepted for forward
/// compatibility but anything other than Kokoro is rejected rather than
/// silently substituted.
#[tauri::command]
pub async fn artist_synthesize_voiceover(
    state: State<'_, Arc<AppState>>,
    text: String,
    voice_id: String,
    engine: Option<TtsEngineId>,
    dir: Option<String>,
) -> Result<VoiceoverResult, AppError> {
    require_auth(&state).await?;

    let trimmed = validate_text(&text)?;
    let voice_id = validate_voice_id(&voice_id)?;
    let engine = engine.unwrap_or_default();
    if engine != TtsEngineId::Kokoro {
        return Err(AppError::Validation(
            "Media Studio voiceover currently supports the local Kokoro engine only.".into(),
        ));
    }

    let settings = TtsSettings::default();
    let request = TtsSynthesisRequest {
        text: trimmed,
        voice_id,
        settings: &settings,
    };

    // Resolve + create the output directory before spending a synthesis slot.
    let out_dir = resolve_output_dir(dir)?;
    tokio::fs::create_dir_all(&out_dir)
        .await
        .map_err(|e| AppError::Internal(format!("voiceover: create dir failed: {e}")))?;

    // Same single-slot backpressure the companion uses: one Kokoro subprocess
    // reloads the ~310MB model, so unbounded concurrency would thrash.
    let audio = {
        let _permit = state
            .companion_tts_semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| AppError::Internal("voiceover: synthesis semaphore closed".into()))?;
        kokoro::synthesize(&state, &request).await?
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio.audio_base64.as_bytes())
        .map_err(|e| AppError::Internal(format!("voiceover: bad synth output: {e}")))?;

    let file_path = out_dir.join(unique_wav_name(voice_id));
    tokio::fs::write(&file_path, &bytes)
        .await
        .map_err(|e| AppError::Internal(format!("voiceover: write wav failed: {e}")))?;

    Ok(VoiceoverResult {
        file_path: file_path.to_string_lossy().into_owned(),
        byte_size: bytes.len(),
    })
}

/// List the Kokoro voices available for narration. A thin re-export of the
/// companion catalog so the Media Studio doesn't reach into companion command
/// modules directly.
#[tauri::command]
pub async fn artist_list_voiceover_voices(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<tts::kokoro_catalog::KokoroVoiceEntry>, AppError> {
    require_auth(&state).await?;
    Ok(tts::kokoro_catalog::KOKORO_VOICES.to_vec())
}

/// Whether the Kokoro sidecar + model are installed, so the UI can gate the
/// voiceover control behind a setup card instead of failing on first use.
#[tauri::command]
pub async fn artist_voiceover_status(
    state: State<'_, Arc<AppState>>,
) -> Result<kokoro::KokoroStatus, AppError> {
    require_auth(&state).await?;
    kokoro::status()
}

fn resolve_output_dir(dir: Option<String>) -> Result<PathBuf, AppError> {
    if let Some(d) = dir.filter(|d| !d.trim().is_empty()) {
        return Ok(PathBuf::from(d));
    }
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Internal("Cannot determine home directory".into()))?;
    Ok(home.join("Personas").join("Artist").join("voiceover"))
}

/// A collision-resistant WAV name. The millisecond clock plus the voice id is
/// enough to keep back-to-back synths from overwriting each other; the studio
/// never generates these fast enough to alias within a millisecond.
fn unique_wav_name(voice_id: &str) -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let slug: String = voice_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    format!("voiceover-{slug}-{stamp}.wav")
}
