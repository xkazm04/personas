//! Word-level transcription for Media Studio clips.
//!
//! Produces a `{clip}.transcript.json` sidecar next to the source file with
//! per-word start/end timestamps. Consumers: beat anchor-word resolver,
//! auto-trim proposal, plan-compose prompt builder.
//!
//! Providers:
//! - `LocalWhisperCli` — spawns the `whisper` binary (from `openai-whisper`)
//!   with `--output_format json --word_timestamps True`. Real, works today.
//! - `ElevenLabs` — TODO(transcribe-elevenlabs): requires HTTP client + the
//!   existing ElevenLabs credential entry. Scaffolded only; returns
//!   `NotImplemented`.
//! - `OpenAiWhisper` — TODO(transcribe-openai-whisper): requires HTTP +
//!   OpenAI credential. Scaffolded only; returns `NotImplemented`.
//!
//! The sidecar schema is a `camelCase` JSON document intentionally mirroring
//! `WordTimeline` in `src/features/plugins/artist/sub_media_studio/types.ts`.
//! Bumping the schema version is a breaking change — update both sides.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::process::Command as TokioCommand;

use crate::error::AppError;
use crate::ipc_auth::require_privileged;
use crate::AppState;

/// Sidecar schema version. Bump when the on-disk shape changes in a way
/// that older readers can't tolerate.
///
/// **Policy** (shared with all other artist artifacts — see
/// `super::schema_policy`): newer-than-current is rejected, equal is
/// accepted, older accepts with a permissive load + `tracing::warn!`
/// until a migration step lands. Any future consumer reading
/// `*.transcript.json` MUST call `super::schema_policy::classify` rather
/// than rolling its own version check, so all four artist surfaces stay
/// in lockstep.
const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TranscribeProvider {
    LocalWhisper,
    Elevenlabs,
    OpenaiWhisper,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResult {
    pub transcript_path: String,
    pub word_count: usize,
    pub duration_seconds: Option<f64>,
}

/// Static capability map for the transcribe surface. Returned by
/// `artist_transcribe_providers_available` so the UI can grey out (or hide)
/// providers that always return `not yet wired up`. Falsy entries here are
/// authoritative — the matching arms in [`artist_transcribe_media`] return
/// [`AppError::Internal`] and the user can't recover from that failure
/// without code changes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeProviderAvailability {
    pub local_whisper: bool,
    pub elevenlabs: bool,
    pub openai_whisper: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarDoc<'a> {
    schema_version: u32,
    language: Option<String>,
    full_text: String,
    provider: &'a str,
    words: Vec<SidecarWord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarWord {
    text: String,
    start: f64,
    end: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    probability: Option<f64>,
}

/// Reject path shapes that a renderer-context exploit might use to steer file
/// I/O at sensitive locations. NOT a containment check — transcribe operates on
/// user-picked media anywhere in the filesystem — but it does block the obvious
/// abuse paths: UNC pivots, Windows alternate-data-stream syntax, and `..`
/// traversal segments.
fn validate_local_file_path(path: &str) -> Result<(), AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("File path is empty.".into()));
    }

    if trimmed.starts_with(r"\\") || trimmed.starts_with("//") {
        return Err(AppError::Validation(
            "UNC / network file paths are not allowed.".into(),
        ));
    }

    let path_obj = Path::new(trimmed);

    // Drive-letter prefix `C:\…` is fine; a `:` inside the *filename* is the ADS
    // syntax (`file.txt:hidden-stream`) we want to reject.
    if let Some(name) = path_obj.file_name().and_then(|n| n.to_str()) {
        if name.contains(':') {
            return Err(AppError::Validation(
                "Filename contains alternate-data-stream syntax.".into(),
            ));
        }
    }

    for component in path_obj.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(AppError::Validation(
                "Path-traversal segments (`..`) are not allowed.".into(),
            ));
        }
    }

    Ok(())
}

/// Transcribe a media clip and write a `*.transcript.json` sidecar.
///
/// Security: privileged command (token-checked at the wrapper level via
/// `PRIVILEGED_COMMANDS` and audit-logged via `require_privileged`).
/// `validate_local_file_path` rejects UNC, ADS, and traversal shapes; the
/// sidecar lands next to the input file, so the fixed `.transcript.json`
/// suffix bounds the write target.
#[tauri::command]
pub async fn artist_transcribe_media(
    state: State<'_, Arc<AppState>>,
    file_path: String,
    provider: TranscribeProvider,
) -> Result<TranscribeResult, AppError> {
    require_privileged(&state, "artist_transcribe_media").await?;
    validate_local_file_path(&file_path)?;

    let source = PathBuf::from(&file_path);
    if !source.exists() {
        return Err(AppError::NotFound(format!("File not found: {file_path}")));
    }

    match provider {
        TranscribeProvider::LocalWhisper => local_whisper_transcribe(&source).await,
        TranscribeProvider::Elevenlabs => Err(AppError::Internal(
            // TODO(transcribe-elevenlabs): wire to credential_negotiator +
            // POST https://api.elevenlabs.io/v1/speech-to-text with diarization
            // disabled and timestamps_granularity=word. Credential entry
            // already exists in scripts/connectors/builtin/elevenlabs.json.
            "ElevenLabs transcription is not yet wired up. Use Local Whisper.".into(),
        )),
        TranscribeProvider::OpenaiWhisper => Err(AppError::Internal(
            // TODO(transcribe-openai-whisper): wire to POST
            // https://api.openai.com/v1/audio/transcriptions with
            // response_format=verbose_json, timestamp_granularities=["word"].
            "OpenAI Whisper transcription is not yet wired up. Use Local Whisper.".into(),
        )),
    }
}

/// Load a previously-written transcript sidecar and return its raw JSON
/// body. Scoped tightly: the path MUST end with `.transcript.json` AND pass
/// `validate_local_file_path` (no UNC, no ADS, no `..` traversal). Privileged
/// at the IPC wrapper level. Consumed by `useTranscriptCache`.
#[tauri::command]
pub async fn artist_load_transcript(
    state: State<'_, Arc<AppState>>,
    transcript_path: String,
) -> Result<String, AppError> {
    require_privileged(&state, "artist_load_transcript").await?;
    validate_local_file_path(&transcript_path)?;
    if !transcript_path.ends_with(".transcript.json") {
        return Err(AppError::Validation(
            "transcript_path must end with .transcript.json".into(),
        ));
    }
    let bytes = tokio::fs::read(&transcript_path)
        .await
        .map_err(|e| AppError::NotFound(format!("Read transcript {transcript_path}: {e}")))?;
    String::from_utf8(bytes).map_err(|e| AppError::Internal(format!("Transcript not UTF-8: {e}")))
}

/// Static capability map of which transcribe providers are actually wired up.
/// Lets the frontend grey out unimplemented variants instead of letting the
/// user pick one and discover the failure only after `invoke` returns.
/// Mirrors the match arms in [`artist_transcribe_media`].
#[tauri::command]
pub fn artist_transcribe_providers_available() -> TranscribeProviderAvailability {
    TranscribeProviderAvailability {
        local_whisper: true,
        elevenlabs: false,
        openai_whisper: false,
    }
}

/// Check whether the local `whisper` binary is discoverable on PATH.
/// Purely informational — consumed by the transcribe button to show an
/// install hint instead of failing silently.
#[tauri::command]
pub async fn artist_check_local_whisper() -> Result<bool, AppError> {
    let mut cmd = TokioCommand::new(whisper_binary_name());
    cmd.arg("--help");
    #[cfg(windows)]
    {
        // tokio::process::Command provides creation_flags inherently on Windows;
        // the std trait import is a no-op but kept for parity with stdlib examples.
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    match cmd.output().await {
        Ok(out) => Ok(out.status.success()),
        Err(_) => Ok(false),
    }
}

fn whisper_binary_name() -> &'static str {
    if cfg!(windows) {
        "whisper.exe"
    } else {
        "whisper"
    }
}

async fn local_whisper_transcribe(source: &Path) -> Result<TranscribeResult, AppError> {
    let parent = source
        .parent()
        .ok_or_else(|| AppError::Internal("Clip path has no parent directory".into()))?;
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::Internal("Clip path has no file stem".into()))?;

    // Whisper writes its JSON output as `{stem}.json` into the output
    // directory. We keep that location so a re-run overwrites cleanly.
    let whisper_json_path = parent.join(format!("{stem}.json"));

    let mut cmd = TokioCommand::new(whisper_binary_name());
    cmd.arg(source)
        .arg("--output_format")
        .arg("json")
        .arg("--word_timestamps")
        .arg("True")
        .arg("--output_dir")
        .arg(parent)
        // Default to the smallest multilingual model so a fresh install
        // doesn't download gigabytes on first run. Users can set
        // WHISPER_MODEL to override.
        .arg("--model")
        .arg(std::env::var("WHISPER_MODEL").unwrap_or_else(|_| "tiny".to_string()))
        .arg("--verbose")
        .arg("False");
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd.output().await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Internal(
                "Local Whisper CLI not found. Install with: pip install -U openai-whisper".into(),
            )
        } else {
            AppError::ProcessSpawn(format!("whisper: {e}"))
        }
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Execution(format!(
            "whisper failed: {}",
            stderr.trim()
        )));
    }

    // Parse whisper's JSON → our sidecar shape.
    let raw = tokio::fs::read(&whisper_json_path)
        .await
        .map_err(|e| AppError::Internal(format!("Read whisper output: {e}")))?;
    let parsed: WhisperJson = serde_json::from_slice(&raw).map_err(|e| {
        AppError::Internal(format!(
            "Parse whisper JSON at {:?}: {e}",
            whisper_json_path
        ))
    })?;

    let mut words = Vec::new();
    for seg in &parsed.segments {
        if let Some(segment_words) = &seg.words {
            for w in segment_words {
                words.push(SidecarWord {
                    text: w.word.clone(),
                    start: w.start,
                    end: w.end,
                    probability: w.probability,
                });
            }
        }
    }

    let full_text = parsed.text.unwrap_or_else(|| {
        parsed
            .segments
            .iter()
            .map(|s| s.text.clone().unwrap_or_default())
            .collect::<Vec<_>>()
            .join("")
    });
    let duration_seconds = parsed
        .segments
        .last()
        .map(|s| s.end)
        .filter(|v| v.is_finite());

    let sidecar = SidecarDoc {
        schema_version: SCHEMA_VERSION,
        language: parsed.language,
        full_text,
        provider: "local-whisper",
        words,
    };

    // Overwrite whisper's raw JSON with our canonical sidecar, renamed to
    // `{stem}.transcript.json`. Remove whisper's original so we don't leak
    // two files per clip.
    let sidecar_path = parent.join(format!("{stem}.transcript.json"));
    let serialized = serde_json::to_vec_pretty(&sidecar)
        .map_err(|e| AppError::Internal(format!("Serialize sidecar: {e}")))?;
    tokio::fs::write(&sidecar_path, &serialized)
        .await
        .map_err(|e| AppError::Internal(format!("Write sidecar: {e}")))?;
    let _ = tokio::fs::remove_file(&whisper_json_path).await;

    Ok(TranscribeResult {
        transcript_path: sidecar_path.to_string_lossy().to_string(),
        word_count: sidecar.words.len(),
        duration_seconds,
    })
}

// =============================================================================
// Whisper JSON shape (subset we consume)
// =============================================================================

#[derive(Debug, Deserialize)]
struct WhisperJson {
    language: Option<String>,
    text: Option<String>,
    segments: Vec<WhisperSegment>,
}

#[derive(Debug, Deserialize)]
struct WhisperSegment {
    end: f64,
    text: Option<String>,
    words: Option<Vec<WhisperWord>>,
}

#[derive(Debug, Deserialize)]
struct WhisperWord {
    word: String,
    start: f64,
    end: f64,
    probability: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_accepts_normal_paths() {
        assert!(validate_local_file_path("/home/user/clips/talk.mp4").is_ok());
        assert!(validate_local_file_path("C:/Users/me/Videos/talk.mp4").is_ok());
        assert!(validate_local_file_path(r"C:\Users\me\Videos\talk.mp4").is_ok());
        assert!(validate_local_file_path("./clips/talk.mp4").is_ok());
        assert!(validate_local_file_path("clips/talk.mp4").is_ok());
    }

    #[test]
    fn validate_rejects_unc_paths() {
        assert!(matches!(
            validate_local_file_path(r"\\server\share\secret.mp4"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            validate_local_file_path("//server/share/secret.mp4"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn validate_rejects_alternate_data_streams() {
        assert!(matches!(
            validate_local_file_path(r"C:\clips\talk.mp4:hidden"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            validate_local_file_path("/home/user/clips/talk.mp4:stream"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn validate_rejects_traversal_segments() {
        assert!(matches!(
            validate_local_file_path("/home/user/../etc/passwd"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            validate_local_file_path("clips/../../escape.mp4"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn validate_rejects_empty_paths() {
        assert!(matches!(
            validate_local_file_path(""),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            validate_local_file_path("   "),
            Err(AppError::Validation(_))
        ));
    }
}
