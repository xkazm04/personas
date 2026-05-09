//! `RadioService` owns the curated stations + runtime playback state.
//! Track-level operations (`next` / `prev` / `track_ended`) only act on
//! `youtubeTracks` stations; `stream` stations error those out so the
//! renderer can disable the corresponding buttons.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};

use super::{NowPlaying, PlayStatus, RadioState, Station, StationCursor, StationSource, Track};

/// On-disk shape of `src-tauri/data/radio_stations.json`. Versioned in
/// case we ever need to migrate. Uses camelCase to match `Station`'s
/// serde rename (which ts-rs in turn relies on for the TS bindings).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StationsFile {
    #[serde(default = "default_version")]
    version: u32,
    default_station_id: Option<String>,
    stations: Vec<Station>,
}

fn default_version() -> u32 {
    3
}

/// Embedded fallback used when the JSON file is missing in dev builds and
/// when `cargo test` runs from a sandbox.
const EMBEDDED_STATIONS_JSON: &str = include_str!("../../data/radio_stations.json");

pub struct RadioService {
    stations: Vec<Station>,
    default_station_id: Option<String>,
    state: RadioState,
    persistence_path: PathBuf,
}

/// Newtype wrapper so Tauri's typed state lookup unambiguously resolves
/// to the radio service.
pub struct RadioServiceHandle(pub Arc<Mutex<RadioService>>);

impl RadioService {
    pub fn new(persistence_path: PathBuf) -> Self {
        let parsed: StationsFile = serde_json::from_str(EMBEDDED_STATIONS_JSON)
            .unwrap_or_else(|e| {
                tracing::error!("Failed to parse embedded radio stations JSON: {}", e);
                StationsFile {
                    version: default_version(),
                    default_station_id: None,
                    stations: Vec::new(),
                }
            });

        let mut state: RadioState = match std::fs::read_to_string(&persistence_path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                tracing::warn!(
                    "Failed to parse persisted radio state at {}: {} — starting fresh",
                    persistence_path.display(),
                    e
                );
                RadioState::default()
            }),
            Err(_) => RadioState::default(),
        };

        // Discard a persisted current_station_id that doesn't exist in the
        // current catalog (common after a station rename or removal between
        // releases).
        if let Some(id) = state.current_station_id.as_ref() {
            if !parsed.stations.iter().any(|s| &s.id == id) {
                state.current_station_id = None;
            }
        }
        // Same hygiene for cursors — drop any pointing at retired stations.
        state
            .station_cursors
            .retain(|id, _| parsed.stations.iter().any(|s| &s.id == id));

        Self {
            stations: parsed.stations,
            default_station_id: parsed.default_station_id,
            state,
            persistence_path,
        }
    }

    pub fn stations(&self) -> &[Station] {
        &self.stations
    }

    pub fn state(&self) -> &RadioState {
        &self.state
    }

    pub fn default_station_id(&self) -> Option<&str> {
        self.default_station_id.as_deref()
            .or_else(|| self.stations.first().map(|s| s.id.as_str()))
    }

    fn station(&self, id: &str) -> Option<&Station> {
        self.stations.iter().find(|s| s.id == id)
    }

    /// Switch to `station_id`. For `youtubeTracks` stations this also
    /// ensures a fresh shuffle cursor exists.
    pub fn set_station(&mut self, station_id: &str) -> Result<(), String> {
        let station = self
            .station(station_id)
            .ok_or_else(|| format!("unknown station: {station_id}"))?;
        if let StationSource::YoutubeTracks { tracks } = &station.source {
            let track_count = tracks.len() as u32;
            self.state
                .station_cursors
                .entry(station_id.to_string())
                .or_insert_with(|| StationCursor {
                    current_track_index: 0,
                    position_sec: 0,
                    shuffle_order: generate_shuffle(track_count),
                });
        }
        self.state.current_station_id = Some(station_id.to_string());
        Ok(())
    }

    pub fn play(&mut self) -> Result<(), String> {
        if self.state.current_station_id.is_none() {
            let default = self
                .default_station_id()
                .ok_or_else(|| "no stations configured".to_string())?
                .to_string();
            self.set_station(&default)?;
        }
        self.state.status = PlayStatus::Playing;
        Ok(())
    }

    pub fn pause(&mut self) {
        if matches!(self.state.status, PlayStatus::Playing | PlayStatus::Buffering) {
            self.state.status = PlayStatus::Paused;
        }
    }

    pub fn set_status(&mut self, status: PlayStatus) {
        self.state.status = status;
    }

    /// Advance to the next track in the current station. Wraps with a
    /// reshuffle at end-of-order. **Only valid for `youtubeTracks`
    /// stations** — returns `Err` for `stream` stations so the UI knows
    /// to disable the button.
    pub fn next(&mut self) -> Result<(), String> {
        self.advance_track(1)
    }

    pub fn prev(&mut self) -> Result<(), String> {
        self.advance_track(-1)
    }

    fn advance_track(&mut self, delta: i32) -> Result<(), String> {
        let station_id = self
            .state
            .current_station_id
            .clone()
            .ok_or_else(|| "no station selected".to_string())?;
        let station = self
            .station(&station_id)
            .ok_or_else(|| format!("unknown station: {station_id}"))?;
        let track_count = match &station.source {
            StationSource::YoutubeTracks { tracks } => tracks.len() as u32,
            StationSource::Stream { .. } => {
                return Err(format!("station {station_id} has no tracks"));
            }
        };
        if track_count == 0 {
            return Err(format!("station {station_id} has no tracks"));
        }
        let cursor = self
            .state
            .station_cursors
            .entry(station_id)
            .or_insert_with(|| StationCursor {
                current_track_index: 0,
                position_sec: 0,
                shuffle_order: generate_shuffle(track_count),
            });
        let len = track_count as i32;
        let next = (cursor.current_track_index as i32 + delta).rem_euclid(len) as u32;
        if delta > 0 && next == 0 {
            // Wrapped — reshuffle so the user gets a fresh sequence.
            cursor.shuffle_order = generate_shuffle(track_count);
        }
        cursor.current_track_index = next;
        cursor.position_sec = 0;
        Ok(())
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.state.volume = volume.clamp(0.0, 1.0);
    }

    pub fn report_position(&mut self, position_sec: u32) {
        if let Some(station_id) = self.state.current_station_id.clone() {
            if let Some(cursor) = self.state.station_cursors.get_mut(&station_id) {
                cursor.position_sec = position_sec;
            }
        }
    }

    /// Resolve the current station + (for YouTube) the current track.
    pub fn now_playing(&self) -> Option<NowPlaying> {
        let station_id = self.state.current_station_id.as_deref()?;
        let station = self.station(station_id)?.clone();
        let (track, track_index_in_station) = match &station.source {
            StationSource::YoutubeTracks { tracks } => {
                let cursor = self.state.station_cursors.get(station_id)?;
                let track_idx = *cursor.shuffle_order.get(cursor.current_track_index as usize)?;
                let track = tracks.get(track_idx as usize)?.clone();
                (Some(track), Some(track_idx))
            }
            StationSource::Stream { .. } => (None, None),
        };
        Some(NowPlaying {
            station,
            track,
            track_index_in_station,
            status: self.state.status,
        })
    }

    /// Persist runtime state to disk. Best-effort.
    pub fn persist(&self) {
        let payload = match serde_json::to_vec_pretty(&self.state) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("Failed to serialize radio state: {}", e);
                return;
            }
        };
        if let Some(parent) = self.persistence_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(&self.persistence_path, payload) {
            tracing::warn!(
                "Failed to write radio state to {}: {}",
                self.persistence_path.display(),
                e
            );
        }
    }
}

fn generate_shuffle(track_count: u32) -> Vec<u32> {
    let mut order: Vec<u32> = (0..track_count).collect();
    let mut rng = rand::thread_rng();
    order.shuffle(&mut rng);
    order
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    fn fresh() -> RadioService {
        let path = temp_dir().join(format!(
            "radio_test_{}.json",
            uuid::Uuid::new_v4().simple()
        ));
        RadioService::new(path)
    }

    #[test]
    fn embedded_json_parses_cleanly() {
        let parsed: Result<StationsFile, _> =
            serde_json::from_str(EMBEDDED_STATIONS_JSON);
        if let Err(e) = &parsed {
            panic!("embedded radio stations JSON failed to parse: {e}");
        }
    }

    #[test]
    fn loads_curated_catalog() {
        let svc = fresh();
        // Seed has at least one of each engine kind.
        assert!(
            svc.stations().iter().any(|s| matches!(s.source, StationSource::YoutubeTracks { .. })),
            "seed must include at least one youtubeTracks station"
        );
        assert!(
            svc.stations().iter().any(|s| matches!(s.source, StationSource::Stream { .. })),
            "seed must include at least one stream station"
        );
    }

    #[test]
    fn streams_have_https_urls_and_youtube_have_video_ids() {
        let svc = fresh();
        for station in svc.stations() {
            match &station.source {
                StationSource::Stream { stream_url } => {
                    assert!(
                        stream_url.starts_with("https://"),
                        "stream {} must be HTTPS",
                        station.id
                    );
                }
                StationSource::YoutubeTracks { tracks } => {
                    assert!(!tracks.is_empty(), "youtubeTracks station {} has no tracks", station.id);
                    for track in tracks {
                        assert!(!track.video_id.is_empty(), "track in {} has empty video_id", station.id);
                    }
                }
            }
        }
    }

    #[test]
    fn play_with_no_station_picks_default() {
        let mut svc = fresh();
        svc.play().expect("play should succeed");
        assert!(svc.state.current_station_id.is_some());
        assert_eq!(svc.state.status, PlayStatus::Playing);
    }

    #[test]
    fn next_advances_track_in_youtube_station() {
        let mut svc = fresh();
        let yt_station_id = svc
            .stations()
            .iter()
            .find(|s| matches!(s.source, StationSource::YoutubeTracks { .. }))
            .map(|s| s.id.clone())
            .expect("seed has a youtubeTracks station");
        svc.set_station(&yt_station_id).unwrap();
        let before = svc.state.station_cursors[&yt_station_id].current_track_index;
        svc.next().unwrap();
        let after = svc.state.station_cursors[&yt_station_id].current_track_index;
        assert_ne!(before, after, "next should advance the cursor");
    }

    #[test]
    fn next_errors_for_stream_station() {
        let mut svc = fresh();
        let stream_station_id = svc
            .stations()
            .iter()
            .find(|s| matches!(s.source, StationSource::Stream { .. }))
            .map(|s| s.id.clone())
            .expect("seed has a stream station");
        svc.set_station(&stream_station_id).unwrap();
        let res = svc.next();
        assert!(res.is_err(), "next on a stream station must Err");
    }

    #[test]
    fn switch_youtube_station_preserves_cursor() {
        let mut svc = fresh();
        let yt_ids: Vec<String> = svc
            .stations()
            .iter()
            .filter(|s| matches!(s.source, StationSource::YoutubeTracks { .. }))
            .map(|s| s.id.clone())
            .collect();
        if yt_ids.len() < 2 {
            return; // single-YouTube-station seeds skip this assertion
        }
        svc.set_station(&yt_ids[0]).unwrap();
        svc.next().unwrap();
        let first_idx = svc.state.station_cursors[&yt_ids[0]].current_track_index;
        svc.set_station(&yt_ids[1]).unwrap();
        svc.set_station(&yt_ids[0]).unwrap();
        let after = svc.state.station_cursors[&yt_ids[0]].current_track_index;
        assert_eq!(first_idx, after);
    }

    #[test]
    fn now_playing_for_stream_has_no_track() {
        let mut svc = fresh();
        let stream_station_id = svc
            .stations()
            .iter()
            .find(|s| matches!(s.source, StationSource::Stream { .. }))
            .map(|s| s.id.clone())
            .expect("seed has a stream station");
        svc.set_station(&stream_station_id).unwrap();
        let np = svc.now_playing().expect("now_playing resolves");
        assert!(np.track.is_none(), "stream station now_playing has no track");
        assert!(np.track_index_in_station.is_none());
    }

    #[test]
    fn now_playing_for_youtube_resolves_track() {
        let mut svc = fresh();
        let yt_station_id = svc
            .stations()
            .iter()
            .find(|s| matches!(s.source, StationSource::YoutubeTracks { .. }))
            .map(|s| s.id.clone())
            .expect("seed has a youtubeTracks station");
        svc.set_station(&yt_station_id).unwrap();
        let np = svc.now_playing().expect("now_playing resolves");
        let track = np.track.expect("youtubeTracks station resolves a track");
        assert!(!track.video_id.is_empty());
    }

    #[test]
    fn set_volume_clamps() {
        let mut svc = fresh();
        svc.set_volume(2.5);
        assert_eq!(svc.state.volume, 1.0);
        svc.set_volume(-0.3);
        assert_eq!(svc.state.volume, 0.0);
    }

    #[test]
    fn unknown_persisted_station_is_discarded_at_boot() {
        let path = temp_dir().join(format!(
            "radio_test_{}.json",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "currentStationId": "nonexistent-station",
                "status": "playing",
                "volume": 0.5,
                "stationCursors": {
                    "alsoNonexistent": {
                        "currentTrackIndex": 0,
                        "positionSec": 0,
                        "shuffleOrder": [0]
                    }
                }
            })).unwrap(),
        ).unwrap();
        let svc = RadioService::new(path);
        assert_eq!(svc.state.current_station_id, None);
        assert!(svc.state.station_cursors.is_empty(), "stale cursor should be evicted");
    }
}
