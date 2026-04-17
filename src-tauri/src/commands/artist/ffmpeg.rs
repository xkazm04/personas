//! FFmpeg integration for Media Studio — detection, media probing, and export.
//!
//! Follows the `BackgroundJobManager` pattern from task_executor.rs:
//! spawns ffmpeg process, parses stderr for progress, emits Tauri events.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

use crate::background_job::BackgroundJobManager;
use crate::engine::event_registry::event_name;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

// =============================================================================
// Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LoudnessStats {
    /// Integrated program loudness (LUFS). Main value used to compute gain.
    pub integrated: f64,
    /// Loudness range (LU).
    pub lra: f64,
    /// True peak (dBTP).
    pub true_peak: f64,
    /// loudnorm's internal threshold.
    pub threshold: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbeResult {
    pub duration: f64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub has_video: bool,
    pub has_audio: bool,
    pub codec: Option<String>,
    pub file_path: String,
}

/// Serialized composition from the frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositionInput {
    pub width: i32,
    pub height: i32,
    pub fps: i32,
    pub background_color: String,
    pub items: Vec<CompositionItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum CompositionItem {
    #[serde(rename = "video")]
    Video {
        file_path: String,
        start_time: f64,
        duration: f64,
        trim_start: f64,
        trim_end: f64,
        transition: String,
        transition_duration: f64,
        #[serde(default = "default_one")]
        speed: f64,
        #[serde(default)]
        fade_in: f64,
        #[serde(default)]
        fade_out: f64,
        #[serde(default)]
        strip_audio: bool,
    },
    #[serde(rename = "audio")]
    Audio {
        file_path: String,
        start_time: f64,
        duration: f64,
        trim_start: f64,
        trim_end: f64,
        volume: f64,
        #[serde(default = "default_one")]
        speed: f64,
        #[serde(default)]
        fade_in: f64,
        #[serde(default)]
        fade_out: f64,
        #[serde(default)]
        normalize: bool,
        // Two-pass loudnorm fields: when all four are present, the export
        // uses loudnorm's linear mode (exact linear gain, matches preview).
        #[serde(default)]
        measured_lufs: Option<f64>,
        #[serde(default)]
        measured_lra: Option<f64>,
        #[serde(default)]
        measured_true_peak: Option<f64>,
        #[serde(default)]
        measured_threshold: Option<f64>,
    },
    #[serde(rename = "text")]
    Text {
        label: String,
        #[serde(default)]
        text: String,
        start_time: f64,
        duration: f64,
        font_size: i32,
        color: String,
        #[serde(default = "default_half")]
        position_x: f64,
        #[serde(default = "default_half")]
        position_y: f64,
        #[serde(default)]
        fade_in: f64,
        #[serde(default)]
        fade_out: f64,
    },
    #[serde(rename = "image")]
    Image {
        file_path: String,
        start_time: f64,
        duration: f64,
        #[serde(default = "default_half")]
        position_x: f64,
        #[serde(default = "default_half")]
        position_y: f64,
        #[serde(default = "default_scale")]
        scale: f64,
        #[serde(default)]
        fade_in: f64,
        #[serde(default)]
        fade_out: f64,
    },
}

fn default_one() -> f64 {
    1.0
}

fn default_half() -> f64 {
    0.5
}

fn default_scale() -> f64 {
    1.0
}

/// Resolve a platform-appropriate TTF path for drawtext filters. Returns
/// None if no known font is installed — caller should log and skip text
/// rendering rather than error.
fn resolve_system_font() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        for candidate in [
            r"C:\Windows\Fonts\arial.ttf",
            r"C:\Windows\Fonts\segoeui.ttf",
        ] {
            let p = std::path::Path::new(candidate);
            if p.exists() {
                // ffmpeg filter syntax prefers forward slashes on Windows
                return Some(candidate.replace('\\', "/"));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        for candidate in [
            "/System/Library/Fonts/Helvetica.ttc",
            "/Library/Fonts/Arial.ttf",
        ] {
            if std::path::Path::new(candidate).exists() {
                return Some(candidate.to_string());
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        for candidate in [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        ] {
            if std::path::Path::new(candidate).exists() {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

/// Escape a user string for use inside an ffmpeg `drawtext=text='...'` clause.
/// The filter graph uses `:` and `,` as separators and `\` as an escape, and
/// we single-quote the text itself so `'` needs doubling.
fn escape_drawtext(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace(',', "\\,")
        .replace('\'', "\\\\\\'")
        .replace('%', "\\%")
}

// =============================================================================
// Background job for export
// =============================================================================

#[derive(Clone, Default)]
struct MediaExportExtra;

static MEDIA_EXPORT_JOBS: BackgroundJobManager<MediaExportExtra> = BackgroundJobManager::new(
    "media-export lock poisoned",
    event_name::MEDIA_EXPORT_STATUS,
    event_name::MEDIA_EXPORT_OUTPUT,
);

// =============================================================================
// FFmpeg detection
// =============================================================================

async fn find_ffmpeg_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\ffmpeg\bin\ffmpeg.exe",
            r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
            r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
        ];
        for c in &candidates {
            let p = PathBuf::from(c);
            if p.exists() {
                return Some(p);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let candidates = ["/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"];
        for c in &candidates {
            let p = PathBuf::from(c);
            if p.exists() {
                return Some(p);
            }
        }
    }

    // Fallback: try PATH (async)
    let mut cmd = TokioCommand::new("ffmpeg");
    cmd.arg("-version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    if let Ok(output) = cmd.output().await {
        if output.status.success() {
            return Some(PathBuf::from("ffmpeg"));
        }
    }
    None
}

async fn get_ffmpeg_version_async(ffmpeg_path: &Path) -> Result<String, AppError> {
    let mut cmd = TokioCommand::new(ffmpeg_path);
    cmd.arg("-version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::ProcessSpawn(e.to_string()))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let version = stdout
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("ffmpeg version "))
        .map(|v| v.split_whitespace().next().unwrap_or(v))
        .unwrap_or("unknown")
        .to_string();
    Ok(version)
}

// =============================================================================
// Commands
// =============================================================================

#[tauri::command]
pub async fn artist_check_ffmpeg() -> Result<FfmpegStatus, AppError> {
    match find_ffmpeg_path().await {
        Some(p) => {
            let version = get_ffmpeg_version_async(&p).await.ok();
            Ok(FfmpegStatus {
                found: true,
                path: Some(p.to_string_lossy().to_string()),
                version,
            })
        }
        None => Ok(FfmpegStatus {
            found: false,
            path: None,
            version: None,
        }),
    }
}

/// Probe a media file using ffprobe to get duration, dimensions, codecs.
#[tauri::command]
pub async fn artist_probe_media(file_path: String) -> Result<MediaProbeResult, AppError> {
    let ffprobe_path = find_ffprobe_path()
        .await
        .ok_or_else(|| AppError::NotFound("ffprobe not found (install ffmpeg)".into()))?;

    let mut cmd = TokioCommand::new(&ffprobe_path);
    cmd.args([
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        &file_path,
    ]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::ProcessSpawn(format!("ffprobe failed: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Internal(format!("ffprobe error: {stderr}")));
    }

    let data: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| AppError::Internal(format!("Failed to parse ffprobe output: {e}")))?;

    let duration = data["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let streams = data["streams"].as_array();
    let video_stream = streams
        .and_then(|ss| ss.iter().find(|s| s["codec_type"] == "video"));
    let audio_stream = streams
        .and_then(|ss| ss.iter().find(|s| s["codec_type"] == "audio"));

    let width = video_stream.and_then(|s| s["width"].as_i64()).map(|w| w as i32);
    let height = video_stream.and_then(|s| s["height"].as_i64()).map(|h| h as i32);
    let codec = video_stream
        .and_then(|s| s["codec_name"].as_str())
        .or_else(|| audio_stream.and_then(|s| s["codec_name"].as_str()))
        .map(|s| s.to_string());

    Ok(MediaProbeResult {
        duration,
        width,
        height,
        has_video: video_stream.is_some(),
        has_audio: audio_stream.is_some(),
        codec,
        file_path,
    })
}

async fn find_ffprobe_path() -> Option<PathBuf> {
    // ffprobe is co-located with ffmpeg
    if let Some(ffmpeg) = find_ffmpeg_path().await {
        let ffprobe = ffmpeg
            .parent()
            .map(|dir| dir.join(if cfg!(target_os = "windows") { "ffprobe.exe" } else { "ffprobe" }));
        if let Some(p) = ffprobe {
            if p.exists() {
                return Some(p);
            }
        }
        // Fallback: just try "ffprobe" on PATH
        return Some(PathBuf::from("ffprobe"));
    }
    None
}

/// Export a composition to MP4 via ffmpeg.
///
/// Runs in a background task, streaming progress events to the frontend.
#[tauri::command]
pub async fn artist_export_composition(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    job_id: String,
    composition_json: String,
    output_path: String,
) -> Result<serde_json::Value, AppError> {
    require_auth(&state).await?;

    let ffmpeg = find_ffmpeg_path()
        .await
        .ok_or_else(|| AppError::NotFound("ffmpeg not found".into()))?;

    let composition: CompositionInput = serde_json::from_str(&composition_json)
        .map_err(|e| AppError::Validation(format!("Invalid composition: {e}")))?;

    let cancel_token = CancellationToken::new();
    MEDIA_EXPORT_JOBS.insert_running(job_id.clone(), cancel_token.clone(), MediaExportExtra)?;
    MEDIA_EXPORT_JOBS.set_status(&app, &job_id, "encoding", None);

    let app_handle = app.clone();
    let job_id_clone = job_id.clone();

    tokio::spawn(async move {
        let result = tokio::select! {
            _ = cancel_token.cancelled() => {
                Err(AppError::Internal("Export cancelled".into()))
            }
            res = run_ffmpeg_export(
                &app_handle,
                &job_id_clone,
                &ffmpeg,
                &composition,
                &output_path,
            ) => res
        };

        match result {
            Ok(()) => {
                MEDIA_EXPORT_JOBS.set_status(&app_handle, &job_id_clone, "completed", None);
                let _ = app_handle.emit(
                    event_name::MEDIA_EXPORT_COMPLETE,
                    json!({ "job_id": job_id_clone, "output_path": output_path }),
                );
            }
            Err(e) => {
                let msg = format!("{e}");
                MEDIA_EXPORT_JOBS.set_status(&app_handle, &job_id_clone, "failed", Some(msg.clone()));
                MEDIA_EXPORT_JOBS.emit_line(&app_handle, &job_id_clone, format!("[Error] {msg}"));
            }
        }

        let _ = MEDIA_EXPORT_JOBS.remove(&job_id_clone);
    });

    Ok(json!({ "job_id": job_id }))
}

// =============================================================================
// Quick-win one-shot operations
// =============================================================================

/// Extract the audio track of a media file into a standalone file.
/// Uses stream-copy (no re-encode) when possible.
#[tauri::command]
pub async fn artist_extract_audio(
    input_path: String,
    output_path: String,
) -> Result<String, AppError> {
    let ffmpeg = find_ffmpeg_path()
        .await
        .ok_or_else(|| AppError::NotFound("ffmpeg not found".into()))?;

    let ext = std::path::Path::new(&output_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("m4a")
        .to_lowercase();

    let codec_args: &[&str] = match ext.as_str() {
        "mp3" => &["-vn", "-c:a", "libmp3lame", "-q:a", "2"],
        "wav" => &["-vn", "-c:a", "pcm_s16le"],
        // Default: container-appropriate copy when possible
        _ => &["-vn", "-c:a", "copy"],
    };

    let mut cmd = TokioCommand::new(&ffmpeg);
    cmd.args(["-y", "-i", &input_path]);
    cmd.args(codec_args);
    cmd.arg(&output_path);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::ProcessSpawn(format!("ffmpeg extract_audio failed: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Internal(format!("ffmpeg error: {stderr}")));
    }
    Ok(output_path)
}

/// Save a single frame as an image. Uses fast seek (`-ss` before `-i`) so
/// it's near-instant even on long files.
#[tauri::command]
pub async fn artist_save_thumbnail(
    input_path: String,
    time_seconds: f64,
    output_path: String,
) -> Result<String, AppError> {
    let ffmpeg = find_ffmpeg_path()
        .await
        .ok_or_else(|| AppError::NotFound("ffmpeg not found".into()))?;

    let mut cmd = TokioCommand::new(&ffmpeg);
    cmd.args([
        "-y",
        "-ss",
        &format!("{:.3}", time_seconds.max(0.0)),
        "-i",
        &input_path,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        "-update",
        "1",
        &output_path,
    ]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::ProcessSpawn(format!("ffmpeg thumbnail failed: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Internal(format!("ffmpeg error: {stderr}")));
    }
    Ok(output_path)
}

/// Measure integrated loudness of a media file using ffmpeg's `loudnorm`
/// filter in "print_format=json" dry-run mode. The preview player uses the
/// returned `integrated` LUFS to apply a true linear gain equivalent to what
/// the export's loudnorm pass will produce.
#[tauri::command]
pub async fn artist_measure_loudness(
    file_path: String,
) -> Result<LoudnessStats, AppError> {
    let ffmpeg = find_ffmpeg_path()
        .await
        .ok_or_else(|| AppError::NotFound("ffmpeg not found".into()))?;

    let mut cmd = TokioCommand::new(&ffmpeg);
    cmd.args([
        "-hide_banner",
        "-nostats",
        "-i",
        &file_path,
        "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
        "-f",
        "null",
        "-",
    ]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::ProcessSpawn(format!("loudnorm measurement failed: {e}")))?;

    // loudnorm prints a JSON block to stderr; extract the braces region.
    let stderr = String::from_utf8_lossy(&output.stderr);
    let start = stderr.find('{').ok_or_else(|| {
        AppError::Internal("loudnorm: no JSON block found in ffmpeg stderr".into())
    })?;
    let end = stderr.rfind('}').ok_or_else(|| {
        AppError::Internal("loudnorm: unterminated JSON block".into())
    })?;
    if end <= start {
        return Err(AppError::Internal("loudnorm: malformed JSON region".into()));
    }
    let json_str = &stderr[start..=end];

    let json: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| AppError::Internal(format!("loudnorm JSON parse error: {e}")))?;

    let pick = |k: &str| -> f64 {
        json.get(k)
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0)
    };

    Ok(LoudnessStats {
        integrated: pick("input_i"),
        lra: pick("input_lra"),
        true_peak: pick("input_tp"),
        threshold: pick("input_thresh"),
    })
}

/// Trim a media file to a standalone output. Stream-copy (fast, near-instant)
/// when possible — falls back to re-encode only if stream-copy rejects the
/// range (e.g. not on a keyframe).
#[tauri::command]
pub async fn artist_trim_file(
    input_path: String,
    start_seconds: f64,
    end_seconds: f64,
    output_path: String,
) -> Result<String, AppError> {
    let ffmpeg = find_ffmpeg_path()
        .await
        .ok_or_else(|| AppError::NotFound("ffmpeg not found".into()))?;

    let start = start_seconds.max(0.0);
    let end = end_seconds.max(start + 0.1);

    // First pass: stream-copy (fast)
    let mut cmd = TokioCommand::new(&ffmpeg);
    cmd.args([
        "-y",
        "-ss",
        &format!("{start:.3}"),
        "-to",
        &format!("{end:.3}"),
        "-i",
        &input_path,
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        &output_path,
    ]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::ProcessSpawn(format!("ffmpeg trim failed: {e}")))?;

    if output.status.success() {
        return Ok(output_path);
    }

    // Fallback: re-encode
    let mut cmd2 = TokioCommand::new(&ffmpeg);
    cmd2.args([
        "-y",
        "-ss",
        &format!("{start:.3}"),
        "-to",
        &format!("{end:.3}"),
        "-i",
        &input_path,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        &output_path,
    ]);
    #[cfg(target_os = "windows")]
    cmd2.creation_flags(0x08000000);

    let output2 = cmd2
        .output()
        .await
        .map_err(|e| AppError::ProcessSpawn(format!("ffmpeg re-encode trim failed: {e}")))?;

    if !output2.status.success() {
        let stderr = String::from_utf8_lossy(&output2.stderr);
        return Err(AppError::Internal(format!("ffmpeg error: {stderr}")));
    }
    Ok(output_path)
}

#[tauri::command]
pub async fn artist_cancel_export(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    MEDIA_EXPORT_JOBS.cancel(&app, &job_id)?;
    Ok(true)
}

// =============================================================================
// FFmpeg command builder + runner
// =============================================================================

async fn run_ffmpeg_export(
    app: &tauri::AppHandle,
    job_id: &str,
    ffmpeg_path: &Path,
    composition: &CompositionInput,
    output_path: &str,
) -> Result<(), AppError> {
    let args = build_ffmpeg_args(composition, output_path);

    MEDIA_EXPORT_JOBS.emit_line(app, job_id, format!("Running: ffmpeg {}", args.join(" ")));

    let mut cmd = tokio::process::Command::new(ffmpeg_path);
    cmd.args(&args)
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null());

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::ProcessSpawn(format!("Failed to spawn ffmpeg: {e}")))?;

    let stderr = child.stderr.take()
        .ok_or_else(|| AppError::Internal("No stderr from ffmpeg".into()))?;

    let mut reader = BufReader::new(stderr).lines();

    // Compute total duration for progress calculation
    let total_duration = compute_total_duration(composition);

    while let Ok(Some(line)) = reader.next_line().await {
        // Parse progress from ffmpeg stderr
        if let Some(time) = parse_ffmpeg_time(&line) {
            let progress = if total_duration > 0.0 {
                ((time / total_duration) * 100.0).min(100.0)
            } else {
                0.0
            };
            let _ = app.emit(
                event_name::MEDIA_EXPORT_PROGRESS,
                json!({ "job_id": job_id, "progress": progress, "time": time }),
            );
        }
        MEDIA_EXPORT_JOBS.emit_line(app, job_id, line);
    }

    let status = child.wait().await
        .map_err(|e| AppError::Internal(format!("ffmpeg process error: {e}")))?;

    if !status.success() {
        return Err(AppError::Internal(format!(
            "ffmpeg exited with code {}",
            status.code().unwrap_or(-1)
        )));
    }

    Ok(())
}

fn build_ffmpeg_args(composition: &CompositionInput, output_path: &str) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".into()]; // overwrite output
    let mut input_idx = 0usize;
    let mut input_map: HashMap<String, usize> = HashMap::new();

    // Collect video and audio inputs
    let video_clips: Vec<_> = composition.items.iter().filter_map(|item| {
        if let CompositionItem::Video { file_path, .. } = item { Some(file_path.clone()) } else { None }
    }).collect();

    let audio_clips: Vec<_> = composition.items.iter().filter_map(|item| {
        if let CompositionItem::Audio { file_path, .. } = item { Some(file_path.clone()) } else { None }
    }).collect();

    // Add video + audio input files (dedup by path)
    for path in video_clips.iter().chain(audio_clips.iter()) {
        if !input_map.contains_key(path) {
            args.push("-i".into());
            args.push(path.clone());
            input_map.insert(path.clone(), input_idx);
            input_idx += 1;
        }
    }

    // Background lavfi color source. Needed whenever there are no real video
    // clips — either because the composition is empty OR because the user has
    // only image/text overlays that still need something to composite onto.
    let has_video_clips = !video_clips.is_empty();
    let bg_input_idx: Option<usize> = if !has_video_clips {
        let idx = input_idx;
        args.extend_from_slice(&[
            "-f".into(),
            "lavfi".into(),
            "-i".into(),
            format!(
                "color=c={}:s={}x{}:d={:.3}:r={}",
                composition.background_color.replace('#', "0x"),
                composition.width,
                composition.height,
                compute_total_duration(composition).max(1.0),
                composition.fps,
            ),
        ]);
        input_idx += 1;
        Some(idx)
    } else {
        None
    };

    // Image inputs — each uses `-loop 1` so it produces an indefinite stream
    // for the overlay filter to composite. Image clips are NOT deduped because
    // `-loop 1` must apply per input and two clips could reuse the same file.
    let mut image_input_map: HashMap<usize, usize> = HashMap::new(); // item_idx → input_idx
    for (i, item) in composition.items.iter().enumerate() {
        if let CompositionItem::Image { file_path, .. } = item {
            args.push("-loop".into());
            args.push("1".into());
            args.push("-i".into());
            args.push(file_path.clone());
            image_input_map.insert(i, input_idx);
            input_idx += 1;
        }
    }

    // Build filter complex
    let mut filters: Vec<String> = Vec::new();
    let mut video_labels: Vec<String> = Vec::new();
    let mut audio_labels: Vec<String> = Vec::new();

    // Compute per-index effective fades that include the contribution of
    // the `transition` field. Both preview and export use the SAME rule:
    // any non-cut transition on clip[i] adds a fade-out of `transition_duration`
    // at the end of clip[i] and a fade-in of `transition_duration` at the
    // start of clip[i+1]. This is how the two sides stay in visual sync.
    let video_indices: Vec<usize> = composition
        .items
        .iter()
        .enumerate()
        .filter_map(|(i, it)| matches!(it, CompositionItem::Video { .. }).then_some(i))
        .collect();
    let transition_fade_in_from_prev = |current_idx: usize| -> f64 {
        let pos = video_indices.iter().position(|&x| x == current_idx);
        let Some(pos) = pos else { return 0.0 };
        if pos == 0 {
            return 0.0;
        }
        let prev = video_indices[pos - 1];
        if let Some(CompositionItem::Video { transition, transition_duration, .. }) =
            composition.items.get(prev)
        {
            if transition != "cut" && *transition_duration > 0.0 {
                return *transition_duration;
            }
        }
        0.0
    };

    // Speed interpretation (matches the live preview):
    //   `duration` is the OUTPUT length of the clip on the timeline.
    //   With speed=k, the clip consumes `duration * k` seconds of source
    //   material and compresses (or stretches) it to fit `duration` seconds
    //   of output via `setpts`/`atempo`. This way the timeline never lies
    //   about how long a clip occupies in the final render.
    for (i, item) in composition.items.iter().enumerate() {
        if let CompositionItem::Video {
            file_path, start_time, trim_start, duration,
            speed, fade_in, fade_out, strip_audio, transition, transition_duration, ..
        } = item {
            let Some(&idx) = input_map.get(file_path) else { continue };
            let safe_speed = if *speed <= 0.0 { 1.0 } else { *speed };
            let source_span = duration * safe_speed;
            let src_end = trim_start + source_span;
            let out_dur = *duration;
            let label = format!("v{i}");

            // Effective fades = user-set fade + transition contribution.
            // Outgoing transition on THIS clip → adds to fade_out.
            // Incoming transition from PREVIOUS video clip → adds to fade_in.
            let transition_out = if transition != "cut" && *transition_duration > 0.0 {
                *transition_duration
            } else {
                0.0
            };
            let eff_fade_in = (fade_in + transition_fade_in_from_prev(i)).min(out_dur);
            let eff_fade_out = (fade_out + transition_out).min(out_dur);

            let mut vfilters = vec![
                format!("trim=start={trim_start:.3}:end={src_end:.3}"),
                if (safe_speed - 1.0).abs() < 1e-4 {
                    "setpts=PTS-STARTPTS".to_string()
                } else {
                    format!("setpts=(PTS-STARTPTS)/{safe_speed}")
                },
            ];
            if eff_fade_in > 0.01 {
                vfilters.push(format!("fade=t=in:st=0:d={:.3}", eff_fade_in));
            }
            if eff_fade_out > 0.01 {
                let st = (out_dur - eff_fade_out).max(0.0);
                vfilters.push(format!("fade=t=out:st={st:.3}:d={:.3}", eff_fade_out));
            }
            filters.push(format!("[{idx}:v]{}[{label}]", vfilters.join(",")));
            video_labels.push(label);

            // Video-embedded audio track. For crossfade (both sides audible),
            // mirror the video fade at the audio level so the sound blends.
            // For fade_to_black we only fade the video to black and leave the
            // audio alone — that's closer to the visual convention.
            if !*strip_audio {
                let delay_ms = (start_time * 1000.0) as i64;
                let audio_fade_out = if transition == "crossfade" {
                    eff_fade_out
                } else {
                    fade_out.min(out_dur)
                };
                let audio_fade_in = if transition_fade_in_from_prev(i) > 0.0
                    && matches!(
                        composition
                            .items
                            .get(video_indices[video_indices.iter().position(|&x| x == i).unwrap_or(0)
                                .saturating_sub(1)]),
                        Some(CompositionItem::Video { transition, .. }) if transition == "crossfade"
                    )
                {
                    eff_fade_in
                } else {
                    fade_in.min(out_dur)
                };

                let mut afilters = vec![
                    format!("atrim=start={trim_start:.3}:end={src_end:.3}"),
                    "asetpts=PTS-STARTPTS".to_string(),
                ];
                if (safe_speed - 1.0).abs() > 1e-4 {
                    afilters.extend(atempo_chain(safe_speed));
                }
                if audio_fade_in > 0.01 {
                    afilters.push(format!("afade=t=in:st=0:d={:.3}", audio_fade_in));
                }
                if audio_fade_out > 0.01 {
                    let st = (out_dur - audio_fade_out).max(0.0);
                    afilters.push(format!("afade=t=out:st={st:.3}:d={:.3}", audio_fade_out));
                }
                if delay_ms > 0 {
                    afilters.push(format!("adelay={delay_ms}|{delay_ms}"));
                }
                let va_label = format!("va{i}");
                filters.push(format!(
                    "[{idx}:a?]{}[{va_label}]",
                    afilters.join(","),
                ));
                audio_labels.push(va_label);
            }
        }
    }

    // Dedicated audio clips
    for (i, item) in composition.items.iter().enumerate() {
        if let CompositionItem::Audio {
            file_path, start_time, trim_start, duration, volume,
            speed, fade_in, fade_out, normalize,
            measured_lufs, measured_lra, measured_true_peak, measured_threshold, ..
        } = item {
            let Some(&idx) = input_map.get(file_path) else { continue };
            let safe_speed = if *speed <= 0.0 { 1.0 } else { *speed };
            let source_span = duration * safe_speed;
            let src_end = trim_start + source_span;
            let out_dur = *duration;
            let delay_ms = (start_time * 1000.0) as i64;
            let label = format!("a{i}");

            let mut afilters = vec![
                format!("atrim=start={trim_start:.3}:end={src_end:.3}"),
                "asetpts=PTS-STARTPTS".to_string(),
            ];
            if (safe_speed - 1.0).abs() > 1e-4 {
                afilters.extend(atempo_chain(safe_speed));
            }
            if *normalize {
                // Use loudnorm's linear (two-pass) mode when we have a
                // measurement — this is bit-for-bit equivalent to what the
                // preview's Web Audio GainNode does.
                match (measured_lufs, measured_lra, measured_true_peak, measured_threshold) {
                    (Some(mi), Some(mlra), Some(mtp), Some(mthr)) => {
                        afilters.push(format!(
                            "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={mi:.2}:measured_LRA={mlra:.2}:measured_TP={mtp:.2}:measured_thresh={mthr:.2}:offset=0:linear=true"
                        ));
                    }
                    _ => {
                        afilters.push("loudnorm=I=-16:TP=-1.5:LRA=11".to_string());
                    }
                }
            }
            if *fade_in > 0.01 {
                afilters.push(format!("afade=t=in:st=0:d={:.3}", fade_in.min(out_dur)));
            }
            if *fade_out > 0.01 {
                let st = (out_dur - fade_out).max(0.0);
                afilters.push(format!("afade=t=out:st={st:.3}:d={:.3}", fade_out.min(out_dur)));
            }
            if delay_ms > 0 {
                afilters.push(format!("adelay={delay_ms}|{delay_ms}"));
            }
            afilters.push(format!("volume={volume:.2}"));

            filters.push(format!("[{idx}:a]{}[{label}]", afilters.join(",")));
            audio_labels.push(label);
        }
    }

    // Concat video labels into a single base (still just concatenation —
    // true temporal crossfade is future work, see docs/concepts/media-studio-architecture.md).
    let mut base_video_label: Option<String> = if video_labels.len() > 1 {
        let inputs: String = video_labels.iter().map(|l| format!("[{l}]")).collect();
        filters.push(format!(
            "{inputs}concat=n={}:v=1:a=0[vconcat]",
            video_labels.len()
        ));
        Some("vconcat".to_string())
    } else if video_labels.len() == 1 {
        Some(video_labels[0].clone())
    } else {
        // Use the lavfi background directly as the base video stream.
        bg_input_idx.map(|idx| format!("{idx}:v"))
    };

    // --- Image overlays --------------------------------------------------
    // For each image clip, build `[idx:v]format=rgba,scale,fade[img_N]` and
    // then chain `[base][img_N]overlay=...[next_base]` against the current
    // base video label. Position is centered on `(posX, posY)` as a fraction
    // of the main frame — matches the preview's `translate(-50%, -50%)`.
    let mut overlay_counter = 0usize;
    for (i, item) in composition.items.iter().enumerate() {
        let CompositionItem::Image {
            start_time,
            duration,
            position_x,
            position_y,
            scale,
            fade_in,
            fade_out,
            ..
        } = item
        else {
            continue;
        };
        let Some(img_input_idx) = image_input_map.get(&i).copied() else { continue };
        let Some(current_base) = base_video_label.clone() else { continue };

        let out_dur = *duration;
        let end_time = start_time + duration;
        // Fit within a 40% × 40% box of the output, multiplied by user scale.
        let target_w = (composition.width as f64 * 0.4 * scale).round().max(1.0) as i64;
        let target_h = (composition.height as f64 * 0.4 * scale).round().max(1.0) as i64;

        let img_label = format!("img{overlay_counter}");
        let mut img_filters = vec![
            "format=rgba".to_string(),
            format!("scale={target_w}:{target_h}:force_original_aspect_ratio=decrease"),
        ];
        // Image stream time starts at 0 and is independent of the main stream,
        // so fade stages must be expressed relative to the IMAGE's own timeline
        // — i.e. use `0` and `out_dur - fade_out` rather than `start_time`.
        if *fade_in > 0.01 {
            img_filters.push(format!(
                "fade=t=in:alpha=1:st=0:d={:.3}",
                fade_in.min(out_dur)
            ));
        }
        if *fade_out > 0.01 {
            let fo_st = (out_dur - fade_out).max(0.0);
            img_filters.push(format!(
                "fade=t=out:alpha=1:st={fo_st:.3}:d={:.3}",
                fade_out.min(out_dur)
            ));
        }
        filters.push(format!(
            "[{img_input_idx}:v]{}[{img_label}]",
            img_filters.join(",")
        ));

        let next_label = format!("vo{overlay_counter}");
        // Overlay position: centered on main frame, enabled for the clip's
        // time window, and `shortest=0` so we don't truncate the base stream.
        filters.push(format!(
            "[{current_base}][{img_label}]overlay=x='main_w*{position_x:.4}-overlay_w/2':y='main_h*{position_y:.4}-overlay_h/2':enable='between(t,{start_time:.3},{end_time:.3})'[{next_label}]"
        ));
        base_video_label = Some(next_label);
        overlay_counter += 1;
    }

    // --- Text overlays (drawtext) ----------------------------------------
    // `drawtext` needs a concrete TTF path. If none is available (rare on
    // desktops), we log a warning and skip text rendering; the preview DOM
    // text still shows on screen.
    let font_path = resolve_system_font();
    for item in composition.items.iter() {
        let CompositionItem::Text {
            label,
            text: _,
            start_time,
            duration,
            font_size,
            color,
            position_x,
            position_y,
            fade_in,
            fade_out,
        } = item
        else {
            continue;
        };
        let Some(current_base) = base_video_label.clone() else { continue };
        let Some(font) = font_path.as_ref() else { continue };
        let end_time = start_time + duration;

        let escaped_label = escape_drawtext(label);
        let fontcolor = if let Some(hex) = color.strip_prefix('#') {
            format!("0x{hex}")
        } else {
            color.clone()
        };

        // Alpha fade expression — product of fade-in and fade-out ramps.
        // `enable` gates rendering outside the clip window, so we only need
        // to ramp inside it. If neither fade is set, we omit the alpha.
        let alpha_expr = match (*fade_in > 0.01, *fade_out > 0.01) {
            (true, true) => Some(format!(
                "min(1\\,max(0\\,(t-{st:.3})/{fi:.3}))*min(1\\,max(0\\,({et:.3}-t)/{fo:.3}))",
                st = start_time, fi = fade_in, et = end_time, fo = fade_out,
            )),
            (true, false) => Some(format!(
                "min(1\\,max(0\\,(t-{st:.3})/{fi:.3}))",
                st = start_time, fi = fade_in,
            )),
            (false, true) => Some(format!(
                "min(1\\,max(0\\,({et:.3}-t)/{fo:.3}))",
                et = end_time, fo = fade_out,
            )),
            (false, false) => None,
        };

        let mut drawtext_parts = vec![
            format!("fontfile='{font}'"),
            format!("text='{escaped_label}'"),
            format!("fontsize={font_size}"),
            format!("fontcolor={fontcolor}"),
            format!("x=(w*{position_x:.4})-(text_w/2)"),
            format!("y=(h*{position_y:.4})-(text_h/2)"),
            format!("enable='between(t,{start_time:.3},{end_time:.3})'"),
            // A subtle shadow so text stays legible on any background,
            // matching the CSS drop-shadow in the preview.
            "shadowcolor=black@0.7".to_string(),
            "shadowx=2".to_string(),
            "shadowy=2".to_string(),
        ];
        if let Some(expr) = alpha_expr {
            drawtext_parts.push(format!("alpha='{expr}'"));
        }

        let next_label = format!("vt{overlay_counter}");
        filters.push(format!(
            "[{current_base}]drawtext={}[{next_label}]",
            drawtext_parts.join(":")
        ));
        base_video_label = Some(next_label);
        overlay_counter += 1;
    }

    // Mix audio labels
    if audio_labels.len() > 1 {
        let inputs: String = audio_labels.iter().map(|l| format!("[{l}]")).collect();
        filters.push(format!(
            "{inputs}amix=inputs={}:duration=longest[amixed]",
            audio_labels.len()
        ));
        audio_labels = vec!["amixed".into()];
    }

    // Apply filter_complex if we have any filters
    if !filters.is_empty() {
        args.push("-filter_complex".into());
        args.push(filters.join(";"));
    }

    // Map video output
    if let Some(vl) = &base_video_label {
        args.push("-map".into());
        // If it looks like `N:v` use directly; otherwise wrap in [].
        if vl.contains(':') {
            args.push(vl.clone());
        } else {
            args.push(format!("[{vl}]"));
        }
    } else if !input_map.is_empty() {
        args.push("-map".into());
        args.push("0:v?".into());
    }

    if let Some(al) = audio_labels.first() {
        args.push("-map".into());
        args.push(format!("[{al}]"));
    }

    // Output settings
    args.extend_from_slice(&[
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "medium".into(),
        "-crf".into(), "23".into(),
        "-c:a".into(), "aac".into(),
        "-b:a".into(), "192k".into(),
        "-movflags".into(), "+faststart".into(),
        "-r".into(), composition.fps.to_string(),
        "-s".into(), format!("{}x{}", composition.width, composition.height),
    ]);

    args.push(output_path.into());
    args
}

/// `atempo` only accepts factors in [0.5, 2.0]. For values outside the range,
/// chain multiple atempo stages so the product equals `speed`.
fn atempo_chain(speed: f64) -> Vec<String> {
    let mut remaining = speed;
    let mut out = Vec::new();
    while remaining > 2.0 {
        out.push("atempo=2.0".to_string());
        remaining /= 2.0;
    }
    while remaining < 0.5 {
        out.push("atempo=0.5".to_string());
        remaining /= 0.5;
    }
    out.push(format!("atempo={remaining:.4}"));
    out
}

fn compute_total_duration(composition: &CompositionInput) -> f64 {
    composition
        .items
        .iter()
        .map(|item| match item {
            CompositionItem::Video { start_time, duration, .. } => start_time + duration,
            CompositionItem::Audio { start_time, duration, .. } => start_time + duration,
            CompositionItem::Text { start_time, duration, .. } => start_time + duration,
            CompositionItem::Image { start_time, duration, .. } => start_time + duration,
        })
        .fold(0.0f64, f64::max)
}

/// Parse ffmpeg's progress line: `time=HH:MM:SS.ms` → seconds
fn parse_ffmpeg_time(line: &str) -> Option<f64> {
    let time_prefix = "time=";
    let idx = line.find(time_prefix)?;
    let rest = &line[idx + time_prefix.len()..];
    let time_str = rest.split_whitespace().next()?;
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = parts[2].parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}
