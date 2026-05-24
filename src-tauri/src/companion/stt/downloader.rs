//! Whisper ggml model download manager.
//!
//! Resolves curated model ids to Hugging Face URLs, streams the single
//! `ggml-<id>.bin` into `~/.personas/companion-stt/models/`, and emits
//! progress on `companion://stt-download` so the Voice tab can render a
//! per-model progress bar. Mirrors `companion::tts::downloader` (atomic
//! `.partial` rename, inflight guard, throttled events) but for one file.

use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::companion::stt::catalog::find_model_by_id;
use crate::engine::inflight_guard::InflightGuard;
use crate::error::AppError;

/// Tauri event channel for download progress + terminal states.
pub const DOWNLOAD_EVENT: &str = "companion://stt-download";

/// HF base for the official `ggerganov/whisper.cpp` model repo. Hard-coded
/// so the manager can't be redirected at another repo.
const HF_BASE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/// Whole-download timeout. The `small` models (~466 MB) can be several
/// minutes on a slow link.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(20 * 60);

const PROGRESS_EVENT_INTERVAL: Duration = Duration::from_millis(250);
const PROGRESS_EVENT_BYTE_INTERVAL: u64 = 1024 * 1024;

/// Process-wide guard preventing two concurrent downloads of the same model.
static DOWNLOAD_INFLIGHT: LazyLock<InflightGuard> = LazyLock::new(InflightGuard::new);

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadState {
    Queued,
    Downloading,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub model_id: String,
    pub state: DownloadState,
    pub bytes_downloaded: u64,
    pub bytes_total: Option<u64>,
    pub error: Option<String>,
}

/// Directory holding downloaded model files. Honors `PERSONAS_HOME` (same
/// override convention the rest of the companion disk layer uses).
pub fn models_dir() -> Result<PathBuf, AppError> {
    let base = if let Ok(override_dir) = std::env::var("PERSONAS_HOME") {
        PathBuf::from(override_dir)
    } else {
        dirs::home_dir()
            .ok_or_else(|| AppError::Internal("could not resolve home directory".into()))?
            .join(".personas")
    };
    Ok(base.join("companion-stt").join("models"))
}

/// Absolute path to a model's `.bin` file (whether or not it exists yet).
pub fn model_path(model_id: &str) -> Result<PathBuf, AppError> {
    Ok(models_dir()?.join(format!("ggml-{model_id}.bin")))
}

/// True when the model's `.bin` is present on disk.
pub fn is_model_downloaded(model_id: &str) -> bool {
    model_path(model_id).map(|p| p.is_file()).unwrap_or(false)
}

/// Remove a model file. Idempotent — missing file is OK. Rejects ids not in
/// the curated catalog (belt-and-suspenders against path traversal).
pub fn delete_model(model_id: &str) -> Result<(), AppError> {
    if find_model_by_id(model_id).is_none() {
        return Err(AppError::Validation(format!(
            "unknown whisper model id `{model_id}`"
        )));
    }
    let path = model_path(model_id)?;
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| AppError::Internal(format!("delete model {model_id}: {e}")))?;
    }
    Ok(())
}

/// Download the model's `.bin`, emitting progress along the way. Returns once
/// the file is renamed into place.
pub async fn download_model(model_id: &str, app: &AppHandle) -> Result<(), AppError> {
    if find_model_by_id(model_id).is_none() {
        return Err(AppError::Validation(format!(
            "unknown whisper model id `{model_id}` — not in curated catalog"
        )));
    }

    if is_model_downloaded(model_id) {
        emit(app, model_id, DownloadState::Completed, 0, None, None);
        return Ok(());
    }

    let _handle = DOWNLOAD_INFLIGHT.guard(model_id).ok_or_else(|| {
        AppError::Validation(format!("model `{model_id}` is already downloading"))
    })?;

    emit(app, model_id, DownloadState::Queued, 0, None, None);

    let dir = models_dir()?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Internal(format!("mkdir {}: {e}", dir.display())))?;

    let url = format!("{HF_BASE}/ggml-{model_id}.bin");
    let final_path = model_path(model_id)?;

    let client = reqwest::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("download client: {e}")))?;

    if let Err(e) = stream_to_file(&client, &url, &final_path, app, model_id).await {
        cleanup_partials(&dir);
        emit(app, model_id, DownloadState::Failed, 0, None, Some(e.to_string()));
        return Err(e);
    }

    emit(app, model_id, DownloadState::Completed, 0, None, None);
    Ok(())
}

async fn stream_to_file(
    client: &reqwest::Client,
    url: &str,
    final_path: &std::path::Path,
    app: &AppHandle,
    model_id: &str,
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

    let partial_path = final_path.with_extension("bin.partial");
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

        let elapsed = last_event.elapsed();
        let bytes_since_last = downloaded.saturating_sub(last_event_bytes);
        if elapsed >= PROGRESS_EVENT_INTERVAL || bytes_since_last >= PROGRESS_EVENT_BYTE_INTERVAL {
            emit(
                app,
                model_id,
                DownloadState::Downloading,
                downloaded,
                total,
                None,
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

#[allow(clippy::too_many_arguments)]
fn emit(
    app: &AppHandle,
    model_id: &str,
    state: DownloadState,
    bytes_downloaded: u64,
    bytes_total: Option<u64>,
    error: Option<String>,
) {
    let payload = DownloadProgress {
        model_id: model_id.to_string(),
        state,
        bytes_downloaded,
        bytes_total,
        error,
    };
    if let Err(e) = app.emit(DOWNLOAD_EVENT, payload) {
        tracing::warn!(error = %e, "stt download: progress event emit failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_path_uses_personas_home_override() {
        std::env::set_var("PERSONAS_HOME", "C:\\test-home");
        let p = model_path("base.en").unwrap();
        std::env::remove_var("PERSONAS_HOME");
        assert!(p
            .to_string_lossy()
            .ends_with("companion-stt\\models\\ggml-base.en.bin"));
    }

    #[test]
    fn delete_model_rejects_unknown_id() {
        assert!(delete_model("large-v3").is_err());
    }

    #[test]
    fn delete_model_idempotent_on_missing() {
        let tmp = std::env::temp_dir().join(format!("personas-stt-del-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);
        std::env::set_var("PERSONAS_HOME", &tmp);
        let r = delete_model("base.en");
        std::env::remove_var("PERSONAS_HOME");
        let _ = std::fs::remove_dir_all(&tmp);
        assert!(r.is_ok());
    }
}
