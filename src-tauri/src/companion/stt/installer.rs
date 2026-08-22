//! One-click install of the whisper.cpp sidecar.
//!
//! Models already download themselves (`stt/downloader.rs`); the *binary*
//! was the last manual step in the whole voice stack — the Voice tab told
//! the user to go find a GitHub release, unzip it, drop the exe in a
//! specific directory, and come back and refresh. This closes that gap
//! the same way the TTS sidecars already did it: pinned release asset,
//! streamed download with progress, extract, verify, done.
//!
//! Mirrors `tts/kokoro_installer.rs` deliberately — same `InflightGuard`
//! lock, same `InstallProgress` event shape (so the frontend reuses
//! `VoiceEngineInstallBlock` unchanged), same "verify it actually
//! resolves before reporting success" ending. The one real difference is
//! the container: whisper.cpp ships **zip**, the sherpa engines ship
//! tar.bz2, so extraction is local rather than shared.
//!
//! Windows-only for now, exactly like the Kokoro installer: the pinned
//! asset below is a win-x64 build. macOS/Linux users still get the manual
//! instructions, which is why the setup card keeps them.

use std::sync::LazyLock;

use tauri::AppHandle;

use crate::companion::stt::whisper;
use crate::companion::tts::sherpa_engine::{self, InstallPhase, InstallProgress};
use crate::engine::inflight_guard::InflightGuard;
use crate::error::AppError;

/// Tauri event channel for install progress + terminal states.
pub const INSTALL_EVENT: &str = "companion://stt-install";

/// Pinned whisper.cpp Windows x64 build.
///
/// **Plain CPU, not BLAS/cuBLAS, on purpose**: the accelerated variants
/// are faster but expect extra runtime DLLs to be present, and an engine
/// that fails to *start* is worse than one that transcribes slowly. A
/// user who wants the fast build can still drop it in by hand — the
/// resolver prefers whatever is in the bin dir either way.
///
/// Pinned to a specific tag rather than `latest` so an upstream release
/// cannot silently change what this button installs. Bumping it is a
/// one-line change here.
///
/// **Verify a new URL with an actual request before pinning it.** The
/// first version of this constant was wrong twice over: the `ggerganov/`
/// org (the repo now lives under `ggml-org/`) and tag `v1.7.4`, which
/// predates these Windows assets. Both looked plausible and both 404'd
/// on the very first click. The asset NAME was the only correct part.
const ENGINE_ARCHIVE_URL: &str =
    "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip";

const DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20 * 60);

/// File extensions worth extracting out of the release zip. The archive
/// carries the CLI plus its runtime DLLs (and some sample/test junk);
/// taking exes + dlls keeps the bin dir runnable without the noise.
const WANTED_EXTENSIONS: &[&str] = &["exe", "dll"];

static INSTALL_INFLIGHT: LazyLock<InflightGuard> = LazyLock::new(InflightGuard::new);

/// Download + extract the whisper sidecar into the STT bin dir. Emits
/// [`INSTALL_EVENT`] progress throughout; returns once the binary is in
/// place *and* resolvable, or an error (also emitted as `Failed`).
pub async fn install(app: &AppHandle) -> Result<(), AppError> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Validation(
            "Automatic Whisper install is Windows-only for now — build or download whisper.cpp \
             and drop the binary in the folder shown on the setup card."
                .into(),
        ));
    }

    let _guard = INSTALL_INFLIGHT
        .guard("stt-install")
        .ok_or_else(|| AppError::Validation("Whisper install already in progress".into()))?;

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
    let bin_dir = whisper::engine_dir()?;
    tokio::fs::create_dir_all(&bin_dir)
        .await
        .map_err(|e| AppError::Internal(format!("whisper install: mkdir bin: {e}")))?;

    let client = reqwest::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("whisper install: client: {e}")))?;

    let tmp = tempfile::Builder::new()
        .prefix("personas-whisper-dl-")
        .tempdir()
        .map_err(|e| AppError::Internal(format!("whisper install: tempdir: {e}")))?;

    let archive = tmp.path().join("whisper-bin-x64.zip");
    sherpa_engine::download_to_file(
        &client,
        ENGINE_ARCHIVE_URL,
        &archive,
        app,
        INSTALL_EVENT,
        InstallPhase::DownloadingEngine,
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

    // Zip inflate is synchronous and IO heavy — off the async runtime.
    let bin_dir2 = bin_dir.clone();
    tokio::task::spawn_blocking(move || extract_engine(&archive, &bin_dir2))
        .await
        .map_err(|e| AppError::Internal(format!("whisper install: extract task: {e}")))??;

    // Never report success on a half-extracted tree: the resolver is the
    // same one the transcribe path uses, so if it cannot find the binary
    // now, nothing downstream would have worked either.
    if whisper::engine_binary_path().is_none() {
        return Err(AppError::Internal(
            "install finished but the whisper binary is still not resolvable".into(),
        ));
    }
    Ok(())
}

/// Flatten the release zip's exes + DLLs into `bin_dir`.
///
/// Flattened on purpose: upstream has shipped these at the archive root
/// and under a `Release/` prefix across versions, and the resolver only
/// looks directly in the bin dir. Entry paths are taken from
/// [`zip::read::ZipFile::enclosed_name`], which rejects absolute paths and
/// `..` traversal, so a hostile archive cannot write outside `bin_dir`.
fn extract_engine(archive: &std::path::Path, bin_dir: &std::path::Path) -> Result<(), AppError> {
    let file = std::fs::File::open(archive)
        .map_err(|e| AppError::Internal(format!("whisper install: open archive: {e}")))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Internal(format!("whisper install: read archive: {e}")))?;

    let mut extracted = 0usize;
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| AppError::Internal(format!("whisper install: zip entry {i}: {e}")))?;
        if entry.is_dir() {
            continue;
        }
        // `enclosed_name` is the traversal-safe accessor; a `None` here
        // means the entry name was hostile, so skip it rather than guess.
        let Some(path) = entry.enclosed_name() else {
            continue;
        };
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let wanted = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| WANTED_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false);
        if !wanted {
            continue;
        }
        let dest = bin_dir.join(name);
        let mut out = std::fs::File::create(&dest).map_err(|e| {
            AppError::Internal(format!("whisper install: create {}: {e}", dest.display()))
        })?;
        std::io::copy(&mut entry, &mut out).map_err(|e| {
            AppError::Internal(format!("whisper install: write {}: {e}", dest.display()))
        })?;
        extracted += 1;
    }

    if extracted == 0 {
        return Err(AppError::Internal(
            "whisper install: archive contained no executable — the pinned release asset may have \
             changed shape"
                .into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Build an in-memory zip with the given entries.
    fn zip_with(entries: &[(&str, &[u8])]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.zip");
        let file = std::fs::File::create(&path).unwrap();
        let mut w = zip::ZipWriter::new(file);
        let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, body) in entries {
            w.start_file(*name, opts).unwrap();
            w.write_all(body).unwrap();
        }
        w.finish().unwrap();
        dir
    }

    #[test]
    fn extracts_binaries_flat_and_skips_the_rest() {
        // Upstream has shipped both layouts; both must land flat.
        let src = zip_with(&[
            ("Release/whisper-cli.exe", b"exe"),
            ("Release/ggml.dll", b"dll"),
            ("models/for-tests-ggml-base.bin", b"junk"),
            ("README.md", b"junk"),
        ]);
        let out = tempfile::tempdir().unwrap();
        extract_engine(&src.path().join("a.zip"), out.path()).unwrap();

        assert!(out.path().join("whisper-cli.exe").exists());
        assert!(out.path().join("ggml.dll").exists());
        assert!(!out.path().join("README.md").exists());
        assert!(!out.path().join("for-tests-ggml-base.bin").exists());
    }

    #[test]
    fn an_archive_without_executables_fails_loudly() {
        // The shape-drift signal: a release that stops carrying an exe
        // must not read as a successful install.
        let src = zip_with(&[("README.md", b"only docs")]);
        let out = tempfile::tempdir().unwrap();
        let err = extract_engine(&src.path().join("a.zip"), out.path()).unwrap_err();
        assert!(err.to_string().contains("no executable"), "got: {err}");
    }

    #[test]
    fn traversal_entries_cannot_escape_the_bin_dir() {
        let src = zip_with(&[("../../evil.exe", b"nope"), ("whisper-cli.exe", b"exe")]);
        let out = tempfile::tempdir().unwrap();
        extract_engine(&src.path().join("a.zip"), out.path()).unwrap();
        // The good entry landed; the traversal one was flattened to its
        // file name at worst, and never above the bin dir.
        assert!(out.path().join("whisper-cli.exe").exists());
        assert!(!out.path().parent().unwrap().join("evil.exe").exists());
    }
}
