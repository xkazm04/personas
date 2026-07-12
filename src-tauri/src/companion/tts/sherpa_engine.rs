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

use std::path::Path;

use crate::error::AppError;

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
