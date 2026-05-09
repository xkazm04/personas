//! Tauri command handlers for the radio feature. Commands acquire the
//! `RadioServiceHandle` mutex, mutate the service, persist state, and emit
//! a `radio:command` event so the hidden player window can react.

use tauri::{AppHandle, Emitter, State};

use crate::radio::{NowPlaying, PlayStatus, RadioService, RadioServiceHandle, RadioState, Station};

/// Tauri event emitted to the radio player window with a command kind +
/// payload. The hidden window's IFrame Player listener dispatches by `kind`.
const RADIO_COMMAND_EVENT: &str = "radio:command";
/// Tauri event emitted to the main window with the latest `RadioState` after
/// every mutation, so the footer can re-render without polling.
const RADIO_STATE_EVENT: &str = "radio:state";

fn with_service<F, R>(state: &State<'_, RadioServiceHandle>, f: F) -> Result<R, String>
where
    F: FnOnce(&mut RadioService) -> R,
{
    let mut svc = state
        .0
        .lock()
        .map_err(|e| format!("radio service mutex poisoned: {e}"))?;
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
pub fn radio_list_stations(state: State<'_, RadioServiceHandle>) -> Result<Vec<Station>, String> {
    with_service(&state, |svc| svc.stations().to_vec())
}

#[tauri::command]
pub fn radio_get_state(state: State<'_, RadioServiceHandle>) -> Result<RadioState, String> {
    with_service(&state, |svc| snapshot(svc))
}

#[tauri::command]
pub fn radio_get_now_playing(
    state: State<'_, RadioServiceHandle>,
) -> Result<Option<NowPlaying>, String> {
    with_service(&state, |svc| svc.now_playing())
}

#[tauri::command]
pub fn radio_play(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
) -> Result<RadioState, String> {
    let snap = with_service(&state, |svc| {
        svc.play()?;
        svc.persist();
        Ok::<_, String>(snapshot(svc))
    })??;
    let _ = app.emit(RADIO_COMMAND_EVENT, serde_json::json!({ "kind": "play" }));
    broadcast(&app, &snap);
    Ok(snap)
}

#[tauri::command]
pub fn radio_pause(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
) -> Result<RadioState, String> {
    let snap = with_service(&state, |svc| {
        svc.pause();
        svc.persist();
        snapshot(svc)
    })?;
    let _ = app.emit(RADIO_COMMAND_EVENT, serde_json::json!({ "kind": "pause" }));
    broadcast(&app, &snap);
    Ok(snap)
}

#[tauri::command]
pub fn radio_next(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
) -> Result<RadioState, String> {
    let snap = with_service(&state, |svc| {
        svc.next()?;
        svc.persist();
        Ok::<_, String>(snapshot(svc))
    })??;
    let _ = app.emit(RADIO_COMMAND_EVENT, serde_json::json!({ "kind": "next" }));
    broadcast(&app, &snap);
    Ok(snap)
}

#[tauri::command]
pub fn radio_prev(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
) -> Result<RadioState, String> {
    let snap = with_service(&state, |svc| {
        svc.prev()?;
        svc.persist();
        Ok::<_, String>(snapshot(svc))
    })??;
    let _ = app.emit(RADIO_COMMAND_EVENT, serde_json::json!({ "kind": "prev" }));
    broadcast(&app, &snap);
    Ok(snap)
}

#[tauri::command]
pub fn radio_set_station(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
    station_id: String,
) -> Result<RadioState, String> {
    let snap = with_service(&state, |svc| {
        svc.set_station(&station_id)?;
        svc.set_status(PlayStatus::Playing);
        svc.persist();
        Ok::<_, String>(snapshot(svc))
    })??;
    let _ = app.emit(
        RADIO_COMMAND_EVENT,
        serde_json::json!({ "kind": "set_station", "stationId": station_id }),
    );
    broadcast(&app, &snap);
    Ok(snap)
}

#[tauri::command]
pub fn radio_set_volume(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
    volume: f32,
) -> Result<RadioState, String> {
    let snap = with_service(&state, |svc| {
        svc.set_volume(volume);
        svc.persist();
        snapshot(svc)
    })?;
    let _ = app.emit(
        RADIO_COMMAND_EVENT,
        serde_json::json!({ "kind": "set_volume", "volume": volume.clamp(0.0, 1.0) }),
    );
    broadcast(&app, &snap);
    Ok(snap)
}

/// Called by the hidden player window when the YouTube IFrame fires `onStateChange`,
/// so the Rust state stays in sync with what the player is actually doing
/// (especially Buffering vs Playing transitions and end-of-track detection).
#[tauri::command]
pub fn radio_report_status(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
    status: PlayStatus,
    position_sec: Option<u32>,
) -> Result<RadioState, String> {
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

/// Called by the hidden player window when a track ends. We advance the
/// cursor and re-emit `radio:command` with `play` so the player picks up
/// the next track.
#[tauri::command]
pub fn radio_track_ended(
    app: AppHandle,
    state: State<'_, RadioServiceHandle>,
) -> Result<RadioState, String> {
    let snap = with_service(&state, |svc| {
        svc.next()?;
        svc.set_status(PlayStatus::Playing);
        svc.persist();
        Ok::<_, String>(snapshot(svc))
    })??;
    let _ = app.emit(RADIO_COMMAND_EVENT, serde_json::json!({ "kind": "play" }));
    broadcast(&app, &snap);
    Ok(snap)
}
