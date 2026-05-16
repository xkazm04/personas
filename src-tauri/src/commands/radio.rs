//! Tauri command handlers for the radio feature. Commands acquire the
//! `RadioServiceHandle` mutex, mutate the service, persist state, and emit
//! a `radio:state` event so the footer can re-render without polling.

use serde::Deserialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use crate::error::AppError;
use crate::radio::{
    NowPlaying, PlayStatus, RadioService, RadioServiceHandle, RadioState, Station, StreamMetadata,
};

/// Tauri event emitted to the main window with the latest `RadioState`
/// after every mutation, so the footer can re-render without polling.
const RADIO_STATE_EVENT: &str = "radio:state";

fn with_service<F, R>(state: &State<'_, RadioServiceHandle>, f: F) -> Result<R, AppError>
where
    F: FnOnce(&mut RadioService) -> R,
{
    let mut svc = state
        .0
        .lock()
        .map_err(|e| AppError::Internal(format!("radio service mutex poisoned: {e}")))?;
    Ok(f(&mut svc))
}

fn snapshot(svc: &RadioService) -> RadioState {
    svc.state().clone()
}

fn broadcast(app: &AppHandle, state: &RadioState) {
    if let Err(e) = app.emit(RADIO_STATE_EVENT, state) {
        tracing::warn!("Failed to emit {}: {}", RADIO_STATE_EVENT, e);
    }
}

#[tauri::command]
pub fn radio_list_stations(
    state: State<'_, RadioServiceHandle>,
) -> Result<Vec<Station>, AppError> {
    with_service(&state, |svc| svc.stations().to_vec())
}

#[tauri::command]
pub fn radio_get_state(state: State<'_, RadioServiceHandle>) -> Result<RadioState, AppError> {
    with_service(&state, |svc| snapshot(svc))
}

#[tauri::command]
pub fn radio_get_now_playing(
    state: State<'_, RadioServiceHandle>,
) -> Result<Option<NowPlaying>, AppError> {
    with_service(&state, |svc| svc.now_playing())
}

#[tauri::command]
pub fn radio_play(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
) -> Result<RadioState, AppError> {
    let snap = with_service(&state, |svc| {
        svc.play().map_err(AppError::Execution)?;
        svc.persist();
        Ok::<_, AppError>(snapshot(svc))
    })??;
    broadcast(&app, &snap);
    Ok(snap)
}

#[tauri::command]
pub fn radio_pause(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
) -> Result<RadioState, AppError> {
    let snap = with_service(&state, |svc| {
        svc.pause();
        svc.persist();
        snapshot(svc)
    })?;
    broadcast(&app, &snap);
    Ok(snap)
}

#[tauri::command]
pub fn radio_next(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
) -> Result<RadioState, AppError> {
    let snap = with_service(&state, |svc| {
        svc.next().map_err(AppError::Execution)?;
        svc.set_status(PlayStatus::Playing);
        svc.persist();
        Ok::<_, AppError>(snapshot(svc))
    })??;
    broadcast(&app, &snap);
    Ok(snap)
}

#[tauri::command]
pub fn radio_prev(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
) -> Result<RadioState, AppError> {
    let snap = with_service(&state, |svc| {
        svc.prev().map_err(AppError::Execution)?;
        svc.set_status(PlayStatus::Playing);
        svc.persist();
        Ok::<_, AppError>(snapshot(svc))
    })??;
    broadcast(&app, &snap);
    Ok(snap)
}

#[tauri::command]
pub fn radio_set_station(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
    station_id: String,
) -> Result<RadioState, AppError> {
    let snap = with_service(&state, |svc| {
        svc.set_station(&station_id).map_err(AppError::Execution)?;
        svc.set_status(PlayStatus::Playing);
        svc.persist();
        Ok::<_, AppError>(snapshot(svc))
    })??;
    broadcast(&app, &snap);
    Ok(snap)
}

#[tauri::command]
pub fn radio_set_volume(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
    volume: f32,
) -> Result<RadioState, AppError> {
    let snap = with_service(&state, |svc| {
        svc.set_volume(volume);
        svc.persist();
        snapshot(svc)
    })?;
    broadcast(&app, &snap);
    Ok(snap)
}

/// Renderer reports an HTMLMediaElement / IFrame Player state transition.
/// `position_sec` is optional — only YouTube tracks expose meaningful
/// playback positions; live streams pass `None`.
#[tauri::command]
pub fn radio_report_status(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
    status: PlayStatus,
    position_sec: Option<u32>,
) -> Result<RadioState, AppError> {
    let snap = with_service(&state, |svc| {
        svc.set_status(status);
        if let Some(pos) = position_sec {
            svc.report_position(pos);
        }
        svc.persist();
        snapshot(svc)
    })?;
    broadcast(&app, &snap);
    Ok(snap)
}

/// Renderer signals end-of-track for a `youtubeTracks` station (natural
/// ENDED state, or skip-on-error after onError 100/101/150). We advance
/// the cursor and re-emit so the renderer picks up the next track.
/// Stream stations should never call this; if they do it returns Err and
/// the renderer ignores the response.
#[tauri::command]
pub fn radio_track_ended(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
) -> Result<RadioState, AppError> {
    let snap = with_service(&state, |svc| {
        svc.next().map_err(AppError::Execution)?;
        svc.set_status(PlayStatus::Playing);
        svc.persist();
        Ok::<_, AppError>(snapshot(svc))
    })??;
    broadcast(&app, &snap);
    Ok(snap)
}

/// Shape of the SomaFM `/songs/{slug}.json` response. We only consume
/// the first entry (current track); historical entries are ignored.
#[derive(Debug, Deserialize)]
struct SomaFmResponse {
    songs: Vec<SomaFmSong>,
}

#[derive(Debug, Deserialize)]
struct SomaFmSong {
    title: String,
    artist: String,
}

/// Sanity bound on the slug so we can't be tricked into forging an
/// arbitrary URL path. SomaFM slugs are short, lowercase, ASCII.
fn is_safe_somafm_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 64
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Fetch the current track for a SomaFM stream station. Runs server-side
/// (in Rust) so the renderer doesn't need a CSP entry for `somafm.com`
/// apex. Returns `Ok(None)` on any non-fatal failure (network blip, empty
/// `songs` array, parse error) — the renderer treats absence as "no
/// metadata available right now" and keeps showing the station name.
#[tauri::command]
pub async fn radio_fetch_somafm_metadata(slug: String) -> Result<Option<StreamMetadata>, AppError> {
    if !is_safe_somafm_slug(&slug) {
        return Ok(None);
    }
    let url = format!("https://somafm.com/songs/{slug}.json");
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("Personas/0.1 (radio metadata)")
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };
    if !resp.status().is_success() {
        return Ok(None);
    }
    let body: SomaFmResponse = match resp.json().await {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };
    Ok(body.songs.into_iter().next().map(|s| StreamMetadata {
        title: s.title,
        artist: s.artist,
    }))
}
