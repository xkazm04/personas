//! Radio feature: a small footer-anchored player that streams curated
//! internet-radio stations directly via an HTML5 `<audio>` element in the
//! main window. No hidden window, no third-party iframe — the footer owns
//! playback end-to-end and reports state changes back via Tauri commands.
//!
//! Curated stations live in `src-tauri/data/radio_stations.json` (loaded
//! once at startup). Runtime state (current station + volume + status)
//! persists to `<config>/radio_state.json` so a restart restores the last
//! station selection.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod service;

pub use service::{RadioService, RadioServiceHandle};

/// One curated internet-radio station. The `stream_url` is fed straight
/// into the footer's `<audio>` element. `source_url` + `source_label`
/// power the attribution shown in Settings → Account.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Station {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub accent_color: String,
    /// Direct stream URL (MP3 or HLS). Must be HTTPS and CORS-friendly so
    /// the renderer's `<audio>` element can play it without a proxy.
    pub stream_url: String,
    /// Optional homepage / attribution link for the station provider.
    pub source_url: Option<String>,
    /// Optional human-readable provider label (e.g. "SomaFM").
    pub source_label: Option<String>,
}

/// Coarse playback state. The footer reports these via `radio_report_status`
/// so the persisted `RadioState` reflects what the `<audio>` element is
/// actually doing.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PlayStatus {
    Stopped,
    Playing,
    Paused,
    Buffering,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RadioState {
    pub current_station_id: Option<String>,
    pub status: PlayStatus,
    /// Linear volume in [0.0, 1.0]. The HTML5 audio element uses the same
    /// range, so no boundary conversion is needed.
    pub volume: f32,
}

impl Default for RadioState {
    fn default() -> Self {
        Self {
            current_station_id: None,
            status: PlayStatus::Stopped,
            volume: 0.7,
        }
    }
}

/// View returned by `radio_get_now_playing` so the footer doesn't need
/// to do its own station lookup.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub station: Station,
    pub status: PlayStatus,
}
