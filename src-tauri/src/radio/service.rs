//! `RadioService` owns the curated stations + runtime playback state. State
//! mutations go through the `&mut self` methods so the lock scope stays
//! obvious at call sites.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::{NowPlaying, PlayStatus, RadioState, Station};

/// On-disk shape of `src-tauri/data/radio_stations.json`. Versioned in case
/// we ever need to migrate. Uses camelCase to match `Station`'s serde
/// rename (which ts-rs in turn relies on to produce the camelCase TS
/// bindings consumed by the frontend).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StationsFile {
    #[serde(default = "default_version")]
    version: u32,
    default_station_id: Option<String>,
    stations: Vec<Station>,
}

fn default_version() -> u32 {
    2
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

    /// Switch to `station_id`. Live streams have no per-station playback
    /// cursor, so this is a straight assignment.
    pub fn set_station(&mut self, station_id: &str) -> Result<(), String> {
        if !self.stations.iter().any(|s| s.id == station_id) {
            return Err(format!("unknown station: {station_id}"));
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

    /// Cycle to the next curated station. With live streams there is no
    /// "next track" concept, so the next button rotates through the catalog.
    pub fn next(&mut self) -> Result<(), String> {
        let next_id = self.adjacent_station_id(1)?;
        self.set_station(&next_id)
    }

    pub fn prev(&mut self) -> Result<(), String> {
        let prev_id = self.adjacent_station_id(-1)?;
        self.set_station(&prev_id)
    }

    fn adjacent_station_id(&self, delta: i32) -> Result<String, String> {
        if self.stations.is_empty() {
            return Err("no stations configured".to_string());
        }
        let len = self.stations.len() as i32;
        let current_idx = self
            .state
            .current_station_id
            .as_ref()
            .and_then(|id| self.stations.iter().position(|s| &s.id == id))
            .map(|i| i as i32)
            .unwrap_or(0);
        let next_idx = (current_idx + delta).rem_euclid(len) as usize;
        Ok(self.stations[next_idx].id.clone())
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.state.volume = volume.clamp(0.0, 1.0);
    }

    /// Resolve the current station for emit/payload purposes. Returns `None`
    /// when no station is selected.
    pub fn now_playing(&self) -> Option<NowPlaying> {
        let station_id = self.state.current_station_id.as_deref()?;
        let station = self.stations.iter().find(|s| s.id == station_id)?.clone();
        Some(NowPlaying {
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
    fn loads_curated_stations() {
        let svc = fresh();
        // The seed file ships with at least Lofi + Focus.
        assert!(svc.stations().iter().any(|s| s.id == "lofi"));
        assert!(svc.stations().iter().any(|s| s.id == "focus"));
    }

    #[test]
    fn every_station_has_https_stream_url() {
        let svc = fresh();
        for station in svc.stations() {
            assert!(
                station.stream_url.starts_with("https://"),
                "station {} stream_url must be HTTPS, got {}",
                station.id,
                station.stream_url
            );
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
    fn next_cycles_through_stations_and_wraps() {
        let mut svc = fresh();
        let ids: Vec<String> = svc.stations().iter().map(|s| s.id.clone()).collect();
        assert!(ids.len() >= 2, "test requires at least 2 stations");

        svc.set_station(&ids[0]).unwrap();
        svc.next().unwrap();
        assert_eq!(svc.state.current_station_id.as_deref(), Some(ids[1].as_str()));

        // Cycle the rest of the way around — should land back on ids[0].
        for _ in 0..(ids.len() - 1) {
            svc.next().unwrap();
        }
        assert_eq!(svc.state.current_station_id.as_deref(), Some(ids[0].as_str()));
    }

    #[test]
    fn prev_wraps_backwards() {
        let mut svc = fresh();
        let ids: Vec<String> = svc.stations().iter().map(|s| s.id.clone()).collect();
        svc.set_station(&ids[0]).unwrap();
        svc.prev().unwrap();
        assert_eq!(svc.state.current_station_id.as_deref(), Some(ids.last().unwrap().as_str()));
    }

    #[test]
    fn now_playing_returns_current_station() {
        let mut svc = fresh();
        svc.set_station("lofi").unwrap();
        let np = svc.now_playing().expect("now playing should resolve");
        assert_eq!(np.station.id, "lofi");
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
            })).unwrap(),
        ).unwrap();
        let svc = RadioService::new(path);
        assert_eq!(svc.state.current_station_id, None);
    }
}
