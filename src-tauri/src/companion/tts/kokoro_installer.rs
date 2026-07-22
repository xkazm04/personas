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
//!
//! Download/progress/extract plumbing shared with `pocket_installer.rs` lives
//! in `sherpa_engine.rs` — this file only owns the URL, model prefix, and
//! keep-predicate that genuinely differ between the two installers.

use std::sync::LazyLock;

use tauri::AppHandle;

use crate::companion::tts::sherpa_engine::{
    self, InstallPhase, InstallProgress, ENGINE_ARCHIVE_URL,
};
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

const DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20 * 60);

static INSTALL_INFLIGHT: LazyLock<InflightGuard> = LazyLock::new(InflightGuard::new);

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

/// Extract the English-needed model files (stripping the top-level prefix)
/// into `model_dir`; skip the Chinese-only assets to trim footprint.
fn extract_model(archive: &std::path::Path, model_dir: &std::path::Path) -> Result<(), AppError> {
    sherpa_engine::extract_selected(
        archive,
        MODEL_PREFIX,
        model_dir,
        |first| {
            matches!(
                first,
                "model.onnx" | "voices.bin" | "tokens.txt" | "lexicon-us-en.txt" | "LICENSE" | "README.md"
            ) || first == "espeak-ng-data"
        },
        "model.onnx",
    )
}
