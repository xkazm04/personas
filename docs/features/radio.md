# Radio

A small footer-anchored player that streams curated internet-radio
stations in the background while the app runs. The footer owns an HTML5
`<audio>` element pointed at the current station's stream URL; the Rust
backend is the source of truth for `current_station_id` / `status` /
`volume` and persists those across restarts.

## What the user sees

- A pill-shaped controller pinned to the bottom-right of the main window
  (`RadioFooter`) with the current station name + description, an accent
  dot for the current station, play/pause, "next station", and a
  station-switch icon.
- Clicking the station icon opens `StationPicker`, listing every curated
  station with its provider label as the secondary line.
- A "Radio" card in **Settings → Account** (`RadioSettingsCard`) that
  lists the curated stations with provider attribution + a link to the
  source homepage. Read-only — there is no in-app editor for curation.
- If a stream fails to start within ~8 seconds (or fires an `error`
  event), the footer pauses, reports `stopped`, and shows a localized
  toast ("`<station>` is unavailable right now…").

## Architecture

```
┌─ Main window ──────────────────────────────────────┐
│ RadioFooter                                        │
│   <audio src={station.streamUrl}>                  │
│   ↕ uses radioApi (invoke)                         │
│   ↕ listens "radio:state"                          │
│   ↕ reports playing/paused/buffering/stopped       │
│     via radio_report_status                        │
└──────────────────────┬─────────────────────────────┘
                       │
                       ▼
       ┌────────────────────────────────────────────────────┐
       │ RadioService (src-tauri/src/radio/)                │
       │   stations: Vec<Station>  (curated, baked in)      │
       │   state: RadioState       (id + status + volume)   │
       │   persistence: <config>/radio_state.json           │
       └────────────────────────────────────────────────────┘
```

- **Curated stations** live in [`src-tauri/data/radio_stations.json`](../../src-tauri/data/radio_stations.json).
  The JSON is `include_str!`-baked into the binary so users see the same
  curated catalog the team shipped — no editor surface.
- **No hidden window.** The previous architecture used a separate
  `WebviewWindow` running the YouTube IFrame Player API; that was
  retired because (a) many curated YouTube videos disable embedding
  ("An error occurred. Please try again later. Playback ID: …") and
  (b) audio-only YouTube playback is YouTube-ToS-grey.
- **Stream provider.** The shipped catalog uses [SomaFM](https://somafm.com/),
  whose terms explicitly permit redistribution from apps and websites.
  Streams are direct MP3, played through HTML5 `<audio>`; no decoder,
  no proxy, no DRM.
- **Watchdog.** `RadioFooter` arms an 8-second timer when it issues
  `audio.play()`. If the `playing` event hasn't fired by then it treats
  the stream as unavailable, surfaces a toast, and reports `stopped`.
  This catches hung streams that don't trigger `error` cleanly.
- **Persistence** writes runtime state (current station, status, volume)
  to `<app_data_dir>/radio_state.json` after every mutation. On startup
  the file is loaded if present so the app resumes the last station; a
  persisted `current_station_id` that no longer exists in the catalog
  is silently discarded.

## Tauri command surface

All commands are wrapped via `invokeWithTimeout` in
[`src/features/radio/api/radioApi.ts`](../../src/features/radio/api/radioApi.ts).

| Command | Direction | Purpose |
| --- | --- | --- |
| `radio_list_stations` | UI → Rust | List curated stations (with stream URL + attribution) |
| `radio_get_state` | UI → Rust | Read current `RadioState` |
| `radio_get_now_playing` | UI → Rust | Resolve current station + status |
| `radio_play` | UI → Rust | Start (auto-picks default station if none selected) |
| `radio_pause` | UI → Rust | Pause |
| `radio_next` | UI → Rust | Cycle to next station in the catalog |
| `radio_prev` | UI → Rust | Cycle to previous station |
| `radio_set_station` | UI → Rust | Switch to a specific station |
| `radio_set_volume` | UI → Rust | Volume in [0.0, 1.0] |
| `radio_report_status` | UI → Rust | Footer reports HTMLMediaElement event transitions |

## Tauri events

| Event | Direction | Payload |
| --- | --- | --- |
| `radio:state` | Rust → main window | `RadioState` snapshot after every mutation |

## Adding or curating stations

Edit [`src-tauri/data/radio_stations.json`](../../src-tauri/data/radio_stations.json).
Each station needs:

- `id`, `slug`, `name`, `description`, `accent_color`
- `stream_url` — direct HTTPS MP3 or HLS URL
- `source_url` (optional) — provider homepage for attribution
- `source_label` (optional) — human-readable provider label

After editing, the change ships in the next build — the JSON is baked
into the binary at compile time via `include_str!`. No migration, no
DB write.

When picking new providers, prefer ones whose terms explicitly permit
app/site redistribution (SomaFM, Radio Paradise, NPR-style public
streams). YouTube videos are not appropriate here — embedding is at
the uploader's discretion and breaks silently.

## CSP

`tauri.conf.json` whitelists `https://*.somafm.com` in `media-src`
and `connect-src`. Adding a new provider domain requires an additional
CSP entry — without it the `<audio>` element will silently refuse to
load the stream.

## Files

- [`src-tauri/src/radio/mod.rs`](../../src-tauri/src/radio/mod.rs) — types
- [`src-tauri/src/radio/service.rs`](../../src-tauri/src/radio/service.rs) — service + persistence
- [`src-tauri/src/commands/radio.rs`](../../src-tauri/src/commands/radio.rs) — Tauri command handlers
- [`src-tauri/data/radio_stations.json`](../../src-tauri/data/radio_stations.json) — curated catalog
- [`src/features/radio/`](../../src/features/radio/) — frontend feature module
