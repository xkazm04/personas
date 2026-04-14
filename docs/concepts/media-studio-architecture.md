# Media Studio — architecture & preview/export parity

**Status:** Phase 1 shipped + Phase 2 in progress
**Owner:** `src/features/plugins/artist/sub_media_studio/`
**Rust:** `src-tauri/src/commands/artist/ffmpeg.rs`

---

## Why this document exists

The media studio is one of the heavier subsystems in this project: it runs an
imperative playback clock, routes local files through Tauri's asset protocol,
mixes audio through the Web Audio API, and keeps an HTML `<video>` element in
sync with an FFmpeg filter graph it never actually renders. It has a layered
architecture with non-obvious invariants. This document is the reference for
anyone (human or model) touching it later.

---

## Three-layer model

```
┌───────────────────────────────────────────────────────────────┐
│ 1. Data model       — Composition { items: TimelineItem[] }   │
│    (src/.../types.ts)                                         │
├───────────────────────────────────────────────────────────────┤
│ 2. Preview renderer — live in-browser playback                │
│    (CompositionPreview + TimelinePanel + useTimelinePlayback) │
├───────────────────────────────────────────────────────────────┤
│ 3. Export pipeline  — ffmpeg filter graph (Rust, async)       │
│    (build_ffmpeg_args → tokio::process::Command)              │
└───────────────────────────────────────────────────────────────┘
```

Layers 2 and 3 are **independent implementations** of the same effect model.
The data model is the single source of truth; preview and export each read it
and must produce equivalent output. The fact that they are independent is
deliberate — it lets preview iterate at 60 fps in the browser without shelling
out to ffmpeg, and it lets export run at production quality without being
constrained to what the browser can decode.

The cost is that every effect has to be implemented **twice**, once per layer,
following the same rule. The parity matrix below tracks which effects are
in lockstep and which diverge.

---

## The playback engine

`useTimelinePlayback` owns the authoritative clock. The critical design
decision: `currentTime` is **not** in React state. The old design put it in
state and re-rendered the whole media-studio tree at 60 fps — the Inspector,
the Timeline, every lane, every clip — and the app was unusably laggy.

The engine now exposes:

```ts
interface PlaybackEngine {
  getTime(): number;
  getPlaying(): boolean;
  subscribe(cb: (time: number) => void): () => void;
}
```

Consumers that need per-frame time updates subscribe imperatively and decide
what to do with the tick:
- **Playhead line in `TimelinePanel`** — writes `element.style.transform`
  directly, zero React re-renders.
- **`CompositionPreview`** — `setState` on a component-local `currentTime`
  so only this component re-renders (its children are cheap; the rest of the
  studio tree is untouched).
- **`PlaybackControls`** — throttled `setState` at 10 Hz for the `MM:SS.s`
  readout.

`playing` and `looping` **are** React state because they only flip on
transport actions (buttons, keyboard). The transport shell re-renders once
per state change, which is the right granularity.

The rAF loop lives inside `useTimelinePlayback.tick`, advances `timeRef.current`
by the real-time delta, notifies subscribers, and schedules the next frame.
On `totalDuration` end it either wraps (if looping) or pauses.

---

## Timeline architecture

`TimelinePanel` has a fixed **left rail** (lane controls, labels, + buttons)
next to a **native horizontally-scrollable** content area. The content area
is a single DOM node of width `totalDuration × zoom`; lanes are stacked rows
with absolute-positioned clips inside them.

### Playhead

The playhead line is `position: absolute; pointer-events: none;` so clicks
pass through to clip buttons. A small draggable triangle handle sits in the
**ruler area only** (top 28 px), not over the lanes. Both elements' positions
are updated imperatively from `engine.subscribe` — no React state changes on
the hot path.

> **Why it matters:** the original implementation had the playhead as a
> full-area overlay that intercepted every click, which made lanes appear
> unclickable. This was the cause of the "media is on the timeline but I
> can't grab it" reports.

### Horizontal scrolling

Ctrl/Cmd + wheel zooms. Plain wheel falls through to native horizontal
scroll. The `useLayoutEffect` that auto-scrolls during playback runs inside
the subscribe callback so auto-follow-during-play stays smooth.

### Clip interaction

`TimelineClip` is the shared draggable/trimmable wrapper used by all four
lane types. It supports:
- Click to select
- Drag body to move (snap to 0.25 s grid)
- Drag left edge → `onTrimLeft(deltaSeconds)` → caller rewrites `startTime`
  and `duration`/`trimStart` atomically.
- Drag right edge → `onTrimRight(deltaSeconds)` → caller rewrites `duration`.
- Hover badge showing the time range.

---

## Effect model & parity matrix

The `TimelineItem` types carry all the knobs the two renderers need. Each
effect has a Preview mechanism and an Export mechanism, and they must agree.

| Effect | Timeline field | Preview mechanism | Export mechanism (`build_ffmpeg_args`) | Status |
|---|---|---|---|---|
| Trim | `trimStart`, `trimEnd` | `videoElement.currentTime` mapped into source | `trim=start:end` / `atrim=start:end` | ✅ in sync |
| Speed | `speed` | `HTMLMediaElement.playbackRate` + re-seek | `setpts=(PTS-STARTPTS)/speed` / `atempo` chain | ✅ in sync |
| Fade in/out | `fadeIn`, `fadeOut` | opacity per tick (video, image, text), gain (audio) | `fade=t=in,fade=t=out` / `afade=` | ✅ in sync |
| Transition | `transition`, `transitionDuration` | effective fade-in on next clip, effective fade-out on this clip | same rule in Rust | ⚠️ fades yes, temporal overlap no |
| Strip audio | `stripAudio` | `video.muted = true` | audio branch skipped | ✅ in sync |
| Normalize | `normalize`, `measuredLufs` | Web Audio GainNode with measured gain | `loudnorm=I=-16` (two-pass when available) | ✅ in sync |
| Clip volume | `volume` | `GainNode.gain` | `volume=` filter | ✅ in sync |
| Image overlay | `ImageItem` | DOM `<img>` with position/scale/opacity | overlay filter chain with fade | ✅ Phase 2 |
| Text overlay | `TextItem` | DOM `<span>` with position/color/size | `drawtext` filter with fade | ✅ Phase 2 |

### The rule for transitions

Both layers MUST apply this identically:

> A non-`cut` transition on clip[i] adds `transitionDuration` to its effective
> fade-out. A non-`cut` transition on clip[i−1] adds `transitionDuration` to
> clip[i]'s effective fade-in.

This is how the preview and export agree on the visual shape of a crossfade
/ fade-to-black without requiring true temporal overlap. The helper that
implements it lives in `CompositionPreview.tsx::effectiveVideoFades` and the
mirror in `ffmpeg.rs::transition_fade_in_from_prev`.

**What this rule does NOT do:** it does not actually overlap clip A and clip B
in time (the way `xfade` does in ffmpeg's native output). A true crossfade
blends the final frame of A with the first frame of B at 50% opacity; our
approximation shows A fading to black, then B fading in from black, with a
brief dark gap in the middle. For most user material the difference is
acceptable; for hard-cut-to-hard-cut transitions it's indistinguishable.

A fully accurate xfade is documented as **future work** below.

### Speed interpretation

`duration` on a clip is always the **output** length of the clip on the
timeline. With `speed = k`, the clip consumes `duration × k` seconds of
source material and compresses (or stretches) it to fit `duration` seconds
of output. This is what both preview and export assume, and it's why the
timeline never lies about how long a clip will be in the final render.

If you ever change this semantics, you must change it in both layers in the
same commit.

---

## Loudness normalization

`normalize` is the most elaborate effect because it requires a measurement
pass before either the preview or the export can apply the right gain.

### The measurement

New Rust command `artist_measure_loudness(file_path) -> LoudnessStats` runs:

```
ffmpeg -hide_banner -nostats \
  -i <file> \
  -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json \
  -f null -
```

loudnorm's "dry run" emits a JSON block on stderr with the integrated
loudness (`input_i`), loudness range (`input_lra`), true peak (`input_tp`),
and its internal threshold. We parse these and return them as `LoudnessStats`.
Fully async via `tokio::process::Command` — never blocks the IPC worker.

### Preview application

The preview routes audio through the Web Audio API:

```
HTMLAudioElement → MediaElementAudioSourceNode → GainNode → AudioContext.destination
```

Going through a `GainNode` means we can amplify above 1.0 — something
`HTMLMediaElement.volume` cannot do. For a clip at −20 LUFS with target
−16, the gain is `10 ^ ((-16 - -20) / 20) ≈ 1.58`, clamped at 6 (~+15.5 dB)
for safety.

The per-tick audio effect computes:

```
totalGain = clip.volume × fadeOpacity × loudnormGain(measuredLufs, -16)
```

and writes it directly to `nodes.gain.gain.value`. The element's native
`volume` stays at 1 when routed through Web Audio.

Lazy AudioContext creation honors browser autoplay policy; it's resumed on
the next `playing` transition.

### Export application

When the clip has a `measuredLufs`, the Rust export runs the **two-pass**
loudnorm (linear mode) which applies exact compensation — this produces the
same result as the preview's GainNode, not an approximation. When we don't
have measurements (user never toggled normalize on), the export falls back
to single-pass loudnorm.

### Inspector UX

Toggling normalize on kicks off the measurement in the background. The
Inspector shows `Measuring integrated loudness…` with a small spinner, then
switches to `Measured -14.3 LUFS — preview gain will match export`. A stale
measurement is re-used; we don't re-measure unless the user forces it.

---

## FFmpeg export pipeline

`artist_export_composition` spawns a tokio task that:
1. Validates the composition JSON.
2. Builds the full ffmpeg filter graph from `CompositionItem`s.
3. Spawns `ffmpeg` via `tokio::process::Command`.
4. Streams its stderr (which contains `time=HH:MM:SS.ms` progress lines) and
   emits Tauri events `media_export_progress` / `media_export_status` /
   `media_export_complete`.
5. On completion, notifies the frontend with the final output path.

### Filter graph construction

Inputs are deduped by file path so a clip that's reused on the timeline only
produces one ffmpeg `-i` flag. For each video clip we build:

```
[{idx}:v]trim=start:end,setpts=(PTS-STARTPTS)/speed,fade=t=in:...,fade=t=out:...[v{i}]
```

Plus an optional video-audio branch when `stripAudio=false`:

```
[{idx}:a?]atrim=...,asetpts=...,atempo=...,afade=...,afade=...,adelay=...[va{i}]
```

(`[idx:a?]` makes the audio input optional so video files with no audio
track don't error out.)

Dedicated audio clips get their own `a{i}` branch with trim, atempo chain,
optional loudnorm, afade in/out, adelay, and volume.

Video labels are concatenated sequentially with `concat=n=N:v=1:a=0`; audio
labels are mixed with `amix=inputs=N:duration=longest`. Image and text
overlays are composited onto the concatenated video via chained `overlay`
and `drawtext` filters before the final `-map` output.

### atempo chain

`atempo` only accepts factors in [0.5, 2.0]. For anything outside that
range, `atempo_chain(speed)` produces a cascading sequence of
`atempo=2.0,atempo=2.0,atempo=...` whose product equals the target speed.
This is how 0.25× and 4× work.

### Drawtext font resolution

`drawtext` needs a TTF path. We resolve a platform-appropriate system font at
runtime:

```
Windows: C:\Windows\Fonts\arial.ttf
macOS:   /System/Library/Fonts/Helvetica.ttc
Linux:   /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf (first available)
```

If no system font is found, text overlays are skipped with a warning line
in the export log. The preview (which uses DOM text) is unaffected.

---

## Tauri integration

### Asset protocol

Local video and image files are served to the `<video>` and `<img>` elements
via Tauri's asset protocol. This required three things to all be true:

1. **Cargo feature**: `tauri = { features = ["tray-icon", "protocol-asset"] }`
2. **App config**: `app.security.assetProtocol.enable: true` with a scope
   (`["**"]` — user-picked files can live anywhere).
3. **CSP**: `media-src` and `img-src` must include `asset:` and
   `http://asset.localhost https://asset.localhost blob:`. Without this, the
   browser refuses to load the asset-protocol URLs even when they're valid.

The symptom when any of these three is wrong is "video won't play, image is
a broken icon". The fix always lives in `src-tauri/tauri.conf.json` +
`src-tauri/Cargo.toml`.

### Async command invariant

**All FFmpeg commands are async (`pub async fn`) and use `tokio::process::Command`.**
The sync variant (`pub fn` + `std::process::Command`) will block the IPC
worker thread and freeze the UI. The Blender/FFmpeg detection commands
used to be sync and caused multi-second freezes — this is documented here
so future commands don't repeat the mistake.

---

## Known divergences & future work

### 1. Full `xfade` temporal overlap

**Current state:** transitions are approximated as independent fades on each
clip (A fades out, B fades in). This is visually acceptable but produces a
brief dark gap in the middle of a crossfade that a true `xfade` blend would
fill.

**What a full implementation needs:**
- A decision on the **clip-overlap model**: do users place clips sequentially
  and the system auto-overlaps by `transitionDuration`, or do they overlap
  manually and the transition type determines how the overlap is rendered?
  The first is more ergonomic; the second is more principled.
- If auto-overlap: `totalDuration` computation must subtract every
  crossfade/fade-to-black's `transitionDuration` from the sum.
- Preview needs a **second `<video>` element** (let's call it `secondaryRef`)
  that plays clip B during clip A's final `transitionDuration` seconds. Both
  elements use the same imperative sync pattern; only their opacity differs.
- Export needs to emit `xfade=transition=fade:duration=D:offset=O[tmp]` as
  a filter stage between consecutive video labels, replacing the naive
  `concat=n=N`.
- The timeline UI should visually show the overlap (clip B's left edge
  extends into clip A's right edge) so the user can tell a crossfade is
  active. This can be a thin hover outline or a diagonal stripe pattern.

**Effort estimate:** 1–2 days of focused work, with non-trivial risk in the
timeline UI layer. This is where I'd recommend stopping Phase 2 and opening
a dedicated PR.

### 2. Advanced audio mixing

- **Ducking** (`sidechaincompress`) for music-under-voiceover. Preview would
  need a DynamicsCompressorNode chain; export is a one-filter add.
- **True audio crossfade** between adjacent audio clips (similar to video
  xfade, but with `acrossfade`).
- **Denoise** (`afftdn`, `arnndn`). Preview approximation via Web Audio
  `BiquadFilterNode` would be lossy; most likely we mark denoise as
  "applied at export only".

### 3. Destructive waveform thumbnails

The `AudioLane` currently renders a **fake** waveform from
`Math.sin(index + charCode)`. A real pass would cache
`ffmpeg -af showwavespic=...` per source file and show the PNG as the
lane's background. This is an Altitude-1 quick win (~40 lines of Rust +
React), not a divergence.

### 4. Proxy / preview media

Dropping a 4K source into the studio currently plays the 4K file directly
in the browser preview, which is slow to seek and uses a lot of memory.
A background `artist_transcode_proxy` that produces a 720p h.264 proxy and
swaps `convertFileSrc` to use it would be the single biggest perceived
performance win for users on raw source footage.

---

## Testing / debugging checklist

When something looks wrong, check in this order:

1. **Does the preview show it right?** → Bug is in export (Rust filter graph).
2. **Does the export show it right?** → Bug is in preview (CompositionPreview or TimelinePanel).
3. **Do both show it wrong the same way?** → Bug is in the data model or the
   effect rule shared by both layers.
4. **Does the video never load in preview?** → Tauri asset protocol (CSP,
   Cargo feature, or assetProtocol scope). Always these three.
5. **Does playback stutter / freeze?** → Check for React state updates on
   the rAF hot path. `currentTime` must not live in state; only the engine's
   `timeRef.current` should advance at 60 Hz.
6. **Does adding clips slow the app progressively?** → Check that lane
   components are still `memo`-wrapped and that parent props are stable
   (`useCallback`, memoized arrays in `useMediaStudio`).

---

## Related files (short inventory)

**Frontend** (`src/features/plugins/artist/sub_media_studio/`)
- `types.ts` — TimelineItem shapes, Composition type, LoudnessStats
- `hooks/useTimelinePlayback.ts` — imperative rAF clock + subscriber pattern
- `hooks/useMediaStudio.ts` — composition state, splitItemAt, memoized derivations
- `hooks/useFfmpegDetect.ts` — idle-deferred ffmpeg detection
- `hooks/useMediaExport.ts` — export job lifecycle / progress events
- `hooks/useMediaFilePicker.ts` — dialog wrappers
- `hooks/useTimelineKeyboard.ts` — keyboard shortcuts (reads engine imperatively)
- `MediaStudioPage.tsx` — top-level layout, drag-and-drop, empty state
- `CompositionPreview.tsx` — live preview renderer (video + audio + overlays)
- `TimelinePanel.tsx` — left rail + scroll area + imperative playhead
- `TextLane.tsx`, `ImageLane.tsx`, `VideoLane.tsx`, `AudioLane.tsx` — lane renderers (memoized)
- `TimelineClip.tsx` — shared draggable/trimmable clip wrapper
- `TimelineRuler.tsx` — tick rendering
- `InspectorPanel.tsx` — property editor + clip action buttons
- `PlaybackControls.tsx` — transport bar with throttled timecode
- `ExportPanel.tsx` — export trigger, progress display
- `FfmpegStatusBanner.tsx` — non-blocking ffmpeg detection UI

**Backend** (`src-tauri/src/commands/artist/`)
- `mod.rs` — Blender detection + creative sessions (async)
- `ffmpeg.rs` — all media commands (detect, probe, extract, thumbnail, trim,
  measure-loudness, export) and `build_ffmpeg_args` filter graph builder

**Config**
- `src-tauri/tauri.conf.json` — `assetProtocol.enable` + CSP for local media
- `src-tauri/Cargo.toml` — `tauri = { features = [..., "protocol-asset"] }`
