//! Local whisper.cpp STT engine — sidecar-binary inference.
//!
//! Why sidecar (same shape as Piper TTS): users drop a prebuilt
//! `whisper-cli` binary in place and can swap newer builds without
//! recompiling the app, and whisper.cpp's ggml/BLAS stack stays in its own
//! process. No credential, no network at transcription time — the captured
//! audio never leaves the machine.
//!
//! Wire protocol (one transcription = one subprocess invocation):
//!   1. Write the caller's 16 kHz mono PCM WAV bytes to a temp file.
//!   2. Spawn `whisper-cli -m <model.bin> -f <wav> -nt -np [-l <lang>]`.
//!   3. Wait for exit; the transcript is printed to stdout.
//!   4. Join the stdout lines into one trimmed string.
//!
//! Binary lookup priority:
//!   1. `PERSONAS_WHISPER_BIN` env override.
//!   2. `~/.personas/companion-stt/bin/<candidate>` for each known filename
//!      (`whisper-cli` is the current name; `main` / `whisper` are accepted
//!      as fallbacks for older/renamed builds).
//!   3. Those same names on PATH.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use crate::companion::stt::catalog::find_model_by_id;
use crate::companion::stt::downloader;
use crate::error::AppError;

/// Transcription timeout. Whisper on CPU can take several seconds for a
/// short clip with the `small` models; 120s is generous headroom.
const WHISPER_TIMEOUT: Duration = Duration::from_secs(120);

/// Candidate engine filenames, newest name first. whisper.cpp renamed its
/// example binary `main` → `whisper-cli`; we accept either plus a bare
/// `whisper` for distro packages.
#[cfg(target_os = "windows")]
const ENGINE_CANDIDATES: &[&str] = &["whisper-cli.exe", "main.exe", "whisper.exe"];
#[cfg(not(target_os = "windows"))]
const ENGINE_CANDIDATES: &[&str] = &["whisper-cli", "main", "whisper"];

/// The canonical filename we tell users to install (newest name).
pub const EXPECTED_FILENAME: &str = ENGINE_CANDIDATES[0];

/// Where the user-installed engine binary should live.
pub fn engine_dir() -> Result<PathBuf, AppError> {
    let base = if let Ok(override_dir) = std::env::var("PERSONAS_HOME") {
        PathBuf::from(override_dir)
    } else {
        dirs::home_dir()
            .ok_or_else(|| AppError::Internal("could not resolve home directory".into()))?
            .join(".personas")
    };
    Ok(base.join("companion-stt").join("bin"))
}

/// Resolve the engine binary path, or `None` if no install is found.
pub fn engine_binary_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PERSONAS_WHISPER_BIN") {
        let candidate = PathBuf::from(p);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Ok(dir) = engine_dir() {
        for name in ENGINE_CANDIDATES {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    path_lookup()
}

#[cfg(feature = "desktop")]
fn path_lookup() -> Option<PathBuf> {
    for name in ENGINE_CANDIDATES {
        if let Ok(p) = which::which(name) {
            return Some(p);
        }
    }
    None
}

#[cfg(not(feature = "desktop"))]
fn path_lookup() -> Option<PathBuf> {
    None
}

/// Status payload for the Voice tab's "Local speech-to-text" card.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub installed: bool,
    pub binary_path: Option<String>,
    pub expected_path: String,
    pub expected_filename: &'static str,
}

pub fn engine_status() -> Result<EngineStatus, AppError> {
    let dir = engine_dir()?;
    let installed_path = engine_binary_path();
    Ok(EngineStatus {
        installed: installed_path.is_some(),
        binary_path: installed_path.map(|p| p.display().to_string()),
        expected_path: dir.join(EXPECTED_FILENAME).display().to_string(),
        expected_filename: EXPECTED_FILENAME,
    })
}

/// Transcribe a 16 kHz mono PCM WAV. `language` is an optional whisper
/// language hint (`en`, `cs`, …); `None` lets whisper auto-detect.
pub async fn transcribe(
    wav_bytes: &[u8],
    model_id: &str,
    language: Option<&str>,
) -> Result<String, AppError> {
    if find_model_by_id(model_id).is_none() {
        return Err(AppError::Validation(format!(
            "unknown whisper model id `{model_id}` — not in curated catalog"
        )));
    }
    if !downloader::is_model_downloaded(model_id) {
        return Err(AppError::Validation(format!(
            "whisper model `{model_id}` is not downloaded — open the Voice tab and download it first"
        )));
    }
    let model_path = downloader::model_path(model_id)?;

    let engine = engine_binary_path().ok_or_else(|| {
        let dir = engine_dir()
            .map(|d| d.display().to_string())
            .unwrap_or_else(|_| "(no home dir)".into());
        AppError::Validation(format!(
            "Whisper engine binary not found. Install it at: {} \\ {} (or set PERSONAS_WHISPER_BIN). \
             Get a build from https://github.com/ggerganov/whisper.cpp/releases",
            dir, EXPECTED_FILENAME
        ))
    })?;

    let tempdir = tempfile::Builder::new()
        .prefix("personas-whisper-")
        .tempdir()
        .map_err(|e| AppError::Internal(format!("whisper tempdir: {e}")))?;
    let wav_path = tempdir.path().join("in.wav");
    tokio::fs::write(&wav_path, wav_bytes)
        .await
        .map_err(|e| AppError::Internal(format!("write whisper wav: {e}")))?;

    let mut cmd = tokio::process::Command::new(&engine);
    cmd.arg("-m")
        .arg(&model_path)
        .arg("-f")
        .arg(&wav_path)
        .arg("-nt") // no timestamps — just the text
        .arg("-np") // no prints — suppress system info / progress
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(lang) = language {
        cmd.arg("-l").arg(lang);
    }

    // Hide the console window on Windows (same rationale as Piper TTS —
    // DETACHED_PROCESS avoids a flashing conhost; all stdio is piped).
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(DETACHED_PROCESS);
    }

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn whisper: {e}")))?;

    let output = tokio::time::timeout(WHISPER_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| AppError::Internal(format!("whisper timed out after {WHISPER_TIMEOUT:?}")))?
        .map_err(|e| AppError::Internal(format!("whisper wait: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let snippet = if stderr.len() > 400 {
            format!("{}…", &stderr[..400])
        } else {
            stderr.into_owned()
        };
        return Err(AppError::Internal(format!(
            "whisper exited with {}: {}",
            output.status, snippet
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(clean_transcript(&stdout))
}

/// Join the engine's stdout lines into one trimmed transcript. whisper-cli
/// with `-nt` prints the text (sometimes wrapped across lines); we collapse
/// runs of whitespace and drop blank lines.
fn clean_transcript(stdout: &str) -> String {
    stdout
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_dir_uses_personas_home_override() {
        std::env::set_var("PERSONAS_HOME", "C:\\test-home");
        let dir = engine_dir().unwrap();
        std::env::remove_var("PERSONAS_HOME");
        assert!(dir.to_string_lossy().ends_with("companion-stt\\bin"));
    }

    #[test]
    fn engine_status_reports_expected_path() {
        let tmp = std::env::temp_dir().join(format!("personas-whisper-status-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);
        std::env::set_var("PERSONAS_HOME", &tmp);
        std::env::remove_var("PERSONAS_WHISPER_BIN");
        let status = engine_status().unwrap();
        assert!(status.expected_path.contains("companion-stt"));
        assert_eq!(status.expected_filename, EXPECTED_FILENAME);
        std::env::remove_var("PERSONAS_HOME");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn clean_transcript_collapses_whitespace_and_blanks() {
        let raw = "\n  Hello   there \n\n  world.  \n";
        assert_eq!(clean_transcript(raw), "Hello there world.");
    }

    #[test]
    fn engine_binary_path_honors_override() {
        let fake = std::env::current_exe().unwrap();
        std::env::set_var("PERSONAS_WHISPER_BIN", &fake);
        assert_eq!(engine_binary_path().as_ref(), Some(&fake));
        std::env::remove_var("PERSONAS_WHISPER_BIN");
    }
}
