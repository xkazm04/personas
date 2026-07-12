//! One-click Pocket TTS install — download + extract the sherpa-onnx sidecar
//! and the Pocket ONNX model package into `~/.personas/companion-tts/`.
//!
//! Mirrors `kokoro_installer.rs` (same streaming download + selective
//! bzip2/tar extract off the async runtime), with two differences:
//!   - the engine asset is **arch-aware**: win-arm64 hosts get the native
//!     aarch64 sidecar, win-x64 hosts the x64 one. Pinned to v1.13.4 — the
//!     first release line carrying Pocket TTS support; the older Kokoro pin
//!     (v1.13.3) predates it, so an existing Kokoro install's binary gets
//!     overwritten with the newer (backward-compatible) build.
//!   - the model package is flat (7 files under one prefix, no data dirs);
//!     we keep the ONNX/JSON files + LICENSE/README and skip `test_wavs/`.
//!
//! License note: the packaged ONNX export derives from the community
//! KevinAHM/pocket-tts-onnx export (non-commercial license). See the note
//! in `pocket.rs`.

use std::path::Path;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::companion::tts::sherpa_engine::{self, ENGINE_ARCHIVE_URL};
use crate::companion::tts::{engine_dir, kokoro, pocket};
use crate::engine::inflight_guard::InflightGuard;
use crate::error::AppError;

/// Tauri event channel for install progress + terminal states.
pub const INSTALL_EVENT: &str = "companion://pocket-install";

/// Pocket int8 model package (stable `tts-models` tag) + its top-level prefix.
const MODEL_ARCHIVE_URL: &str = pocket::MODEL_DOWNLOAD_URL;
const MODEL_PREFIX: &str = "sherpa-onnx-pocket-tts-int8-2026-01-26";

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
        tracing::warn!(error = %e, "pocket install: progress event emit failed");
    }
}

/// Download + extract the sidecar and model. Emits `INSTALL_EVENT` progress
/// throughout; returns once both are in place (and verified), else errors
/// (also emitted as a `Failed` event).
pub async fn install(app: &AppHandle) -> Result<(), AppError> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Validation(
            "Automatic Pocket TTS install is Windows-only for now — install the sidecar + model manually (see the setup card).".into(),
        ));
    }

    let _guard = INSTALL_INFLIGHT
        .guard("pocket-install")
        .ok_or_else(|| AppError::Validation("Pocket TTS install already in progress".into()))?;

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
    let model_dir = pocket::model_dir()?;
    let voices_dir = pocket::voices_dir()?;
    for d in [&bin_dir, &model_dir, &voices_dir] {
        tokio::fs::create_dir_all(d)
            .await
            .map_err(|e| AppError::Internal(format!("pocket install: mkdir {}: {e}", d.display())))?;
    }

    let client = reqwest::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("pocket install: client: {e}")))?;

    let tmp = tempfile::Builder::new()
        .prefix("personas-pocket-dl-")
        .tempdir()
        .map_err(|e| AppError::Internal(format!("pocket install: tempdir: {e}")))?;

    // Skip the engine download when a binary already resolves AND already
    // understands pocket models — but version detection via --help is
    // brittle across releases, so we keep it simple: re-download only when
    // no binary resolves at all. An existing (possibly older, Kokoro-era)
    // binary is upgraded in place since v1.13.4 is backward-compatible.
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
    .map_err(|e| AppError::Internal(format!("pocket install: extract task: {e}")))??;

    // Never report success on a half-extracted tree.
    if kokoro::engine_binary_path().is_none() {
        return Err(AppError::Internal(
            "install finished but the engine binary is still not resolvable".into(),
        ));
    }
    if !pocket::is_model_installed() {
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

/// Extract the model files (stripping the top-level prefix) into `model_dir`;
/// skip `test_wavs/` to trim footprint.
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
        // Flat package: keep the 7 model files + license/readme, skip test_wavs/.
        let keep = first.ends_with(".onnx")
            || first.ends_with(".json")
            || matches!(first.as_str(), "LICENSE" | "README.md");
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
            if first.starts_with("lm_main") {
                found_model = true;
            }
        }
    }
    if !found_model {
        return Err(AppError::Internal(
            "model archive did not contain lm_main.int8.onnx".into(),
        ));
    }
    Ok(())
}
