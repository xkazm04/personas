//! FFmpeg integration for Media Studio — detection, media probing, and export.
//!
//! Follows the `BackgroundJobManager` pattern from task_executor.rs:
//! spawns ffmpeg process, parses stderr for progress, emits Tauri events.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
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
    },
    #[serde(rename = "audio")]
    Audio {
        file_path: String,
        start_time: f64,
        duration: f64,
        trim_start: f64,
        trim_end: f64,
        volume: f64,
    },
    #[serde(rename = "text")]
    Text {
        word: String,
        start_time: f64,
        duration: f64,
        font_size: i32,
        color: String,
        #[serde(default)]
        position: Position,
    },
    #[serde(rename = "image")]
    Image {
        file_path: String,
        start_time: f64,
        duration: f64,
        #[serde(default)]
        position: Position,
        #[serde(default = "default_scale")]
        scale: f64,
    },
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

fn default_scale() -> f64 {
    1.0
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

fn find_ffmpeg_path() -> Option<PathBuf> {
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
        let candidates = [
            "/usr/local/bin/ffmpeg",
            "/opt/homebrew/bin/ffmpeg",
        ];
        for c in &candidates {
            let p = PathBuf::from(c);
            if p.exists() {
                return Some(p);
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("which").arg("ffmpeg").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(PathBuf::from(path));
                }
            }
        }
    }
    // Fallback: try PATH
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-version");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    if let Ok(output) = cmd.output() {
        if output.status.success() {
            return Some(PathBuf::from("ffmpeg"));
        }
    }
    None
}

fn get_ffmpeg_version(ffmpeg_path: &Path) -> Result<String, AppError> {
    let mut cmd = Command::new(ffmpeg_path);
    cmd.arg("-version");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd
        .output()
        .map_err(|e| AppError::ProcessSpawn(e.to_string()))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    // First line: "ffmpeg version N.N.N ..."
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
pub fn artist_check_ffmpeg() -> Result<FfmpegStatus, AppError> {
    let path = find_ffmpeg_path();
    match &path {
        Some(p) => {
            let version = get_ffmpeg_version(p).ok();
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
pub fn artist_probe_media(file_path: String) -> Result<MediaProbeResult, AppError> {
    let ffprobe_path = find_ffprobe_path()
        .ok_or_else(|| AppError::NotFound("ffprobe not found (install ffmpeg)".into()))?;

    let mut cmd = Command::new(&ffprobe_path);
    cmd.args([
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        &file_path,
    ]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .output()
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

fn find_ffprobe_path() -> Option<PathBuf> {
    // ffprobe is co-located with ffmpeg
    if let Some(ffmpeg) = find_ffmpeg_path() {
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

        MEDIA_EXPORT_JOBS.remove(&job_id_clone);
    });

    Ok(json!({ "job_id": job_id }))
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

    // Add input files
    for path in video_clips.iter().chain(audio_clips.iter()) {
        if !input_map.contains_key(path) {
            args.push("-i".into());
            args.push(path.clone());
            input_map.insert(path.clone(), input_idx);
            input_idx += 1;
        }
    }

    // If no inputs, create a blank video from color
    if input_map.is_empty() {
        args.extend_from_slice(&[
            "-f".into(), "lavfi".into(),
            "-i".into(), format!(
                "color=c={}:s={}x{}:d={:.1}:r={}",
                composition.background_color.replace('#', "0x"),
                composition.width, composition.height,
                compute_total_duration(composition),
                composition.fps,
            ),
        ]);
    }

    // Build filter complex
    let mut filters: Vec<String> = Vec::new();
    let mut video_labels: Vec<String> = Vec::new();
    let mut audio_labels: Vec<String> = Vec::new();

    // Video clips: trim and label
    for (i, item) in composition.items.iter().enumerate() {
        if let CompositionItem::Video { file_path, trim_start, trim_end: _, duration, .. } = item {
            if let Some(&idx) = input_map.get(file_path) {
                let end = trim_start + duration;
                let label = format!("v{i}");
                filters.push(format!(
                    "[{idx}:v]trim=start={trim_start:.3}:end={end:.3},setpts=PTS-STARTPTS[{label}]"
                ));
                video_labels.push(label);
            }
        }
    }

    // Audio clips: trim, volume, and delay
    for (i, item) in composition.items.iter().enumerate() {
        if let CompositionItem::Audio { file_path, start_time, trim_start, duration, volume, .. } = item {
            if let Some(&idx) = input_map.get(file_path) {
                let end = trim_start + duration;
                let delay_ms = (start_time * 1000.0) as i64;
                let label = format!("a{i}");
                filters.push(format!(
                    "[{idx}:a]atrim=start={trim_start:.3}:end={end:.3},asetpts=PTS-STARTPTS,adelay={delay_ms}|{delay_ms},volume={volume:.2}[{label}]"
                ));
                audio_labels.push(label);
            }
        }
    }

    // Concat video labels (simple sequential for Phase 1)
    if video_labels.len() > 1 {
        let inputs: String = video_labels.iter().map(|l| format!("[{l}]")).collect();
        filters.push(format!(
            "{inputs}concat=n={}:v=1:a=0[vconcat]",
            video_labels.len()
        ));
        video_labels = vec!["vconcat".into()];
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

    // Map outputs
    if let Some(vl) = video_labels.first() {
        args.push("-map".into());
        args.push(format!("[{vl}]"));
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
