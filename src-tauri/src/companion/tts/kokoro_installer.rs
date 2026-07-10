//! One-click Kokoro install — download + extract the sherpa-onnx sidecar and
//! the Kokoro model package into `~/.personas/companion-tts/`.
//!
//! The sidecar binary and the model ship as `.tar.bz2` on the sherpa-onnx
//! GitHub releases. We stream each archive to a temp file, then (on a blocking
//! task, since bzip2+tar are synchronous) selectively extract only the files
//! we need:
//!   - engine: `sherpa-onnx-offline-tts.exe` + its sibling `*.dll` from the
//!     bundle's `bin/`, into the shared engine dir.
//!   - model: `model.onnx` + `voices.bin` + `tokens.txt` + `espeak-ng-data/`
//!     (+ `lexicon-us-en.txt`, LICENSE, README) into the model dir. The
//!     Chinese `dict/`, `lexicon-zh`, and `*-zh.fst` are skipped — we only
//!     surface English voices, and this trims the on-disk footprint.
//!
//! Windows-only for now: the prebuilt sidecar asset is `win-x64`. Other
//! platforms return a validation error pointing at the manual setup card.

use std::path::Path;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::companion::tts::sherpa_engine::{self, ENGINE_ARCHIVE_URL};
use crate::companion::tts::{engine_dir, kokoro};
use crate::engine::inflight_guard::InflightGuard;
use crate::error::AppError;

/// Tauri event channel for install progress + terminal states.
pub const INSTALL_EVENT: &str = "companion://kokoro-install";

/// Kokoro model package (stable `tts-models` tag). v1_0 specifically — the
/// catalog's sids are verified against it; v1_1 may reorder speakers.
const MODEL_ARCHIVE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2";
/// Top-level directory inside the model archive.
const MODEL_PREFIX: &str = "kokoro-multi-lang-v1_0";

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(20 * 60);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
const PROGRESS_BYTE_INTERVAL: u64 = 1024 * 1024;

static INSTALL_INFLIGHT: LazyLock<InflightGuard> = LazyLock::new(InflightGuard::new);

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallPhase {
    DownloadingEngine,
    DownloadingModel,
    Extracting,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub phase: InstallPhase,
    pub bytes_downloaded: u64,
    pub bytes_total: Option<u64>,
    pub error: Option<String>,
}

fn emit(app: &AppHandle, payload: InstallProgress) {
    if let Err(e) = app.emit(INSTALL_EVENT, payload) {
        tracing::warn!(error = %e, "kokoro install: progress event emit failed");
    }
}

/// Download + extract the sidecar and model. Emits `INSTALL_EVENT` progress
/// throughout; returns once both are in place (and verified resolvable), or
/// an error (also emitted as a `Failed` event) otherwise.
pub async fn install(app: &AppHandle) -> Result<(), AppError> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Validation(
            "Automatic Kokoro install is Windows-only for now — install the sidecar + model manually (see the setup card).".into(),
        ));
    }

    let _guard = INSTALL_INFLIGHT
        .guard("kokoro-install")
        .ok_or_else(|| AppError::Validation("Kokoro install already in progress".into()))?;

    let result = install_inner(app).await;
    match &result {
        Ok(()) => emit(
            app,
            InstallProgress {
                phase: InstallPhase::Completed,
                bytes_downloaded: 0,
                bytes_total: None,
                error: None,
            },
        ),
        Err(e) => emit(
            app,
            InstallProgress {
                phase: InstallPhase::Failed,
                bytes_downloaded: 0,
                bytes_total: None,
                error: Some(e.to_string()),
            },
        ),
    }
    result
}

async fn install_inner(app: &AppHandle) -> Result<(), AppError> {
    let bin_dir = engine_dir()?; // shared engine bin dir
    let model_dir = kokoro::model_dir()?;
    tokio::fs::create_dir_all(&bin_dir)
        .await
        .map_err(|e| AppError::Internal(format!("kokoro install: mkdir bin: {e}")))?;
    tokio::fs::create_dir_all(&model_dir)
        .await
        .map_err(|e| AppError::Internal(format!("kokoro install: mkdir model: {e}")))?;

    let client = reqwest::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("kokoro install: client: {e}")))?;

    let tmp = tempfile::Builder::new()
        .prefix("personas-kokoro-dl-")
        .tempdir()
        .map_err(|e| AppError::Internal(format!("kokoro install: tempdir: {e}")))?;

    let engine_tar = tmp.path().join("engine.tar.bz2");
    download_to_file(
        &client,
        ENGINE_ARCHIVE_URL,
        &engine_tar,
        app,
        InstallPhase::DownloadingEngine,
    )
    .await?;

    let model_tar = tmp.path().join("model.tar.bz2");
    download_to_file(
        &client,
        MODEL_ARCHIVE_URL,
        &model_tar,
        app,
        InstallPhase::DownloadingModel,
    )
    .await?;

    emit(
        app,
        InstallProgress {
            phase: InstallPhase::Extracting,
            bytes_downloaded: 0,
            bytes_total: None,
            error: None,
        },
    );

    // bzip2 + tar are synchronous and CPU/IO heavy — run off the async runtime.
    let bin_dir2 = bin_dir.clone();
    let model_dir2 = model_dir.clone();
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        sherpa_engine::extract_engine(&engine_tar, &bin_dir2)?;
        extract_model(&model_tar, &model_dir2)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(format!("kokoro install: extract task: {e}")))??;

    // Verify the install actually resolved (never report success on a
    // half-extracted tree).
    if kokoro::engine_binary_path().is_none() {
        return Err(AppError::Internal(
            "install finished but the engine binary is still not resolvable".into(),
        ));
    }
    if !kokoro::is_model_installed() {
        return Err(AppError::Internal(
            "install finished but the model files are still missing".into(),
        ));
    }
    Ok(())
}

/// Stream `url` to `dest`, emitting throttled download-progress events.
async fn download_to_file(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    app: &AppHandle,
    phase: InstallPhase,
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
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| AppError::Internal(format!("create {}: {e}", dest.display())))?;

    let mut downloaded: u64 = 0;
    let mut last_event = Instant::now();
    let mut last_bytes: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| AppError::Internal(format!("download chunk: {e}")))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| AppError::Internal(format!("write chunk: {e}")))?;
        downloaded += bytes.len() as u64;
        if last_event.elapsed() >= PROGRESS_INTERVAL
            || downloaded.saturating_sub(last_bytes) >= PROGRESS_BYTE_INTERVAL
        {
            emit(
                app,
                InstallProgress {
                    phase,
                    bytes_downloaded: downloaded,
                    bytes_total: total,
                    error: None,
                },
            );
            last_event = Instant::now();
            last_bytes = downloaded;
        }
    }
    file.flush()
        .await
        .map_err(|e| AppError::Internal(format!("flush {}: {e}", dest.display())))?;
    Ok(())
}

/// Extract the English-needed model files (stripping the top-level prefix)
/// into `model_dir`; skip the Chinese-only assets to trim footprint.
fn extract_model(archive: &Path, model_dir: &Path) -> Result<(), AppError> {
    let file = std::fs::File::open(archive)
        .map_err(|e| AppError::Internal(format!("open model archive: {e}")))?;
    let decoder = bzip2::read::BzDecoder::new(file);
    let mut ar = tar::Archive::new(decoder);
    let mut found_model = false;
    for entry in ar
        .entries()
        .map_err(|e| AppError::Internal(format!("read model archive: {e}")))?
    {
        let mut entry = entry.map_err(|e| AppError::Internal(format!("model entry: {e}")))?;
        let path = entry
            .path()
            .map_err(|e| AppError::Internal(format!("model entry path: {e}")))?
            .into_owned();
        let Ok(rel) = path.strip_prefix(MODEL_PREFIX) else {
            continue; // unexpected top-level layout — skip
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let first = rel
            .components()
            .next()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .unwrap_or_default();
        let keep = matches!(
            first.as_str(),
            "model.onnx" | "voices.bin" | "tokens.txt" | "lexicon-us-en.txt" | "LICENSE" | "README.md"
        ) || first == "espeak-ng-data";
        if !keep {
            continue;
        }
        let dest = model_dir.join(rel);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&dest)
                .map_err(|e| AppError::Internal(format!("mkdir {}: {e}", dest.display())))?;
        } else {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| AppError::Internal(format!("mkdir {}: {e}", parent.display())))?;
            }
            entry
                .unpack(&dest)
                .map_err(|e| AppError::Internal(format!("unpack {}: {e}", dest.display())))?;
            if first == "model.onnx" {
                found_model = true;
            }
        }
    }
    if !found_model {
        return Err(AppError::Internal(
            "model archive did not contain model.onnx".into(),
        ));
    }
    Ok(())
}
