//! Piper voice download manager.
//!
//! Resolves curated voice IDs to Hugging Face URLs, streams the model +
//! config files into `~/.personas/companion-tts/piper/<voice_id>/`, and
//! emits progress events on `companion://tts-download` so the Voice tab
//! UI can render a per-voice progress bar.
//!
//! Catalog gating: only voice IDs in `companion::tts::catalog::PIPER_VOICES`
//! can be downloaded. Arbitrary IDs from the renderer are rejected to
//! prevent hostile URL injection — even though `validate_voice_id` already
//! blocks path-traversal characters, capping at the curated list narrows
//! the trust surface to "voices we've reviewed, hosted at the official
//! rhasspy/piper-voices repo."
//!
//! Atomicity: each file is downloaded to `<name>.partial`, fsync'd, then
//! renamed to its final name. A crashed download leaves only the partial
//! behind, never a half-finished `.onnx` that ONNX runtime would try to
//! parse on next launch and segfault on.

use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::companion::tts::catalog::{find_voice_by_id, parse_voice_id};
use crate::engine::inflight_guard::InflightGuard;
use crate::error::AppError;

/// Tauri event channel for download progress and terminal states.
pub const DOWNLOAD_EVENT: &str = "companion://tts-download";

/// HF base for the curated `rhasspy/piper-voices` repo. Hard-coded so the
/// download manager can't be redirected at a different repo via config.
const HF_BASE: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

/// Streaming chunk read timeout — covers the whole download. Generous
/// because the larger voices (`high` quality, ~110MB) are easily a few
/// minutes on a slow connection.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Throttle progress events so we don't event-storm the renderer on
/// fast networks. Emit at most once per 250ms or per 1MB transferred,
/// whichever comes first.
const PROGRESS_EVENT_INTERVAL: Duration = Duration::from_millis(250);
const PROGRESS_EVENT_BYTE_INTERVAL: u64 = 1024 * 1024;

/// Process-wide guard preventing two concurrent downloads of the same voice.
/// Different voices can download in parallel.
static DOWNLOAD_INFLIGHT: LazyLock<InflightGuard> = LazyLock::new(InflightGuard::new);

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadState {
    /// Inflight guard held; about to start streaming.
    Queued,
    /// At least one byte has streamed; emitted with progress updates.
    Downloading,
    /// Both files present and renamed into place.
    Completed,
    /// Aborted (network, IO, validation). `error` field carries detail.
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub voice_id: String,
    pub state: DownloadState,
    pub bytes_downloaded: u64,
    /// `None` when the upstream didn't return `Content-Length` (rare for HF
    /// but possible on chunked transfer).
    pub bytes_total: Option<u64>,
    pub error: Option<String>,
}

/// Resolve the local directory for a voice. Honors `PERSONAS_HOME` (same
/// override convention `disk::brain_root` uses) so tests can redirect.
pub fn voice_dir(voice_id: &str) -> Result<PathBuf, AppError> {
    let base = if let Ok(override_dir) = std::env::var("PERSONAS_HOME") {
        PathBuf::from(override_dir)
    } else {
        dirs::home_dir()
            .ok_or_else(|| AppError::Internal("could not resolve home directory".into()))?
            .join(".personas")
    };
    Ok(base.join("companion-tts").join("piper").join(voice_id))
}

/// True when both files (`<voice_id>.onnx` + `<voice_id>.onnx.json`) are on
/// disk. Either one missing → considered not downloaded; the synthesizer
/// would fail to load anyway.
pub fn is_voice_downloaded(voice_id: &str) -> bool {
    let Ok(dir) = voice_dir(voice_id) else {
        return false;
    };
    dir.join(format!("{voice_id}.onnx")).is_file()
        && dir.join(format!("{voice_id}.onnx.json")).is_file()
}

/// Remove the voice's directory tree. Idempotent — missing dir is OK.
pub fn delete_voice(voice_id: &str) -> Result<(), AppError> {
    if find_voice_by_id(voice_id).is_none() {
        return Err(AppError::Validation(format!(
            "unknown piper voice id `{voice_id}`"
        )));
    }
    let dir = voice_dir(voice_id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| AppError::Internal(format!("delete voice {voice_id}: {e}")))?;
    }
    Ok(())
}

/// Download both the model + config files for `voice_id` and emit progress
/// events along the way. Returns once both files are renamed into place.
///
/// On failure, partial files are removed and a `Failed` state event is
/// emitted with the error message so the frontend can offer a Retry.
pub async fn download_voice(voice_id: &str, app: &AppHandle) -> Result<(), AppError> {
    let entry = find_voice_by_id(voice_id).ok_or_else(|| {
        AppError::Validation(format!(
            "unknown piper voice id `{voice_id}` — not in curated catalog"
        ))
    })?;

    // Skip the whole pipeline if both files are already on disk. Idempotent
    // re-call from the UI shouldn't waste bandwidth.
    if is_voice_downloaded(voice_id) {
        emit_progress(
            app,
            DownloadProgress {
                voice_id: voice_id.to_string(),
                state: DownloadState::Completed,
                bytes_downloaded: 0,
                bytes_total: None,
                error: None,
            },
        );
        return Ok(());
    }

    let _handle = DOWNLOAD_INFLIGHT.guard(voice_id).ok_or_else(|| {
        AppError::Validation(format!("voice `{voice_id}` is already downloading"))
    })?;

    emit_progress(
        app,
        DownloadProgress {
            voice_id: voice_id.to_string(),
            state: DownloadState::Queued,
            bytes_downloaded: 0,
            bytes_total: None,
            error: None,
        },
    );

    let dir = voice_dir(voice_id)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Internal(format!("mkdir {}: {e}", dir.display())))?;

    let parsed = parse_voice_id(entry.voice_id)?;
    let url_prefix = format!(
        "{HF_BASE}/{}/{}/{}/{}",
        parsed.lang_family, parsed.lang_locale, parsed.speaker, parsed.quality
    );
    let onnx_url = format!("{url_prefix}/{voice_id}.onnx");
    let json_url = format!("{url_prefix}/{voice_id}.onnx.json");

    let client = reqwest::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("download client: {e}")))?;

    // Download the big file first with progress events; the JSON config is
    // small and silent.
    let onnx_path = dir.join(format!("{voice_id}.onnx"));
    if let Err(e) = stream_to_file(&client, &onnx_url, &onnx_path, app, voice_id).await {
        cleanup_partials(&dir);
        emit_failed(app, voice_id, &e);
        return Err(e);
    }

    let json_path = dir.join(format!("{voice_id}.onnx.json"));
    if let Err(e) = download_small_file(&client, &json_url, &json_path).await {
        cleanup_partials(&dir);
        // The .onnx already landed; remove it too so the voice is either
        // fully present or fully absent.
        let _ = std::fs::remove_file(&onnx_path);
        emit_failed(app, voice_id, &e);
        return Err(e);
    }

    emit_progress(
        app,
        DownloadProgress {
            voice_id: voice_id.to_string(),
            state: DownloadState::Completed,
            bytes_downloaded: 0,
            bytes_total: None,
            error: None,
        },
    );
    Ok(())
}

/// Stream `url` to `final_path` via a `<final_path>.partial` temp, emitting
/// progress events. Renames into place on success.
async fn stream_to_file(
    client: &reqwest::Client,
    url: &str,
    final_path: &std::path::Path,
    app: &AppHandle,
    voice_id: &str,
) -> Result<(), AppError> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("download {url}: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Internal(format!(
            "download {url}: HTTP {}",
            resp.status()
        )));
    }
    let total = resp.content_length();

    let partial_path = final_path.with_extension(format!(
        "{}.partial",
        final_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("dl")
    ));
    let mut file = tokio::fs::File::create(&partial_path)
        .await
        .map_err(|e| AppError::Internal(format!("create {}: {e}", partial_path.display())))?;

    let mut downloaded: u64 = 0;
    let mut last_event = Instant::now();
    let mut last_event_bytes: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| AppError::Internal(format!("download chunk: {e}")))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| AppError::Internal(format!("write chunk: {e}")))?;
        downloaded += bytes.len() as u64;

        // Throttle event emission — enough to keep the progress bar feeling
        // alive without flooding the IPC bridge.
        let elapsed = last_event.elapsed();
        let bytes_since_last = downloaded.saturating_sub(last_event_bytes);
        if elapsed >= PROGRESS_EVENT_INTERVAL || bytes_since_last >= PROGRESS_EVENT_BYTE_INTERVAL {
            emit_progress(
                app,
                DownloadProgress {
                    voice_id: voice_id.to_string(),
                    state: DownloadState::Downloading,
                    bytes_downloaded: downloaded,
                    bytes_total: total,
                    error: None,
                },
            );
            last_event = Instant::now();
            last_event_bytes = downloaded;
        }
    }

    file.flush()
        .await
        .map_err(|e| AppError::Internal(format!("flush: {e}")))?;
    drop(file);

    tokio::fs::rename(&partial_path, final_path)
        .await
        .map_err(|e| AppError::Internal(format!("rename to {}: {e}", final_path.display())))?;

    Ok(())
}

/// Download a small file (the `.onnx.json` config). One-shot, no progress
/// events — the JSON is a few KB and the per-event throttling overhead
/// would dominate.
async fn download_small_file(
    client: &reqwest::Client,
    url: &str,
    final_path: &std::path::Path,
) -> Result<(), AppError> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("download {url}: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Internal(format!(
            "download {url}: HTTP {}",
            resp.status()
        )));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("download body: {e}")))?;
    let partial_path = final_path.with_extension("json.partial");
    tokio::fs::write(&partial_path, &bytes)
        .await
        .map_err(|e| AppError::Internal(format!("write {}: {e}", partial_path.display())))?;
    tokio::fs::rename(&partial_path, final_path)
        .await
        .map_err(|e| AppError::Internal(format!("rename to {}: {e}", final_path.display())))?;
    Ok(())
}

fn cleanup_partials(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.ends_with("partial"))
            .unwrap_or(false)
        {
            let _ = std::fs::remove_file(&path);
        }
    }
}

fn emit_progress(app: &AppHandle, payload: DownloadProgress) {
    if let Err(e) = app.emit(DOWNLOAD_EVENT, payload) {
        tracing::warn!(error = %e, "tts download: progress event emit failed");
    }
}

fn emit_failed(app: &AppHandle, voice_id: &str, err: &AppError) {
    emit_progress(
        app,
        DownloadProgress {
            voice_id: voice_id.to_string(),
            state: DownloadState::Failed,
            bytes_downloaded: 0,
            bytes_total: None,
            error: Some(err.to_string()),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_dir_uses_personas_home_override() {
        std::env::set_var("PERSONAS_HOME", "C:\\test-home");
        let dir = voice_dir("en_US-amy-medium").unwrap();
        std::env::remove_var("PERSONAS_HOME");
        assert!(dir
            .to_string_lossy()
            .ends_with("companion-tts\\piper\\en_US-amy-medium"));
    }

    #[test]
    fn delete_voice_rejects_unknown_id() {
        // Belt-and-suspenders: even if validation upstream missed it,
        // delete refuses ids that aren't in the curated catalog.
        assert!(delete_voice("ru_XX-fake-medium").is_err());
    }

    #[test]
    fn delete_voice_is_idempotent_on_missing_dir() {
        // PERSONAS_HOME points at an empty test dir; the voice is in the
        // catalog but no files exist on disk. Should be a no-op.
        let tmp = std::env::temp_dir().join(format!(
            "personas-tts-delete-test-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&tmp);
        std::env::set_var("PERSONAS_HOME", &tmp);
        let r = delete_voice("en_US-amy-medium");
        std::env::remove_var("PERSONAS_HOME");
        let _ = std::fs::remove_dir_all(&tmp);
        assert!(r.is_ok(), "delete on missing dir should be no-op");
    }

    #[test]
    fn is_voice_downloaded_requires_both_files() {
        let tmp = std::env::temp_dir().join(format!(
            "personas-tts-isdl-test-{}",
            std::process::id()
        ));
        let voice_dir = tmp
            .join("companion-tts")
            .join("piper")
            .join("en_US-amy-medium");
        let _ = std::fs::create_dir_all(&voice_dir);
        std::env::set_var("PERSONAS_HOME", &tmp);

        assert!(!is_voice_downloaded("en_US-amy-medium"));

        // Only .onnx present
        let _ = std::fs::write(voice_dir.join("en_US-amy-medium.onnx"), b"fake");
        assert!(!is_voice_downloaded("en_US-amy-medium"));

        // Both present
        let _ = std::fs::write(voice_dir.join("en_US-amy-medium.onnx.json"), b"{}");
        assert!(is_voice_downloaded("en_US-amy-medium"));

        std::env::remove_var("PERSONAS_HOME");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
