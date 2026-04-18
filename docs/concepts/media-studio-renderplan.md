# Media Studio — RenderPlan IR

**Status:** Proposal, ready for implementation
**Related docs:** `docs/concepts/media-studio-architecture.md` (existing architecture — read first)
**Scope:** introduce a shared intermediate representation between `Composition` and the two renderers (browser preview + FFmpeg export). Does **not** change any API surface, Tauri command, or event name visible to users or external callers.

---

## For the implementer (fresh session)

### Required pre-reading, in order

1. `docs/concepts/media-studio-architecture.md` — understand the current dual-stack model, the playback engine, and the parity matrix. **Especially** §"Effect model & parity matrix" and §"Loudness normalization".
2. `src/features/plugins/artist/sub_media_studio/types.ts` — current `Composition` / `TimelineItem` shape. **This is unchanged by this spec.**
3. `src/features/plugins/artist/sub_media_studio/CompositionPreview.tsx` — current preview implementation, esp. `effectiveVideoFades`, `loudnormGain`, `fadeOpacity`.
4. `src-tauri/src/commands/artist/ffmpeg.rs` — current export implementation, esp. `build_ffmpeg_args` and `artist_export_composition`.

### What NOT to touch during this work

- The `Composition` / `TimelineItem` TypeScript types. They are the authoring format and the UI edits them directly. Do not alter field names or semantics.
- Any Tauri command signature. `artist_export_composition(job_id, composition_json, output_path)` keeps its signature; it just compiles the JSON to a `RenderPlan` internally.
- Any Tauri event payload shape. `media-export-progress` and siblings stay identical.
- The asset-protocol / CSP / cargo-features plumbing.
- `useMediaStudio` (the React hook) and its undo/redo semantics.

### Conventions in this codebase

- Rust structs that cross the IPC boundary carry `#[derive(Debug, Clone, Serialize, Deserialize, TS)]` + `#[ts(export)]` + `#[serde(rename_all = "camelCase")]`. This generates a matching `.ts` binding into `src/lib/bindings/`. Follow this for every new type in this spec.
- Tauri commands in `src-tauri/src/commands/artist/` must be `pub async fn` using `tokio::process::Command`. Any sync subprocess call blocks the IPC worker.
- Frontend imports from `@/lib/bindings/<Name>` — never duplicate these types by hand.
- User-facing strings go through `src/i18n/locales/en.json` (type-codegen'd). This spec adds no new user-facing strings.
- The project uses TypeScript 6 + strict mode. `noUncheckedIndexedAccess` is on — array indexing returns `T | undefined`.

---

## Why this exists

Today `CompositionPreview.tsx` and `ffmpeg.rs::build_ffmpeg_args` each traverse the `Composition` and reimplement the same effect rules (trim, speed, fade, transition-fade-fold, normalize gain, audio routing). The rules live as **prose** in the parity matrix and as **hand-written code in two places**. Every new effect is two implementations plus a new prose rule.

This spec introduces a `RenderPlan` intermediate representation. A **single compile step** owns all composition-level math and produces a flat, pre-resolved plan. Both renderers consume the plan with zero composition awareness. The transition-fade-fold rule lives in one place. Invariants become checkable at the type level and via property tests.

This is not a rewrite. Existing renderers are refactored to consume the IR. The user-visible behavior is unchanged.

---

## The IR

All types shown below are TypeScript for readability but are **generated from Rust** via `ts-rs`. Rust is the canonical definition; the TypeScript bindings live in `src/lib/bindings/`.

### Top-level

```typescript
interface RenderPlan {
  /** Bump when the shape changes in a way renderers must react to. */
  schemaVersion: 1;

  /** Output frame dimensions in pixels. Matches Composition.width/height. */
  width: number;
  height: number;

  /** Output framerate. */
  fps: number;

  /** Integer frame count. Primary; seconds derived. */
  durationFrames: number;

  /** Duration in seconds: durationFrames / fps. Present for convenience;
   *  every renderer should prefer frame-indexed math where possible. */
  durationSeconds: number;

  /** Background color drawn beneath every stage. Hex, no alpha. */
  backgroundColor: string;

  /** Deduplicated source catalog. Stages reference by index. */
  sources: SourceEntry[];

  /** Single video track. Stages are sorted by outputStart ascending.
   *  May have temporal gaps (gap = background color). Stages may overlap
   *  by exactly `overlapNext.durationSeconds` when overlapNext is set. */
  videoTrack: VideoStage[];

  /** Audio tracks. All tracks are mixed on output.
   *  The compiler emits:
   *  - one track per dedicated AudioClip in the Composition
   *  - one implicit track 'embedded' that collects non-stripped audio from
   *    every VideoStage whose source has an audio channel. */
  audioTracks: AudioTrack[];

  /** Overlays composited on top of the video track in array order
   *  (array[0] is behind array[N-1]). Overlaps freely. */
  overlays: OverlayStage[];

  /** Non-fatal issues the compiler wants the renderer to surface to the
   *  user (preview banner, export log). */
  warnings: CompileWarning[];
}
```

### Sources (discriminated union)

```typescript
type SourceEntry =
  | FileSource
  | ProxySource
  | ColorSource;

interface FileSource {
  kind: 'file';
  id: number;
  /** Absolute local path. */
  path: string;
  mediaDurationSeconds: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

interface ProxySource {
  kind: 'proxy';
  id: number;
  /** Path to the 720p proxy file. */
  path: string;
  /** Path to the original high-res file. Export prefers this when
   *  RenderPlan was compiled with CompileOptions.forExport === true. */
  originalPath: string;
  mediaDurationSeconds: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

interface ColorSource {
  kind: 'color';
  id: number;
  /** Hex color, no alpha. */
  hex: string;
}
```

Rationale for discriminated union vs. shared shape: a color source has no duration, no audio/video flags, no path. Forcing a common shape would require nullable fields the renderer would have to defensively check. The discriminant is cheaper.

### Video track

```typescript
interface VideoStage {
  /** Stable across recompiles of the same Composition (derived deterministically
   *  from the TimelineItem id). Used as cache key for thumbnails. */
  id: string;

  /** Index into RenderPlan.sources. Source kind must be 'file' or 'proxy'
   *  (not 'color' — color fills are implicit gaps, not stages). */
  sourceId: number;

  /** Absolute start/end on the output timeline, seconds. outputEnd > outputStart. */
  outputStart: number;
  outputEnd: number;

  /** Source-time region consumed. sourceEnd > sourceIn. */
  sourceIn: number;
  sourceEnd: number;

  /** Playback rate applied to the source. In (0, +∞). Preview sets
   *  video.playbackRate; export emits `setpts=(PTS-STARTPTS)/speed`. */
  speed: number;

  /** Effective fades in seconds. For fade-folded transitions these already
   *  include the neighbor clip's transitionDuration contribution — renderers
   *  do NOT fold, they just apply what's here. */
  fadeIn: number;
  fadeOut: number;

  /** Present when this stage temporally overlaps the next video stage.
   *  Only emitted when the compiler ran with transitionMode === 'overlap'. */
  overlapNext: null | { durationSeconds: number; kind: 'crossfade' | 'fadeToBlack' };

  /** Mute audio embedded in this clip's source. When true, no contribution
   *  to the 'embedded' audio track. */
  stripEmbeddedAudio: boolean;
}
```

What's deliberately missing from VideoStage vs the input TimelineItem: `transition`, `transitionDuration`, `trimStart`, `trimEnd`, `mediaDuration`, `fadeIn`/`fadeOut` (raw). Those were compiler inputs; the stage carries results only.

### Audio tracks

```typescript
interface AudioTrack {
  /** Stable id. For the implicit video-embedded track this is the literal 'embedded'. */
  id: string;

  /** Track-level linear gain, multiplied on top of stage gain. 1.0 today,
   *  reserved for future master-bus / ducking features. */
  gain: number;

  /** Stages on this track. May overlap (mixed within-track). */
  stages: AudioStage[];
}

interface AudioStage {
  id: string;
  sourceId: number;

  outputStart: number;
  outputEnd: number;
  sourceIn: number;
  sourceEnd: number;
  speed: number;

  /** Pre-computed linear gain that captures clip.volume × base-fade-envelope.
   *  Does NOT include loudnorm compensation; see `normalize` below. */
  linearGain: number;

  /** Fade envelope durations (seconds), applied multiplicatively alongside
   *  linearGain at the outputStart/outputEnd edges. */
  fadeIn: number;
  fadeOut: number;

  /** Normalization directive.
   *  - null: no normalize; renderer uses only linearGain × fade.
   *  - object: renderer applies normalize.
   *    Preview applies an approximation (linear gain derived from measurements).
   *    Export applies two-pass loudnorm with the measurements.
   *  The measurements field mirrors what artist_measure_loudness returned
   *  (the source was measured over its trimmed region; see Known-issues
   *  elsewhere in this doc for why that's important). */
  normalize: null | {
    targetLufs: number;       // always -16 today
    maxLinearGain: number;    // always 6 today (~ +15.5 dB safety clamp)
    measurements: {
      integratedLufs: number;
      lra: number;
      truePeakDbfs: number;
      threshold: number;
    };
  };
}
```

**Semantic clarification** (this was genuinely ambiguous in the v1 draft):

- `linearGain` is always multiplied into the output by both renderers.
- `normalize` is a directive, not pre-baked gain. When present:
  - **Preview** computes `approxGain = 10^((targetLufs - measurements.integratedLufs) / 20)`, clamps to `maxLinearGain`, and applies it multiplicatively to `linearGain × fadeEnvelope`. This matches today's `loudnormGain` helper.
  - **Export** emits the two-pass `loudnorm` filter with `I=targetLufs` plus the four `measured_*` parameters, then multiplies the output by `linearGain` (via a subsequent `volume` filter) and applies afade. Matches today's two-pass path.
- This keeps preview fast (one multiply) and export accurate (real loudnorm). It also makes the divergence explicit: preview is an approximation by design.

### Overlays

```typescript
type OverlayStage = TextOverlayStage | ImageOverlayStage;

interface OverlayBase {
  id: string;
  outputStart: number;
  outputEnd: number;
  fadeIn: number;
  fadeOut: number;

  /** Frame-relative position, both in [0, 1]. Renderers scale to container. */
  positionX: number;
  positionY: number;
}

interface TextOverlayStage extends OverlayBase {
  kind: 'text';
  text: string;

  /** The font the compiler decided to use for THIS overlay. Compiler picks
   *  from a known-bundled set first, then optional system probe, and records
   *  the final choice so preview and export render identical glyphs.
   *  If no font resolved, overlay is omitted and a CompileWarning emitted. */
  fontFamily: string;
  fontWeight: 400 | 500 | 700;

  /** Pixels at the composition's native height. Preview scales to
   *  (previewHeight / composition.height). */
  fontSizePx: number;
  colorHex: string;
}

interface ImageOverlayStage extends OverlayBase {
  kind: 'image';
  sourceId: number;  // must be 'file' or 'proxy'
  scale: number;     // 1.0 = source's natural size within the frame
}
```

### Warnings

```typescript
type CompileWarning =
  | { kind: 'textFontMissing'; overlayId: string; requested: string; fallback: string | null }
  | { kind: 'loudnormUnmeasured'; audioStageId: string }
  | { kind: 'speedClamped'; stageId: string; requested: number; applied: number }
  | { kind: 'proxyMissing'; sourceId: number; originalPath: string }
  | { kind: 'audioSourceSilent'; sourceId: number };
```

Warnings are non-fatal. The preview UI shows them in a small banner above the output; the export streams them as info lines in the log.

### Rust mirror (canonical)

```rust
// src-tauri/src/engine/render_plan.rs
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RenderPlan {
    pub schema_version: u32,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub duration_frames: u64,
    pub duration_seconds: f64,
    pub background_color: String,
    pub sources: Vec<SourceEntry>,
    pub video_track: Vec<VideoStage>,
    pub audio_tracks: Vec<AudioTrack>,
    pub overlays: Vec<OverlayStage>,
    pub warnings: Vec<CompileWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SourceEntry {
    File { id: u32, path: String, media_duration_seconds: f64, has_audio: bool, has_video: bool },
    Proxy { id: u32, path: String, original_path: String, media_duration_seconds: f64, has_audio: bool, has_video: bool },
    Color { id: u32, hex: String },
}

// … VideoStage, AudioTrack, AudioStage, OverlayStage, CompileWarning derived identically …
```

---

## The compiler

Single entry point. Pure function. No I/O except through the `CompileDeps` trait-object callbacks.

### Signature

```rust
pub fn compile(
    composition: &Composition,
    opts: &CompileOptions,
    deps: &CompileDeps,
) -> Result<RenderPlan, CompileError>;

pub struct CompileOptions {
    /// Fold: today's behavior. Transitions collapse into each stage's fades;
    ///       stages are strictly sequential; totalDuration = max(stage.outputEnd).
    /// Overlap: true xfade. Stage[i] and stage[i+1] overlap by transitionDuration;
    ///          totalDuration subtracts every overlap.
    pub transition_mode: TransitionMode,

    /// Snap every stage boundary (and overlap length) to `1/fps` so the
    /// preview never shows a frame that wouldn't exist in the export.
    /// Default: true.
    pub frame_snap: bool,

    /// True when this plan will feed the export pipeline. Compiler prefers
    /// FileSource over ProxySource in that case.
    pub for_export: bool,
}

pub enum TransitionMode { Fold, Overlap }

pub struct CompileDeps<'a> {
    /// None => no proxies. Returns Some(ProxyRef) when a proxy exists on disk
    /// for the given original path.
    pub proxy_lookup: Option<&'a dyn Fn(&str) -> Option<ProxyRef>>,

    /// None => assume only the bundled font is available.
    /// Some(f) => f(familyName) returns true if the font is installed.
    pub font_probe: Option<&'a dyn Fn(&str) -> bool>,
}

pub enum CompileError {
    NegativeOrZeroDuration { stage_id: String },
    SourceOutOfBounds { stage_id: String, requested: f64, available: f64 },
    UnsupportedCompositionShape { reason: String },
}
```

Fatal vs warning split:
- **CompileError** — composition is structurally broken; caller must fix before rendering (duration ≤ 0, source-range out of bounds, etc.).
- **CompileWarning** — plan is valid but an effect got omitted or degraded (font fallback, normalize without measurements, speed clamped to range).

### Algorithm (step by step)

Input: `Composition` (`.items: TimelineItem[]`).

**Step 1 — Normalize item order.** Sort `items` deterministically by `(type, startTime, id)`. Stability matters because the IR is expected to be bit-identical for identical inputs (for caching).

**Step 2 — Build source catalog.**
- For every distinct file path referenced by any item, create one `FileSource` OR `ProxySource`. Prefer proxy iff `!opts.for_export && deps.proxy_lookup(path).is_some()`. Emit `CompileWarning::ProxyMissing` when `opts.for_export` and a proxy was detected but not used.
- Emit one implicit `ColorSource { hex: composition.background_color }` as `sources[0]`. Reserved slot; renderers use it for gaps and `fadeToBlack`.

**Step 3 — Compile video stages.**

For each `VideoClip` i (already sorted):

```
baseFadeIn  = clip.fadeIn  ?? 0
baseFadeOut = clip.fadeOut ?? 0
transitionFromPrev = (videos[i-1]?.transition != 'cut' && videos[i-1]?.transitionDuration > 0) ? videos[i-1].transitionDuration : 0
transitionOut      = (clip.transition != 'cut' && clip.transitionDuration > 0) ? clip.transitionDuration : 0

if mode == Fold:
  stage.fadeIn  = min(clip.duration, baseFadeIn  + transitionFromPrev)
  stage.fadeOut = min(clip.duration, baseFadeOut + transitionOut)
  stage.outputStart = clip.startTime
  stage.outputEnd   = clip.startTime + clip.duration
  stage.overlapNext = null

if mode == Overlap:
  stage.fadeIn  = baseFadeIn                   // do NOT fold
  stage.fadeOut = baseFadeOut
  cumulative_overlap = Σ_{j<i} videos[j].transitionDuration where videos[j].transition != 'cut'
  stage.outputStart = clip.startTime - cumulative_overlap
  stage.outputEnd   = stage.outputStart + clip.duration
  stage.overlapNext = transitionOut > 0 ? { durationSeconds: transitionOut, kind: clip.transition } : null

stage.speed    = clamp(clip.speed ?? 1, 0.0625, 16.0)   // emit SpeedClamped warning if clamped
stage.sourceIn = clip.trimStart
stage.sourceEnd = clip.trimStart + (stage.outputEnd - stage.outputStart) * stage.speed
stage.stripEmbeddedAudio = clip.stripAudio ?? false
```

Emit one `VideoStage` per clip.

**Step 4 — Compile dedicated audio stages.** One `AudioTrack` per `AudioClip`. For each clip:

```
base_fade_in  = clip.fadeIn  ?? 0
base_fade_out = clip.fadeOut ?? 0
stage.speed = clamp(clip.speed ?? 1, 0.0625, 16.0)
stage.outputStart = clip.startTime
stage.outputEnd   = clip.startTime + clip.duration
stage.sourceIn    = clip.trimStart
stage.sourceEnd   = clip.trimStart + (stage.outputEnd - stage.outputStart) * stage.speed
stage.linearGain  = clip.volume ?? 1
stage.fadeIn      = base_fade_in
stage.fadeOut     = base_fade_out

if clip.normalize == true:
  if clip.measuredLufs is Some:
    stage.normalize = Some { targetLufs: -16, maxLinearGain: 6, measurements: {...} }
  else:
    stage.normalize = None
    emit CompileWarning::LoudnormUnmeasured { audioStageId: stage.id }
else:
  stage.normalize = None
```

**Step 5 — Compile embedded audio track.** Emit one `AudioTrack { id: 'embedded' }` whose stages come from VideoClips where `!stripAudio && source.has_audio`. Each embedded stage mirrors its VideoStage's `outputStart/End`, `sourceIn/End`, `speed`. `linearGain = 1`, `fadeIn/fadeOut = 0` (video-embedded audio follows the video's fade envelope only via export's implicit routing — see "Contracts" below). `normalize: None`.

**Step 6 — Compile overlays.**

For each `TextItem`:
- Resolve font: if `deps.font_probe('Inter')`, use Inter (bundled). Else if `deps.font_probe(…)` for known platform fonts (see architecture doc §drawtext font resolution), use that. Else emit `TextFontMissing` warning and **omit the overlay entirely** (do not emit a stage). The existing export behavior silently skips; the IR makes the omission visible via the warning.
- Otherwise, emit a `TextOverlayStage`.

For each `ImageItem`, emit an `ImageOverlayStage`. No font concerns.

**Step 7 — Compute duration.**

```
video_end = max(stage.outputEnd) across videoTrack   // 0 if empty
audio_end = max(stage.outputEnd) across every audioTracks[*].stages
overlay_end = max(stage.outputEnd) across overlays
duration_seconds = max(video_end, audio_end, overlay_end)
duration_frames  = ceil(duration_seconds * fps)
duration_seconds = duration_frames / fps    // reconcile
```

**Step 8 — Frame-snap pass.** If `opts.frame_snap`:
- For every stage: snap `outputStart`, `outputEnd`, `fadeIn`, `fadeOut`, `overlapNext.durationSeconds` to `round(value * fps) / fps`.
- Adjust `sourceEnd` to match `sourceIn + (outputEnd - outputStart) * speed` so invariant I5 (below) holds.

**Step 9 — Validate.** Run the full invariant set (I1–I11 below) as a debug-assertion pass. Any violation is a compiler bug — convert to `CompileError::UnsupportedCompositionShape { reason: <invariant-name> }` in release builds so a botched compile surfaces early instead of tearing in the renderer.

Output: an immutable `RenderPlan`.

### Determinism

Given identical `(Composition, CompileOptions, resolved CompileDeps output)`, `compile` must produce bit-identical output. Enables plan caching by `hash(composition_json) + hash(opts)` and golden-file snapshot tests.

---

## Invariants

Every emitted `RenderPlan` upholds these.

- **I1.** `durationFrames == ceil(durationSeconds * fps)` within 1e-9 tolerance.
- **I2.** For every stage `s`: `0 <= s.outputStart && s.outputEnd > s.outputStart && s.outputEnd <= durationSeconds + 1/(2·fps)`.
- **I3.** For every stage `s`: `s.fadeIn + s.fadeOut <= (s.outputEnd - s.outputStart)`.
- **I4.** For every video/audio stage `s` whose `sourceId` resolves to a non-color source `src`: `0 <= s.sourceIn && s.sourceEnd <= src.mediaDurationSeconds && s.sourceEnd > s.sourceIn`.
- **I5.** For every video/audio stage `s`: `|(s.sourceEnd - s.sourceIn) - (s.outputEnd - s.outputStart) * s.speed| < 1/(2·fps)`.
- **I6.** For every audio stage `s`: `0 <= s.linearGain && s.linearGain <= s.normalize?.maxLinearGain ?? ∞`.
- **I7.** For every overlay: `0 <= positionX <= 1 && 0 <= positionY <= 1`.
- **I8.** `videoTrack` is sorted by `outputStart`. In `Fold` mode consecutive stages satisfy `videos[i+1].outputStart == videos[i].outputEnd` (equality modulo frame tolerance) — gaps are not possible because each clip's `(startTime, duration)` is the Composition's single source of truth. In `Overlap` mode, `videos[i+1].outputStart == videos[i].outputEnd - (videos[i].overlapNext?.durationSeconds ?? 0)`.
- **I9.** When `opts.frame_snap == true`, every `outputStart`, `outputEnd`, `fadeIn`, `fadeOut`, `overlapNext.durationSeconds` is an integer multiple of `1/fps` within 1e-9 tolerance.
- **I10.** Every `warnings[*]` id references an existing stage or source id.
- **I11.** `sources[0].kind == 'color'` (reserved background-color slot).

### Invariant-checker shape

```rust
// src-tauri/src/engine/render_plan/invariants.rs
pub fn assert_invariants(plan: &RenderPlan) -> Result<(), InvariantViolation>;

pub struct InvariantViolation {
    pub code: &'static str,   // "I1", "I2", …
    pub message: String,
    pub offending_id: Option<String>,
}
```

Called at the end of `compile` in debug builds. Called from every test. Never skipped.

---

## Renderer contract

Both renderers are thin. Neither touches `Composition`.

### Preview

```typescript
// src/features/plugins/artist/sub_media_studio/CompositionPreview.tsx
function renderPreview(plan: RenderPlan, engine: PlaybackEngine): void;
```

Per tick (at `engine.getTime()`):
- **Video:** find the active `VideoStage` where `outputStart <= t < outputEnd`. Sync the `<video>` element's `currentTime = sourceIn + (t - outputStart) * speed`. Compute opacity from `fadeIn`/`fadeOut` at the edges. If `overlapNext` and `t >= outputEnd - overlap.durationSeconds`, load the next stage into a secondary `<video>` element and crossfade opacity.
- **Audio:** for every AudioTrack, for every stage where `outputStart <= t < outputEnd`: sync `HTMLAudioElement.currentTime`, set `GainNode.gain = linearGain × fadeEnvelope × (normalize ? approxLoudnormGain(normalize) : 1)`.
- **Overlays:** iterate in array order, DOM-render each with opacity from fade envelope.

None of those computations reference anything outside the plan.

### Export

```rust
// src-tauri/src/commands/artist/ffmpeg.rs
pub fn build_ffmpeg_args(plan: &RenderPlan, output_path: &Path) -> Vec<String>;
```

- One `-i <path>` per non-color source (file/proxy).
- Per VideoStage: `[srcI:v]trim=sourceIn:sourceEnd,setpts=(PTS-STARTPTS)/speed,fade=t=in:d=fadeIn,fade=t=out:st=...:d=fadeOut[vN]`.
- Video stage concat/xfade: determined entirely by each VideoStage's `overlapNext`. None → `concat`; Some → `xfade=transition=<kind>:duration=D:offset=O`. The choice is a per-pair switch, not a composition-level decision.
- Per AudioStage: `[srcI:a?]atrim=sourceIn:sourceEnd,asetpts=...,atempo=<chain>,volume=linearGain,afade=...,afade=...,adelay=outputStart*1000[aN]`. Then if `normalize is Some`, append the two-pass loudnorm filter.
- Embedded audio track is just another audio track in the mix; no special handling.
- Overlay chain applied after video concat; each OverlayStage becomes a `drawtext` or `overlay` clause guarded by `enable='between(t,outputStart,outputEnd)'`.

Neither renderer reads `clip.transition`, `clip.transitionDuration`, `trimStart`, or any other Composition-level concept.

---

## Worked example

A minimal 3-clip composition with one crossfade.

**Input** (`Composition`):
```json
{
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "backgroundColor": "#000000",
  "items": [
    {
      "id": "v1", "type": "video", "filePath": "/a.mp4", "mediaDuration": 10,
      "startTime": 0, "duration": 5, "trimStart": 0, "trimEnd": 0,
      "transition": "crossfade", "transitionDuration": 1, "fadeIn": 0, "fadeOut": 0, "speed": 1
    },
    {
      "id": "v2", "type": "video", "filePath": "/b.mp4", "mediaDuration": 10,
      "startTime": 5, "duration": 4, "trimStart": 0, "trimEnd": 0,
      "transition": "cut", "transitionDuration": 0, "fadeIn": 0, "fadeOut": 0, "speed": 1
    }
  ]
}
```

**Output under `transitionMode: 'fold'`, `frameSnap: true`, `forExport: true`**:
```json
{
  "schemaVersion": 1, "width": 1920, "height": 1080, "fps": 30,
  "durationFrames": 270, "durationSeconds": 9.0,
  "backgroundColor": "#000000",
  "sources": [
    { "kind": "color", "id": 0, "hex": "#000000" },
    { "kind": "file",  "id": 1, "path": "/a.mp4", "mediaDurationSeconds": 10, "hasAudio": true, "hasVideo": true },
    { "kind": "file",  "id": 2, "path": "/b.mp4", "mediaDurationSeconds": 10, "hasAudio": true, "hasVideo": true }
  ],
  "videoTrack": [
    { "id": "v1", "sourceId": 1, "outputStart": 0, "outputEnd": 5,
      "sourceIn": 0, "sourceEnd": 5, "speed": 1,
      "fadeIn": 0, "fadeOut": 1, "overlapNext": null, "stripEmbeddedAudio": false },
    { "id": "v2", "sourceId": 2, "outputStart": 5, "outputEnd": 9,
      "sourceIn": 0, "sourceEnd": 4, "speed": 1,
      "fadeIn": 1, "fadeOut": 0, "overlapNext": null, "stripEmbeddedAudio": false }
  ],
  "audioTracks": [
    { "id": "embedded", "gain": 1, "stages": [
      { "id": "v1-embedded", "sourceId": 1, "outputStart": 0, "outputEnd": 5,
        "sourceIn": 0, "sourceEnd": 5, "speed": 1, "linearGain": 1,
        "fadeIn": 0, "fadeOut": 0, "normalize": null },
      { "id": "v2-embedded", "sourceId": 2, "outputStart": 5, "outputEnd": 9,
        "sourceIn": 0, "sourceEnd": 4, "speed": 1, "linearGain": 1,
        "fadeIn": 0, "fadeOut": 0, "normalize": null }
    ]}
  ],
  "overlays": [],
  "warnings": []
}
```

**Same composition under `transitionMode: 'overlap'`**:
- `videoTrack[0].overlapNext = { durationSeconds: 1, kind: 'crossfade' }`
- `videoTrack[0].fadeOut = 0` (transition NOT folded)
- `videoTrack[1].outputStart = 4` (overlapping 1s)
- `videoTrack[1].fadeIn = 0`
- `durationFrames = 240` (8s total, not 9s)

This is the single data shape both renderers consume for both modes.

---

## Tests

### Unit: invariants

```rust
// src-tauri/src/engine/render_plan/tests.rs
use proptest::prelude::*;

proptest! {
    #[test]
    fn compile_respects_invariants_fold(comp in any_valid_composition()) {
        let plan = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none())?;
        assert_invariants(&plan).unwrap();
    }

    #[test]
    fn compile_respects_invariants_overlap(comp in any_valid_composition()) {
        let plan = compile(&comp, &CompileOptions::overlap_default(), &CompileDeps::none())?;
        assert_invariants(&plan).unwrap();
    }
}
```

`any_valid_composition()` is a proptest generator (in `tests/gen.rs`) that emits random compositions with:
- 0–8 video clips, 0–4 audio clips, 0–4 text/image overlays
- `startTime` ∈ [0, 60), `duration` ∈ [0.25, 20)
- Valid `trimStart` ∈ [0, mediaDuration − duration]
- Random `transition`, `transitionDuration`, `fadeIn`, `fadeOut`, `speed`

Writing this generator is ~80 LOC and is the highest-leverage artifact in this PR — it'll catch divergences for years.

### Integration: frame-diff parity

```typescript
// tests/render_plan_parity.spec.ts (Playwright)
for (const fixture of readFixtures('tests/fixtures/compositions/')) {
  test(`${fixture.name} — preview vs export frames match`, async ({ page }) => {
    const plan = await compile(fixture.composition);
    const previewFrames = await capturePreviewFrames(page, plan, samplePoints);
    const exportMp4 = await runExport(plan);
    const exportFrames = await extractFramesWithFfmpeg(exportMp4, samplePoints);
    for (let i = 0; i < samplePoints.length; i++) {
      expect(pixelDiff(previewFrames[i], exportFrames[i])).toBeLessThan(0.02);
    }
  });
}
```

`capturePreviewFrames` drives the preview in headless Chromium via Playwright, seeks to each `samplePoint`, captures `<canvas>` pixels. `extractFramesWithFfmpeg` runs `ffmpeg -ss <t> -i out.mp4 -frames:v 1 frame.png` per sample point. Pixel-diff threshold is 2% RMSE — accounts for codec/browser decoder color-space differences.

Fixtures to ship with PR-2 minimum:
1. Plain cut (2 video clips, no fades)
2. Crossfade fold (fade-folded mode)
3. Fade-to-black (fold)
4. Sub-frame-snap on/off comparison
5. Normalize on with measurements
6. Multiple overlays
7. Speed 0.25× and 4×

### Schema version compatibility

`docs/concepts/render-plan-fixtures/v1/golden-*.json` — one golden file per representative composition. CI deserializes each golden into current `RenderPlan` types. Any field-addition/rename breaks this test and forces a `schemaVersion` bump + migration.

---

## Migration plan

Three incremental PRs. Each is shippable on its own.

### PR-1 — Introduce the IR

**Files added:**
- `src-tauri/src/engine/render_plan/mod.rs` — types
- `src-tauri/src/engine/render_plan/compile.rs` — the `compile` function
- `src-tauri/src/engine/render_plan/invariants.rs` — `assert_invariants`
- `src-tauri/src/engine/render_plan/tests.rs` — proptest + golden files
- `src-tauri/Cargo.toml` — add `proptest = { version = "1", optional = true }` under `[dev-dependencies]`
- `src/lib/bindings/RenderPlan.ts` et al. — generated, committed
- `docs/concepts/render-plan-fixtures/v1/golden-*.json` — initial golden set

**Files modified:**
- `src-tauri/src/engine/mod.rs` — `pub mod render_plan;`

**Acceptance criteria:**
- `cargo test -p personas-desktop render_plan` passes with proptest active (run ≥1000 cases per proptest).
- Generated TypeScript bindings compile (`npx tsc --noEmit`).
- Every invariant has at least one positive test and one negative test (compose a plan that violates it, expect `assert_invariants` to return `Err`).
- `compile` is not called from any production code path.

**Non-goals:**
- No frontend changes.
- No export pipeline changes.

**Estimated size:** ~2 days focused work; ~700 LOC including tests.

### PR-2 — Route export through the IR

**Files modified:**
- `src-tauri/src/commands/artist/ffmpeg.rs`:
  - `artist_export_composition` deserializes `composition_json` to `Composition`, calls `render_plan::compile(&comp, &CompileOptions::for_export_default(), &deps)`, then calls the new `build_ffmpeg_args(&plan, &output_path)`.
  - `build_ffmpeg_args`'s signature changes from `(composition: &Composition, ...)` to `(plan: &RenderPlan, ...)`. All transition-fade-fold / trim / speed logic is **deleted** from this function — it lives in the compiler now.

**Files added:**
- `tests/render_plan_export_parity.rs` (or similar) — golden FFmpeg args tests. For each fixture composition, serialize the emitted `Vec<String>` and diff against a committed baseline.

**Acceptance criteria:**
- Every fixture in `docs/concepts/render-plan-fixtures/v1/` exports identical (or intentionally-different-with-reason) FFmpeg args to the pre-PR baseline.
- End-to-end export in the running app produces visually identical MP4s for the same compositions as before (manual QA on the 7 fixture compositions).
- No change to any Tauri event, no change to `artist_export_composition`'s signature.

**Non-goals:**
- No preview changes.
- No new user-facing behavior.

**Estimated size:** ~3 days; a lot of this is writing the baseline FFmpeg-args snapshots.

### PR-3 — Route preview through the IR

**Files added:**
- `src/features/plugins/artist/sub_media_studio/compile.ts` — TypeScript hand-port of the Rust `compile` function.
- `src/features/plugins/artist/sub_media_studio/compile.test.ts` — same fixtures as Rust proptest, asserts the two implementations produce identical `RenderPlan` JSON (byte-equivalent after stringify with sorted keys).

**Files modified:**
- `CompositionPreview.tsx` now calls `compile(composition, opts)` from `compile.ts`. The `effectiveVideoFades`, `loudnormGain`, and related helpers are deleted — their logic lives in `compile.ts` now. Preview just consumes stages.

**Acceptance criteria:**
- For every fixture, `compileTs(composition)` produces identical JSON to `compileRust(composition)` (modulo float rounding that gets snapped away by frame_snap).
- Playwright frame-diff parity tests pass (< 2% pixel diff per sampled frame).
- The prose "parity matrix" table is deleted from `media-studio-architecture.md` with a note pointing to this spec.

**Non-goals:**
- No new features exposed to users.
- No Rust-to-wasm build step. A future PR may replace `compile.ts` with wasm-compiled Rust; that's an optimization, not a requirement.

**Why not wasm now:** setting up `wasm-pack`/`wasm-bindgen` on Tauri 2 is infrastructure work orthogonal to this spec. A TypeScript hand-port is "the thing we're replacing" in miniature — yes — but it's ~200 LOC and is tested against the Rust canonical via a direct cross-language fixture comparison, which is stronger than today's prose parity matrix. The downside (two implementations of `compile`) is strictly smaller than today's downside (two implementations of every effect rule spread across two renderers).

**Estimated size:** ~4 days.

---

## What doesn't change (explicit non-goals)

- `Composition` TypeScript type stays exactly as-is. UI reads/writes it; serialization format is unchanged.
- `artist_export_composition(job_id, composition_json, output_path)` signature stays.
- Every Tauri event shape stays.
- Undo/redo, timeline interactions, drag-and-drop — all orthogonal.
- CSP, asset protocol, Cargo features — all orthogonal.
- No new user-facing strings.
- No new sidebar entry, no new settings.

## What remains divergent after this work (explicit)

- **Decoder parity.** Browser H264 decode vs libx264 decode may differ at edge chroma / IDR boundaries. Out of scope.
- **Font rasterizer parity.** Even with a bundled font, CSS text shaping vs FFmpeg's `drawtext`/freetype produce subtly different metrics. The IR records which font was used; the renderers still use different rasterizers.
- **Audio codec parity.** AAC/Opus decoder differences. Out of scope.
- **Preview loudnorm is still an approximation.** Export uses true two-pass loudnorm. Preview uses a linear-gain approximation derived from the same measurements. The IR makes this explicit (the `normalize` directive) rather than hidden; the magnitude of the approximation is unchanged from today.

These are accepted divergences. The IR narrows parity to **rules we control** (fades, transitions, trim, speed, routing) — which is what actually bites.

---

## Appendix A — Alternative architectures considered

Documented here so a future reader understands the decision space without re-exploring it.

| Option | Verdict | Rationale |
|---|---|---|
| Keep status quo: prose parity matrix, two independent renderers | Rejected | Parity cost scales linearly with effect count; already has 5+ known divergences |
| Rewrite preview in Rust via wgpu + canvas streaming | Rejected for this milestone | Loses DOM overlays, browser-native codec support, mouse-native interaction. ~6 month project for marginal user value |
| Full WASM effect runtime (Rust-compiled), canvas draws bitmap | Rejected | Still needs HTMLVideoElement for decoding; partial win, high integration cost |
| **RenderPlan IR with TS hand-port (this spec)** | **Accepted** | Minimal infra, high correctness payoff, preserves all current strengths |
| RenderPlan IR with Rust→wasm compiler | Future optimization | Replaces `compile.ts` with wasm once the infra is justified by other features |

## Appendix B — Follow-up work this unlocks

Each becomes a 1–2 day PR after PR-3 lands, instead of the multi-day architectural negotiations they are today.

- **Transition xfade overlap.** Flip `CompileOptions::transition_mode` to `Overlap`. Both renderers already handle `overlapNext`.
- **Trim-aware loudnorm measurement.** The cache key moves from `path` to `(sourceId, sourceIn, sourceEnd)`; the compiler emits `AudioStage.normalize = None` until the trim-aware measurement is available and a new warning is emitted in its place.
- **Proxy media.** Plumb `CompileDeps::proxy_lookup`; preview automatically prefers proxies, export automatically prefers originals. Renderers unchanged.
- **Hardware encoder selection.** Pure export-side concern; adds a `preferredEncoder` field to `CompileOptions`, consumed only by `build_ffmpeg_args`.
- **Real audio waveforms.** Replaces the deterministic-fallback path in `AudioClipBody` by keying off `sourceId` instead of `filePath`.
- **Bundled Inter font.** Compiler always picks Inter when it's present; previews and exports render identical glyphs. The `fontProbe` still exists but is demoted to a fallback layer.

Each of these was a "known divergence" in the architecture doc. The IR reduces every one to "change the compiler, renderers are unchanged."
