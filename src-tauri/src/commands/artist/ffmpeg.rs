//! FFmpeg integration for Media Studio — detection, media probing, and export.
//!
//! Follows the `BackgroundJobManager` pattern from task_executor.rs:
//! spawns ffmpeg process, parses stderr for progress, emits Tauri events.

use std::collections::{HashMap, HashSet};
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
use crate::engine::render_plan::compile::{
    CompileDeps as RpCompileDeps, CompileOptions as RpCompileOptions, Composition as RpComposition,
};
use crate::engine::render_plan::{
    compile as render_plan_compile, AudioStage, OverlayStage, RenderPlan, SourceEntry, VideoStage,
};
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

/// Compile a Composition JSON blob to a RenderPlan IR.
///
/// Exposed so the browser preview can share the Rust compiler instead of
/// maintaining a parallel TypeScript port. Pure function — no I/O — so it
/// needs no auth guard. Preview mode uses Fold + frame-snap + !for_export;
/// export still calls `render_plan::compile` directly in its own command.
#[tauri::command]
pub async fn artist_compile_render_plan(
    composition_json: String,
) -> Result<RenderPlan, AppError> {
    let composition: RpComposition = serde_json::from_str(&composition_json)
        .map_err(|e| AppError::Validation(format!("Invalid composition: {e}")))?;

    render_plan_compile(
        &composition,
        &RpCompileOptions::fold_default(),
        &RpCompileDeps::none(),
    )
    .map_err(|e| AppError::Validation(format!("Composition compile failed: {e}")))
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

    let composition: RpComposition = serde_json::from_str(&composition_json)
        .map_err(|e| AppError::Validation(format!("Invalid composition: {e}")))?;

    // Compile to the RenderPlan IR; both the export pipeline and (eventually,
    // in PR-3) the preview consume the plan instead of the Composition.
    let plan = render_plan_compile(
        &composition,
        &RpCompileOptions::for_export_default(),
        &RpCompileDeps::none(),
    )
    .map_err(|e| AppError::Validation(format!("Composition compile failed: {e}")))?;

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
                &plan,
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
    plan: &RenderPlan,
    output_path: &str,
) -> Result<(), AppError> {
    let args = build_ffmpeg_args(plan, Path::new(output_path));

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

    let total_duration = plan.duration_seconds;

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

// =============================================================================
// FFmpeg args from RenderPlan (PR-2)
// =============================================================================
//
// This function consumes ONLY the RenderPlan — never the Composition.
// Every composition-level decision (transition folding, speed clamping,
// fade combination, source dedup, frame snap) has already been resolved
// by `render_plan::compile`. The builder below is a flat translation from
// stages to ffmpeg filter graph notation.

pub fn build_ffmpeg_args(plan: &RenderPlan, output_path: &Path) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".into()]; // overwrite output

    // ---- Step 1: source → ffmpeg input index map ----
    //
    // Sources come in this order:
    //   slot 0           — reserved Color (never an `-i`)
    //   slot 1..N        — File/Proxy sources referenced by video/audio stages
    //                      AND by image overlays. We distinguish them at build
    //                      time by scanning overlays, so image sources get
    //                      `-loop 1` and media sources do not.
    //
    // When the plan has no video stages, we synthesise a lavfi color background
    // as an extra input — matches the previous behavior of filling the frame
    // with the composition's background when it's audio/overlay-only.

    // Which source ids are referenced as image overlays?
    let image_source_ids: HashSet<u32> = plan
        .overlays
        .iter()
        .filter_map(|o| match o {
            OverlayStage::Image(i) => Some(i.source_id),
        })
        .collect();

    let mut source_input_idx: HashMap<u32, usize> = HashMap::new();
    let mut input_idx = 0usize;

    // Non-image media sources first (slot 1 onward, skipping Color slot 0).
    for source in plan.sources.iter() {
        let id = source.id();
        match source {
            SourceEntry::Color { .. } => continue,
            SourceEntry::File { path, .. } | SourceEntry::Proxy { path, .. } => {
                if image_source_ids.contains(&id) {
                    // Deferred to the image-input pass below so `-loop 1`
                    // can be applied per-input (images need it, media don't).
                    continue;
                }
                args.push("-i".into());
                args.push(path.clone());
                source_input_idx.insert(id, input_idx);
                input_idx += 1;
            }
        }
    }

    // Synthetic lavfi background when no video stages exist — reserves its
    // own input slot and feeds the filter graph as the base video stream.
    let bg_hex = bg_source_hex(plan);
    let bg_input_idx: Option<usize> = if plan.video_track.is_empty() {
        let duration = plan.duration_seconds.max(1.0);
        args.extend_from_slice(&[
            "-f".into(),
            "lavfi".into(),
            "-i".into(),
            format!(
                "color=c={}:s={}x{}:d={:.3}:r={}",
                bg_hex.replace('#', "0x"),
                plan.width,
                plan.height,
                duration,
                plan.fps,
            ),
        ]);
        let idx = input_idx;
        input_idx += 1;
        Some(idx)
    } else {
        None
    };

    // Image overlay sources — each gets a distinct `-loop 1 -i <path>` input.
    // Image clips are NOT deduped across overlays because `-loop 1` is a
    // per-input directive, and the old implementation emitted them
    // sequentially; we preserve that ordering for byte-parity.
    let mut image_input_idx: HashMap<String, usize> = HashMap::new();
    for overlay in plan.overlays.iter() {
        if let OverlayStage::Image(img) = overlay {
            let Some(source) = plan.sources.iter().find(|s| s.id() == img.source_id) else {
                continue;
            };
            let path = match source {
                SourceEntry::File { path, .. } | SourceEntry::Proxy { path, .. } => path.clone(),
                SourceEntry::Color { .. } => continue,
            };
            args.push("-loop".into());
            args.push("1".into());
            args.push("-i".into());
            args.push(path);
            image_input_idx.insert(img.id.clone(), input_idx);
            input_idx += 1;
        }
    }

    // ---- Step 2: filter_complex ----
    let mut filters: Vec<String> = Vec::new();
    let mut video_labels: Vec<String> = Vec::new();
    let mut audio_labels: Vec<String> = Vec::new();

    // Video stages.
    for (i, stage) in plan.video_track.iter().enumerate() {
        let Some(&idx) = source_input_idx.get(&stage.source_id) else {
            continue;
        };
        let label = format!("v{i}");
        filters.push(build_video_stage_filter(idx, &label, stage));
        video_labels.push(label);
    }

    // Audio stages (both dedicated tracks and the implicit 'embedded' track).
    //
    // Each audio stage becomes a single filter chain. Labels are `a<N>` where
    // N is the emission ordinal. The old implementation labelled video-
    // embedded audio as `va<item_idx>` and dedicated audio as `a<item_idx>`;
    // the labels were never observable since everything is immediately mixed
    // via `amix`. The IR uses a uniform `a<N>` naming — graph semantics are
    // identical.
    let mut audio_ord = 0usize;
    for track in plan.audio_tracks.iter() {
        for stage in track.stages.iter() {
            let Some(&idx) = source_input_idx.get(&stage.source_id) else {
                continue;
            };
            let label = format!("a{audio_ord}");
            audio_ord += 1;
            filters.push(build_audio_stage_filter(idx, &label, stage));
            audio_labels.push(label);
        }
    }

    // ---- Step 3: concat / xfade the video track ----
    //
    // Under `TransitionMode::Fold` (what `for_export_default()` uses today)
    // every video stage has `overlap_next == None` and we emit a simple
    // `concat=n=N:v=1:a=0` pass. When any stage carries `overlap_next` we
    // emit a cascading `xfade` chain instead — one xfade filter per pair.
    let has_overlap = plan.video_track.iter().any(|s| s.overlap_next.is_some());
    let mut base_video_label: Option<String> = if has_overlap && plan.video_track.len() >= 2 {
        Some(build_xfade_chain(&plan.video_track, &video_labels, &mut filters))
    } else if video_labels.len() >= 2 {
        let inputs: String = video_labels.iter().map(|l| format!("[{l}]")).collect();
        filters.push(format!(
            "{inputs}concat=n={}:v=1:a=0[vconcat]",
            video_labels.len()
        ));
        Some("vconcat".to_string())
    } else if video_labels.len() == 1 {
        Some(video_labels[0].clone())
    } else {
        bg_input_idx.map(|idx| format!("{idx}:v"))
    };

    // ---- Step 4: image overlays ----
    let mut overlay_counter = 0usize;
    for overlay in plan.overlays.iter() {
        let OverlayStage::Image(img) = overlay else {
            continue;
        };
        let Some(&img_idx) = image_input_idx.get(&img.id) else {
            continue;
        };
        let Some(current_base) = base_video_label.clone() else {
            continue;
        };

        let out_dur = img.output_end - img.output_start;
        // Preserve the old 40%-of-frame box semantics so scale=1.0 still
        // renders identically. See architecture doc §Image overlay.
        let target_w = (plan.width as f64 * 0.4 * img.scale).round().max(1.0) as i64;
        let target_h = (plan.height as f64 * 0.4 * img.scale).round().max(1.0) as i64;

        let img_label = format!("img{overlay_counter}");
        let mut img_filters = vec![
            "format=rgba".to_string(),
            format!("scale={target_w}:{target_h}:force_original_aspect_ratio=decrease"),
        ];
        if img.fade_in > 0.01 {
            img_filters.push(format!(
                "fade=t=in:alpha=1:st=0:d={:.3}",
                img.fade_in.min(out_dur)
            ));
        }
        if img.fade_out > 0.01 {
            let fo_st = (out_dur - img.fade_out).max(0.0);
            img_filters.push(format!(
                "fade=t=out:alpha=1:st={fo_st:.3}:d={:.3}",
                img.fade_out.min(out_dur)
            ));
        }
        filters.push(format!(
            "[{img_idx}:v]{}[{img_label}]",
            img_filters.join(",")
        ));

        let next_label = format!("vo{overlay_counter}");
        filters.push(format!(
            "[{current_base}][{img_label}]overlay=x='main_w*{px:.4}-overlay_w/2':y='main_h*{py:.4}-overlay_h/2':enable='between(t,{st:.3},{et:.3})'[{next_label}]",
            px = img.position_x,
            py = img.position_y,
            st = img.output_start,
            et = img.output_end,
        ));
        base_video_label = Some(next_label);
        overlay_counter += 1;
    }

    // ---- Step 5: audio mix ----
    //
    // Text overlays no longer render — Text items in the Composition are
    // beats (timeline milestones) and never become OverlayStage::Text.
    // `drawtext` emission was removed alongside the IR's Text overlay
    // variant.
    if audio_labels.len() > 1 {
        let inputs: String = audio_labels.iter().map(|l| format!("[{l}]")).collect();
        filters.push(format!(
            "{inputs}amix=inputs={}:duration=longest[amixed]",
            audio_labels.len()
        ));
        audio_labels = vec!["amixed".into()];
    }

    // ---- Step 7: assemble args ----
    if !filters.is_empty() {
        args.push("-filter_complex".into());
        args.push(filters.join(";"));
    }

    if let Some(vl) = &base_video_label {
        args.push("-map".into());
        // lavfi-style `N:v` labels stay bare; filter_complex labels get wrapped.
        if vl.contains(':') {
            args.push(vl.clone());
        } else {
            args.push(format!("[{vl}]"));
        }
    } else if !source_input_idx.is_empty() {
        args.push("-map".into());
        args.push("0:v?".into());
    }

    if let Some(al) = audio_labels.first() {
        args.push("-map".into());
        args.push(format!("[{al}]"));
    }

    args.extend_from_slice(&[
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "medium".into(),
        "-crf".into(), "23".into(),
        "-c:a".into(), "aac".into(),
        "-b:a".into(), "192k".into(),
        "-movflags".into(), "+faststart".into(),
        "-r".into(), plan.fps.to_string(),
        "-s".into(), format!("{}x{}", plan.width, plan.height),
    ]);

    args.push(output_path.to_string_lossy().into_owned());
    args
}

fn build_video_stage_filter(input_idx: usize, label: &str, stage: &VideoStage) -> String {
    let mut vf = vec![
        format!(
            "trim=start={si:.3}:end={se:.3}",
            si = stage.source_in,
            se = stage.source_end
        ),
        if (stage.speed - 1.0).abs() < 1e-4 {
            "setpts=PTS-STARTPTS".to_string()
        } else {
            format!("setpts=(PTS-STARTPTS)/{}", stage.speed)
        },
    ];
    let out_dur = stage.output_end - stage.output_start;
    if stage.fade_in > 0.01 {
        vf.push(format!("fade=t=in:st=0:d={:.3}", stage.fade_in.min(out_dur)));
    }
    if stage.fade_out > 0.01 {
        let st = (out_dur - stage.fade_out).max(0.0);
        vf.push(format!(
            "fade=t=out:st={st:.3}:d={:.3}",
            stage.fade_out.min(out_dur)
        ));
    }
    format!("[{input_idx}:v]{}[{label}]", vf.join(","))
}

fn build_audio_stage_filter(input_idx: usize, label: &str, stage: &AudioStage) -> String {
    let out_dur = stage.output_end - stage.output_start;
    let delay_ms = (stage.output_start * 1000.0) as i64;
    let mut af = vec![
        format!(
            "atrim=start={si:.3}:end={se:.3}",
            si = stage.source_in,
            se = stage.source_end
        ),
        "asetpts=PTS-STARTPTS".to_string(),
    ];
    if (stage.speed - 1.0).abs() > 1e-4 {
        af.extend(atempo_chain(stage.speed));
    }
    if let Some(n) = &stage.normalize {
        // Two-pass loudnorm in linear mode — exact gain match with preview's
        // GainNode. Uses the same TP/LRA presets as the preview measurement.
        af.push(format!(
            "loudnorm=I={target:.0}:TP=-1.5:LRA=11:measured_I={mi:.2}:measured_LRA={mlra:.2}:measured_TP={mtp:.2}:measured_thresh={mthr:.2}:offset=0:linear=true",
            target = n.target_lufs,
            mi = n.measurements.integrated_lufs,
            mlra = n.measurements.lra,
            mtp = n.measurements.true_peak_dbfs,
            mthr = n.measurements.threshold,
        ));
    }
    if stage.fade_in > 0.01 {
        af.push(format!(
            "afade=t=in:st=0:d={:.3}",
            stage.fade_in.min(out_dur)
        ));
    }
    if stage.fade_out > 0.01 {
        let st = (out_dur - stage.fade_out).max(0.0);
        af.push(format!(
            "afade=t=out:st={st:.3}:d={:.3}",
            stage.fade_out.min(out_dur)
        ));
    }
    if delay_ms > 0 {
        af.push(format!("adelay={delay_ms}|{delay_ms}"));
    }
    // volume applied last, matching the old implementation's ordering.
    if (stage.linear_gain - 1.0).abs() > 1e-4 {
        af.push(format!("volume={:.2}", stage.linear_gain));
    }
    // `[idx:a?]` makes the audio stream optional so video files without an
    // audio track don't fail the graph (embedded audio case).
    format!("[{input_idx}:a?]{}[{label}]", af.join(","))
}

/// Build a cascading `xfade` chain across consecutive video stages whose
/// predecessors carry `overlap_next`. Emits filters into `filters` and
/// returns the final label name.
fn build_xfade_chain(
    stages: &[VideoStage],
    labels: &[String],
    filters: &mut Vec<String>,
) -> String {
    debug_assert_eq!(stages.len(), labels.len());
    let mut current = labels[0].clone();
    // Cumulative output offset so each xfade's `offset` parameter sits at
    // the right boundary in the CURRENT running stream.
    let mut running_end = stages[0].output_end;
    for i in 1..stages.len() {
        let prev = &stages[i - 1];
        let cur_label = labels[i].clone();
        let merged = format!("vx{i}");
        let (xtype, duration) = match &prev.overlap_next {
            Some(o) => (
                match o.kind {
                    crate::engine::render_plan::OverlapKind::Crossfade => "fade",
                    crate::engine::render_plan::OverlapKind::FadeToBlack => "fadeblack",
                },
                o.duration_seconds,
            ),
            None => ("fade", 0.0),
        };
        let offset = (running_end - duration).max(0.0);
        filters.push(format!(
            "[{current}][{cur_label}]xfade=transition={xtype}:duration={duration:.3}:offset={offset:.3}[{merged}]"
        ));
        current = merged;
        running_end = running_end - duration + (stages[i].output_end - stages[i].output_start);
    }
    current
}

/// Extract the background color from the reserved Color source at slot 0.
/// Falls back to black if the invariant has been violated.
fn bg_source_hex(plan: &RenderPlan) -> String {
    plan.sources
        .first()
        .and_then(|s| match s {
            SourceEntry::Color { hex, .. } => Some(hex.clone()),
            _ => None,
        })
        .unwrap_or_else(|| plan.background_color.clone())
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
