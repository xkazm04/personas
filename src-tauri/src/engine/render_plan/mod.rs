//! RenderPlan intermediate representation for the Media Studio.
//!
//! See `docs/concepts/media-studio-renderplan.md` for the full design rationale.
//! This IR sits between the user-authored `Composition` and the two renderers
//! (browser preview + FFmpeg export). A single `compile` step owns all
//! composition-level math so renderers only consume a flat, pre-resolved plan.
//!
//! PR-1 scope: types + compiler + invariants + tests. No production call
//! sites wire this up yet — that is PR-2 (export) and PR-3 (preview).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod compile;
pub mod invariants;

#[cfg(test)]
mod tests;

pub use compile::{compile, CompileDeps, CompileError, CompileOptions, ProxyRef, TransitionMode};
pub use invariants::{assert_invariants, InvariantViolation};

/// PR-2 export renderer. Exposed here so integration tests and future
/// consumers can reach the function without traversing the private
/// `commands` module path.
pub use crate::commands::artist::ffmpeg::build_ffmpeg_args;

// =============================================================================
// Top-level plan
// =============================================================================

/// Bump when the shape changes in a way renderers must react to.
pub const RENDER_PLAN_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RenderPlan {
    /// Bump when the shape changes in a way renderers must react to.
    pub schema_version: u32,

    /// Output frame dimensions in pixels. Matches Composition.width/height.
    pub width: u32,
    pub height: u32,

    /// Output framerate.
    pub fps: u32,

    /// Integer frame count. Primary; seconds derived.
    pub duration_frames: u64,

    /// Duration in seconds: durationFrames / fps. Present for convenience;
    /// every renderer should prefer frame-indexed math where possible.
    pub duration_seconds: f64,

    /// Background color drawn beneath every stage. Hex, no alpha.
    pub background_color: String,

    /// Deduplicated source catalog. Stages reference by index.
    pub sources: Vec<SourceEntry>,

    /// Single video track. Stages are sorted by outputStart ascending.
    /// May have temporal gaps (gap = background color). Stages may overlap
    /// by exactly `overlapNext.durationSeconds` when overlapNext is set.
    pub video_track: Vec<VideoStage>,

    /// Audio tracks. All tracks are mixed on output.
    /// The compiler emits:
    /// - one track per dedicated AudioClip in the Composition
    /// - one implicit track 'embedded' that collects non-stripped audio from
    ///   every VideoStage whose source has an audio channel.
    pub audio_tracks: Vec<AudioTrack>,

    /// Overlays composited on top of the video track in array order
    /// (array[0] is behind array[N-1]). Overlaps freely.
    pub overlays: Vec<OverlayStage>,

    /// Non-fatal issues the compiler wants the renderer to surface to the
    /// user (preview banner, export log).
    pub warnings: Vec<CompileWarning>,
}

// =============================================================================
// Sources (discriminated union)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum SourceEntry {
    #[serde(rename = "file")]
    File {
        id: u32,
        path: String,
        media_duration_seconds: f64,
        has_audio: bool,
        has_video: bool,
    },
    #[serde(rename = "proxy")]
    Proxy {
        id: u32,
        path: String,
        original_path: String,
        media_duration_seconds: f64,
        has_audio: bool,
        has_video: bool,
    },
    #[serde(rename = "color")]
    Color { id: u32, hex: String },
}

impl SourceEntry {
    pub fn id(&self) -> u32 {
        match self {
            SourceEntry::File { id, .. }
            | SourceEntry::Proxy { id, .. }
            | SourceEntry::Color { id, .. } => *id,
        }
    }

    pub fn media_duration_seconds(&self) -> Option<f64> {
        match self {
            SourceEntry::File { media_duration_seconds, .. }
            | SourceEntry::Proxy { media_duration_seconds, .. } => Some(*media_duration_seconds),
            SourceEntry::Color { .. } => None,
        }
    }

    pub fn has_audio(&self) -> bool {
        match self {
            SourceEntry::File { has_audio, .. } | SourceEntry::Proxy { has_audio, .. } => {
                *has_audio
            }
            SourceEntry::Color { .. } => false,
        }
    }
}

// =============================================================================
// Video track
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct VideoStage {
    /// Stable across recompiles of the same Composition.
    pub id: String,

    /// Index into RenderPlan.sources. Source kind must be 'file' or 'proxy'
    /// (not 'color' — color fills are implicit gaps, not stages).
    pub source_id: u32,

    /// Absolute start/end on the output timeline, seconds. outputEnd > outputStart.
    pub output_start: f64,
    pub output_end: f64,

    /// Source-time region consumed. sourceEnd > sourceIn.
    pub source_in: f64,
    pub source_end: f64,

    /// Playback rate applied to the source.
    pub speed: f64,

    /// Effective fades in seconds. For fade-folded transitions these already
    /// include the neighbor clip's transitionDuration contribution — renderers
    /// do NOT fold, they just apply what's here.
    pub fade_in: f64,
    pub fade_out: f64,

    /// Present when this stage temporally overlaps the next video stage.
    /// Only emitted when the compiler ran with transitionMode === 'overlap'.
    pub overlap_next: Option<OverlapNext>,

    /// Mute audio embedded in this clip's source. When true, no contribution
    /// to the 'embedded' audio track.
    pub strip_embedded_audio: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OverlapNext {
    pub duration_seconds: f64,
    pub kind: OverlapKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum OverlapKind {
    Crossfade,
    FadeToBlack,
}

// =============================================================================
// Audio tracks
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    /// Stable id. For the implicit video-embedded track this is the literal 'embedded'.
    pub id: String,

    /// Track-level linear gain, multiplied on top of stage gain. 1.0 today,
    /// reserved for future master-bus / ducking features.
    pub gain: f64,

    /// Stages on this track. May overlap (mixed within-track).
    pub stages: Vec<AudioStage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AudioStage {
    pub id: String,
    pub source_id: u32,

    pub output_start: f64,
    pub output_end: f64,
    pub source_in: f64,
    pub source_end: f64,
    pub speed: f64,

    /// Pre-computed linear gain that captures clip.volume. Does NOT include
    /// loudnorm compensation; see `normalize` below.
    pub linear_gain: f64,

    /// Fade envelope durations (seconds), applied multiplicatively alongside
    /// linearGain at the outputStart/outputEnd edges.
    pub fade_in: f64,
    pub fade_out: f64,

    /// Normalization directive. None = no normalize; the renderer uses only
    /// linearGain × fade. Some = renderer applies normalize (preview uses a
    /// linear-gain approximation, export uses two-pass loudnorm).
    pub normalize: Option<NormalizeDirective>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NormalizeDirective {
    pub target_lufs: f64,      // always -16 today
    pub max_linear_gain: f64,  // always 6 today (~ +15.5 dB safety clamp)
    pub measurements: LoudnormMeasurements,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LoudnormMeasurements {
    pub integrated_lufs: f64,
    pub lra: f64,
    pub true_peak_dbfs: f64,
    pub threshold: f64,
}

// =============================================================================
// Overlays
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OverlayStage {
    #[serde(rename = "image")]
    Image(ImageOverlayStage),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImageOverlayStage {
    pub id: String,
    pub output_start: f64,
    pub output_end: f64,
    pub fade_in: f64,
    pub fade_out: f64,

    pub position_x: f64,
    pub position_y: f64,

    /// Must reference a 'file' or 'proxy' source.
    pub source_id: u32,
    /// 1.0 = source's natural size within the frame.
    pub scale: f64,
}

impl OverlayStage {
    pub fn id(&self) -> &str {
        match self {
            OverlayStage::Image(i) => &i.id,
        }
    }

    pub fn output_start(&self) -> f64 {
        match self {
            OverlayStage::Image(i) => i.output_start,
        }
    }

    pub fn output_end(&self) -> f64 {
        match self {
            OverlayStage::Image(i) => i.output_end,
        }
    }

    pub fn fade_in(&self) -> f64 {
        match self {
            OverlayStage::Image(i) => i.fade_in,
        }
    }

    pub fn fade_out(&self) -> f64 {
        match self {
            OverlayStage::Image(i) => i.fade_out,
        }
    }

    pub fn position_x(&self) -> f64 {
        match self {
            OverlayStage::Image(i) => i.position_x,
        }
    }

    pub fn position_y(&self) -> f64 {
        match self {
            OverlayStage::Image(i) => i.position_y,
        }
    }
}

// =============================================================================
// Warnings
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum CompileWarning {
    #[serde(rename = "loudnormUnmeasured")]
    LoudnormUnmeasured { audio_stage_id: String },
    #[serde(rename = "speedClamped")]
    SpeedClamped {
        stage_id: String,
        requested: f64,
        applied: f64,
    },
    #[serde(rename = "proxyMissing")]
    ProxyMissing {
        source_id: u32,
        original_path: String,
    },
    #[serde(rename = "audioSourceSilent")]
    AudioSourceSilent { source_id: u32 },
}
