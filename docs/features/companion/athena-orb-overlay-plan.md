# Athena Orb — Floating Dockable Companion Overlay (Implementation Plan)

**Status:** Planned — not yet implemented
**Author:** Design pass 2026-05-23
**Scope:** Promote Athena out of the footer into a first-class, dockable overlay layer; add voice-in/voice-out without opening the chat; coexist with the traditional chat panel.
**Decision:** Ship in **two steps** — (1) in-footer avatar + hold-to-talk, (2) floating dockable orb overlay. Voice input uses a **local STT engine** (no cloud audio), mirroring the Piper-TTS subprocess pattern.

This plan is the concrete build-out of open question #1 ("Where does Athena live in the app? Floating companion?") from [`athena-interactive-avatar.md`](./athena-interactive-avatar.md). It assumes Layer A (the `AthenaAvatar` video component) as already-shipped foundation and stages Layer B (reactive glow) as an optional polish at the end.

---

## 0. Goal

Today the chat-initiation affordance is a generic lucide `<Bot>` icon in `DesktopFooter`'s right cluster (`CompanionFooterIcon.tsx:301`). Athena's real animated avatar (`AthenaAvatar.tsx`) exists but is only used as a 5%-opacity watermark behind the open chat panel (`CompanionPanel.tsx:208`).

We want Athena to become a **living, movable presence**:

1. Her actual avatar (not a robot glyph) is the initiation surface.
2. She floats as an overlay **above app content**, dockable to any edge/corner, persisting across routes.
3. The user can **speak to her and hear her** without opening the full chat (minimized voice mode).
4. The traditional full chat panel still exists — the orb expands into it.

---

## 1. What already exists (reuse, don't rebuild)

| Capability | Where | Reuse as |
| --- | --- | --- |
| Animated avatar (idle/thinking video crossfade, `speaking` stubbed) | `AthenaAvatar.tsx` | Orb body — already supports circular (`size`) + `fill` modes |
| State machine `closed \| collapsed \| open` | `companionStore.ts`, `types.ts` | Extend with `minimized` |
| TTS out (ElevenLabs + Piper), pending playback, footer Play | `voicePlayback.ts`, `CompanionFooterIcon.tsx:303`, `companionStore.ts` (`pendingPlayback`) | Minimized-mode voice-out |
| Voice in (browser Web Speech) | `useDictation.ts`, `Composer.tsx:54` | Fallback STT engine + the send wiring |
| Send pipeline (optimistic bubble → stream → TTS) | `CompanionPanel.tsx` `send()` | Drive minimized-mode turns through the same path |
| Settings slice + Voice tab | `companionPluginSlice.ts`, `sub_voice/VoicePanel.tsx` | Add orb + STT-engine settings |
| Per-engine local-subprocess pattern (Piper) | `companion/tts/piper.rs`, `commands/companion/voice.rs` | Template for local STT engine |

The footer icon work and the panel-state machine are the only places that need to learn a new concept; everything else is composition.

---

## 2. Architecture — the overlay layer

A new portal-mounted layer at app root that survives route changes (resolves `athena-interactive-avatar.md` open-question #2 — "does the avatar persist across routes?").

```
App root (src/App.tsx)
└── <AthenaOrbLayer/>        ← NEW: portal to document.body, z just below modals
      ├── drag/dock controller (position from store, persisted)
      ├── <AthenaAvatar/>     ← existing, circular mode, state-driven
      ├── reactive glow        ← Step 2.5 / optional (Layer B-lite)
      ├── caption bubble       ← transient "what she's saying" beside orb
      └── voice ring           ← listening/speaking affordance
```

- **Single instance, single video decode.** The orb and the panel watermark should not both mount a decoding `AthenaAvatar` at full size simultaneously; keep the orb at small `size` and the panel watermark at `opacity 0.05` (already cheap). Pause the orb's video via `IntersectionObserver`/visibility when the full panel is open over it.
- **z-index ladder:** orb sits above app content and the footer (`z-40`) but **below** modals/command palette (`z-[60]+`). The open `CompanionPanel` is `z-[60]`; when the panel opens, the orb tucks behind it or morphs into it (see §5 transitions).
- **Pointer discipline:** the layer is `pointer-events-none`; only the orb element itself opts back in. Never blocks clicks on app content.

---

## 3. State model changes

### 3.1 `CompanionState` (companion/types.ts)
```ts
export type CompanionState = 'closed' | 'collapsed' | 'minimized' | 'open';
```
- `closed` — orb hidden entirely (user dismissed the presence).
- `collapsed` — legacy "nothing showing but reachable from footer". Kept for back-compat; footer toggle now cycles `collapsed ↔ minimized`.
- `minimized` — **new**: the floating orb is visible (voice-first, no transcript).
- `open` — full chat panel (existing).

### 3.2 New `companionStore` fields (UI-ephemeral, NOT persisted)
- `orbListening: boolean` — mic is capturing for a voice turn.
- `orbCaption: string | null` — transient line shown beside the orb (her latest spoken sentence / interim transcript).
- Derive `avatarState` (`idle|thinking|speaking`) from existing `streaming` + a `isSpeaking` flag (the panel already computes `isSpeaking`; hoist it to the store so the orb can read it).

### 3.3 New persisted settings (`companionPluginSlice.ts`)
- `companionOrbEnabled: boolean` (default `true`) — master switch for the floating orb (separate from `companionFooterEnabled`).
- `companionOrbDock: { edge: 'left'|'right'|'top'|'bottom'|'free'; x: number; y: number }` — last docked position (normalized 0..1 for `free`). Default bottom-right.
- `companionSttEngine: 'browser' | 'whisper'` (default `'browser'` for back-compat; recommend `'whisper'` once a model is downloaded).
- `companionSttModelId: string | null` — selected local whisper model (e.g. `ggml-base.en`).

All persisted via `systemStore.partialize` like the other companion fields.

---

## Step 1 — In-footer avatar + hold-to-talk (low risk, lands first)

Goal: immediate visible win and de-risk the avatar-in-button render before building the overlay shell.

### 1.1 Replace the robot glyph with Athena (`CompanionFooterIcon.tsx`)
- Import `AthenaAvatar`; replace the `<Bot className={iconClass}/>` (line 301) with:
  ```tsx
  <AthenaAvatar
    state={streaming ? 'thinking' : hasUnreadPlayback ? 'speaking' : 'idle'}
    size={20}
  />
  ```
- Keep the pulse/recolor affordances (`buttonStateClass`) on the wrapping button; the avatar's own ring/bg is fine at 20px. Verify the watermark/circular ring doesn't fight the footer height (32px bar — `size={20}` fits).
- Keep the existing notice popover and Play button untouched.

### 1.2 Hold-to-talk on the footer button
- Add a press-and-hold gesture (pointerdown → start STT, pointerup → stop + send). Short tap still toggles the panel (disambiguate by hold duration ~250ms).
- On release: take the dictation `finalText`, run it through the **same `send()` path** the Composer uses (extract `send` into a shared hook or expose via store `pendingPrompt` with `autoSend: true` — the store already has `pendingPrompt`/`consumePendingPrompt` plumbing at `companionStore.ts:188`).
- Reply auto-plays via the existing TTS pipeline when `companionVoiceEnabled` is on. This already delivers "talk to her without opening chat" at footer scale.

### 1.3 i18n
- Add `plugins.companion.hold_to_talk`, `talk_listening`, `talk_release_to_send` to `src/i18n/locales/en.json`. (Translator note in commit: footer mic hint, keep ≤4 words.)

**Exit criteria for Step 1:** Athena's face animates in the footer; press-hold → speak → hear reply, panel never opens.

---

## Step 2 — Floating dockable orb overlay

### 2.1 New components
- `src/features/plugins/companion/orb/AthenaOrbLayer.tsx` — portal root, reads `companionOrbEnabled` + `state`, renders nothing unless `state === 'minimized'`.
- `orb/AthenaOrb.tsx` — the draggable orb: `AthenaAvatar` (circular, `size` ~56–72) + voice ring + caption bubble + expand/dismiss controls on hover.
- `orb/useOrbDrag.ts` — pointer-based drag with edge snapping; writes `companionOrbDock` on drop (debounced). Respect window resize (re-clamp).
- `orb/OrbCaption.tsx` — transient line beside the orb (interim STT while listening; her spoken sentence while speaking). Auto-fades.

### 2.2 Mount point (`App.tsx`)
- Add `<AthenaOrbLayer/>` lazily, next to the existing `<CompanionPanel/>` (App.tsx:261), inside the same Suspense island. Idle-prefetch it alongside the panel (App.tsx:90-94 list).

### 2.3 Footer button becomes the summon/hide control
- `CompanionFooterIcon` click now cycles: `minimized` (show orb) ↔ `collapsed` (hide orb). A secondary affordance (or right-click / long-press) opens the full panel directly (`open`).
- When `companionOrbEnabled` is false, footer behaves exactly as today (toggles `open`).

### 2.4 Transitions between orb and panel
- `minimized → open`: orb morphs into the panel (shared-layout animation via framer-motion `layoutId` on the avatar, so her face flies from orb position into the panel header). Orb hides while panel is open.
- `open → minimized`: panel collapses back to the orb at its docked position.
- The panel's `setState('collapsed')` close button (`CompanionPanel.tsx:214`) becomes `setState('minimized')` when the orb is enabled — closing the chat leaves the orb floating instead of vanishing to the footer.

### 2.5 Minimized voice loop (the core UX)
- **Tap orb** → start local STT capture; orb shows listening ring + interim caption.
- **Tap again / silence-detect** → stop, send via shared `send()`, orb shows `thinking` avatar state.
- **Reply streams** → her spoken summary plays (TTS); `speaking` avatar state; caption shows the spoken sentence. A small "open chat" affordance appears so the user can escalate to the full transcript if they want detail.
- Entirely keyboard-accessible: a global shortcut (e.g. `Cmd/Ctrl+Shift+A`) toggles listening; `Esc` cancels.

### 2.6 Optional Layer B-lite (reactive glow)
- A single CSS/canvas glow behind the orb that pulses with TTS audio level (tap the existing playback `<audio>` with an `AnalyserNode`, per `athena-interactive-avatar.md` §3.4). Cheap, big "alive" gain. Defer if Step 2 timeline is tight.

### 2.7 i18n
- `plugins.companion.orb_summon`, `orb_hide`, `orb_expand_chat`, `orb_listening`, `orb_dismiss`, `orb_dock_hint`. Add to `en.json` only.

**Exit criteria for Step 2:** Athena floats as a draggable orb that docks to edges, persists across routes and restarts, runs a full voice turn without the panel, and morphs cleanly into/out of the full chat.

---

## 4. Local STT engine (replaces cloud-routed browser dictation)

`useDictation` (Web Speech) cloud-routes audio to Microsoft on WebView2 — conflicts with the local-first rule (`feedback_credentials_stay_local`). Mirror the Piper-TTS approach: **subprocess isolation around a prebuilt whisper.cpp binary**, no ORT in-process (whisper.cpp uses its own ggml, so it also sidesteps the `ort` version conflict that forced Piper to subprocess).

### 4.1 Backend (`src-tauri/src/companion/stt/`)
New module mirroring `companion/tts/`:
- `stt/mod.rs` — `SttEngineId { Browser, Whisper }`, `SttRequest { audio_wav_base64, language: Option<String> }`, `SttResult { text }`, input validation (cap audio bytes, e.g. ≤ 25 MB / ~10 min).
- `stt/whisper.rs` — spawn `~/.personas/companion-stt/bin/whisper-cli(.exe)` (or `PERSONAS_WHISPER_BIN` override / PATH), pass the WAV temp file + model path, parse stdout transcript. Bounded timeout.
- `stt/catalog.rs` — curated ggml whisper models (tiny/base/small, `.en` and multilingual) from `huggingface.co/ggerganov/whisper.cpp`, downloaded to `~/.personas/companion-stt/models/<id>.bin`. Reuse the Piper `downloader.rs` pattern (atomic `.partial` rename, progress on a `companion://stt-download` event channel).
- New IPC in `commands/companion/voice.rs` (or a sibling `stt.rs`): `companion_stt_transcribe`, `companion_stt_engine_status`, `companion_stt_list_models`, `companion_stt_download_model`, `companion_stt_delete_model`. Run `node scripts/generate-command-names.mjs` after adding.

**Why frontend sends WAV, not webm:** keeps the backend free of an ffmpeg dependency. The frontend captures via `getUserMedia` → `AudioContext` → downsample to 16 kHz mono PCM → encode WAV → base64. whisper.cpp consumes 16 kHz WAV directly.

### 4.2 Frontend
- `orb/useLocalDictation.ts` — `getUserMedia` capture + WAV encode + `companion_stt_transcribe`. Same return shape as `useDictation` (`{ supported, listening, finalText, interimText, error, start, stop, reset }`) so the orb and Composer can switch engines transparently.
- `useDictation` stays as the `browser` engine; a thin `useSpeechInput()` selector returns the right hook based on `companionSttEngine`.
- Voice tab (`sub_voice/VoicePanel.tsx`) gains an STT section mirroring the TTS engine selector: engine radio (Browser / Local Whisper), model browser with Installed badge + download (reuse the Piper voice-browser UI shape), and a clear disclosure that Browser mode sends audio to the OS WebView vendor.

### 4.3 Streaming caveat
whisper.cpp is batch (no live interim like Web Speech). For the orb, show a "transcribing…" state after the user stops talking rather than live interim text. Acceptable for short voice turns; document it. (A streaming local STT — whisper streaming or vosk — is a later option if the batch latency feels slow.)

---

## 5. Accessibility & performance

- **`prefers-reduced-motion`:** freeze avatar on first idle frame, disable orb drag inertia and the morph animation, disable reactive glow (per `athena-interactive-avatar.md` open-question #6).
- **Reduced decode:** only one full-size `AthenaAvatar` decoding at a time; pause orb video when the panel is open over it (IntersectionObserver / visibility).
- **Keyboard:** orb is focusable, `role="button"`, labelled; global shortcut to summon + talk; `Esc` cancels listening; dock position adjustable via arrow keys when focused.
- **Mic permission:** request lazily on first listen, never on mount; surface denial state in the orb + Voice tab.
- **Off-screen:** clamp dock position on window resize so the orb never strands off-viewport.

---

## 6. Docs & surfaces to update (same-session sync rule)

Editing `src/features/plugins/companion/**` triggers the doc-sync Stop hook → update in the same turn(s):
- `docs/features/companion/README.md` — add an "Orb / minimized presence" + "Local STT" section.
- This plan file's status as steps land.
- Onboarding: if a companion tour flow exists in `feature-doc-map.json`'s `onboardingFlows`, add an orb intro step.
- Marketing (`../personas-web`): the companion guide category gains the floating-orb + local-voice story (or `/guide-sync` batch later).

---

## 7. Phasing checklist

**Step 1 (½–1 day)**
- [ ] Avatar replaces `<Bot>` in `CompanionFooterIcon` (state-driven).
- [ ] Hold-to-talk gesture → shared `send()` → TTS reply.
- [ ] i18n keys; doc-sync README touch.

**Step 2a — orb shell (shipped)**
- [x] `CompanionState` gains `minimized`.
- [x] Persisted orb settings (`companionOrbEnabled`, `companionOrbPos`) + partialize + Setup toggle.
- [x] `AthenaOrbLayer` portal + `AthenaOrb` (tap/hold/drag in one pointer surface) + edge snapping + persistence; mounted in `App.tsx`.
- [x] Shared `useHoldToTalk` hook (footer refactored onto it; orb reuses it).
- [x] Footer cycles `minimized ↔ collapsed` when orb enabled; panel close → `minimized` when orb enabled.
- [x] Minimized voice loop (hold-to-talk) + interim caption beside the orb.

**Step 2b — orb polish (shipped)**
- [x] Orb→panel morph: panel flies + scales out of the orb's recorded center (anchored to the panel's deterministic bottom-left corner) and collapses back on close. Simpler + more robust than cross-portal `layoutId`.
- [x] Global summon+talk shortcut (Cmd/Ctrl+Shift+A) + `Esc` cancel (`abort()` on the shared hook discards the transcript). Single `useHoldToTalk` instance lifted to `AthenaOrbLayer` so orb + keyboard share talk state.
- [x] `prefers-reduced-motion` handling (morph → opacity-only; orb hover-scale / pulse disabled) via framer `useReducedMotion`.
- [~] Speaking glow: CSS pulse bloom while a spoken reply is queued/playing. **The audio-reactive `AnalyserNode` version is still parked** — `voicePlayback.play()` spins up a fresh `<audio>` per call with no shared analyser, so true level-driven bloom needs playback to be centralized first (§2.6).

**Step 2c — local on-device Whisper STT (shipped)**
- [x] `companion/stt/` module (mod/whisper/catalog/downloader) + 5 IPC commands + command-names regen. Types hand-mirrored in `api/companion.ts` (no ts-rs needed — matches the Piper TTS convention).
- [x] `useLocalDictation` (getUserMedia → 16k mono WAV in the renderer → `companion_stt_transcribe`) + `useSpeechInput` selector; `useHoldToTalk` routes through it so footer + orb pick up the engine choice.
- [x] Voice tab `SttPanel` (engine selector, install status, model browser with download/select/delete + progress, browser cloud disclosure).
- [x] Slice fields `companionSttEngine` / `companionSttModelId` (persisted).
- Note: batch engine keeps `listening` true through transcription to preserve the hold-to-talk contract (no live interim). Live transcription needs the `whisper-cli` binary + a downloaded model (same install UX as Piper TTS); verified via `cargo check`/`cargo test` (12 STT unit tests) — not exercised against a real binary in-session.

---

## 8. Open questions / risks

1. **Speaking clip.** `AthenaAvatar` stubs `speaking → idle`. A real talking loop noticeably sells voice mode — generate one offline (`athena-interactive-avatar.md` §2.1) before or during Step 2.
2. **whisper.cpp binary distribution.** Like Piper, we ask the user to drop a prebuilt binary (or we bundle per-platform). Decide bundle-vs-install; bundling adds installer weight, install mirrors Piper's current UX.
3. **Batch STT latency.** base.en on CPU is ~real-time-ish for short clips; small/medium are slower. Default to `base.en`; expose model size as the latency/accuracy lever.
4. **Two avatar instances.** Ensure orb + panel-watermark don't double-decode; gate by state.
5. **Discoverability.** A floating orb the user can dismiss needs a re-summon path — keep the footer control as the always-present anchor.
6. **Multi-persona future.** Orb is Athena-specific today; if every persona gets an avatar later, the orb component should accept a persona/clip-set prop (note, don't build yet).

---

## Related
- [`athena-interactive-avatar.md`](./athena-interactive-avatar.md) — the 3-layer avatar architecture this plan builds on (Layer A shipped; Layer B reactive glow staged here as §2.6).
- [`README.md`](./README.md) — companion feature surface map.
- `AthenaAvatar.tsx`, `CompanionFooterIcon.tsx`, `companionStore.ts`, `companionPluginSlice.ts`, `useDictation.ts`, `companion/tts/piper.rs` — primary touch points.
- Memory: `feedback_credentials_stay_local` — the local-first rule driving the local-STT choice.
