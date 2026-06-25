# Cockpit, Voice & Sensory — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: cockpit-voice-and-sensory | Group: Athena Companion
> Total: 5 | Critical: 1 | High: 2 | Medium: 2 | Low: 0

## 1. Switching STT engine during an active capture strands a live mic and loses the transcript
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: resource-leak / lifecycle-race / privacy
- **File**: src/features/plugins/companion/useSpeechInput.ts:17 (trigger: src/features/plugins/companion/sub_voice/SttPanel.tsx:54)
- **Scenario**: Engine = `whisper`. User holds-to-talk → `useLocalDictation.start()` acquires the mic and sets its internal `listening=true`. While still holding, the `companionSttEngine` store value flips to `browser` (the SttPanel `EngineButton` `onClick={() => setEngine('browser')}` has no guard against switching mid-capture, and the store can be changed from anywhere). `useSpeechInput` re-renders and now returns the **browser** hook, so `useHoldToTalk`'s `dictation` reference silently swaps to a different object.
- **Root cause**: `useSpeechInput` selects the returned dictation object purely from the current engine value (`return engine === 'whisper' ? local : browser`). The previously-started `local` hook stays mounted and keeps capturing, but the controller (`useHoldToTalk`) no longer holds a reference to it. On release, `stop()` reads `dictation.listening` (now the browser hook = `false`) and takes the "never started" branch, never calling the local hook's `stop()`. The local hook only releases its `MediaStream`/`AudioContext` on unmount (`useLocalDictation.ts:124`).
- **Impact**: Mic stays live indefinitely (until the companion UI unmounts) with the OS mic indicator on while the user believes capture ended — a privacy/resource leak. The captured audio is never transcribed and `useHoldToTalk`'s listening→false effect never fires (it watches the wrong hook), so the voice turn is silently dropped.
- **Fix sketch**: Don't let the active engine change while a capture is in flight: in `SttPanel` disable the engine buttons (or defer the switch) when `companionStore` reports an armed/talking session; and/or have `useSpeechInput` detect that the previously-returned hook is still `listening` and force-`stop()`/teardown it before handing back the newly-selected hook. Belt-and-suspenders: `useHoldToTalk` should `stop()` the prior `dictation` in an effect cleanup when the `dictation` identity changes.
- **Value**: impact=9 effort=3

## 2. Local STT assumes the WebView honors `sampleRate: 16000`; no resample fallback, and the backend hard-rejects anything ≠16 kHz
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: undocumented-audio-constant / silent-feature-break
- **File**: src/features/plugins/companion/useLocalDictation.ts:156 (paired with src-tauri/src/companion/stt/mod.rs:108)
- **Scenario**: `useLocalDictation` builds `new AudioContext({ sampleRate: 16000 })`, captures via a `ScriptProcessorNode`, then encodes the WAV using the context's **actual** `ctx.sampleRate` (line 183/200). Chromium/WebView2 honors the requested rate, so Windows works. WebKit-based webviews (WKWebView on macOS, WebKitGTK on Linux) have historically ignored the `sampleRate` constructor option, so the context (and thus the encoded WAV header) ends up at the hardware rate (44.1/48 kHz). `validate_wav_format` then rejects with `audio must be 16 kHz` (mod.rs:108).
- **Root cause**: The "pinned to 16 kHz mono" contract is only *requested*, never verified or enforced by resampling. The code stamps whatever `ctx.sampleRate` the platform gave it into the WAV; the Rust validator demands exactly 16 000. There's no resample step and no client-side rate check, and the 16 kHz assumption is tribal knowledge with no doc/runtime assertion.
- **Impact**: On every WebKit platform the local Whisper engine fails 100% of the time with a confusing "audio must be 16 kHz" error — the entire on-device STT feature is silently broken there, and the user has no actionable hint.
- **Fix sketch**: After acquiring the stream, assert `ctx.sampleRate === 16000`; if not, resample the merged Float32 buffer to 16 kHz before `encodeWav` (linear/decimation is sufficient for whisper) — or pass the true capture rate and resample server-side. Document the 16 kHz mono PCM contract and the resample requirement next to `TARGET_SAMPLE_RATE`.
- **Value**: impact=7 effort=4

## 3. TTS/STT subprocess spawns have no concurrency guard — overlapping synth/transcribe can stack unbounded
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: resource-exhaustion / missing-backpressure
- **File**: src-tauri/src/commands/companion/voice.rs:33 (and stt.rs:28 → companion/tts/piper.rs:207, companion/stt/whisper.rs:174)
- **Scenario**: `companion_tts` and `companion_stt_transcribe` each spawn a fresh sidecar process per IPC call with no limit. The downloader paths have an `_inflight_guard` (noted in voice.rs:100), but the synth/transcribe hot paths have none. Athena auto-speaking a chunked reply (multiple `companion_tts` calls), or TTS playing while the user starts a new dictation, runs several piper/whisper processes at once — each piper load pulls a full ONNX voice into memory and whisper saturates all CPU cores.
- **Root cause**: No semaphore/serialization around the spawn sites; the frontend only serializes within a single dictation hook instance, not across TTS-while-STT or rapid multi-call TTS. Out-of-order completion is also unmanaged: a slow earlier transcription resolving after a newer one can clobber the newer turn's `finalText`.
- **Impact**: On modest hardware, stacked sidecars cause CPU saturation / large memory spikes and a janky or hung app; in the worst case OOM. Lower-likelihood but unbounded by construction.
- **Fix sketch**: Wrap each engine's spawn in a `tokio::sync::Semaphore` (or per-engine `Mutex`) held in `AppState` to cap concurrency (e.g. 1–2). Tag transcription requests with a monotonically increasing id so a stale result can be discarded instead of overwriting a newer turn.
- **Value**: impact=6 effort=4

## 4. Long speech has no client-side duration/size cap — guaranteed 25 MB rejection plus a memory spike
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / buffer-overflow / lost-transcript
- **File**: src/features/plugins/companion/useLocalDictation.ts:162 (paired with src-tauri/src/companion/stt/mod.rs:38)
- **Scenario**: `processor.onaudioprocess` pushes a `Float32Array(4096)` per callback into `chunksRef` with no ceiling. For very long dictation the buffer grows without bound; `finishAndTranscribe` then allocates the merged Float32 buffer + an Int16 WAV + a base64 string (3× the audio in memory) before IPC. The backend caps the decoded WAV at `STT_MAX_AUDIO_BYTES` = 25 MB (~13 min) and rejects with `audio too large` (mod.rs:38).
- **Root cause**: The frontend has no max-capture-duration or running byte budget and no auto-stop; the only cap lives server-side, so the rejection happens only after the entire long clip is captured, merged, and marshalled.
- **Impact**: A user who holds-to-talk too long loses the whole transcript and pays a multi-tens-of-MB allocation + base64 spike for nothing — wasted work and a momentary memory balloon, with a generic "too large" message.
- **Fix sketch**: Track accumulated samples in `onaudioprocess`; auto-stop (and surface a "max length reached" hint) when approaching ~12 min / the 25 MB equivalent at 16 kHz. Mirror the backend constant client-side so the two limits can't drift.
- **Value**: impact=5 effort=3

## 5. `cli_session` sensory gate is persisted to the DB after the lock is dropped — concurrent toggles can desync the privacy gate
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition / privacy-gate-consistency
- **File**: src-tauri/src/commands/companion/sensory.rs:71
- **Scenario**: `companion_set_sensory_source_enabled` flips the in-memory gate under `ambient_context.lock()`, then `drop(guard)` (line 72) and only afterward writes the `cli_session` value to `app_settings` (lines 80–94). Two near-simultaneous toggles of `cli_session` (A=enable, B=disable) serialize their in-memory writes via the mutex but race on the later DB write: in-memory can end on B's value while the DB ends on A's value.
- **Root cause**: The cross-process persistence happens outside the mutex that protects the in-memory state, so the in-memory gate and the DB-backed daemon gate are updated non-atomically.
- **Impact**: The windowed app and the daemon can disagree on whether CLI-session awareness is enabled — the daemon may keep injecting CLI-session context the user just turned off (or stop when they turned it on). A privacy gate silently disagreeing with the UI is exactly the contract this module promises to uphold.
- **Fix sketch**: Persist the `cli_session` setting while still holding `guard` (before `drop`), or guard the persist with a dedicated per-key lock/serialized writer so the last in-memory state and the last DB state are always the same toggle.
- **Value**: impact=5 effort=3
