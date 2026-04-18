//! The RenderPlan compiler.
//!
//! Single entry point `compile(&Composition, &CompileOptions, &CompileDeps) -> Result<RenderPlan, CompileError>`.
//! Pure — no I/O except through `CompileDeps` callbacks (proxy lookup, font
//! probe). Given identical inputs the output is bit-identical.

use serde::Deserialize;

use super::{
    AudioStage, AudioTrack, CompileWarning, ImageOverlayStage, LoudnormMeasurements,
    NormalizeDirective, OverlapKind, OverlapNext, OverlayStage, RenderPlan, SourceEntry,
    TextOverlayStage, VideoStage, RENDER_PLAN_SCHEMA_VERSION,
};
use super::invariants::assert_invariants;

// =============================================================================
// Composition input types
// =============================================================================
//
// These are the frontend-authored shape. Kept deserialize-only so the UI
// remains the single source of truth for the authoring format. They mirror
// `src/features/plugins/artist/sub_media_studio/types.ts`.

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Composition {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub background_color: String,
    pub items: Vec<TimelineItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum TimelineItem {
    #[serde(rename = "video")]
    Video(VideoClipInput),
    #[serde(rename = "audio")]
    Audio(AudioClipInput),
    #[serde(rename = "text")]
    Text(TextItemInput),
    #[serde(rename = "image")]
    Image(ImageItemInput),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoClipInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    pub file_path: String,
    pub start_time: f64,
    pub duration: f64,
    #[serde(default)]
    pub trim_start: f64,
    #[serde(default)]
    pub trim_end: f64,
    #[serde(default)]
    pub media_duration: Option<f64>,
    #[serde(default)]
    pub transition: Option<String>,
    #[serde(default)]
    pub transition_duration: f64,
    #[serde(default)]
    pub speed: Option<f64>,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    #[serde(default)]
    pub strip_audio: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioClipInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    pub file_path: String,
    pub start_time: f64,
    pub duration: f64,
    #[serde(default)]
    pub trim_start: f64,
    #[serde(default)]
    pub trim_end: f64,
    #[serde(default)]
    pub media_duration: Option<f64>,
    #[serde(default = "default_one")]
    pub volume: f64,
    #[serde(default)]
    pub speed: Option<f64>,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    #[serde(default)]
    pub normalize: bool,
    #[serde(default)]
    pub measured_lufs: Option<f64>,
    #[serde(default)]
    pub measured_lra: Option<f64>,
    #[serde(default)]
    pub measured_true_peak: Option<f64>,
    #[serde(default)]
    pub measured_threshold: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextItemInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    pub start_time: f64,
    pub duration: f64,
    #[serde(default)]
    pub text: String,
    #[serde(default = "default_font_size")]
    pub font_size: f64,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default = "default_half")]
    pub position_x: f64,
    #[serde(default = "default_half")]
    pub position_y: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageItemInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    pub file_path: String,
    pub start_time: f64,
    pub duration: f64,
    #[serde(default = "default_half")]
    pub position_x: f64,
    #[serde(default = "default_half")]
    pub position_y: f64,
    #[serde(default = "default_one")]
    pub scale: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
}

fn default_one() -> f64 { 1.0 }
fn default_half() -> f64 { 0.5 }
fn default_font_size() -> f64 { 32.0 }
fn default_color() -> String { "#ffffff".to_string() }

// =============================================================================
// CompileOptions / CompileDeps / CompileError
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionMode {
    /// Today's behavior. Transitions collapse into each stage's fades;
    /// stages are strictly sequential; totalDuration = max(stage.outputEnd).
    Fold,
    /// True xfade. Stage[i] and stage[i+1] overlap by transitionDuration;
    /// totalDuration subtracts every overlap.
    Overlap,
}

#[derive(Debug, Clone)]
pub struct CompileOptions {
    pub transition_mode: TransitionMode,
    /// Snap every stage boundary (and overlap length) to `1/fps` so the
    /// preview never shows a frame that wouldn't exist in the export.
    pub frame_snap: bool,
    /// True when this plan will feed the export pipeline. Compiler prefers
    /// FileSource over ProxySource in that case.
    pub for_export: bool,
}

impl CompileOptions {
    pub fn fold_default() -> Self {
        Self { transition_mode: TransitionMode::Fold, frame_snap: true, for_export: false }
    }
    pub fn overlap_default() -> Self {
        Self { transition_mode: TransitionMode::Overlap, frame_snap: true, for_export: false }
    }
    pub fn for_export_default() -> Self {
        Self { transition_mode: TransitionMode::Fold, frame_snap: true, for_export: true }
    }
}

/// Reference to a proxy file the compiler may substitute for an original path.
#[derive(Debug, Clone)]
pub struct ProxyRef {
    pub proxy_path: String,
    pub media_duration_seconds: f64,
    pub has_audio: bool,
    pub has_video: bool,
}

/// Compiler dependencies. All callbacks are optional; None means the
/// compiler falls back to conservative behavior (no proxies, only bundled
/// fonts assumed available).
pub struct CompileDeps<'a> {
    /// None => no proxies. Returns Some(ProxyRef) when a proxy exists on disk
    /// for the given original path.
    pub proxy_lookup: Option<&'a dyn Fn(&str) -> Option<ProxyRef>>,

    /// None => assume only the bundled font is available.
    /// Some(f) => f(familyName) returns true if the font is installed.
    pub font_probe: Option<&'a dyn Fn(&str) -> bool>,

    /// Callback consulted for `FileSource.media_duration_seconds` when the
    /// composition doesn't carry a `mediaDuration`. None => compiler uses the
    /// clip's trimStart + (duration × speed) as a floor.
    pub media_probe: Option<&'a dyn Fn(&str) -> Option<MediaProbe>>,
}

impl<'a> CompileDeps<'a> {
    pub fn none() -> Self {
        Self { proxy_lookup: None, font_probe: None, media_probe: None }
    }
}

#[derive(Debug, Clone)]
pub struct MediaProbe {
    pub duration_seconds: f64,
    pub has_audio: bool,
    pub has_video: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CompileError {
    NegativeOrZeroDuration { stage_id: String },
    SourceOutOfBounds { stage_id: String, requested: f64, available: f64 },
    UnsupportedCompositionShape { reason: String },
}

impl std::fmt::Display for CompileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CompileError::NegativeOrZeroDuration { stage_id } => {
                write!(f, "stage {stage_id} has non-positive duration")
            }
            CompileError::SourceOutOfBounds { stage_id, requested, available } => {
                write!(
                    f,
                    "stage {stage_id} requires {requested:.3}s of source but only {available:.3}s available"
                )
            }
            CompileError::UnsupportedCompositionShape { reason } => {
                write!(f, "unsupported composition: {reason}")
            }
        }
    }
}

impl std::error::Error for CompileError {}

// =============================================================================
// Entry point
// =============================================================================

pub fn compile(
    composition: &Composition,
    opts: &CompileOptions,
    deps: &CompileDeps,
) -> Result<RenderPlan, CompileError> {
    if composition.fps == 0 {
        return Err(CompileError::UnsupportedCompositionShape {
            reason: "fps must be > 0".into(),
        });
    }

    // ---- Step 1: normalize item order (stable, deterministic). ----
    let mut items_indexed: Vec<(usize, &TimelineItem)> = composition.items.iter().enumerate().collect();
    items_indexed.sort_by(|(a_idx, a), (b_idx, b)| {
        let a_key = sort_key(a, *a_idx);
        let b_key = sort_key(b, *b_idx);
        a_key.cmp(&b_key)
    });

    // Walk the sorted view but keep a stable "video ordinal" for neighbor lookup.
    let sorted_video: Vec<&VideoClipInput> = items_indexed
        .iter()
        .filter_map(|(_, it)| match it {
            TimelineItem::Video(v) => Some(v),
            _ => None,
        })
        .collect();

    let sorted_audio: Vec<&AudioClipInput> = items_indexed
        .iter()
        .filter_map(|(_, it)| match it {
            TimelineItem::Audio(a) => Some(a),
            _ => None,
        })
        .collect();

    let sorted_text: Vec<&TextItemInput> = items_indexed
        .iter()
        .filter_map(|(_, it)| match it {
            TimelineItem::Text(t) => Some(t),
            _ => None,
        })
        .collect();

    let sorted_image: Vec<&ImageItemInput> = items_indexed
        .iter()
        .filter_map(|(_, it)| match it {
            TimelineItem::Image(i) => Some(i),
            _ => None,
        })
        .collect();

    // ---- Step 2: build source catalog. ----
    let mut sources: Vec<SourceEntry> = Vec::new();
    let mut warnings: Vec<CompileWarning> = Vec::new();

    // Reserved slot 0: background color.
    sources.push(SourceEntry::Color {
        id: 0,
        hex: composition.background_color.clone(),
    });

    // Dedupe file/proxy sources by path. Collect ordered-first-seen.
    let mut path_to_source_id: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut image_source_ids: std::collections::HashMap<String, u32> = std::collections::HashMap::new();

    // Paths referenced by video/audio clips.
    let referenced_media_paths: Vec<String> = items_indexed
        .iter()
        .filter_map(|(_, it)| match it {
            TimelineItem::Video(v) => Some(v.file_path.clone()),
            TimelineItem::Audio(a) => Some(a.file_path.clone()),
            _ => None,
        })
        .collect();

    for path in referenced_media_paths {
        if path_to_source_id.contains_key(&path) {
            continue;
        }
        let next_id = sources.len() as u32;
        let proxy = deps.proxy_lookup.and_then(|f| f(&path));
        match (opts.for_export, proxy) {
            (false, Some(p)) => {
                // Preview path — prefer proxy.
                sources.push(SourceEntry::Proxy {
                    id: next_id,
                    path: p.proxy_path,
                    original_path: path.clone(),
                    media_duration_seconds: p.media_duration_seconds,
                    has_audio: p.has_audio,
                    has_video: p.has_video,
                });
            }
            (true, Some(_)) => {
                // Export path — prefer original, flag that a proxy existed.
                let probe = deps.media_probe.and_then(|f| f(&path));
                let (duration, has_audio, has_video) = match probe {
                    Some(p) => (p.duration_seconds, p.has_audio, p.has_video),
                    None => (source_duration_fallback(&items_indexed, &path), true, true),
                };
                sources.push(SourceEntry::File {
                    id: next_id,
                    path: path.clone(),
                    media_duration_seconds: duration,
                    has_audio,
                    has_video,
                });
                warnings.push(CompileWarning::ProxyMissing {
                    source_id: next_id,
                    original_path: path.clone(),
                });
            }
            (_, None) => {
                let probe = deps.media_probe.and_then(|f| f(&path));
                let (duration, has_audio, has_video) = match probe {
                    Some(p) => (p.duration_seconds, p.has_audio, p.has_video),
                    None => (source_duration_fallback(&items_indexed, &path), true, true),
                };
                sources.push(SourceEntry::File {
                    id: next_id,
                    path: path.clone(),
                    media_duration_seconds: duration,
                    has_audio,
                    has_video,
                });
            }
        }
        path_to_source_id.insert(path, next_id);
    }

    // Image sources: separate from video/audio dedup (per the current export
    // implementation, images are handled as independent inputs anyway).
    for img in &sorted_image {
        if image_source_ids.contains_key(&img.file_path) {
            continue;
        }
        let next_id = sources.len() as u32;
        let probe = deps.media_probe.and_then(|f| f(&img.file_path));
        let (duration, has_audio, has_video) = match probe {
            Some(p) => (p.duration_seconds, p.has_audio, p.has_video),
            // Image files: synthetic "infinite" duration. Overlays use output_start/end only.
            None => (f64::MAX / 2.0, false, true),
        };
        sources.push(SourceEntry::File {
            id: next_id,
            path: img.file_path.clone(),
            media_duration_seconds: duration,
            has_audio,
            has_video,
        });
        image_source_ids.insert(img.file_path.clone(), next_id);
    }

    // ---- Step 3: compile video stages. ----
    let mut video_track: Vec<VideoStage> = Vec::new();
    let mut cumulative_overlap_prefix: f64 = 0.0;

    for (ordinal, clip) in sorted_video.iter().enumerate() {
        let stage_id = clip.id.clone().unwrap_or_else(|| format!("v{ordinal}"));

        let Some(&source_id) = path_to_source_id.get(&clip.file_path) else {
            return Err(CompileError::UnsupportedCompositionShape {
                reason: format!("video clip '{stage_id}' references missing source path"),
            });
        };

        let (speed, requested_speed) = clamp_speed(clip.speed.unwrap_or(1.0));
        if (speed - requested_speed).abs() > 1e-9 {
            warnings.push(CompileWarning::SpeedClamped {
                stage_id: stage_id.clone(),
                requested: requested_speed,
                applied: speed,
            });
        }

        if clip.duration <= 0.0 {
            return Err(CompileError::NegativeOrZeroDuration { stage_id });
        }

        let base_fade_in = clip.fade_in.max(0.0);
        let base_fade_out = clip.fade_out.max(0.0);

        let transition_in_from_prev = if ordinal == 0 {
            0.0
        } else {
            let prev = &sorted_video[ordinal - 1];
            transition_contribution(prev)
        };
        let transition_out_self = transition_contribution(clip);

        let (fade_in, fade_out, output_start, output_end, overlap_next) = match opts.transition_mode
        {
            TransitionMode::Fold => {
                let output_start = clip.start_time;
                let output_end = clip.start_time + clip.duration;
                let fade_in = (base_fade_in + transition_in_from_prev).min(clip.duration);
                let fade_out = (base_fade_out + transition_out_self).min(clip.duration);
                (fade_in, fade_out, output_start, output_end, None::<OverlapNext>)
            }
            TransitionMode::Overlap => {
                // Each transition on a preceding clip pulls this clip earlier
                // by its transition_duration so the two overlap on the output
                // timeline.
                let output_start = clip.start_time - cumulative_overlap_prefix;
                let output_end = output_start + clip.duration;
                let overlap_next = if transition_out_self > 0.0 {
                    Some(OverlapNext {
                        duration_seconds: transition_out_self,
                        kind: overlap_kind(clip),
                    })
                } else {
                    None
                };
                // After this clip, extend the prefix.
                cumulative_overlap_prefix += transition_out_self;
                (base_fade_in, base_fade_out, output_start, output_end, overlap_next)
            }
        };

        let source_duration_consumed = (output_end - output_start) * speed;
        let source_in = clip.trim_start.max(0.0);
        let source_end = source_in + source_duration_consumed;

        // Source-range bounds check (against the catalog's known media duration).
        if let Some(available) = sources
            .iter()
            .find(|s| s.id() == source_id)
            .and_then(|s| s.media_duration_seconds())
        {
            if source_end > available + 1e-3 && available.is_finite() {
                return Err(CompileError::SourceOutOfBounds {
                    stage_id,
                    requested: source_end,
                    available,
                });
            }
        }

        video_track.push(VideoStage {
            id: stage_id,
            source_id,
            output_start,
            output_end,
            source_in,
            source_end,
            speed,
            fade_in,
            fade_out,
            overlap_next,
            strip_embedded_audio: clip.strip_audio,
        });
    }

    // ---- Step 4: compile dedicated audio stages. ----
    let mut audio_tracks: Vec<AudioTrack> = Vec::new();
    for (ordinal, clip) in sorted_audio.iter().enumerate() {
        let stage_id = clip.id.clone().unwrap_or_else(|| format!("a{ordinal}"));

        let Some(&source_id) = path_to_source_id.get(&clip.file_path) else {
            return Err(CompileError::UnsupportedCompositionShape {
                reason: format!("audio clip '{stage_id}' references missing source path"),
            });
        };

        let (speed, requested_speed) = clamp_speed(clip.speed.unwrap_or(1.0));
        if (speed - requested_speed).abs() > 1e-9 {
            warnings.push(CompileWarning::SpeedClamped {
                stage_id: stage_id.clone(),
                requested: requested_speed,
                applied: speed,
            });
        }

        if clip.duration <= 0.0 {
            return Err(CompileError::NegativeOrZeroDuration { stage_id });
        }

        let output_start = clip.start_time;
        let output_end = clip.start_time + clip.duration;
        let source_in = clip.trim_start.max(0.0);
        let source_end = source_in + clip.duration * speed;

        if let Some(available) = sources
            .iter()
            .find(|s| s.id() == source_id)
            .and_then(|s| s.media_duration_seconds())
        {
            if source_end > available + 1e-3 && available.is_finite() {
                return Err(CompileError::SourceOutOfBounds {
                    stage_id,
                    requested: source_end,
                    available,
                });
            }
        }

        // linearGain captures clip.volume; loudnorm is a separate directive.
        let linear_gain = clip.volume.max(0.0);

        let fade_in = clip.fade_in.max(0.0).min(clip.duration);
        let fade_out = clip.fade_out.max(0.0).min(clip.duration - fade_in).max(0.0);

        let normalize = if clip.normalize {
            match (
                clip.measured_lufs,
                clip.measured_lra,
                clip.measured_true_peak,
                clip.measured_threshold,
            ) {
                (Some(i), Some(lra), Some(tp), Some(t)) => Some(NormalizeDirective {
                    target_lufs: -16.0,
                    max_linear_gain: 6.0,
                    measurements: LoudnormMeasurements {
                        integrated_lufs: i,
                        lra,
                        true_peak_dbfs: tp,
                        threshold: t,
                    },
                }),
                _ => {
                    warnings.push(CompileWarning::LoudnormUnmeasured {
                        audio_stage_id: stage_id.clone(),
                    });
                    None
                }
            }
        } else {
            None
        };

        let track = AudioTrack {
            id: stage_id.clone(),
            gain: 1.0,
            stages: vec![AudioStage {
                id: stage_id,
                source_id,
                output_start,
                output_end,
                source_in,
                source_end,
                speed,
                linear_gain,
                fade_in,
                fade_out,
                normalize,
            }],
        };
        audio_tracks.push(track);
    }

    // ---- Step 5: compile embedded audio track. ----
    let mut embedded_stages: Vec<AudioStage> = Vec::new();
    for stage in &video_track {
        if stage.strip_embedded_audio {
            continue;
        }
        let source_has_audio = sources
            .iter()
            .find(|s| s.id() == stage.source_id)
            .is_some_and(|s| s.has_audio());
        if !source_has_audio {
            continue;
        }
        embedded_stages.push(AudioStage {
            id: format!("{}-embedded", stage.id),
            source_id: stage.source_id,
            output_start: stage.output_start,
            output_end: stage.output_end,
            source_in: stage.source_in,
            source_end: stage.source_end,
            speed: stage.speed,
            linear_gain: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
            normalize: None,
        });
    }
    if !embedded_stages.is_empty() {
        audio_tracks.push(AudioTrack {
            id: "embedded".into(),
            gain: 1.0,
            stages: embedded_stages,
        });
    }

    // ---- Step 6: compile overlays. ----
    let mut overlays: Vec<OverlayStage> = Vec::new();

    for (ordinal, t) in sorted_text.iter().enumerate() {
        let id = t.id.clone().unwrap_or_else(|| format!("t{ordinal}"));
        if t.duration <= 0.0 {
            return Err(CompileError::NegativeOrZeroDuration { stage_id: id });
        }

        let preferred = ["Inter", "Segoe UI", "Arial", "Helvetica", "DejaVu Sans"];
        let chosen = match deps.font_probe {
            Some(probe) => preferred.iter().copied().find(|&f| probe(f)),
            // Without a probe we assume Inter is bundled (project default).
            None => Some("Inter"),
        };

        match chosen {
            Some(family) => {
                let fade_in = t.fade_in.max(0.0).min(t.duration);
                let fade_out = t.fade_out.max(0.0).min(t.duration - fade_in).max(0.0);
                // The existing export renders `label` as the primary line,
                // and the preview additionally renders `text` as an optional
                // half-size subtitle. We split them explicitly in the IR so
                // the divergence is visible rather than buried in the
                // renderers.
                let primary = t
                    .label
                    .clone()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| t.text.clone());
                let subtitle = if Some(&primary) == t.label.as_ref() && !t.text.is_empty() {
                    Some(t.text.clone())
                } else {
                    None
                };
                overlays.push(OverlayStage::Text(TextOverlayStage {
                    id,
                    output_start: t.start_time,
                    output_end: t.start_time + t.duration,
                    fade_in,
                    fade_out,
                    position_x: t.position_x.clamp(0.0, 1.0),
                    position_y: t.position_y.clamp(0.0, 1.0),
                    text: primary,
                    subtitle,
                    font_family: family.to_string(),
                    font_weight: 400,
                    font_size_px: t.font_size.max(1.0),
                    color_hex: t.color.clone(),
                }));
            }
            None => {
                warnings.push(CompileWarning::TextFontMissing {
                    overlay_id: id,
                    requested: "Inter".into(),
                    fallback: None,
                });
            }
        }
    }

    for (ordinal, img) in sorted_image.iter().enumerate() {
        let id = img.id.clone().unwrap_or_else(|| format!("i{ordinal}"));
        if img.duration <= 0.0 {
            return Err(CompileError::NegativeOrZeroDuration { stage_id: id });
        }
        let source_id = *image_source_ids
            .get(&img.file_path)
            .expect("image source was registered in step 2");

        let fade_in = img.fade_in.max(0.0).min(img.duration);
        let fade_out = img.fade_out.max(0.0).min(img.duration - fade_in).max(0.0);

        overlays.push(OverlayStage::Image(ImageOverlayStage {
            id,
            output_start: img.start_time,
            output_end: img.start_time + img.duration,
            fade_in,
            fade_out,
            position_x: img.position_x.clamp(0.0, 1.0),
            position_y: img.position_y.clamp(0.0, 1.0),
            source_id,
            scale: img.scale.max(0.0),
        }));
    }

    // ---- Step 7: compute duration. ----
    let video_end = video_track
        .iter()
        .map(|s| s.output_end)
        .fold(0.0_f64, f64::max);
    let audio_end = audio_tracks
        .iter()
        .flat_map(|t| t.stages.iter())
        .map(|s| s.output_end)
        .fold(0.0_f64, f64::max);
    let overlay_end = overlays
        .iter()
        .map(|o| o.output_end())
        .fold(0.0_f64, f64::max);
    let raw_duration = video_end.max(audio_end).max(overlay_end).max(0.0);

    let fps_f = composition.fps as f64;
    let duration_frames = (raw_duration * fps_f).ceil() as u64;
    let duration_seconds = duration_frames as f64 / fps_f;

    // ---- Step 8: frame-snap pass. ----
    if opts.frame_snap {
        let snap = |v: f64| -> f64 { (v * fps_f).round() / fps_f };
        for s in video_track.iter_mut() {
            s.output_start = snap(s.output_start);
            s.output_end = snap(s.output_end);
            s.fade_in = snap(s.fade_in);
            s.fade_out = snap(s.fade_out);
            if let Some(o) = s.overlap_next.as_mut() {
                o.duration_seconds = snap(o.duration_seconds);
            }
            // Reconcile source_end against snapped output window.
            s.source_end = s.source_in + (s.output_end - s.output_start) * s.speed;
            // Keep fadeIn + fadeOut <= duration after snap.
            let dur = (s.output_end - s.output_start).max(0.0);
            if s.fade_in + s.fade_out > dur {
                // Shrink fade_out to preserve fade_in preference.
                s.fade_out = (dur - s.fade_in).max(0.0);
            }
        }
        for t in audio_tracks.iter_mut() {
            for s in t.stages.iter_mut() {
                s.output_start = snap(s.output_start);
                s.output_end = snap(s.output_end);
                s.fade_in = snap(s.fade_in);
                s.fade_out = snap(s.fade_out);
                s.source_end = s.source_in + (s.output_end - s.output_start) * s.speed;
                let dur = (s.output_end - s.output_start).max(0.0);
                if s.fade_in + s.fade_out > dur {
                    s.fade_out = (dur - s.fade_in).max(0.0);
                }
            }
        }
        for o in overlays.iter_mut() {
            match o {
                OverlayStage::Text(t) => {
                    t.output_start = snap(t.output_start);
                    t.output_end = snap(t.output_end);
                    t.fade_in = snap(t.fade_in);
                    t.fade_out = snap(t.fade_out);
                    let dur = (t.output_end - t.output_start).max(0.0);
                    if t.fade_in + t.fade_out > dur {
                        t.fade_out = (dur - t.fade_in).max(0.0);
                    }
                }
                OverlayStage::Image(i) => {
                    i.output_start = snap(i.output_start);
                    i.output_end = snap(i.output_end);
                    i.fade_in = snap(i.fade_in);
                    i.fade_out = snap(i.fade_out);
                    let dur = (i.output_end - i.output_start).max(0.0);
                    if i.fade_in + i.fade_out > dur {
                        i.fade_out = (dur - i.fade_in).max(0.0);
                    }
                }
            }
        }
    }

    // Sort video_track by output_start for invariant I8 determinism.
    video_track.sort_by(|a, b| {
        a.output_start
            .partial_cmp(&b.output_start)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });

    let plan = RenderPlan {
        schema_version: RENDER_PLAN_SCHEMA_VERSION,
        width: composition.width,
        height: composition.height,
        fps: composition.fps,
        duration_frames,
        duration_seconds,
        background_color: composition.background_color.clone(),
        sources,
        video_track,
        audio_tracks,
        overlays,
        warnings,
    };

    // ---- Step 9: validate. ----
    if let Err(v) = assert_invariants(&plan) {
        return Err(CompileError::UnsupportedCompositionShape {
            reason: format!("invariant {} violated: {}", v.code, v.message),
        });
    }

    Ok(plan)
}

// =============================================================================
// Helpers
// =============================================================================

fn sort_key(item: &TimelineItem, original_index: usize) -> (u8, OrderedF64, String, usize) {
    let type_rank: u8 = match item {
        TimelineItem::Video(_) => 0,
        TimelineItem::Audio(_) => 1,
        TimelineItem::Text(_) => 2,
        TimelineItem::Image(_) => 3,
    };
    let start = item_start_time(item);
    let id = item_id(item).unwrap_or_default();
    (type_rank, OrderedF64(start), id, original_index)
}

fn item_start_time(item: &TimelineItem) -> f64 {
    match item {
        TimelineItem::Video(v) => v.start_time,
        TimelineItem::Audio(a) => a.start_time,
        TimelineItem::Text(t) => t.start_time,
        TimelineItem::Image(i) => i.start_time,
    }
}

fn item_id(item: &TimelineItem) -> Option<String> {
    match item {
        TimelineItem::Video(v) => v.id.clone(),
        TimelineItem::Audio(a) => a.id.clone(),
        TimelineItem::Text(t) => t.id.clone(),
        TimelineItem::Image(i) => i.id.clone(),
    }
}

/// Wrapper so we can use f64 in an Ord context deterministically. NaNs
/// are treated as greater than any real value (they should never appear in
/// well-formed input).
#[derive(Debug, Clone, Copy)]
struct OrderedF64(f64);

impl PartialEq for OrderedF64 {
    fn eq(&self, other: &Self) -> bool {
        self.0.to_bits() == other.0.to_bits()
    }
}
impl Eq for OrderedF64 {}
impl PartialOrd for OrderedF64 {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> { Some(self.cmp(other)) }
}
impl Ord for OrderedF64 {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0
            .partial_cmp(&other.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    }
}

fn clamp_speed(requested: f64) -> (f64, f64) {
    let applied = requested.clamp(0.0625, 16.0);
    (applied, requested)
}

fn transition_contribution(clip: &VideoClipInput) -> f64 {
    let kind = clip.transition.as_deref().unwrap_or("cut");
    if kind != "cut" && clip.transition_duration > 0.0 {
        clip.transition_duration
    } else {
        0.0
    }
}

fn overlap_kind(clip: &VideoClipInput) -> OverlapKind {
    match clip.transition.as_deref() {
        Some("fade_to_black") | Some("fadeToBlack") => OverlapKind::FadeToBlack,
        _ => OverlapKind::Crossfade,
    }
}

/// Conservative lower bound for a source's media duration when no media_probe
/// is wired up. Uses the largest (trimStart + duration × speed) over every
/// clip that references the path.
fn source_duration_fallback(items_indexed: &[(usize, &TimelineItem)], path: &str) -> f64 {
    let mut max_consumed: f64 = 0.0;
    for (_, it) in items_indexed {
        match it {
            TimelineItem::Video(v) if v.file_path == path => {
                let speed = v.speed.unwrap_or(1.0).abs().max(f64::MIN_POSITIVE);
                let consumed = v.trim_start + v.duration * speed;
                if let Some(m) = v.media_duration {
                    max_consumed = max_consumed.max(m);
                }
                max_consumed = max_consumed.max(consumed);
            }
            TimelineItem::Audio(a) if a.file_path == path => {
                let speed = a.speed.unwrap_or(1.0).abs().max(f64::MIN_POSITIVE);
                let consumed = a.trim_start + a.duration * speed;
                if let Some(m) = a.media_duration {
                    max_consumed = max_consumed.max(m);
                }
                max_consumed = max_consumed.max(consumed);
            }
            _ => {}
        }
    }
    max_consumed
}
