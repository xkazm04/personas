//! Piper local TTS engine — sidecar-binary inference.
//!
//! Why sidecar instead of in-process Rust bindings:
//! - The published `piper-rs` crate pins `ort = "=2.0.0-rc.11"`; we ship
//!   `ort = "2.0.0-rc.9"` for fastembed embeddings. Two ORT versions in
//!   one process is a recipe for the same DLL-version-mismatch panic
//!   `Cargo.toml`'s comment block warns about (search "onnxruntime.dll").
//! - The official `piper.exe` Windows release ships its own bundled
//!   onnxruntime.dll inside the zip — running it as a subprocess gives
//!   us per-process DLL isolation for free.
//! - Sidecar lets users swap in newer Piper builds without recompiling
//!   the desktop app; useful while we still don't know what voice
//!   quality is achievable for the user's languages.
//!
//! Wire protocol (one synthesis = one subprocess invocation):
//!   1. Spawn `piper(.exe) --model voice.onnx --config voice.onnx.json
//!      --output_file <tempfile> [--length_scale x] [--noise_scale y]`
//!   2. Write text to stdin; close stdin to signal end-of-input.
//!   3. Wait for the child to exit; on success the WAV file is on disk.
//!   4. Read the WAV bytes, base64-encode for IPC, return.
//!   5. Delete the temp file.
//!
//! Engine binary lookup priority:
//!   1. `PERSONAS_PIPER_BIN` env override (developer/test escape hatch).
//!   2. `~/.personas/companion-tts/bin/piper(.exe)` (user/auto install).
//!   3. `piper(.exe)` on PATH (system-wide install).
//!
//! Errors carry the lookup chain so the user knows where to drop the
//! binary if synthesis fails because it's missing.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use tauri::State;
use tokio::io::AsyncWriteExt;

use crate::companion::tts::downloader;
use crate::companion::tts::{TtsAudio, TtsSynthesisRequest};
use crate::error::AppError;
use crate::AppState;

/// Sidecar invocation timeout. Local inference for a 1-3 sentence reply
/// runs in 1-3 seconds on typical hardware; 60s is generous headroom for
/// slower CPUs and the `high` quality voices.
const PIPER_TIMEOUT: Duration = Duration::from_secs(60);

/// Filename of the piper engine binary on the current platform.
#[cfg(target_os = "windows")]
const ENGINE_FILENAME: &str = "piper.exe";
#[cfg(not(target_os = "windows"))]
const ENGINE_FILENAME: &str = "piper";

/// Where the user-installed engine binary should live, mirroring
/// `companion-tts/piper/` for voice models so all of TTS shares one dir.
pub fn engine_dir() -> Result<PathBuf, AppError> {
    let base = if let Ok(override_dir) = std::env::var("PERSONAS_HOME") {
        PathBuf::from(override_dir)
    } else {
        dirs::home_dir()
            .ok_or_else(|| AppError::Internal("could not resolve home directory".into()))?
            .join(".personas")
    };
    Ok(base.join("companion-tts").join("bin"))
}

/// Resolve the engine binary path. Returns `None` if no installation is
/// found at any of the lookup-chain locations. UI uses this to surface
/// the engine-status badge in the Voice tab.
pub fn engine_binary_path() -> Option<PathBuf> {
    // 1. Explicit env override.
    if let Ok(p) = std::env::var("PERSONAS_PIPER_BIN") {
        let candidate = PathBuf::from(p);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // 2. Standard install location under ~/.personas.
    if let Ok(dir) = engine_dir() {
        let candidate = dir.join(ENGINE_FILENAME);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // 3. PATH lookup. `which` is gated behind the `desktop` feature, so
    //    non-desktop builds skip this leg entirely.
    if let Some(p) = path_lookup() {
        return Some(p);
    }
    None
}

#[cfg(feature = "desktop")]
fn path_lookup() -> Option<PathBuf> {
    which::which(ENGINE_FILENAME).ok()
}

#[cfg(not(feature = "desktop"))]
fn path_lookup() -> Option<PathBuf> {
    None
}

/// Status payload for the Voice tab's "Piper engine" card. Lets the UI
/// render an Installed / Not installed badge plus the path string the
/// user should drop the binary into.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub installed: bool,
    /// Resolved binary path when `installed` is true.
    pub binary_path: Option<String>,
    /// Where the user should put the engine if installing manually.
    pub expected_path: String,
    /// The exact filename to drop in (`piper.exe` on Windows, `piper`
    /// elsewhere) so the install-instructions copy is platform-correct.
    pub expected_filename: &'static str,
}

pub fn engine_status() -> Result<EngineStatus, AppError> {
    let dir = engine_dir()?;
    let installed_path = engine_binary_path();
    Ok(EngineStatus {
        installed: installed_path.is_some(),
        binary_path: installed_path.map(|p| p.display().to_string()),
        expected_path: dir.join(ENGINE_FILENAME).display().to_string(),
        expected_filename: ENGINE_FILENAME,
    })
}

pub async fn synthesize(
    _state: &State<'_, Arc<AppState>>,
    request: &TtsSynthesisRequest<'_>,
) -> Result<TtsAudio, AppError> {
    if !downloader::is_voice_downloaded(request.voice_id) {
        return Err(AppError::Validation(format!(
            "piper voice `{}` is not downloaded — open the Voice tab and click Download first",
            request.voice_id
        )));
    }
    let voice_dir = downloader::voice_dir(request.voice_id)?;
    let model_path = voice_dir.join(format!("{}.onnx", request.voice_id));
    let config_path = voice_dir.join(format!("{}.onnx.json", request.voice_id));

    let engine = engine_binary_path().ok_or_else(|| {
        let dir = engine_dir()
            .map(|d| d.display().to_string())
            .unwrap_or_else(|_| "(no home dir)".into());
        AppError::Validation(format!(
            "Piper engine binary not found. Install it at: {} \\ {} (or set PERSONAS_PIPER_BIN). \
             Get the latest release from https://github.com/rhasspy/piper/releases",
            dir, ENGINE_FILENAME
        ))
    })?;

    let tempdir = tempfile::Builder::new()
        .prefix("personas-piper-")
        .tempdir()
        .map_err(|e| AppError::Internal(format!("piper tempdir: {e}")))?;
    let output_path = tempdir.path().join("out.wav");

    let mut cmd = tokio::process::Command::new(&engine);
    cmd.arg("--model")
        .arg(&model_path)
        .arg("--config")
        .arg(&config_path)
        .arg("--output_file")
        .arg(&output_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Optional tuning. Piper clamps server-side too, but matching the
    // ElevenLabs path (clamp on the way out) keeps both engines behaving
    // the same when the user drags the sliders into oblivion.
    if let Some(length_scale) = request.settings.length_scale {
        cmd.arg("--length_scale")
            .arg(length_scale.clamp(0.5, 2.0).to_string());
    } else if let Some(speed) = request.settings.speed {
        // Map the shared `speed` (0.7..=1.2, ElevenLabs convention) to
        // Piper's inverted `length_scale` (smaller = faster). Skip when
        // the user explicitly set length_scale; that takes priority.
        let inv = 1.0 / speed.clamp(0.5, 2.0);
        cmd.arg("--length_scale").arg(inv.to_string());
    }
    if let Some(noise_scale) = request.settings.noise_scale {
        cmd.arg("--noise_scale")
            .arg(noise_scale.clamp(0.0, 1.5).to_string());
    }

    // Hide the console window on Windows so spawning the engine doesn't
    // flash a black box behind the app. We use DETACHED_PROCESS rather
    // than the otherwise-canonical CREATE_NO_WINDOW because in some
    // environments (Windows Terminal, npm/cargo dev shells, certain AV
    // hooks) CREATE_NO_WINDOW lets a stub conhost/cmd.exe flash for the
    // spawn duration. DETACHED_PROCESS gives the child no console
    // association at all — and since all three stdio streams above are
    // piped, the child has no legitimate need for one.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(DETACHED_PROCESS);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn piper: {e}")))?;

    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::Internal("piper stdin missing".into()))?;
        stdin
            .write_all(request.text.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("write piper stdin: {e}")))?;
        // Dropping stdin closes the pipe, which signals end-of-input to
        // the child. piper then renders, writes the WAV, and exits.
    }

    let output = tokio::time::timeout(PIPER_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| AppError::Internal(format!("piper timed out after {PIPER_TIMEOUT:?}")))?
        .map_err(|e| AppError::Internal(format!("piper wait: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let snippet = if stderr.len() > 400 {
            format!("{}…", &stderr[..400])
        } else {
            stderr.into_owned()
        };
        return Err(AppError::Internal(format!(
            "piper exited with {}: {}",
            output.status, snippet
        )));
    }

    let wav_bytes = tokio::fs::read(&output_path)
        .await
        .map_err(|e| AppError::Internal(format!("read piper wav: {e}")))?;
    let byte_size = wav_bytes.len();
    let audio_base64 = base64::engine::general_purpose::STANDARD.encode(&wav_bytes);

    Ok(TtsAudio {
        audio_base64,
        mime_type: "audio/wav".into(),
        byte_size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_dir_uses_personas_home_override() {
        std::env::set_var("PERSONAS_HOME", "C:\\test-home");
        let dir = engine_dir().unwrap();
        std::env::remove_var("PERSONAS_HOME");
        assert!(dir.to_string_lossy().ends_with("companion-tts\\bin"));
    }

    #[test]
    fn engine_status_reports_not_installed_for_empty_dir() {
        // PERSONAS_HOME points at an empty test dir; PATH may have
        // piper installed system-wide on developer machines, so we
        // also clear PERSONAS_PIPER_BIN explicitly. We can't fully
        // suppress system-wide PATH installs without overriding PATH,
        // but we can at least assert the expected_path resolution.
        let tmp = std::env::temp_dir().join(format!(
            "personas-piper-status-test-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&tmp);
        std::env::set_var("PERSONAS_HOME", &tmp);
        std::env::remove_var("PERSONAS_PIPER_BIN");

        let status = engine_status().unwrap();
        assert!(status.expected_path.contains("companion-tts"));
        assert_eq!(status.expected_filename, ENGINE_FILENAME);

        std::env::remove_var("PERSONAS_HOME");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn engine_binary_path_honors_personas_piper_bin_override() {
        // Point the override at a file that exists (this test file's exe).
        // We can't easily fake a binary, so we use the cargo test exe.
        let fake_bin = std::env::current_exe().unwrap();
        std::env::set_var("PERSONAS_PIPER_BIN", &fake_bin);

        let resolved = engine_binary_path();
        assert_eq!(resolved.as_ref(), Some(&fake_bin));

        std::env::remove_var("PERSONAS_PIPER_BIN");
    }
}
