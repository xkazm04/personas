# Radio

A small footer-anchored player that streams curated YouTube tracks in the
background while the app runs. Audio survives main-window minimize and close —
the player lives in a separate hidden Tauri WebviewWindow that the system tray
keeps alive.

## What the user sees

- A pill-shaped controller pinned to the bottom-right of the main window
  (`RadioFooter`) with the current track title, an accent dot for the current
  station, play/pause, skip, and a station-switch icon.
- Clicking the station icon opens `StationPicker`, listing every curated
  station. Picking one resumes that station's playback cursor (so switching
  away and back doesn't restart the tracklist).
- A "Radio" card in **Settings → Account** (`RadioSettingsCard`) that lists
  the curated stations and their tracklists for transparency. Read-only —
  there is no in-app editor for curation today.

## Architecture

```
┌─ Main window ──────────────────┐    ┌─ Hidden "radio" window ─────┐
│ RadioFooter                    │    │ public/radio.html           │
│   ↕ uses radioApi (invoke)     │    │   ↕ window.__TAURI__         │
│   ↕ listens "radio:state"      │    │   ↕ YouTube IFrame Player   │
└──────────────┬─────────────────┘    └──────────────┬──────────────┘
               │                                     │
               ▼                                     ▼
       ┌────────────────────────────────────────────────────┐
       │ RadioService (src-tauri/src/radio/)                │
       │   stations: Vec<Station>  (curated, baked in)      │
       │   state: RadioState       (per-station cursors)    │
       │   persistence: <config>/radio_state.json           │
       └────────────────────────────────────────────────────┘
```

- **Curated stations** live in [`src-tauri/data/radio_stations.json`](../../src-tauri/data/radio_stations.json).
  The JSON is `include_str!`-baked into the binary, so users see the same
  curated catalog the team shipped — no editor surface.
- **Hidden player window** is declared in `tauri.conf.json` as window label
  `radio` (visible: false, skipTaskbar: true, decorations: false). It loads
  `public/radio.html` which boots the YouTube IFrame Player API and listens
  for `radio:command` events from Rust.
- **Per-station cursors** are kept in `RadioState.station_cursors` so
  switching stations preserves where each station was. The shuffle order
  for a station is generated on first selection and reshuffled at the end
  of the cycle.
- **Persistence** writes runtime state (current station, cursors, volume,
  status) to `<app_data_dir>/radio_state.json` after every mutation. On
  startup the file is loaded if present so the app resumes the last station
  + position.

## Tauri command surface

All commands are wrapped via `invokeWithTimeout` in
[`src/features/radio/api/radioApi.ts`](../../src/features/radio/api/radioApi.ts).

| Command | Direction | Purpose |
| --- | --- | --- |
| `radio_list_stations` | UI → Rust | List curated stations + tracks |
| `radio_get_state` | UI → Rust | Read current `RadioState` |
| `radio_get_now_playing` | UI / hidden window → Rust | Resolve current station + track |
| `radio_play` | UI → Rust | Start (auto-picks default station if none selected) |
| `radio_pause` | UI → Rust | Pause |
| `radio_next` | UI → Rust | Advance cursor (reshuffle on wrap) |
| `radio_prev` | UI → Rust | Step cursor back |
| `radio_set_station` | UI → Rust | Switch station, preserve its cursor |
| `radio_set_volume` | UI → Rust | Volume in [0.0, 1.0] |
| `radio_report_status` | hidden window → Rust | Report YouTube IFrame Player state changes + position |
| `radio_track_ended` | hidden window → Rust | Auto-advance on natural track end |

## Tauri events

| Event | Direction | Payload |
| --- | --- | --- |
| `radio:command` | Rust → hidden window | `{ kind: 'play' \| 'pause' \| 'next' \| 'prev' \| 'set_station' \| 'set_volume', ... }` |
| `radio:state` | Rust → main window | `RadioState` snapshot after every mutation |

## YouTube ToS note

The hidden audio-only player is **ToS-grey**. YouTube's terms require the
player to remain visible while audio plays. At zero adoption this is a
deliberate, accepted risk (see in-session decision 2026-05-09). Before any
public launch, revisit this — options are (a) make the player a small
visible mini-window, (b) gate behind YouTube Premium detection, or (c)
swap the source to a license-friendly alternative.

## Adding or curating stations

Edit [`src-tauri/data/radio_stations.json`](../../src-tauri/data/radio_stations.json).
Each station needs `id`, `slug`, `name`, `description`, `accent_color`, and
`tracks[]`. Each track needs `video_id` (YouTube id), `title`, `artist`, and
`duration_sec` (optional — `null` is fine; the player reports the real value
at runtime).

After editing, the change ships in the next build — the JSON is baked into
the binary at compile time via `include_str!`. No migration, no DB write.

## Files

- [`src-tauri/src/radio/mod.rs`](../../src-tauri/src/radio/mod.rs) — types
- [`src-tauri/src/radio/service.rs`](../../src-tauri/src/radio/service.rs) — service + persistence
- [`src-tauri/src/commands/radio.rs`](../../src-tauri/src/commands/radio.rs) — Tauri command handlers
- [`src-tauri/data/radio_stations.json`](../../src-tauri/data/radio_stations.json) — curated catalog
- [`public/radio.html`](../../public/radio.html) — hidden player page (IFrame Player API)
- [`src/features/radio/`](../../src/features/radio/) — frontend feature module
