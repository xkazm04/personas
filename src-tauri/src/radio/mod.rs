//! Radio feature: a small footer-anchored player. Each curated station has
//! one of two playback engines:
//!
//! - **`youtubeTracks`**: a curated list of YouTube video IDs played through
//!   a hidden IFrame Player (visible video element off-screen, audio routed
//!   to the renderer). Track-level prev/next + per-station shuffle cursors.
//! - **`stream`**: a direct internet-radio stream URL played through an
//!   HTML5 `<audio>` element. No tracks; track-level prev/next is a no-op.
//!
//! The Rust backend owns curated catalog + playback state. The renderer
//! reads `RadioState` and `NowPlaying`, drives playback through the
//! appropriate engine, and reports state transitions back via
//! `radio_report_status` / `radio_track_ended`.
//!
//! Curated stations live in `src-tauri/data/radio_stations.json` (loaded
//! once at startup). Runtime state (current station + per-YouTube-station
//! cursors + volume + status) persists to `<config>/radio_state.json`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

pub mod service;

pub use service::{RadioService, RadioServiceHandle};

/// One YouTube track for a `youtubeTracks` station.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    /// Optional — null in the seed; the IFrame Player reports the real
    /// duration at runtime.
    pub duration_sec: Option<u32>,
}

/// Tagged playback engine for a station. Serializes as
/// `{ "kind": "youtubeTracks", "tracks": [...] }` or
/// `{ "kind": "stream", "streamUrl": "..." }` so the frontend can switch
/// rendering on the discriminator.
///
/// `rename_all_fields` rather than `rename_all`: the latter only renames
/// the variant tag itself, while the former camelCases each variant's
/// inner field names (so `stream_url` → `streamUrl` in JSON).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum StationSource {
    /// Curated YouTube video list. Played through a hidden IFrame Player
    /// in the renderer; track-level prev/next + shuffle cursor.
    YoutubeTracks { tracks: Vec<Track> },
    /// Direct internet-radio stream URL (MP3 or HLS). Played through a
    /// renderer-side `<audio>` element. No track-level navigation.
    Stream { stream_url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Station {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub accent_color: String,
    /// Optional homepage / attribution link for the provider.
    pub source_url: Option<String>,
    /// Optional human-readable provider label (e.g. "SomaFM" or
    /// "Lofi Girl"). Shown in the picker + settings card.
    pub source_label: Option<String>,
    pub source: StationSource,
}

/// Coarse playback state. Reported from the renderer via `radio_report_status`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PlayStatus {
    Stopped,
    Playing,
    Paused,
    Buffering,
}

/// Per-YouTube-station cursor. Streams have no cursor — they're a single
/// continuous source.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StationCursor {
    /// Index into `shuffle_order` (NOT the station's `tracks` list directly).
    pub current_track_index: u32,
    /// Last reported playback position. Updated periodically by the player
    /// so a restart can resume mid-track.
    pub position_sec: u32,
    /// Shuffled indices into the station's `tracks` list. Regenerated
    /// when the cursor reaches the end of the order (reshuffle on wrap).
    pub shuffle_order: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RadioState {
    pub current_station_id: Option<String>,
    pub status: PlayStatus,
    /// Linear volume in [0.0, 1.0]. The renderer maps this to either
    /// `audio.volume` (stream) or `player.setVolume(0..100)` (YouTube).
    pub volume: f32,
    /// Per-station cursors, keyed by station id. Only populated for
    /// `youtubeTracks` stations.
    pub station_cursors: HashMap<String, StationCursor>,
}

impl Default for RadioState {
    fn default() -> Self {
        Self {
            current_station_id: None,
            status: PlayStatus::Stopped,
            volume: 0.7,
            station_cursors: HashMap::new(),
        }
    }
}

/// View returned by `radio_get_now_playing`. For `youtubeTracks` stations
/// `track` is `Some`; for `stream` stations it is `None`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub station: Station,
    pub track: Option<Track>,
    pub track_index_in_station: Option<u32>,
    pub status: PlayStatus,
}
