//! Pocket TTS local engine — HTTP sidecar-service inference.
//!
//! Why an HTTP service instead of a subprocess-per-call sidecar (Piper) or
//! an in-process `ort` session:
//! - Pocket TTS (kyutai-labs) is a 100M-param PyTorch model with zero-shot
//!   voice cloning. There is no self-contained CLI binary that runs its
//!   8-graph ONNX export, and bundling Python/PyTorch into the app is a
//!   non-starter — but a *long-lived local HTTP service* keeps the model
//!   warm (one-shot spawn would pay a multi-second model load per call)
//!   and stays out-of-process, so it can't collide with our pinned
//!   in-process `ort 2.0.0-rc.9` (the same DLL hazard `piper.rs` documents).
//! - The service (see `pocket-tts` repo, `service/app.py`) exposes an
//!   ElevenLabs-shaped API, so this module is structurally a twin of
//!   `elevenlabs.rs` with a localhost base URL and no credential.
//! - Voice cloning: dropping a `<name>.safetensors` embedding into the
//!   service's `voices/` dir makes `<name>` a valid `voice_id` here — the
//!   user's own cloned voice speaks Athena's replies.
//!
//! The service is expected at `http://127.0.0.1:8080` (override with the
//! `PERSONAS_POCKET_TTS_URL` env var). It applies its own bounded queue and
//! replies 429 under overload, so no client-side semaphore is needed.
//!
//! ## Two backends, one engine
//!
//! Since sherpa-onnx v1.13.4 ships Pocket TTS support (the SAME sidecar
//! binary Kokoro uses), this module also has a fully-packaged **sidecar
//! mode**: a one-shot `sherpa-onnx-offline-tts` spawn with the 7-file ONNX
//! model package (~190MB int8) and `--reference-audio=<voice>.wav` for
//! zero-shot cloning. No Python anywhere; installable via the same
//! one-click download flow as Kokoro (`pocket_installer.rs`).
//!
//! Routing: a synthesis goes to the **sidecar** when it's installed AND the
//! requested voice exists as a wav in `~/.personas/companion-tts/
//! pocket-voices/`; otherwise it falls back to the HTTP service (which also
//! carries the built-in Kyutai voice catalog). Either backend alone is
//! sufficient; users who never start the Python service still get cloning.
//!
//! License note: the prebuilt ONNX export packaged by sherpa-onnx derives
//! from a community export (KevinAHM/pocket-tts-onnx) that is licensed
//! **non-commercial** — fine for personal use; re-export from the original
//! weights before any commercial distribution.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::companion::tts::{kokoro, piper, TtsAudio, TtsSynthesisRequest};
use crate::error::AppError;

/// Where the local service listens unless overridden.
const DEFAULT_BASE_URL: &str = "http://127.0.0.1:8080";

/// Synthesis round-trip cap. Local CPU inference for a 1-3 sentence reply is
/// seconds; a queued request under parallel load can wait longer. 90s matches
/// Kokoro's generosity.
const POCKET_TIMEOUT: Duration = Duration::from_secs(90);

/// Health/voices probes should be snappy — the Voice tab polls this.
const POCKET_PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// Sidecar invocation cap. A short reply is ~3s wall including model load;
/// long text on a slow CPU stays well under this.
const POCKET_SIDECAR_TIMEOUT: Duration = Duration::from_secs(120);

/// The 7 files the sidecar needs, relative to `model_dir()`. Matches the
/// `sherpa-onnx-pocket-tts-int8-2026-01-26` package layout.
const MODEL_FILES: [&str; 7] = [
    "lm_flow.int8.onnx",
    "lm_main.int8.onnx",
    "encoder.onnx",
    "decoder.int8.onnx",
    "text_conditioner.onnx",
    "vocab.json",
    "token_scores.json",
];

/// Where to get the sidecar binary + model package (surfaced for the manual
/// setup path; the one-click installer pins exact assets).
pub const ENGINE_DOWNLOAD_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases";
pub const MODEL_DOWNLOAD_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2";

/// Model package dir: `~/.personas/companion-tts/pocket/`.
pub fn model_dir() -> Result<PathBuf, AppError> {
    Ok(piper::engine_dir()?
        .parent()
        .ok_or_else(|| AppError::Internal("companion-tts dir has no parent".into()))?
        .join("pocket"))
}

/// Cloned-voice dir: `~/.personas/companion-tts/pocket-voices/`. Every
/// `<name>.wav` in here is a selectable cloned voice (10-30s of clean
/// single-speaker audio clones best).
pub fn voices_dir() -> Result<PathBuf, AppError> {
    Ok(piper::engine_dir()?
        .parent()
        .ok_or_else(|| AppError::Internal("companion-tts dir has no parent".into()))?
        .join("pocket-voices"))
}

/// True when all 7 model files are present.
pub fn is_model_installed() -> bool {
    let Ok(dir) = model_dir() else { return false };
    MODEL_FILES.iter().all(|f| dir.join(f).is_file())
}

/// The sidecar is usable: engine binary resolvable (shared with Kokoro —
/// same `sherpa-onnx-offline-tts` exe) + model package present.
pub fn sidecar_ready() -> bool {
    kokoro::engine_binary_path().is_some() && is_model_installed()
}

/// Resolve a cloned voice's reference wav, if it exists.
fn voice_wav_path(voice_id: &str) -> Option<PathBuf> {
    let dir = voices_dir().ok()?;
    let p = dir.join(format!("{voice_id}.wav"));
    p.is_file().then_some(p)
}

/// Uploaded reference recordings are small by construction (the frontend
/// resamples to 24kHz mono PCM16 and trims to ~30s ≈ 1.4MB); 10MB is a
/// generous ceiling that still rejects accidental album-length uploads.
const VOICE_WAV_MAX_BYTES: usize = 10 * 1024 * 1024;

/// Save an uploaded reference recording as a cloned voice. The frontend
/// converts whatever the user picked (mp3/wav/flac/…) into a 24kHz mono
/// PCM16 WAV via the Web Audio API before upload, so this only needs to
/// sanity-check the container and size — `voice_id` is validated by the
/// command layer (same charset rule as every other engine's voice ids).
pub fn import_voice(voice_id: &str, wav_bytes: &[u8]) -> Result<PocketVoiceEntry, AppError> {
    if wav_bytes.len() > VOICE_WAV_MAX_BYTES {
        return Err(AppError::Validation(format!(
            "voice recording too large ({} bytes, max {})",
            wav_bytes.len(),
            VOICE_WAV_MAX_BYTES
        )));
    }
    if wav_bytes.len() < 44 || &wav_bytes[0..4] != b"RIFF" || &wav_bytes[8..12] != b"WAVE" {
        return Err(AppError::Validation(
            "voice recording is not a WAV file — the upload conversion failed".into(),
        ));
    }
    let dir = voices_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Internal(format!("create voices dir: {e}")))?;
    // Write via temp + rename so a mid-write crash can't leave a truncated
    // wav that the sidecar would then feed to the encoder.
    let dest = dir.join(format!("{voice_id}.wav"));
    let tmp = dir.join(format!("{voice_id}.wav.partial"));
    std::fs::write(&tmp, wav_bytes)
        .map_err(|e| AppError::Internal(format!("write voice wav: {e}")))?;
    std::fs::rename(&tmp, &dest)
        .map_err(|e| AppError::Internal(format!("finalize voice wav: {e}")))?;
    Ok(PocketVoiceEntry {
        voice_id: voice_id.to_string(),
        name: voice_id.to_string(),
        category: "cloned".into(),
    })
}

/// Remove a cloned voice's reference wav. Idempotent — deleting a voice
/// that doesn't exist (or was never local) returns Ok.
pub fn delete_voice(voice_id: &str) -> Result<(), AppError> {
    if let Some(p) = voice_wav_path(voice_id) {
        std::fs::remove_file(&p)
            .map_err(|e| AppError::Internal(format!("delete voice wav: {e}")))?;
    }
    Ok(())
}

/// Enumerate the cloned voices (wav stems in `voices_dir`).
fn list_local_voices() -> Vec<PocketVoiceEntry> {
    let Ok(dir) = voices_dir() else { return vec![] };
    let Ok(entries) = std::fs::read_dir(&dir) else { return vec![] };
    let mut out: Vec<PocketVoiceEntry> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("wav")) {
                let stem = p.file_stem()?.to_string_lossy().into_owned();
                Some(PocketVoiceEntry {
                    voice_id: stem.clone(),
                    name: stem,
                    category: "cloned".into(),
                })
            } else {
                None
            }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub fn base_url() -> String {
    std::env::var("PERSONAS_POCKET_TTS_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim_end_matches('/').to_string())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
}

/// Status payload for the Voice tab's Pocket setup card. Reports both
/// backends independently: the packaged sidecar (installable, offline) and
/// the optional HTTP service (warm model + built-in voice catalog).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PocketStatus {
    /// True when GET /health returned 200 (service up, models loaded).
    pub running: bool,
    /// The base URL we probed — surfaced so the user can see/override it.
    pub base_url: String,
    /// Worker-pool size reported by the service, when running.
    pub workers: Option<u32>,
    /// Sidecar engine binary present (shared `sherpa-onnx-offline-tts`).
    pub engine_installed: bool,
    /// Pocket model package (7 ONNX/JSON files) present.
    pub model_installed: bool,
    /// Where the model package should be extracted.
    pub model_dir: String,
    /// Where cloned-voice wavs live.
    pub voices_dir: String,
    /// Where to drop the engine binary if installing manually.
    pub expected_binary_path: String,
    pub engine_download_url: &'static str,
    pub model_download_url: &'static str,
    /// One-click install supported (prebuilt sidecar exists for this OS).
    pub can_auto_install: bool,
}

/// One voice row from the service's `GET /v1/voices`. `category` is
/// `"cloned"` for user embeddings in the service's voices dir and
/// `"premade"` for the built-in Kyutai catalog.
///
/// Casing is asymmetric on purpose: the service speaks snake_case
/// (`voice_id`) while our IPC surface is camelCase (`voiceId`) like every
/// other frontend-facing payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct PocketVoiceEntry {
    pub voice_id: String,
    pub name: String,
    pub category: String,
}

#[derive(Deserialize)]
struct VoicesResponse {
    voices: Vec<PocketVoiceEntry>,
}

fn probe_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(POCKET_PROBE_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("pocket tts http client: {e}")))
}

pub async fn status() -> Result<PocketStatus, AppError> {
    let base = base_url();
    let client = probe_client()?;
    let (running, workers) = match client.get(format!("{base}/health")).send().await {
        Ok(resp) if resp.status().is_success() => {
            let workers = resp
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|v| v["config"]["workers"].as_u64())
                .map(|w| w as u32);
            (true, workers)
        }
        // Both "connection refused" (service down) and non-200 (loading)
        // render as not-running; the Voice tab offers a re-check.
        _ => (false, None),
    };
    let bin_dir = piper::engine_dir()?;
    Ok(PocketStatus {
        running,
        base_url: base,
        workers,
        engine_installed: kokoro::engine_binary_path().is_some(),
        model_installed: is_model_installed(),
        model_dir: model_dir()?.display().to_string(),
        voices_dir: voices_dir()?.display().to_string(),
        expected_binary_path: bin_dir
            .join(if cfg!(windows) { "sherpa-onnx-offline-tts.exe" } else { "sherpa-onnx-offline-tts" })
            .display()
            .to_string(),
        engine_download_url: ENGINE_DOWNLOAD_URL,
        model_download_url: MODEL_DOWNLOAD_URL,
        can_auto_install: cfg!(target_os = "windows"),
    })
}

/// Merged voice list: local cloned wavs (sidecar-servable, listed first)
/// plus — when the service is reachable — its voices. Local wins on id
/// collision so the offline path is always preferred.
pub async fn list_voices() -> Result<Vec<PocketVoiceEntry>, AppError> {
    let mut merged = list_local_voices();

    let base = base_url();
    let client = probe_client()?;
    let service_voices: Vec<PocketVoiceEntry> = match client
        .get(format!("{base}/v1/voices"))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => resp
            .json::<VoicesResponse>()
            .await
            .map(|v| v.voices)
            .unwrap_or_default(),
        // Service down is fine when the sidecar is installed — the local
        // list stands alone. Only error when NEITHER backend can serve.
        _ => {
            if merged.is_empty() && !sidecar_ready() {
                return Err(not_running_error(&base));
            }
            vec![]
        }
    };
    for v in service_voices {
        if !merged.iter().any(|m| m.voice_id == v.voice_id) {
            merged.push(v);
        }
    }
    Ok(merged)
}

fn not_running_error(base: &str) -> AppError {
    AppError::Validation(format!(
        "Pocket TTS has no usable backend: the packaged engine isn't installed (use the Voice \
         tab's one-click install) and no local service is reachable at {base}. Install the \
         engine, or start the service / set PERSONAS_POCKET_TTS_URL, then re-check."
    ))
}

/// Route a synthesis to the best available backend: the packaged sidecar
/// when it can serve this voice (installed + a local reference wav), else
/// the HTTP service. See the module docs for the rationale.
pub async fn synthesize(request: &TtsSynthesisRequest<'_>) -> Result<TtsAudio, AppError> {
    if sidecar_ready() {
        if let Some(wav) = voice_wav_path(request.voice_id) {
            return synthesize_sidecar(request, &wav).await;
        }
    }
    synthesize_service(request).await
}

/// One-shot sidecar spawn — kokoro.rs's wire protocol with the pocket flag
/// set and `--reference-audio` doing the zero-shot cloning.
async fn synthesize_sidecar(
    request: &TtsSynthesisRequest<'_>,
    reference_wav: &std::path::Path,
) -> Result<TtsAudio, AppError> {
    let dir = model_dir()?;
    let engine = kokoro::engine_binary_path().ok_or_else(|| {
        AppError::Internal("pocket sidecar: engine binary vanished after readiness check".into())
    })?;

    let tempdir = tempfile::Builder::new()
        .prefix("personas-pocket-")
        .tempdir()
        .map_err(|e| AppError::Internal(format!("pocket tempdir: {e}")))?;
    let output_path = tempdir.path().join("out.wav");

    let mut cmd = tokio::process::Command::new(&engine);
    cmd.arg(format!("--pocket-lm-flow={}", dir.join("lm_flow.int8.onnx").display()))
        .arg(format!("--pocket-lm-main={}", dir.join("lm_main.int8.onnx").display()))
        .arg(format!("--pocket-encoder={}", dir.join("encoder.onnx").display()))
        .arg(format!("--pocket-decoder={}", dir.join("decoder.int8.onnx").display()))
        .arg(format!(
            "--pocket-text-conditioner={}",
            dir.join("text_conditioner.onnx").display()
        ))
        .arg(format!("--pocket-vocab-json={}", dir.join("vocab.json").display()))
        .arg(format!(
            "--pocket-token-scores-json={}",
            dir.join("token_scores.json").display()
        ))
        .arg(format!("--reference-audio={}", reference_wav.display()))
        .arg("--num-threads=4")
        .arg(format!("--output-filename={}", output_path.display()))
        // Text is a POSITIONAL trailing arg (same as Kokoro, unlike Piper).
        .arg(request.text)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Hide the console window on Windows — same reasoning as piper.rs.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(DETACHED_PROCESS);
    }

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn pocket sidecar: {e}")))?;

    let output = tokio::time::timeout(POCKET_SIDECAR_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| {
            AppError::Internal(format!("pocket sidecar timed out after {POCKET_SIDECAR_TIMEOUT:?}"))
        })?
        .map_err(|e| AppError::Internal(format!("pocket sidecar wait: {e}")))?;

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
            "pocket sidecar exited with {}: {}",
            output.status, snippet
        )));
    }

    let wav_bytes = tokio::fs::read(&output_path)
        .await
        .map_err(|e| AppError::Internal(format!("read pocket wav: {e}")))?;
    let byte_size = wav_bytes.len();
    let audio_base64 = base64::engine::general_purpose::STANDARD.encode(&wav_bytes);

    Ok(TtsAudio {
        audio_base64,
        mime_type: "audio/wav".into(),
        byte_size,
    })
}

async fn synthesize_service(request: &TtsSynthesisRequest<'_>) -> Result<TtsAudio, AppError> {
    let base = base_url();
    let client = reqwest::Client::builder()
        .timeout(POCKET_TIMEOUT)
        .build()
        .map_err(|e| AppError::Internal(format!("pocket tts http client: {e}")))?;

    let url = format!(
        "{base}/v1/text-to-speech/{}?output_format=wav_24000",
        request.voice_id
    );
    let body = serde_json::json!({
        "text": request.text,
        "model_id": "pocket_tts",
    });

    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                not_running_error(&base)
            } else {
                AppError::Internal(format!("pocket tts request: {e}"))
            }
        })?;

    let status = resp.status();
    if status.as_u16() == 429 {
        // The service's bounded queue is full — surface as a user-actionable
        // condition rather than an opaque internal error.
        return Err(AppError::Validation(
            "Pocket TTS service is at capacity (queue full) — try again in a moment".into(),
        ));
    }
    if !status.is_success() {
        let body_text = resp.text().await.unwrap_or_default();
        let snippet = if body_text.len() > 400 {
            format!(
                "{}…",
                crate::utils::text::truncate_on_char_boundary(&body_text, 400)
            )
        } else {
            body_text
        };
        return Err(AppError::Internal(format!(
            "Pocket TTS service returned {status}: {snippet}"
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("pocket tts read body: {e}")))?;
    let byte_size = bytes.len();
    let audio_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

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
    fn voice_entry_deserializes_service_snake_case_and_serializes_camel() {
        // Shape as actually returned by the service's GET /v1/voices.
        let entry: PocketVoiceEntry = serde_json::from_str(
            r#"{"voice_id":"step4","name":"step4","category":"cloned"}"#,
        )
        .expect("service snake_case must deserialize");
        assert_eq!(entry.voice_id, "step4");

        // ...and re-serializes camelCase for the IPC surface.
        let out = serde_json::to_string(&entry).unwrap();
        assert!(out.contains("\"voiceId\":\"step4\""), "got: {out}");
    }

    #[test]
    fn base_url_defaults_and_trims_override() {
        std::env::remove_var("PERSONAS_POCKET_TTS_URL");
        assert_eq!(base_url(), DEFAULT_BASE_URL);

        std::env::set_var("PERSONAS_POCKET_TTS_URL", "http://127.0.0.1:9090/");
        assert_eq!(base_url(), "http://127.0.0.1:9090");
        std::env::remove_var("PERSONAS_POCKET_TTS_URL");

        // Blank override falls back to the default rather than producing
        // a request to an empty host.
        std::env::set_var("PERSONAS_POCKET_TTS_URL", "  ");
        assert_eq!(base_url(), DEFAULT_BASE_URL);
        std::env::remove_var("PERSONAS_POCKET_TTS_URL");
    }
}
