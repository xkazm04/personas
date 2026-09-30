# Athena Voice Studio v2 - implementation plan

Status: **phase 1 in progress** (2026-09-30). The current Stage setup stays the default until the
owner accepts the port; the new shell ships behind a switch beside it.

## Where this comes from

A two-round contest decided the design (contest records in the local `.contest/` vault, not
committed):

| Round | Question | Owner's decision |
|---|---|---|
| 1 - research report | how a non-technical person calibrates a companion's voice and manner | shortlisted **"Two Takes"**: pick between two takes as the core gesture, free-text direction as a complement, a Style Card compiled from the picks, Round 0 conversation while the voice installs |
| Engine bake-off | Qwen3-TTS, Chatterbox, Kokoro, VoxCPM2 measured on an RTX 4090 and CPU (2026-09-29) | **Kokoro Heart is the default engine**; preset voices; a **GPU/CPU toggle** so people compare the wait on their own machine; **cloning deferred** ("let the market develop"); Qwen3-TTS noted for pre-rendered content, not live chat |
| 2 - UI prototypes | the first meeting, in text and sound | **B/1 "Across the Table"**, to be ported following the composition kit and Personas styling |

The winning prototype's bet: **the conversation owns the page.** Athena types while her voice
installs, then speaks. Every decision arrives as a card inside the chat and folds into a one-line
receipt with *change* once answered. Two instruments flank the chat: the **path** on the left (the
current beat opened into its steps) and **her Style Card** on the right, writing itself in plain
words. The voice pinnacle moves her orb to the centre of the room, breathing with the real signal,
with her words lighting as she says them.

## What exists today (the engine the shell sits on)

- One engine, `sub_create/engine/useCreateAthenaEngine.ts`, emits one `card` per step
  (`createAthenaTypes.ts`: `intro`, `keep_toggle`, `orb_place`, `engine_pick`, `install`,
  `voice_pick`, `stt`, `handoff`) and was built to drive several shells.
- Ten steps: `intro, footer_icon, orb, orb_place, chime, voice_engine, voice_install, voice_pick,
  stt, handoff`. The pointer persists in `useSystemStore.athenaOnboardingStep`.
- TTS: Kokoro through the sherpa-onnx CPU sidecar, **one process per sentence** (measured ~1.7 s of
  spawn cost per sentence); the Kokoro catalog exposes **one voice** (`af_heart`,
  `src-tauri/src/companion/tts/kokoro_catalog.rs`). `athenaVoiceSpeed` is stored but **no UI writes
  it**. No GPU path, no pauses/tone controls, no manner settings anywhere.

## The phases

Each phase lands as atomic commits in the main checkout and is usable on its own. The owner's gate
is visual: after each phase, screenshots or the live app, then a verdict.

### Phase 1 - the Table shell over today's engine (this session)

Port the winner's look and layout as `variants/CreateAthenaTable.tsx` + `variants/table/*`,
rendering the **existing** cards. No engine change.

- **Switch:** `CreateAthenaPanel` gains a Stage | Table switch; **Stage stays the default**. The
  choice is a per-viewer convenience (local storage, wrapped in try/catch).
- **Beats (left rail):** Hello (`intro`) -> Where I live (`footer_icon`, `orb`, `orb_place`,
  `chime`) -> Her voice (`voice_engine`, `voice_install`, `voice_pick`) -> Your voice (`stt`) ->
  Ready (`handoff`). A beat opens into its steps; done beats are a way back (`goTo`).
- **Thread (centre):** her line typed as a message; the current step's card is the one live card;
  answered steps fold into receipts with *change* (derived from the real store values, not a local
  copy). The dock under the thread carries the keys for the moment; `?` lists them all.
- **Presence:** the orb header; during install its ring fills with the real progress.
- **Style Card (right rail):** only what is real today - her voice, how she reaches you (footer,
  orb, chime), how she hears you (STT). The manner section appears in phase 3, not as a placeholder.
- **Styling:** a feature stylesheet ported in the form the winner wrote it (layered gradients,
  receipts, cards, the path), with type and colour routed through the app's tokens so every theme
  repaints it, and light-theme overrides the dark prototype never had. Components under 200 lines.
  Every string through `t.athena.*` in all 14 locales.
- **Promotion check** (`.claude/skills/contest/references/promotion.md`): roles from the owner's
  choice (path beat, her message, live card, receipt, option, dock action, Style Card, presence),
  captured from the winner with `style-contract.py`, checked against the real component in a
  harness until the deviations are explained or zero; the named interaction (a card folds into a
  receipt; *change* reopens it) driven in a browser.

### Phase 2 - her voices, and pace

- Verify the `kokoro-multi-lang-v1_0` sids and expose Heart (default) plus a small curated set
  (Bella and Emma were heard in the bake-off) in `kokoro_catalog.rs`.
- The **Two Takes** voice card: one line, two takes, *first / second / can't tell / neither*;
  reuses `previewVoice` per take.
- **Pace**: the first UI writer for `athenaVoiceSpeed` (0.7-1.2), chosen by a pair, not a slider.
- A held-out line confirms the pick in a sentence she has not said yet.

### Phase 3 - manner and the Style Card

- "Who should I be" archetype card and manner pairs (length, formality, humour, directness,
  warmth, asking back, disagreeing), compiled into a Style Card the person can read and edit.
- Stored as its own addendum (never `constitution.md`, which the companion never edits), applied
  in prompt assembly, and checked: a small eval that she actually talks that way.
- The Style Card rail gains *How she talks*; every line is a *change* door back to its pair.

### Phase 4 - GPU/CPU, and a warm voice

- A GPU runtime for Kokoro (a CUDA-enabled sherpa-onnx provider or onnxruntime-gpu), detected at
  install; a stored device choice.
- The **speed step**: the same answer played from the graphics card and from the processor, each
  timed on *this* machine, phrased for a person ("answers right away" / "after a breath"), numbers
  one level down behind *Details*.
- A **warm synthesis worker** instead of a process per sentence: it removes the measured ~1.7 s
  per sentence on every machine, GPU or not.

### Phase 5 - the pinnacle: talking to her

- Centre stage: the orb moves to the middle, the thread fades, her words light as she speaks, the
  orb breathes with the real signal. Talk to her (STT -> chat -> TTS) and nudge live ("slower",
  "shorter"); `T` shows the transcript.
- *She is ready*: the keep sheet with her card, and a way back to change anything later from the
  companion settings.
- Pauses and tone (the prototype's "room" and "air") only if app-side audio processing is judged
  worth it after phase 4; they were simulated in the prototype.

### Phase 6 - acceptance and cleanup

When the owner accepts the Table shell: make it the default, remove the Stage shell and its tests,
remove the switch, update `docs/features/` and the onboarding tour, run `/guide-sync`, add a
`CHANGELOG.md` entry.

## Deferred and declined

- **Voice cloning / bring a voice**: deferred by the owner until the market develops. Qwen3-TTS
  1.7B/0.6B cloned well but is GPU-slow; a candidate for pre-rendered content, not the reply loop.
- **Pocket TTS on the main path**: not offered in setup (experimental, non-commercial ONNX licence).
- **Blending Kokoro voices**: not pursued; presets are the path.

## Risks

- The sids must be verified before any new voice ships; a wrong sid silently speaks another voice.
- Phase 3 touches the companion's prompt; a manner setting that the model ignores is worse than
  none, hence the eval.
- A GPU runtime adds a large download and a second install path; it must degrade to CPU silently
  only where the person has not chosen GPU, and say so where they have.
