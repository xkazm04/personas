//! One-click Pocket TTS install — download + extract the sherpa-onnx sidecar
//! and the Pocket ONNX model package into `~/.personas/companion-tts/`.
//!
//! Mirrors `kokoro_installer.rs` (same streaming download + selective
//! bzip2/tar extract off the async runtime, both sourced from
//! `sherpa_engine.rs`), with two differences:
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

use std::sync::LazyLock;

use tauri::AppHandle;

use crate::companion::tts::sherpa_engine::{
    self, InstallPhase, InstallProgress, ENGINE_ARCHIVE_URL,
};
use crate::companion::tts::{engine_dir, kokoro, pocket};
use crate::engine::inflight_guard::InflightGuard;
use crate::error::AppError;

/// Tauri event channel for install progress + terminal states.
pub const INSTALL_EVENT: &str = "companion://pocket-install";

/// Pocket int8 model package (stable `tts-models` tag) + its top-level prefix.
const MODEL_ARCHIVE_URL: &str = pocket::MODEL_DOWNLOAD_URL;
const MODEL_PREFIX: &str = "sherpa-onnx-pocket-tts-int8-2026-01-26";

const DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20 * 60);

static INSTALL_INFLIGHT: LazyLock<InflightGuard> = LazyLock::new(InflightGuard::new);

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
        Ok(()) => sherpa_engine::emit(
            app,
            INSTALL_EVENT,
            InstallProgress {
                phase: InstallPhase::Completed,
                bytes_downloaded: 0,
                bytes_total: None,
                error: None,
            },
        ),
        Err(e) => sherpa_engine::emit(
            app,
            INSTALL_EVENT,
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
    sherpa_engine::download_to_file(
        &client,
        ENGINE_ARCHIVE_URL,
        &engine_tar,
        app,
        INSTALL_EVENT,
        InstallPhase::DownloadingEngine,
    )
    .await?;

    let model_tar = tmp.path().join("model.tar.bz2");
    sherpa_engine::download_to_file(
        &client,
        MODEL_ARCHIVE_URL,
        &model_tar,
        app,
        INSTALL_EVENT,
        InstallPhase::DownloadingModel,
    )
    .await?;

    sherpa_engine::emit(
        app,
        INSTALL_EVENT,
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

/// Extract the model files (stripping the top-level prefix) into `model_dir`;
/// skip `test_wavs/` to trim footprint.
fn extract_model(archive: &std::path::Path, model_dir: &std::path::Path) -> Result<(), AppError> {
    sherpa_engine::extract_selected(
        archive,
        MODEL_PREFIX,
        model_dir,
        // Flat package: keep the 7 model files + license/readme, skip test_wavs/.
        |first| {
            first.ends_with(".onnx") || first.ends_with(".json") || matches!(first, "LICENSE" | "README.md")
        },
        "lm_main",
    )
}
