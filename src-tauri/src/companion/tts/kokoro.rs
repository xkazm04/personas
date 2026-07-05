//! Kokoro local TTS engine — sherpa-onnx sidecar inference.
//!
//! Why sherpa-onnx as the sidecar (vs in-process `ort`):
//! - The prebuilt `sherpa-onnx-offline-tts` ships its own `onnxruntime.dll`
//!   alongside the exe and loads it in a separate process, so it can't
//!   collide with our pinned in-process `ort 2.0.0-rc.9` — the same
//!   DLL-version hazard `piper.rs` documents, and the reason both local
//!   engines run out-of-process. (Use the `win-x64-shared-MT-Release`
//!   build; there is no `static` build on the sherpa-onnx releases page.)
//! - It bundles espeak-ng phonemization, so we don't reimplement Kokoro's
//!   text frontend in Rust.
//! - Mirrors the Piper install model: the user drops the engine binary into
//!   `~/.personas/companion-tts/bin/` (shared with Piper) and extracts the
//!   Kokoro model package under `~/.personas/companion-tts/kokoro/`.
//!
//! Unlike Piper (one `.onnx` per voice), Kokoro is a single ~310MB model
//! whose 53 voices are selected by an integer `--sid`. `kokoro_catalog.rs`
//! maps friendly voice ids (`af_heart`) to sids.
//!
//! Wire protocol (one synthesis = one subprocess invocation):
//!   sherpa-onnx-offline-tts --kokoro-model M --kokoro-voices V \
//!     --kokoro-tokens T --kokoro-data-dir espeak-ng-data \
//!     [--kokoro-lexicon lexicon-us-en.txt] --num-threads 2 \
//!     --sid <N> --output-filename out.wav "text"
//! Text is a **positional** arg (not stdin). Output is 24kHz 16-bit WAV.
//!
//! Engine binary lookup priority mirrors Piper:
//!   1. `PERSONAS_KOKORO_BIN` env override (developer/test escape hatch).
//!   2. `~/.personas/companion-tts/bin/sherpa-onnx-offline-tts(.exe)`.
//!   3. `sherpa-onnx-offline-tts(.exe)` on PATH.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use tauri::State;

use crate::companion::tts::kokoro_catalog::find_voice_by_id;
use crate::companion::tts::piper;
use crate::companion::tts::{TtsAudio, TtsSynthesisRequest};
use crate::error::AppError;
use crate::AppState;

/// Sidecar invocation timeout. Kokoro inference for a few sentences is
/// sub-second on CPU, but each one-shot call reloads the ~310MB model
/// (~1-3s cold), so 90s is generous headroom for slow disks / CPUs.
const KOKORO_TIMEOUT: Duration = Duration::from_secs(90);

/// Sidecar engine binary filename on the current platform.
#[cfg(target_os = "windows")]
const ENGINE_FILENAME: &str = "sherpa-onnx-offline-tts.exe";
#[cfg(not(target_os = "windows"))]
const ENGINE_FILENAME: &str = "sherpa-onnx-offline-tts";

/// Official model package (stable `tts-models` release tag).
pub const MODEL_DOWNLOAD_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2";

/// Where to get the sidecar engine binary. Points at the releases index
/// rather than a pinned version so the copy doesn't rot; the UI tells the
/// user to grab the `win-x64-shared-MT-Release` build.
pub const ENGINE_DOWNLOAD_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases";

/// Resolve the model package directory: `~/.personas/companion-tts/kokoro/`.
/// Honors `PERSONAS_HOME` like the rest of the TTS stack.
pub fn model_dir() -> Result<PathBuf, AppError> {
    let base = if let Ok(override_dir) = std::env::var("PERSONAS_HOME") {
        PathBuf::from(override_dir)
    } else {
        dirs::home_dir()
            .ok_or_else(|| AppError::Internal("could not resolve home directory".into()))?
            .join(".personas")
    };
    Ok(base.join("companion-tts").join("kokoro"))
}

/// Resolve the engine binary path, or `None` if not installed anywhere on
/// the lookup chain.
pub fn engine_binary_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PERSONAS_KOKORO_BIN") {
        let candidate = PathBuf::from(p);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // Shared bin dir with Piper.
    if let Ok(dir) = piper::engine_dir() {
        let candidate = dir.join(ENGINE_FILENAME);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    path_lookup()
}

#[cfg(feature = "desktop")]
fn path_lookup() -> Option<PathBuf> {
    which::which(ENGINE_FILENAME).ok()
}

#[cfg(not(feature = "desktop"))]
fn path_lookup() -> Option<PathBuf> {
    None
}

/// The three files the sidecar needs, resolved under the model dir. The
/// `espeak-ng-data` dir must also exist for English phonemization.
struct ModelPaths {
    model: PathBuf,
    voices: PathBuf,
    tokens: PathBuf,
    espeak_data: PathBuf,
    /// Optional US-English lexicon; passed to `--kokoro-lexicon` when present
    /// for cleaner English pronunciation, omitted otherwise.
    lexicon_us_en: Option<PathBuf>,
}

fn resolve_model_paths() -> Result<ModelPaths, AppError> {
    let dir = model_dir()?;
    let lexicon = dir.join("lexicon-us-en.txt");
    Ok(ModelPaths {
        model: dir.join("model.onnx"),
        voices: dir.join("voices.bin"),
        tokens: dir.join("tokens.txt"),
        espeak_data: dir.join("espeak-ng-data"),
        lexicon_us_en: lexicon.is_file().then_some(lexicon),
    })
}

/// True when the core model files (`model.onnx`, `voices.bin`, `tokens.txt`)
/// and the `espeak-ng-data` directory are all present. Any missing → the
/// sidecar would fail to load, so we treat it as not installed.
pub fn is_model_installed() -> bool {
    let Ok(p) = resolve_model_paths() else {
        return false;
    };
    p.model.is_file() && p.voices.is_file() && p.tokens.is_file() && p.espeak_data.is_dir()
}

/// Status payload for the Voice tab's Kokoro card. Reports both the engine
/// binary and the model package independently so the setup UI can guide the
/// user through each half.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KokoroStatus {
    /// Engine binary present at any lookup-chain location.
    pub engine_installed: bool,
    /// Resolved binary path when `engine_installed`.
    pub engine_binary_path: Option<String>,
    /// Where to drop the engine binary if installing manually.
    pub expected_binary_path: String,
    /// Exact engine filename to drop in (platform-correct).
    pub expected_filename: &'static str,
    /// Model package (model.onnx + voices.bin + tokens.txt + espeak-ng-data).
    pub model_installed: bool,
    /// Directory the model package should be extracted into.
    pub model_dir: String,
    /// Copy-paste URL for the model package.
    pub model_download_url: &'static str,
    /// Copy-paste URL for the engine binary releases.
    pub engine_download_url: &'static str,
    /// Whether one-click auto-install is supported on this platform (the
    /// prebuilt sidecar asset is win-x64 only). Windows → true; other OSes
    /// fall back to the manual setup instructions.
    pub can_auto_install: bool,
}

pub fn status() -> Result<KokoroStatus, AppError> {
    let bin_dir = piper::engine_dir()?;
    let installed_path = engine_binary_path();
    Ok(KokoroStatus {
        engine_installed: installed_path.is_some(),
        engine_binary_path: installed_path.map(|p| p.display().to_string()),
        expected_binary_path: bin_dir.join(ENGINE_FILENAME).display().to_string(),
        expected_filename: ENGINE_FILENAME,
        model_installed: is_model_installed(),
        model_dir: model_dir()?.display().to_string(),
        model_download_url: MODEL_DOWNLOAD_URL,
        engine_download_url: ENGINE_DOWNLOAD_URL,
        can_auto_install: cfg!(target_os = "windows"),
    })
}

pub async fn synthesize(
    _state: &State<'_, Arc<AppState>>,
    request: &TtsSynthesisRequest<'_>,
) -> Result<TtsAudio, AppError> {
    let voice = find_voice_by_id(request.voice_id).ok_or_else(|| {
        AppError::Validation(format!(
            "kokoro voice `{}` is not in the curated catalog",
            request.voice_id
        ))
    })?;

    if !is_model_installed() {
        return Err(AppError::Validation(format!(
            "Kokoro model not installed — extract the model package into {} (see the Voice tab)",
            model_dir()?.display()
        )));
    }
    let paths = resolve_model_paths()?;

    let engine = engine_binary_path().ok_or_else(|| {
        let dir = piper::engine_dir()
            .map(|d| d.display().to_string())
            .unwrap_or_else(|_| "(no home dir)".into());
        AppError::Validation(format!(
            "Kokoro engine binary not found. Install `{}` at: {} (or set PERSONAS_KOKORO_BIN). \
             Get the win-x64-shared-MT-Release build from {}",
            ENGINE_FILENAME, dir, ENGINE_DOWNLOAD_URL
        ))
    })?;

    let tempdir = tempfile::Builder::new()
        .prefix("personas-kokoro-")
        .tempdir()
        .map_err(|e| AppError::Internal(format!("kokoro tempdir: {e}")))?;
    let output_path = tempdir.path().join("out.wav");

    let mut cmd = tokio::process::Command::new(&engine);
    cmd.arg(format!("--kokoro-model={}", paths.model.display()))
        .arg(format!("--kokoro-voices={}", paths.voices.display()))
        .arg(format!("--kokoro-tokens={}", paths.tokens.display()))
        .arg(format!("--kokoro-data-dir={}", paths.espeak_data.display()));
    if let Some(lex) = &paths.lexicon_us_en {
        cmd.arg(format!("--kokoro-lexicon={}", lex.display()));
    }
    // Map the shared `speed` (ElevenLabs 0.7..=1.2 convention) onto sherpa's
    // `--kokoro-length-scale` (Piper-style: smaller = faster). Skip when the
    // user hasn't customized speed so we inherit the model default (1.0).
    if let Some(speed) = request.settings.speed {
        let inv = 1.0 / speed.clamp(0.5, 2.0);
        cmd.arg(format!("--kokoro-length-scale={inv}"));
    } else if let Some(length_scale) = request.settings.length_scale {
        cmd.arg(format!("--kokoro-length-scale={}", length_scale.clamp(0.5, 2.0)));
    }
    cmd.arg("--num-threads=2")
        .arg(format!("--sid={}", voice.sid))
        .arg(format!("--output-filename={}", output_path.display()))
        // Text is a POSITIONAL trailing arg (not stdin, unlike Piper).
        .arg(request.text)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Hide the console window on Windows — same reasoning as piper.rs
    // (DETACHED_PROCESS avoids a conhost flash; all stdio is piped/null).
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(DETACHED_PROCESS);
    }

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn kokoro sidecar: {e}")))?;

    let output = tokio::time::timeout(KOKORO_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| AppError::Internal(format!("kokoro timed out after {KOKORO_TIMEOUT:?}")))?
        .map_err(|e| AppError::Internal(format!("kokoro wait: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let snippet = if stderr.len() > 400 {
            format!(
                "{}…",
                crate::utils::text::truncate_on_char_boundary(&stderr, 400)
            )
        } else {
            stderr.into_owned()
        };
        return Err(AppError::Internal(format!(
            "kokoro sidecar exited with {}: {}",
            output.status, snippet
        )));
    }

    let wav_bytes = tokio::fs::read(&output_path)
        .await
        .map_err(|e| AppError::Internal(format!("read kokoro wav: {e}")))?;
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
    fn model_dir_uses_personas_home_override() {
        std::env::set_var("PERSONAS_HOME", "C:\\test-home");
        let dir = model_dir().unwrap();
        std::env::remove_var("PERSONAS_HOME");
        assert!(dir.to_string_lossy().ends_with("companion-tts\\kokoro"));
    }

    #[test]
    fn is_model_installed_false_for_empty_dir() {
        let tmp = std::env::temp_dir().join(format!(
            "personas-kokoro-model-test-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&tmp);
        std::env::set_var("PERSONAS_HOME", &tmp);
        assert!(!is_model_installed());
        std::env::remove_var("PERSONAS_HOME");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn status_reports_expected_paths() {
        let tmp = std::env::temp_dir().join(format!(
            "personas-kokoro-status-test-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&tmp);
        std::env::set_var("PERSONAS_HOME", &tmp);
        std::env::remove_var("PERSONAS_KOKORO_BIN");

        let s = status().unwrap();
        assert!(s.expected_binary_path.contains("companion-tts"));
        assert!(s.model_dir.contains("kokoro"));
        assert_eq!(s.expected_filename, ENGINE_FILENAME);
        assert!(s.model_download_url.contains("kokoro-multi-lang-v1_0"));

        std::env::remove_var("PERSONAS_HOME");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
