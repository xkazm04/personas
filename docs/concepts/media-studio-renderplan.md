# Media Studio — RenderPlan IR

**Status:** Proposal
**Supersedes:** the "dual implementation is deliberate" stance in `media-studio-architecture.md` §Three-layer model
**Relates to:** §Effect model & parity matrix, §Known divergences (transition overlap, waveforms, proxies)
**Depends on:** nothing — can land alongside current renderers without breaking them

---

## Why this exists

Today `CompositionPreview.tsx` and `ffmpeg.rs::build_ffmpeg_args` each traverse the `Composition` and apply the same effect rules (trim, speed, fade, transition-fade-fold, normalize gain). The rules live as **prose** in the parity matrix and as **hand-written code** in two places. Every new effect is two implementations and a new parity doc-note.

The fix is to hoist composition-level logic into a **compile step** that produces a flat, pre-resolved IR. Both renderers consume the IR verbatim with zero composition awareness. The transition-fade-fold rule lives in *one* place. Invariants become checkable at type level and via property tests.

This doc specifies the IR, the compiler signature, the invariants, and a migration path. It does not yet specify the compiler implementation — that's the next PR.

---

## Design goals

1. **Single source of truth** for effect math. Rules live in the compiler, not in renderers.
2. **Renderers become dumb.** Each stage says "play this source region with this gain/opacity/transform between `t_start` and `t_end`." No neighbor-clip awareness.
3. **Extensible without parity proliferation.** Adding a new effect = one type extension + one compiler branch + two renderer branches. No new prose rule.
4. **Supports both transition models** — today's fade-folded sequential tracks AND tomorrow's true xfade overlap — selected via a `CompileOptions` flag, with identical downstream handling.
5. **Frame-accurate option.** A compile flag snaps stage boundaries to `1/fps` so the preview stops showing frames that don't exist in the export.
6. **Schema-versioned** so stored compositions survive IR evolution.

Non-goals:
- Not a replacement for `Composition`. `Composition` stays as the authoring / serialization format.
- Not a full renderer abstraction — preview and export still have different engines (browser vs FFmpeg). They just share an input contract.
- Not a performance claim about rendering. The win is correctness + testability + maintainability.

---

## The IR

All types below are described as TypeScript first for readability. They are generated **from** Rust via `ts-rs` so the Rust definitions are the canonical ones; the TypeScript is what the frontend imports.

### Top-level

```typescript
interface RenderPlan {
  /** Bump when the shape changes in a way renderers must react to. */
  schemaVersion: 1;

  /** Output width × height in pixels. Mirrors Composition.width/height. */
  width: number;
  height: number;

  /** Output framerate. Every stage boundary is an integer multiple of 1/fps
   *  when compiled with `frameSnap: true`. */
  fps: number;

  /** Total output duration in seconds. For fade-folded mode this equals
   *  max(stage.tOut) across all video stages. For xfade-overlap mode this
   *  subtracts every overlap. Either way it's the length of the final file. */
  durationSeconds: number;

  /** Explicit frame count. Equals ceil(durationSeconds * fps). Parity tests
   *  iterate 0..durationFrames and assert preview(frame) == export(frame). */
  durationFrames: number;

  /** Solid color drawn before any video stage starts. Hex without alpha. */
  backgroundColor: string;

  /** De-duplicated source catalog. Stages reference sources by index. */
  sources: SourceEntry[];

  /** Video track: sequenced or overlapping video stages. At any time t, at
   *  most two stages are active (current + incoming xfade). */
  videoTrack: VideoStage[];

  /** Audio tracks. Multiple tracks are mixed. Today the compiler produces
   *  one track per AudioClip; future mixing features produce multiple. */
  audioTracks: AudioTrack[];

  /** Overlays are composited on top of the video track in plan order.
   *  Overlap freely; z-order = array order. */
  overlays: OverlayStage[];

  /** Effects the renderer should know were intentionally omitted (e.g. text
   *  skipped because no font available). Surfaced in the export log and the
   *  preview warning banner. */
  warnings: CompileWarning[];
}
```

### Sources

```typescript
type SourceEntry =
  | { kind: 'file';  id: number; path: string;     mediaDurationSeconds: number }
  | { kind: 'proxy'; id: number; path: string;     originalPath: string; mediaDurationSeconds: number }
  | { kind: 'color'; id: number; rgba: string;     mediaDurationSeconds: number };
```

The `proxy` variant is how **proxy media** lands in the plan without branching renderer code: the compiler picks the proxy if one exists on disk; renderers just open whatever the plan says. Export can override to the original by a CompileOptions flag.

### Video stages

```typescript
interface VideoStage {
  /** Unique within the plan. Stable across recompiles of the same Composition
   *  (derived from the source TimelineItem.id) so cached thumbnails survive. */
  id: string;

  /** Index into RenderPlan.sources. */
  sourceId: number;

  /** Absolute start/end on the output timeline, in seconds. tOut > tIn. */
  tIn: number;
  tOut: number;

  /** Source-time region consumed. sourceIn + (tOut-tIn)*speed = sourceOut. */
  sourceIn: number;
  sourceOut: number;

  /** Playback rate applied to the source. Always > 0. Preview sets
   *  video.playbackRate; export emits setpts. */
  speed: number;

  /** Effective fades in seconds. For fade-folded transitions these already
   *  include the transitionDuration contribution — renderers do NOT fold. */
  fadeIn: number;
  fadeOut: number;

  /** True when this stage overlaps the next video stage. Only set when the
   *  compiler ran in `transitionMode: 'overlap'`. Used by export to emit
   *  xfade, by preview to schedule the secondary video element. */
  overlapNext: null | {
    durationSeconds: number;
    kind: 'crossfade' | 'fade_to_black';
  };

  /** True to mute any audio track embedded in the source file. Dedicated
   *  audio clips are independent and live on an AudioTrack. */
  stripEmbeddedAudio: boolean;
}
```

Note what's missing: `transition`, `transitionDuration`, `trimStart`, `trimEnd`. Those are all inputs the compiler consumed; the stage only carries the *result*.

### Audio tracks

```typescript
interface AudioTrack {
  /** Stable per recompile. */
  id: string;

  /** Stages on this track. Stages on the same track may overlap (mixed).
   *  Different tracks are mixed against each other via `amix`. */
  stages: AudioStage[];

  /** Track-level gain (0..1). Used when future features add master-bus
   *  automation; for now always 1. */
  gain: number;
}

interface AudioStage {
  id: string;
  sourceId: number;

  tIn: number;
  tOut: number;
  sourceIn: number;
  sourceOut: number;
  speed: number;

  /** Linear gain applied before afade. Already includes clip.volume AND the
   *  measured loudnorm gain when normalize is on. Renderers multiply and go.
   *  Clamped to [0, MAX_NORMALIZE_GAIN]. */
  gain: number;

  fadeIn: number;
  fadeOut: number;

  /** If the compiler wants two-pass loudnorm at export time, it forwards the
   *  cached measurements verbatim. Preview never reads these — its gain is
   *  baked into `gain` above. */
  loudnormMeasurements: null | {
    integratedLufs: number;
    lra: number;
    truePeakDbfs: number;
    threshold: number;
  };
}
```

The key subtle win: `gain` is **fully resolved** in the plan. Preview and export apply it identically. Today the preview computes `loudnormGain(measuredLufs, -16)` inline; the export passes `loudnorm=I=-16` and trusts FFmpeg to converge. With the IR the compiler guarantees these match by emitting the same linear number to both.

### Overlays

```typescript
type OverlayStage =
  | TextOverlayStage
  | ImageOverlayStage;

interface OverlayBase {
  id: string;
  tIn: number;
  tOut: number;
  fadeIn: number;
  fadeOut: number;

  /** Frame-relative position [0, 1]. Renderers scale to container size. */
  positionX: number;
  positionY: number;
}

interface TextOverlayStage extends OverlayBase {
  kind: 'text';
  text: string;
  /** Resolved font face. The compiler picks from a bundled set + optional
   *  system probe and records the final choice so preview and export render
   *  identical glyphs. */
  fontFamily: string;
  fontWeight: 400 | 500 | 700;
  /** Pixels at composition height. Renderer scales for preview:
   *  pxInPreview = fontSizePx * (previewHeight / composition.height). */
  fontSizePx: number;
  colorHex: string;
}

interface ImageOverlayStage extends OverlayBase {
  kind: 'image';
  sourceId: number;
  scale: number;
}
```

### Warnings

```typescript
type CompileWarning =
  | { kind: 'text_font_missing'; overlayId: string; fallback: string }
  | { kind: 'loudnorm_unmeasured'; audioStageId: string }
  | { kind: 'speed_clamped'; stageId: string; requested: number; applied: number }
  | { kind: 'proxy_missing'; sourceId: number; usingOriginal: boolean };
```

Warnings are non-fatal. They exist so the preview UI and the export log can show the same set of caveats — another parity point.

### Rust mirror

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
    pub duration_seconds: f64,
    pub duration_frames: u64,
    pub background_color: String,
    pub sources: Vec<SourceEntry>,
    pub video_track: Vec<VideoStage>,
    pub audio_tracks: Vec<AudioTrack>,
    pub overlays: Vec<OverlayStage>,
    pub warnings: Vec<CompileWarning>,
}

// … analogous structs for VideoStage, AudioStage, OverlayStage, SourceEntry …
```

All fields are serde-serializable; the plan crosses the Tauri IPC boundary as JSON just like `Composition` does today.

---

## The compiler

Single entry point. Pure function. No I/O except an optional proxy-lookup callback.

### Signature

```rust
pub fn compile(
    composition: &Composition,
    opts: &CompileOptions,
    deps: &CompileDeps,
) -> Result<RenderPlan, CompileError>;

pub struct CompileOptions {
    /// `Fold` = today's behavior: transitions collapse into fades on each side,
    ///         stages are sequential, totalDuration = Σ stage.duration.
    /// `Overlap` = true xfade: stage[i] and stage[i+1] overlap by
    ///             transitionDuration, totalDuration is Σ durations − overlaps.
    pub transition_mode: TransitionMode,

    /// Snap every stage boundary to `1/fps` so preview never shows a frame
    /// that export wouldn't produce. Default true. Disable only for artistic
    /// sub-frame scrubbing, which is a deliberate divergence.
    pub frame_snap: bool,

    /// True when the plan will be consumed by the export pipeline. The
    /// compiler prefers originals over proxies in this mode.
    pub for_export: bool,
}

pub struct CompileDeps<'a> {
    /// Optional — if provided, `sources` will reference proxies when they
    /// exist. None for tests.
    pub proxy_lookup: Option<&'a dyn Fn(&str) -> Option<ProxyRef>>,
    /// Optional — if provided, determines which fonts are available on this
    /// host. None means "use bundled Inter only".
    pub font_probe: Option<&'a dyn Fn(&str) -> bool>,
}

pub enum CompileError {
    InvalidComposition { reason: String },
    NegativeDuration { stage_id: String },
    SourceOutOfBounds { stage_id: String, requested: f64, available: f64 },
    UnsupportedSpeed { stage_id: String, speed: f64 },
}
```

### Algorithm (sketch)

The compiler is a six-step pass over `Composition.items`, ordered deterministically by `(type, startTime, id)`:

1. **Bucket items by type** — videos, audios, images, texts.
2. **Dedup sources** — build the `sources` vector, de-dup by `(path, proxy?)`.
3. **Per-video stage construction:**
   - For each `VideoClip` i in startTime order:
     - Compute `baseFadeIn = clip.fadeIn ?? 0`, `baseFadeOut = clip.fadeOut ?? 0`.
     - Compute `transitionIn` from `videos[i-1].transition + transitionDuration` (the fold rule — **this is the only place it lives now**).
     - Compute `transitionOut` from `clip.transition + transitionDuration`.
     - **If `transitionMode == Fold`:**
       - `fadeIn = min(clip.duration, baseFadeIn + transitionIn)`
       - `fadeOut = min(clip.duration, baseFadeOut + transitionOut)`
       - `tIn = clip.startTime; tOut = clip.startTime + clip.duration`
       - `overlapNext = None`
     - **If `transitionMode == Overlap`:**
       - `fadeIn = baseFadeIn; fadeOut = baseFadeOut`
       - `tIn = Σ previous (duration − transitionDuration); tOut = tIn + clip.duration`
       - `overlapNext = Some({durationSeconds: transitionDuration, kind})` if next clip has transition set.
     - Compute `sourceIn = clip.trimStart; sourceOut = clip.trimStart + clip.duration * speed`.
     - Emit a `VideoStage`.
4. **Per-audio stage construction** (similar, plus the loudnorm gain fold):
   - `gain = clip.volume × loudnormGain(clip.measuredLufs, TARGET_LUFS)` (clamped)
   - If `clip.normalize && clip.measuredLufs.isNone()`: emit `CompileWarning::LoudnormUnmeasured` and use `gain = clip.volume` (no amplification).
5. **Overlay stage construction** — resolve font, emit warnings for missing overlays.
6. **Frame-snap pass** (if `opts.frame_snap`) — for each stage, snap `tIn`/`tOut`/`overlapNext.durationSeconds` to the nearest `1/fps`; then tighten `sourceIn/sourceOut` to match.

The output is an immutable `RenderPlan`.

### Determinism

Given identical `(Composition, CompileOptions, CompileDeps result)`, `compile` must produce bit-identical output. This enables:
- Plan caching by `hash(composition_json) + hash(opts)`.
- Golden-file tests: serialize the plan, snapshot, diff.
- Reproducible exports.

---

## Invariants

Every `RenderPlan` emitted by `compile` upholds the following. These are the backbone of the property-based parity tests.

**I1.** `durationFrames == ceil(durationSeconds * fps)`.

**I2.** For every stage `s`: `s.tIn >= 0 && s.tOut > s.tIn && s.tOut <= durationSeconds`.

**I3.** For every stage `s`: `s.fadeIn + s.fadeOut <= s.tOut - s.tIn` (fades never overlap in the middle).

**I4.** For every video/audio stage `s` with `sourceId -> src`: `s.sourceIn >= 0 && s.sourceOut <= src.mediaDurationSeconds && s.sourceOut > s.sourceIn`.

**I5.** For every video/audio stage `s`: `(s.sourceOut - s.sourceIn) ≈ (s.tOut - s.tIn) * s.speed` within 1/fps tolerance.

**I6.** Every `AudioStage.gain` is in `[0, MAX_NORMALIZE_GAIN]`.

**I7.** Every `OverlayBase.positionX, positionY` is in `[0, 1]`.

**I8.** Within `videoTrack`, stages are sorted by `tIn` ascending. In `Fold` mode, consecutive stages are sequential (`videos[i+1].tIn == videos[i].tOut`). In `Overlap` mode, `videos[i+1].tIn == videos[i].tOut - overlapNext.durationSeconds` when `overlapNext` is set.

**I9.** When `opts.frame_snap == true`, every `tIn, tOut` is an integer multiple of `1/fps` within 1e-9 tolerance.

**I10.** Every `warnings` entry references an id that exists in the corresponding stage list.

Each invariant is a one-line check; the full battery runs in microseconds. Property tests use `quickcheck`/`proptest` (Rust) and `fast-check` (TS) to generate Compositions; invariants are asserted on every output.

---

## Renderer contract

Both renderers are thin. They do not consult `Composition`.

### Preview

```typescript
function renderPreview(plan: RenderPlan, engine: PlaybackEngine): void;
```

- Video: at each `currentTime`, find the active video stage (`s.tIn <= currentTime < s.tOut`). If `s.overlapNext` exists and `currentTime >= s.tOut - overlap.duration`, also preload the next stage into a secondary `<video>` element and crossfade opacity.
- Audio: each AudioTrack has a GainNode chain, stages are scheduled per rAF tick. `stage.gain × fadeOpacity(local, stage.duration, stage.fadeIn, stage.fadeOut)` is the live linear gain.
- Overlays: iterate `plan.overlays`, match `currentTime`, emit the DOM node with the given position/opacity. Z-order = array order.

### Export

```rust
pub fn build_ffmpeg_args(plan: &RenderPlan, output_path: &Path) -> Vec<String>;
```

- One `-i` per unique `SourceEntry`.
- Per VideoStage: `[srcI:v]trim=sourceIn:sourceOut,setpts=(PTS-STARTPTS)/speed,fade=t=in:start=0:d=fadeIn,fade=t=out:start=...:d=fadeOut[v{i}]`.
- Concat / xfade between video stages depending on `overlapNext`. This is the **only** place export decides; it reads `overlapNext` and emits `xfade=offset=...:duration=...` vs `concat`.
- Per AudioStage analogous, plus optional two-pass loudnorm using `loudnormMeasurements`.
- Overlay chain applied post-concat.

Neither renderer reads `clip.transition`, `clip.transitionDuration`, `baseFadeIn + transitionContribution`, or any other composition-level concept. If they do, it's a bug.

---

## Parity test strategy

Three layers.

### 1. Compiler invariants (property-based)

```rust
proptest! {
    #[test]
    fn compile_respects_invariants(comp in any_valid_composition()) {
        let plan = compile(&comp, &CompileOptions::default(), &CompileDeps::none()).unwrap();
        assert_invariants(&plan);
    }
}
```

`any_valid_composition()` is a proptest generator that produces random but structurally-valid compositions (overlapping items, negative fades clamped to zero, etc.). Catches compiler bugs.

### 2. Renderer parity (snapshot-based)

```typescript
// for every fixture in __fixtures__/compositions/*.json
describe('parity', () => {
  for (const fixture of fixtures) {
    it(`${fixture.name} — preview vs export frame match`, async () => {
      const plan = await compile(fixture.composition);
      const previewFrames = await samplePreviewFrames(plan, [0.0, 0.5, 1.0, ...]);
      const exportFrames = await sampleExportFrames(plan, [0.0, 0.5, 1.0, ...]);
      for (let i = 0; i < previewFrames.length; i++) {
        expect(pixelDiff(previewFrames[i], exportFrames[i])).toBeLessThan(0.02);
      }
    });
  }
});
```

`samplePreviewFrames` runs the preview in headless Chromium (Playwright), seeks to the given times, captures `<canvas>` pixels. `sampleExportFrames` runs the export to a tmp mp4, then `ffmpeg -ss` + frame grab. Pixel-diff threshold accounts for codec/renderer color-space differences (2% is standard for "visually identical").

Fixtures cover: plain cut, crossfade, fade-to-black, sub-frame scrubbing (snap on/off), normalize on/off, multiple overlapping overlays, strip-audio, speed 0.25× / 4×.

### 3. Schema compatibility (CI check)

`schemaVersion` is frozen per release. A golden file per version lives in `docs/concepts/render-plan-fixtures/v1/`. CI deserializes every golden into current types; any breaking change fails the build and forces a `schemaVersion` bump + migration.

---

## Migration

Three incremental PRs, each shippable alone.

### PR-1: Introduce the IR alongside current renderers

- Add `src-tauri/src/engine/render_plan.rs` with types and `compile`.
- Add `src/lib/bindings/RenderPlan.ts` (generated via `ts-rs`).
- Add property tests for invariants.
- Neither renderer uses it yet.

**Outcome:** a new, tested, unreferenced module. Zero user impact.

### PR-2: Route export through the IR

- `artist_export_composition` compiles the incoming JSON → `RenderPlan`, then `build_ffmpeg_args(&plan)` consumes that instead of `Composition`.
- All transition / fade / trim logic moves from `build_ffmpeg_args` into `compile`.
- Golden-file tests assert the emitted FFmpeg args for representative fixtures are byte-identical to today's (or intentionally different with reason).

**Outcome:** one renderer is on the IR. Export behavior unchanged. Parity matrix column "Export mechanism" reduces to "consume stage verbatim".

### PR-3: Route preview through the IR

- `CompositionPreview.tsx` calls `compile` client-side (same Rust module via wasm, OR a duplicate TS compiler — see below).
- All `effectiveVideoFades`, `loudnormGain`, `fadeOpacity` logic either deletes or becomes a pure stage-renderer helper.
- Parity tests flip from "advisory" to "required in CI".

**Outcome:** both renderers on the IR. The prose parity matrix in `media-studio-architecture.md` gets deleted.

### Open question: TS compiler or wasm-from-Rust?

Two options for the frontend:

**A) Hand-port `compile` to TypeScript.** Pros: zero infra. Cons: the thing we just got rid of (duplicated logic) is back in a different form.

**B) Compile the Rust `compile` module to wasm and consume it from the frontend.** Pros: single source of truth at the type level AND the code level. Cons: new build step (`wasm-pack`), wasm package adds ~80KB, calling conventions.

**Recommendation:** B. The compiler is pure and small (~300 LOC estimated); wasm is exactly the right tool. Ship B in PR-3 with a fallback to A in a file named `compile.ts.fallback` kept only to assist the wasm-less test environment.

---

## What this doesn't solve

Be explicit about what remains as-is after the IR lands:

- **Decoder parity.** HTMLVideoElement's H264 decode vs FFmpeg's libx264 decode may differ in edge chroma / IDR handling. Out of scope.
- **Font rendering.** Even with a bundled font, CSS text shaping (harfbuzz-like in browsers) and FFmpeg's `drawtext` (freetype) produce subtly different metrics. The IR records which font was used — the renderers still use different rasterizers.
- **Audio decode parity.** Same story for AAC / Opus decoders.
- **True GPU acceleration.** Not in scope. The IR is agnostic to encoder choice.

These are accepted "we are not Adobe" divergences. The IR narrows parity to **rules we control**, which is what actually bites us in practice.

---

## Decision

This IR is the cheapest architectural move with the highest correctness-and-maintainability payoff. It does not require a Rust rewrite of the preview. It does not lock us out of a future wgpu preview — that would just become a third renderer consuming the same IR.

PR-1 is ~2 days. PR-2 is ~3 days. PR-3 is ~4 days (most of it wasm wiring). Total ~1.5 engineering weeks to land the full loop.

Once it's in, the current "known divergences" list gets re-triaged:

| Divergence | How the IR changes it |
|---|---|
| Transition xfade overlap | Adds a single CompileOptions flag; renderers already handle `overlapNext` |
| Waveform thumbnails | Becomes a source-catalog concern, not a renderer concern |
| Proxy media | Plan carries the proxy reference; renderers don't care |
| Preview frame accuracy | Becomes a CompileOptions flag; preview opts in |
| Loudnorm trim-aware measurement | Cache key becomes `(sourceId, sourceIn, sourceOut)` at the compiler layer |

Each is now ~1-2 day follow-up PRs instead of architectural negotiations.
