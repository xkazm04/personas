# Radio

A compact player rendered in the centre of the app footer
(`DesktopFooter`). Each curated station has one of two playback engines:

- **`youtubeTracks`** — a curated list of YouTube video IDs played
  through a hidden IFrame Player. Track-level prev/next buttons + a
  shuffle cursor that persists per-station.
- **`stream`** — a direct internet-radio stream URL played through an
  HTML5 `<audio>` element. Single continuous source, no tracks; the
  prev/next-track buttons are disabled while a stream station is active.

Backend `RadioState` is the source of truth. The renderer drives the
appropriate engine and reports state transitions back via
`radio_report_status` / `radio_track_ended`.

## What the user sees

- A compact controller in the **centre** of the bottom-of-window footer
  (`DesktopFooter`): prev-track, play/pause, next-track, volume (level-
  aware speaker icon — click to open a slider popover with a built-in
  mute toggle), station name + current track (truncated), station-picker.
- The station picker lists every curated station with a YouTube/Radio
  badge and (for YouTube) a track count. When the catalog contains
  both `youtubeTracks` and `stream` stations the list splits into
  collapsible "YouTube" / "Streams" groups (each with a count chip);
  the collapse choice persists across sessions via
  `collapsedSourceKinds` in the radio slice. Catalogs of a single
  kind render flat — the heading would feel decorative.
- A "Radio" card in **Settings → Account** (`RadioSettingsCard`) that
  lists the curated catalog. YouTube stations show their tracklist;
  stream stations show the source label + link. Three settings live
  here: master enable, **auto-resume on launch** (when on, the last
  playing station auto-starts the first time the footer mounts after
  app open — off by default; grays out when the master switch is off),
  and per-station hide-from-picker toggles. The row dot for the
  currently active station glows in the accent colour (or pulses when
  buffering), mirroring the footer's playing-state cue, so it's
  visible at a glance which station is live while you toggle others.
- While the engine is in `buffering` state (audio waiting for data or
  YouTube prebuffer) the play button swaps to a spinning loader tinted
  with the station accent, the now-playing accent dot pulses, and the
  expanded card's big play button pulses subtly. Once `playing` lands
  the spinner returns to a Pause icon. Stalled streams that never
  reach `playing` within the 8s watchdog still surface the unavailable
  toast as before.
- If either engine fails to start within ~8 seconds (or fires an `error`
  event) the renderer surfaces a localized toast. For YouTube errors
  100/101/150 (embed disabled / unavailable) the renderer auto-skips to
  the next track via `radio_track_ended` so a single bad video doesn't
  deadlock the station. Failed videoIds also land in a session-scope
  blacklist (`failedVideoIdsRef`): the next time the shuffle wrap
  returns the same id, the engine-sync useEffect silently advances the
  cursor without re-triggering the toast. A `skipBudgetRef` (reset on
  station change and on every successful PLAYING state) caps
  consecutive blacklist-skips at the station's track count, so an
  entirely-broken station eventually surfaces the failure instead of
  spinning forever.
- For `youtubeTracks` stations a thin accent-coloured progress bar
  appears below the track title while playing. The renderer polls
  `player.getCurrentTime()` / `player.getDuration()` once per second
  and every fifth tick reports the current position back through
  `radio_report_status` so a restart resumes mid-track.
- YouTube tracks **crossfade** at end-of-track. When the polling loop
  notices `durationSec - currentSec <= 1.6s` it kicks a 1.5s eased
  rAF-driven fade from `state.volume → 0` on the YT player. When the
  next videoId loads, an identical fade runs from `0 → state.volume`.
  The volume-sync useEffect that normally forces the player back to
  `state.volume` after every state change skips the YT path while
  `crossfadingRef.current` is true so the animation owns volume
  exclusively. Stream stations don't crossfade — they're a single
  continuous source with no track boundary.
- Clicking the track title opens a floating "now playing" card anchored
  above the footer (`NowPlayingCard`). The card shows the station with
  an accent-tinted header, the current track + artist (with a YouTube
  thumbnail from `i.ytimg.com/vi/{videoId}/mqdefault.jpg` to the left
  for YT tracks), a wider progress bar with explicit M:SS / M:SS time
  labels, accent-coloured prev / play / next controls, the full
  YouTube tracklist with the active track highlighted (or, for
  `stream` stations, the description and source link). Failed
  thumbnails silently fall back to the layout without the image.
  Click outside or Escape dismisses.
- The footer title text **crossfades** when it changes — new YouTube
  track, new SomaFM metadata, station switch. A small `TitleCrossfade`
  component overlays an outgoing-text span (fading out) on top of the
  incoming one (fading in) over 300ms, driven by two named keyframes
  (`fade-in`, `fade-out`) in `globals.css`. The fade is purely cosmetic
  — the underlying click target on the title segment behaves identically.

## Architecture

```
┌─ Main window ──────────────────────────────────────┐
│ DesktopFooter (centre cluster)                     │
│   RadioFooter                                      │
│     ┌─ Hidden YouTube IFrame Player (200×200,     │
│     │    position: fixed; left: -10000px)         │
│     │  — used for `youtubeTracks` stations        │
│     └─ <audio> element (no UI)                    │
│        — used for `stream` stations               │
│   ↕ uses radioApi (invoke)                         │
│   ↕ listens "radio:state"                          │
│   ↕ reports playing/paused/buffering/stopped       │
│     via radio_report_status                        │
│   ↕ skips on natural END or YT onError 100/101/150 │
│     via radio_track_ended                          │
└──────────────────────┬─────────────────────────────┘
                       │
                       ▼
       ┌────────────────────────────────────────────────────┐
       │ RadioService (src-tauri/src/radio/)                │
       │   stations: Vec<Station>  (curated, baked in)      │
       │   state: RadioState       (id + status + volume +  │
       │                            station_cursors)        │
       │   persistence: <config>/radio_state.json           │
       └────────────────────────────────────────────────────┘
```

- **Curated catalog** lives in [`src-tauri/data/radio_stations.json`](../../src-tauri/data/radio_stations.json).
  Baked into the binary via `include_str!` so users see the same catalog
  the team shipped — no editor surface.
- **Hidden YouTube player.** The IFrame Player API requires a real DOM
  element with non-zero dimensions; `RadioFooter` mounts a 200×200 div
  off-screen at `position: fixed; left: -10000px; top: -10000px`. Audio
  plays normally; the video portion is never visible. The player handle
  is created lazily in `useYouTubePlayer`, which loads
  `https://www.youtube.com/iframe_api` once and shares the namespace
  across hook instances.
- **Stream player** is a vanilla `<audio>` element rendered alongside
  the YT host; it carries no visible UI either, just its event handlers.
- **Per-station cursors** are stored in `RadioState.station_cursors`,
  keyed by station id, and only populated for `youtubeTracks` stations.
  Switching away and back to a YouTube station resumes its cursor.
- **Watchdog.** The renderer arms an 8-second timer when it issues a
  play. If the engine hasn't reported `playing` by then, it surfaces an
  unavailable toast and (for YouTube) advances the cursor — covering
  the silent-stall case where YT renders an in-frame error message
  without firing `onError`.
- **Persistence** writes runtime state to `<app_data_dir>/radio_state.json`
  after every mutation. On startup the file is loaded if present so the
  app resumes the last station; persisted `current_station_id` /
  cursor entries that no longer exist in the catalog are silently
  discarded.
- **SomaFM stream metadata.** Stream stations carry no track data of
  their own, but SomaFM publishes per-channel current-track JSON at
  `https://somafm.com/songs/{slug}.json`. The renderer polls
  `radio_fetch_somafm_metadata` every 30s while a station with
  `sourceLabel === "SomaFM"` is active. The fetch runs server-side in
  Rust via `reqwest` (5s timeout, slug validated against
  `^[a-z0-9-]{1,64}$`), so the renderer doesn't need a CSP entry for
  the apex `somafm.com` domain. Surfaced in both the footer title
  segment and the now-playing card's current-track row; the station
  name + description remain the fallback when metadata is unavailable.

## Tauri command surface

All commands are wrapped via `invokeWithTimeout` in
[`src/features/radio/api/radioApi.ts`](../../src/features/radio/api/radioApi.ts).

| Command | Direction | Purpose |
| --- | --- | --- |
| `radio_list_stations` | UI → Rust | List curated stations with their `StationSource` |
| `radio_get_state` | UI → Rust | Read current `RadioState` |
| `radio_get_now_playing` | UI → Rust | Resolve current station + (for YouTube) track |
| `radio_play` | UI → Rust | Start (auto-picks default station if none selected) |
| `radio_pause` | UI → Rust | Pause |
| `radio_next` | UI → Rust | Advance to next track (YouTube only; Err for streams) |
| `radio_prev` | UI → Rust | Step to previous track (YouTube only; Err for streams) |
| `radio_set_station` | UI → Rust | Switch to a specific station |
| `radio_set_volume` | UI → Rust | Volume in [0.0, 1.0] |
| `radio_report_status` | UI → Rust | Engine reports state transitions; optional `position_sec` (YouTube only) |
| `radio_track_ended` | UI → Rust | YouTube engine reports natural END or skip-on-error |
| `radio_fetch_somafm_metadata` | UI → Rust | Fetch current-track artist/title from `https://somafm.com/songs/{slug}.json` (async; runs in Rust so the renderer needs no CSP entry for the apex domain). Returns `Some(StreamMetadata)` on success, `None` on any non-fatal failure |

## Tauri events

| Event | Direction | Payload |
| --- | --- | --- |
| `radio:state` | Rust → main window | `RadioState` snapshot after every mutation |

## Adding or curating stations

Edit [`src-tauri/data/radio_stations.json`](../../src-tauri/data/radio_stations.json).
Required fields on every station: `id`, `slug`, `name`, `description`,
`accentColor`, `source`. Optional: `sourceUrl`, `sourceLabel`.

For a `youtubeTracks` station:

```json
"source": {
  "kind": "youtubeTracks",
  "tracks": [
    { "videoId": "...", "title": "...", "artist": "...", "durationSec": null }
  ]
}
```

For a `stream` station:

```json
"source": {
  "kind": "stream",
  "streamUrl": "https://..."
}
```

After editing, the change ships in the next build — the JSON is baked
into the binary at compile time. The seed parses through `serde` with
`rename_all = "camelCase"` and `rename_all_fields = "camelCase"` on the
enum, so JSON keys must be camelCase (`streamUrl`, `videoId`,
`accentColor`, …).

When picking new providers:

- **Streams**: prefer providers whose terms permit app/site redistribution
  (SomaFM, Radio Paradise, NPR/BBC public streams). The `https://*.somafm.com`
  CSP entry covers SomaFM; new domains need a CSP whitelist update too.
- **YouTube tracks**: many popular channels (Lofi Girl, the major focus-
  music streams) disable embedding. The skip-on-error + watchdog handle
  individual unembeddable videos gracefully, but a station whose entire
  tracklist is unembeddable will toast on every track. Test new IDs
  with `https://www.youtube.com/oembed?url=…` (returns 401 if embed is
  disabled) before shipping.

## CSP

`tauri.conf.json` whitelists:

- YouTube IFrame Player: `script-src https://www.youtube.com https://s.ytimg.com`,
  `frame-src https://www.youtube.com https://www.youtube-nocookie.com`,
  `connect-src https://www.youtube.com https://*.googlevideo.com`,
  `media-src https://*.googlevideo.com`.
- SomaFM streams: `media-src https://*.somafm.com`,
  `connect-src https://*.somafm.com`.

Adding a new stream provider requires an additional CSP entry — without
it the `<audio>` element will silently refuse to load the stream.

## Files

- [`src-tauri/src/radio/mod.rs`](../../src-tauri/src/radio/mod.rs) — types, including the `StationSource` tagged enum
- [`src-tauri/src/radio/service.rs`](../../src-tauri/src/radio/service.rs) — service + persistence
- [`src-tauri/src/commands/radio.rs`](../../src-tauri/src/commands/radio.rs) — Tauri command handlers
- [`src-tauri/data/radio_stations.json`](../../src-tauri/data/radio_stations.json) — curated catalog
- [`src/features/radio/`](../../src/features/radio/) — frontend feature module
- [`src/features/radio/hooks/useYouTubePlayer.ts`](../../src/features/radio/hooks/useYouTubePlayer.ts) — IFrame Player wrapper
- [`src/features/shared/components/layout/DesktopFooter.tsx`](../../src/features/shared/components/layout/DesktopFooter.tsx) — mount point (centre cluster)
