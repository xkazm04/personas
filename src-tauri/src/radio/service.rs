//! `RadioService` owns the curated stations + runtime playback state. State
//! mutations go through the `&mut self` methods so the lock scope stays
//! obvious at call sites.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};

use super::{NowPlaying, PlayStatus, RadioState, Station, StationCursor, Track};

/// On-disk shape of `src-tauri/data/radio_stations.json`. Versioned in case
/// we ever need to migrate.
#[derive(Debug, Clone, Deserialize, Serialize)]
struct StationsFile {
    #[serde(default = "default_version")]
    version: u32,
    default_station_id: Option<String>,
    stations: Vec<Station>,
}

fn default_version() -> u32 {
    1
}

/// Embedded fallback used when the JSON file is missing in dev builds and
/// when `cargo test` runs from a sandbox. Kept in sync with `radio_stations.json`.
const EMBEDDED_STATIONS_JSON: &str = include_str!("../../data/radio_stations.json");

pub struct RadioService {
    stations: Vec<Station>,
    default_station_id: Option<String>,
    state: RadioState,
    persistence_path: PathBuf,
}

/// Newtype wrapper so Tauri's typed state lookup unambiguously resolves to
/// the radio service (avoids collisions with other `Arc<Mutex<…>>`-managed
/// state).
pub struct RadioServiceHandle(pub Arc<Mutex<RadioService>>);

impl RadioService {
    /// Boot the service. Loads curated stations from the embedded JSON,
    /// then attempts to overlay any persisted runtime state from disk.
    /// Persistence-load failures are logged and ignored — the service always
    /// boots into a usable state.
    pub fn new(persistence_path: PathBuf) -> Self {
        let parsed: StationsFile = serde_json::from_str(EMBEDDED_STATIONS_JSON)
            .unwrap_or_else(|e| {
                tracing::error!("Failed to parse embedded radio stations JSON: {}", e);
                StationsFile {
                    version: 1,
                    default_station_id: None,
                    stations: Vec::new(),
                }
            });

        let state = match std::fs::read_to_string(&persistence_path) {
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

    /// Switch to `station_id`. If the station has no cursor yet, generate
    /// a fresh shuffle. If a cursor exists, leave it alone — switching back
    /// to a previously-played station resumes its tracklist position.
    pub fn set_station(&mut self, station_id: &str) -> Result<(), String> {
        let station = self
            .stations
            .iter()
            .find(|s| s.id == station_id)
            .ok_or_else(|| format!("unknown station: {station_id}"))?;
        let track_count = station.tracks.len() as u32;
        self.state
            .station_cursors
            .entry(station_id.to_string())
            .or_insert_with(|| StationCursor {
                current_track_index: 0,
                position_sec: 0,
                shuffle_order: generate_shuffle(track_count),
            });
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

    /// Advance to the next track. Wraps at end of shuffle order with a
    /// reshuffle so the user gets a fresh sequence rather than a loop.
    pub fn next(&mut self) -> Result<(), String> {
        let station_id = self
            .state
            .current_station_id
            .clone()
            .ok_or_else(|| "no station selected".to_string())?;
        let track_count = self
            .stations
            .iter()
            .find(|s| s.id == station_id)
            .map(|s| s.tracks.len() as u32)
            .ok_or_else(|| format!("unknown station: {station_id}"))?;
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
        cursor.current_track_index = cursor.current_track_index.saturating_add(1);
        if cursor.current_track_index >= track_count {
            cursor.shuffle_order = generate_shuffle(track_count);
            cursor.current_track_index = 0;
        }
        cursor.position_sec = 0;
        Ok(())
    }

    pub fn prev(&mut self) -> Result<(), String> {
        let station_id = self
            .state
            .current_station_id
            .clone()
            .ok_or_else(|| "no station selected".to_string())?;
        let track_count = self
            .stations
            .iter()
            .find(|s| s.id == station_id)
            .map(|s| s.tracks.len() as u32)
            .ok_or_else(|| format!("unknown station: {station_id}"))?;
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
        cursor.current_track_index = if cursor.current_track_index == 0 {
            track_count - 1
        } else {
            cursor.current_track_index - 1
        };
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

    /// Resolve the current track for emit/payload purposes. Returns `None`
    /// when no station is selected or the cursor points at an empty list.
    pub fn now_playing(&self) -> Option<NowPlaying> {
        let station_id = self.state.current_station_id.as_deref()?;
        let station = self.stations.iter().find(|s| s.id == station_id)?.clone();
        let cursor = self.state.station_cursors.get(station_id)?;
        let track_idx = *cursor.shuffle_order.get(cursor.current_track_index as usize)?;
        let track = station.tracks.get(track_idx as usize)?.clone();
        Some(NowPlaying {
            track_index_in_station: track_idx,
            track,
            station,
            status: self.state.status,
        })
    }

    /// Persist runtime state to disk. Best-effort — failures are logged and
    /// swallowed so a transient FS error doesn't crash the radio.
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

/// Picks the playback track for a station given an existing or fresh cursor.
/// Used by tests; the runtime path goes through `RadioService::now_playing`.
#[cfg(test)]
fn track_at_cursor<'a>(station: &'a Station, cursor: &StationCursor) -> Option<&'a Track> {
    let order_idx = cursor.current_track_index as usize;
    let track_idx = *cursor.shuffle_order.get(order_idx)? as usize;
    station.tracks.get(track_idx)
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
    fn loads_curated_stations() {
        let svc = fresh();
        // The seed file ships with at least Lofi + Focus.
        assert!(svc.stations().iter().any(|s| s.id == "lofi"));
        assert!(svc.stations().iter().any(|s| s.id == "focus"));
    }

    #[test]
    fn play_with_no_station_picks_default() {
        let mut svc = fresh();
        svc.play().expect("play should succeed");
        assert!(svc.state.current_station_id.is_some());
        assert_eq!(svc.state.status, PlayStatus::Playing);
    }

    #[test]
    fn switch_station_preserves_cursor() {
        let mut svc = fresh();
        svc.set_station("lofi").unwrap();
        svc.next().unwrap();
        let lofi_idx = svc
            .state
            .station_cursors
            .get("lofi")
            .map(|c| c.current_track_index)
            .unwrap();
        svc.set_station("focus").unwrap();
        svc.set_station("lofi").unwrap();
        let after_switch_back = svc
            .state
            .station_cursors
            .get("lofi")
            .map(|c| c.current_track_index)
            .unwrap();
        assert_eq!(
            lofi_idx, after_switch_back,
            "switching away and back must not reset cursor"
        );
    }

    #[test]
    fn next_wraps_with_reshuffle_at_end() {
        let mut svc = fresh();
        svc.set_station("lofi").unwrap();
        let track_count = svc
            .stations()
            .iter()
            .find(|s| s.id == "lofi")
            .unwrap()
            .tracks
            .len() as u32;
        for _ in 0..track_count {
            svc.next().unwrap();
        }
        // After wrapping, current_track_index is back to 0
        let cursor = svc.state.station_cursors.get("lofi").unwrap();
        assert_eq!(cursor.current_track_index, 0);
        assert_eq!(cursor.shuffle_order.len() as u32, track_count);
    }

    #[test]
    fn now_playing_returns_correct_track() {
        let mut svc = fresh();
        svc.set_station("lofi").unwrap();
        let np = svc.now_playing().expect("now playing should resolve");
        assert_eq!(np.station.id, "lofi");
        // The resolved track must be one of the station's tracks
        assert!(np.station.tracks.iter().any(|t| t.video_id == np.track.video_id));
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
    fn track_at_cursor_resolves_through_shuffle() {
        let svc = fresh();
        let lofi = svc.stations().iter().find(|s| s.id == "lofi").unwrap();
        let cursor = StationCursor {
            current_track_index: 0,
            position_sec: 0,
            shuffle_order: vec![1, 0],
        };
        let track = track_at_cursor(lofi, &cursor).unwrap();
        assert_eq!(track.video_id, lofi.tracks[1].video_id);
    }
}
