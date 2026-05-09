//! Radio feature: hidden Tauri WebviewWindow plays curated YouTube tracks via
//! the IFrame Player API. The main window's footer drives play/pause/skip and
//! station switching through Tauri commands.
//!
//! Curated stations live in `src-tauri/data/radio_stations.json` (loaded once
//! at startup). Per-station playback cursors persist to `<config>/radio_state.json`
//! so switching stations resumes where the user left off, and a restart restores
//! the last station + track + position.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

pub mod service;

pub use service::{RadioService, RadioServiceHandle};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    /// Optional — `null` in the seed JSON; the IFrame Player reports the real
    /// duration at runtime, but we don't currently round-trip it back into
    /// state because tracks are queued by id, not by metadata.
    pub duration_sec: Option<u32>,
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
    pub tracks: Vec<Track>,
}

/// Coarse playback state. The hidden player window emits these via `radio:state`
/// events so the footer can render the right control affordances.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PlayStatus {
    Stopped,
    Playing,
    Paused,
    Buffering,
}

/// Per-station playback cursor. Switching stations preserves the cursor so the
/// user resumes where they left off rather than restarting the tracklist.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StationCursor {
    /// Index into `shuffle_order` (NOT the station's `tracks` list directly).
    pub current_track_index: u32,
    /// Last reported playback position. Updated periodically by the player
    /// window so a restart can resume mid-track.
    pub position_sec: u32,
    /// Shuffled indices into the station's `tracks` list. Regenerated when
    /// the cursor reaches the end of the order (reshuffle on wrap).
    pub shuffle_order: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RadioState {
    pub current_station_id: Option<String>,
    pub status: PlayStatus,
    /// Linear volume in [0.0, 1.0]. The IFrame Player API uses 0–100; the
    /// hidden window converts at the boundary.
    pub volume: f32,
    /// Per-station cursors. Keyed by station id.
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

/// Currently-playing track view, returned by `radio_get_now_playing` so the
/// footer doesn't need to do its own station lookup + index resolution.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub station: Station,
    pub track: Track,
    pub track_index_in_station: u32,
    pub status: PlayStatus,
}
