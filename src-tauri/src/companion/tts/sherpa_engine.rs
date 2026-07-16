//! Shared sherpa-onnx sidecar install source for Kokoro *and* Pocket TTS.
//!
//! Both engines run through the SAME `sherpa-onnx-offline-tts` binary in the
//! shared `~/.personas/companion-tts/bin/` dir, so the archive they install
//! from must be a single pinned, arch-correct source. Before this module the
//! two installers pinned it independently — Kokoro at `v1.13.3 win-x64`
//! (not arch-aware) and Pocket at `v1.13.4` (arch-aware). On a win-arm64 host
//! a Kokoro install would drop an x64 exe over the native arm64 one, and
//! because Pocket TTS support only landed in **v1.13.4**, the downgrade would
//! silently break voice cloning (`--pocket-*` flags unrecognized).
//!
//! Rule: bump `ENGINE_VERSION` here and both engines move together.
//!
//! This module also hosts the install-progress plumbing shared by
//! `kokoro_installer.rs` and `pocket_installer.rs` — `InstallPhase`,
//! `InstallProgress`, `emit()`, `download_to_file()`, and `extract_selected()`
//! (the generalized bzip2/tar selective-extract skeleton). Before this
//! consolidation those two files carried ~180 line-for-line-identical lines
//! copied from one another; only the event channel name, model archive URL /
//! prefix, and per-file keep predicate are genuinely per-installer.

use std::path::Path;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::error::AppError;

const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
const PROGRESS_BYTE_INTERVAL: u64 = 1024 * 1024;

/// Install-progress phase, shared by all TTS one-click installers.
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

/// Emit an `InstallProgress` event on `event_name`, warning (not failing) on
/// a dead frontend channel.
pub fn emit(app: &AppHandle, event_name: &str, payload: InstallProgress) {
    if let Err(e) = app.emit(event_name, payload) {
        tracing::warn!(error = %e, event = event_name, "tts install: progress event emit failed");
    }
}

/// Stream `url` to `dest`, emitting throttled `InstallProgress` events on
/// `event_name` tagged with `phase`.
pub async fn download_to_file(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    app: &AppHandle,
    event_name: &str,
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
                event_name,
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

/// Extract entries under `archive`'s `prefix/` top-level directory into
/// `dest_dir`, stripping the prefix. `keep(first_path_component)` decides
/// which top-level children to extract. `sentinel` is a substring checked
/// against each unpacked file's first path component — if nothing unpacked
/// matches it, the archive is treated as malformed and an error is returned
/// (guards against silently reporting success on a truncated/renamed asset).
pub fn extract_selected(
    archive: &Path,
    prefix: &str,
    dest_dir: &Path,
    keep: impl Fn(&str) -> bool,
    sentinel: &str,
) -> Result<(), AppError> {
    let file = std::fs::File::open(archive)
        .map_err(|e| AppError::Internal(format!("open archive: {e}")))?;
    let decoder = bzip2::read::BzDecoder::new(file);
    let mut ar = tar::Archive::new(decoder);
    let mut found_sentinel = false;
    for entry in ar
        .entries()
        .map_err(|e| AppError::Internal(format!("read archive: {e}")))?
    {
        let mut entry = entry.map_err(|e| AppError::Internal(format!("archive entry: {e}")))?;
        let path = entry
            .path()
            .map_err(|e| AppError::Internal(format!("archive entry path: {e}")))?
            .into_owned();
        let Ok(rel) = path.strip_prefix(prefix) else {
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
        if !keep(&first) {
            continue;
        }
        let dest = dest_dir.join(rel);
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
            if first.contains(sentinel) {
                found_sentinel = true;
            }
        }
    }
    if !found_sentinel {
        return Err(AppError::Internal(format!(
            "archive did not contain expected file matching `{sentinel}`"
        )));
    }
    Ok(())
}

/// Pinned sherpa-onnx release. **Minimum v1.13.4** — the first release line
/// carrying Pocket TTS support. Never pin below this.
pub const ENGINE_VERSION: &str = "v1.13.4";

/// Arch-correct sidecar bundle (shared-MT-Release ships the exe + its
/// `onnxruntime.dll`). `target_arch` follows the compiled app, not the
/// (possibly emulated) shell's `PROCESSOR_ARCHITECTURE`.
#[cfg(target_arch = "aarch64")]
pub const ENGINE_ARCHIVE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.4/sherpa-onnx-v1.13.4-win-arm64-shared-MT-Release.tar.bz2";
#[cfg(not(target_arch = "aarch64"))]
pub const ENGINE_ARCHIVE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.4/sherpa-onnx-v1.13.4-win-x64-shared-MT-Release.tar.bz2";

/// Releases index, surfaced in the manual-setup cards.
pub const ENGINE_RELEASES_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases";

/// Extract `sherpa-onnx-offline-tts.exe` + its sibling `*.dll` from the
/// bundle's `bin/` into `bin_dir`. Shared by both installers so the two
/// can never disagree about what a valid engine tree looks like.
pub fn extract_engine(archive: &Path, bin_dir: &Path) -> Result<(), AppError> {
    let file = std::fs::File::open(archive)
        .map_err(|e| AppError::Internal(format!("open engine archive: {e}")))?;
    let decoder = bzip2::read::BzDecoder::new(file);
    let mut ar = tar::Archive::new(decoder);
    let mut found_exe = false;
    for entry in ar
        .entries()
        .map_err(|e| AppError::Internal(format!("read engine archive: {e}")))?
    {
        let mut entry = entry.map_err(|e| AppError::Internal(format!("engine entry: {e}")))?;
        let path = entry
            .path()
            .map_err(|e| AppError::Internal(format!("engine entry path: {e}")))?
            .into_owned();
        let under_bin = path
            .components()
            .any(|c| c.as_os_str().eq_ignore_ascii_case("bin"));
        let Some(fname) = path.file_name().map(|s| s.to_string_lossy().into_owned()) else {
            continue;
        };
        let want = under_bin
            && (fname.eq_ignore_ascii_case("sherpa-onnx-offline-tts.exe")
                || fname.to_ascii_lowercase().ends_with(".dll"));
        if want {
            let dest = bin_dir.join(&fname);
            entry
                .unpack(&dest)
                .map_err(|e| AppError::Internal(format!("unpack {fname}: {e}")))?;
            if fname.eq_ignore_ascii_case("sherpa-onnx-offline-tts.exe") {
                found_exe = true;
            }
        }
    }
    if !found_exe {
        return Err(AppError::Internal(
            "engine archive did not contain sherpa-onnx-offline-tts.exe".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_archive_url_matches_pinned_version_and_host_arch() {
        assert!(
            ENGINE_ARCHIVE_URL.contains(ENGINE_VERSION),
            "the archive URL must track ENGINE_VERSION: {ENGINE_ARCHIVE_URL}"
        );
        // Pocket TTS support landed in 1.13.4 — a lower pin silently breaks
        // voice cloning through the shared binary.
        assert_eq!(ENGINE_VERSION, "v1.13.4");

        let expect_arch = if cfg!(target_arch = "aarch64") { "win-arm64" } else { "win-x64" };
        assert!(
            ENGINE_ARCHIVE_URL.contains(expect_arch),
            "archive URL must match the compiled target arch ({expect_arch}): {ENGINE_ARCHIVE_URL}"
        );
    }
}
