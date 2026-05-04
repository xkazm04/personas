# Athena Interactive Avatar — Layered Architecture

**Status:** Concept / parked for later exploration
**Author:** Design pass 2026-05-02
**Scope:** Persona avatar surface (Athena baseline), audio/cursor reactivity, UI chrome
**Decision:** Document the three-layer approach. No code yet.

## TL;DR

Build Athena as a **three-layer composite** rather than a single rigged character:

1. **Layer A — Pre-rendered MP4 base.** State-driven `<video>` swap with crossfade (`idle ↔ thinking ↔ speaking ↔ ...`). Carries the photoreal volumetric aesthetic that defines the persona.
2. **Layer B — Reactive WebGL/canvas overlay.** Transparent layer above the video, driven by Web Audio analyser + cursor/focus events. Pulses the chest core glow, drifts particles, blooms on input. Cheap to add, large perceived "alive" gain.
3. **Layer C — Rive UI chrome.** Vector + state-machine UI elements *around* the avatar — listening rings, thinking dots, status badges, micro-interactions on persona controls. Rive does **not** drive the avatar itself.

Why split the layers: the baseline asset is a photoreal raster (volumetric particles, sub-pixel translucency, glowing core). A vector engine cannot host it without flattening the aesthetic, and Rive's runtime has no MP4 decoder. Pre-rendered video preserves the look; canvas/Rive add the reactivity each is good at.

---

## Part 1 — Constraints that drove the design

### 1.1 The baseline is the constraint

`public/athena/athena_baseline.jpg` (768×768, ~470KB JPG) is volumetric and photoreal — translucent particle silhouette, soft glow, cyan core. The aesthetic does not survive vectorisation. Any approach that re-draws Athena (Rive vector rig, SVG, CSS art) loses the persona's visual identity.

Therefore: **the avatar itself is video.** Reactivity is added in layers above, not by re-rigging the avatar.

### 1.2 Local-first economics

The desktop app's hard rule (see `feedback_credentials_stay_local.md`) is that user state stays local. Real-time talking-head services (HeyGen LiveAvatar, Simli, D-ID) stream synthesized video from the cloud per-minute. They are out of scope for the always-on avatar; they may become opt-in for a specific "voice conversation" feature later, but the default avatar must run offline.

### 1.3 What Rive can and cannot do here

- **Cannot:** play MP4, accept the JPG as a riggable character, render volumetric photoreal pixels.
- **Can:** vector animation, state machines, lightweight WASM runtime, AI-assisted authoring via the Rive MCP server / AI coding agent.

Rive's payoff is concentrated in the UI shell, not in Athena's body.

---

## Part 2 — Layer A: Pre-rendered video state machine

### 2.1 Asset library

Today: `athena_idle.mp4`, `athena_thinking.mp4` (each ~1.4MB, locally bundled). Target library:

| State | Trigger | Loop? | Notes |
|---|---|---|---|
| `idle` | default | yes | currently shipped |
| `thinking` | persona is generating | yes | currently shipped |
| `speaking` | TTS playback active | yes | needed |
| `greeting` | session start | no | one-shot, transitions back to idle |
| `acknowledging` | task accepted | no | brief nod / glow pulse |
| `dismissive` | task rejected / cancelled | no | optional, low priority |

New clips can be generated offline by feeding the baseline JPG + a prompt to an image-to-video model (Runway Gen-3, Kling, Pika 2). Estimated cost ~$0.05–0.25 per clip, batch overnight. Clips ship in `public/athena/` — no runtime cloud dependency.

### 2.2 State machine

Finite states with permitted transitions:

```
idle ⇄ thinking
idle ⇄ speaking
thinking → speaking → idle
greeting → idle  (one-shot on mount)
* → acknowledging → previous-state  (interrupt)
```

Implementation suggestion (no code yet — recorded for later):
- A small Zustand slice: `avatarState: 'idle' | 'thinking' | 'speaking' | ...`, plus `transition(next)` with allowed-transition guards.
- Driven by existing app signals: build session active → `thinking`, TTS audio playing → `speaking`, otherwise `idle`.
- One-shot states auto-resolve back via `onEnded` of the underlying video.

### 2.3 Crossfade rendering

Two stacked `<video>` elements, A and B. On state change:
1. Preload next clip on the inactive element.
2. Start playback at `t=0`, set `opacity: 0`.
3. CSS transition `opacity` 200–300ms, swap z-index.
4. Pause and unload the previous clip after fade completes.

Looped clips need first-frame ≈ last-frame for seamless restart; this is a generation-time constraint to give the image-to-video prompt.

### 2.4 Memory and decode cost

Two simultaneous decoders is the worst case (during a fade). On a typical desktop this is negligible. On low-end devices we should watch GPU decoder pressure — Tauri's WebView2 on Windows hands video to the OS decoder, so cost is small.

---

## Part 3 — Layer B: Reactive overlay

### 3.1 What it adds

The video alone is a loop. Reactivity is what sells "alive":

- **Audio-reactive chest core.** While `speaking`, sample TTS audio level via `AnalyserNode.getByteFrequencyData()` and modulate a radial bloom centred on the chest core position. Low-band energy → core brightness; mid/high → particle density.
- **Cursor proximity drift.** When cursor is within N pixels of the avatar, drift a few extra particles toward it. Subtle — a 2-3% effect, not a follow-the-mouse parallax.
- **Focus pulse.** When the persona's input field gains focus, single soft pulse from the core outward.
- **Idle breath.** Optional ultra-low-frequency pulse during `idle` even without audio, to avoid the static-loop feeling between video restarts.

### 3.2 Implementation choice

Three options, in order of overhead:

| Tech | Pros | Cons |
|---|---|---|
| **2D `<canvas>`** | zero deps, full control | manual particle math, no shader bloom |
| **PixiJS** | sprite/filter pipeline, cheap bloom | ~80KB gzipped, abstraction over WebGL |
| **three.js + post-processing** | real shaders, real bloom | overkill for 2D, ~150KB+ |

Recommended: **PixiJS** if we want shader bloom out of the box; **2D canvas** if we keep particles flat and use CSS `filter: blur()` for glow. Default to canvas first, escalate only if the look is insufficient.

### 3.3 Calibration — the chest-core anchor

The chest core is at a fixed position in the baseline (~45% from left, ~70% from top in the 768×768 frame). The overlay layer needs to know this anchor to centre the bloom. Hardcode the normalized coordinates per clip; if a future clip moves the avatar, store anchor metadata alongside the clip filename.

### 3.4 Audio source

Web Audio graph: `MediaElementAudioSourceNode` (TTS audio element) → `AnalyserNode` → `AudioDestinationNode`. The analyser is the tap. No effect on playback; one analyser per audio source. Frame-rate matched to `requestAnimationFrame`.

---

## Part 4 — Layer C: Rive UI chrome

### 4.1 Where Rive earns its keep

UI elements *around* the avatar that are stateful, vector, and benefit from designer-authored motion:

- **Listening ring** — concentric pulsing arcs while microphone is active.
- **Thinking dots** — three-dot loader, but with personality (offset, easing, glow).
- **Status badge** — animated transitions between `online / busy / offline`.
- **Capability chips** — micro-bounce when a tool fires.
- **Action confirmations** — checkmark draw-in, dismiss sweep.

Each is a small `.riv` file with a state machine. The Rive React runtime is already lightweight (~70KB WASM, lazy-loadable). State inputs are driven from the same Zustand slice that drives Layer A.

### 4.2 Authoring path

Two routes for producing the `.riv` files:

1. **Designer in Rive editor.** Standard path, best results, requires manual work.
2. **Rive AI coding agent / MCP server.** Generate state-machine vector animations from prompts. Useful for the small UI primitives above; output quality is acceptable for chrome but not for hero pieces. Worth experimenting once the layout is locked.

### 4.3 What Rive does NOT do here

Important to spell this out so the architecture stays clean:
- Rive does not animate Athena's face, body, or particles.
- Rive does not lipsync.
- Rive does not host the chest-core glow (that is canvas, because it must be audio-reactive at frame level).
- Rive files are not loaded for the persona portrait itself — only for the UI chrome.

---

## Part 5 — Composition

```
┌─────────────────────────────────────────────────┐
│ Container (positioned, fixed aspect ratio)       │
│                                                  │
│   ┌─────────────────────────────────────────┐   │
│   │ Layer A: <video> (crossfade pair)       │   │  z=0
│   │   .athena-video-a / .athena-video-b     │   │
│   └─────────────────────────────────────────┘   │
│                                                  │
│   ┌─────────────────────────────────────────┐   │
│   │ Layer B: <canvas> (reactive particles)  │   │  z=1
│   │   pointer-events: none                  │   │
│   └─────────────────────────────────────────┘   │
│                                                  │
│   ┌──────┐                          ┌──────┐    │  z=2
│   │ Rive │ ← listening ring,        │ Rive │       │
│   │ chip │   status badge, etc.     │ ring │    │
│   └──────┘                          └──────┘    │
└─────────────────────────────────────────────────┘
```

All layers absolutely positioned within the container. Layer A and B receive no pointer events; Layer C elements opt in only where they're interactive.

Component sketch (deferred):
- `<AthenaAvatar>` — orchestrator, owns the state slice
  - `<AvatarVideoStack>` — Layer A (crossfade pair)
  - `<AvatarReactiveCanvas>` — Layer B (audio + cursor)
  - `<AvatarChrome>` — Layer C (Rive widgets, positioned)

---

## Part 6 — Open questions to resolve before implementing

1. **Where does Athena live in the app?** Persona detail panel? Floating companion? Full-screen during voice? The container size and aspect ratio depend on this.
2. **Does the avatar persist across routes?** If yes, the video element must survive route changes (portal'd to root) so the loop doesn't restart on navigation.
3. **TTS pipeline.** Does the speaking-state trigger come from a local TTS engine or a cloud provider? Determines whether we have an `<audio>` element to tap with `AnalyserNode`.
4. **Clip generation budget.** Is it acceptable to spend a one-time ~$5–15 generating a 20–30 clip library, or do we constrain to the existing 2 clips + procedural reactivity only?
5. **Multi-persona future.** Athena is one persona. If every persona gets a custom avatar, the per-persona clip library scales linearly. Is the same architecture re-usable, or is Athena bespoke?
6. **Accessibility.** Avatar must respect `prefers-reduced-motion` — disable crossfade, suppress particle drift, freeze on first frame of `idle`. Decide the fallback at design time.

---

## Part 7 — Risks

- **Clip seam visibility.** First-frame ≠ last-frame on a generated loop = visible jump every cycle. Mitigation: explicit prompt requirement at generation time, plus a 100ms crossfade at loop boundary if needed.
- **Audio analyser staleness.** If the `<audio>` element is created after the analyser graph is built, the tap misses it. Mitigation: build the graph lazily on first speaking transition, never on mount.
- **Rive bundle weight.** Adding the Rive React runtime to the main bundle for chrome-only animations is expensive. Mitigation: lazy-load `@rive-app/react-canvas` only when the avatar is mounted.
- **Generated clip quality drift.** Image-to-video models update; clips generated months apart may not visually match. Mitigation: pin model + seed in a metadata file alongside each clip.
- **GPU thermals on laptops.** Two video decoders + canvas + Rive on battery is not free. Mitigation: pause Layer B's `requestAnimationFrame` when the avatar is off-screen (IntersectionObserver).

---

## Part 8 — What to test before committing to the architecture

In order of cost:

1. **15 min — crossfade prototype.** Two `<video>` elements with state-driven swap, just `idle ↔ thinking`. Confirms the loop quality and crossfade timing of the existing clips.
2. **1 hr — audio-reactive chest core.** Single canvas overlay reacting to a stub audio element. Confirms whether the bloom integrates aesthetically with the photoreal base or fights it.
3. **1 hr — single Rive chrome element.** Listening ring `.riv` driven by a state input. Confirms bundle cost and visual coherence with the avatar.
4. **2 hr — single image-to-video clip generation.** Generate one new clip (`speaking`) from the baseline, evaluate quality, lock the prompt template.

If all four feel right, the full implementation is straightforward. If clip generation in step 4 produces unusable output, the whole library plan downgrades to "ship with the 2-3 hand-crafted clips we have."

---

## Related

- `public/athena/athena_baseline.jpg` — baseline image
- `public/athena/athena_idle.mp4`, `athena_thinking.mp4` — current clips
- `.claude/skills/leonardo/SKILL.md` — image generation skill (used to produce the baseline)
- Memory: `feedback_credentials_stay_local.md` — local-first constraint on cloud streaming services
