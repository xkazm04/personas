---
layer: application
subject: voice-io
technique: engine-abstraction
stack: rust
---

# The companion TTS/STT engine layer — where the repo meets the technique, and where it doesn't

The synthesis abstraction lives in `src-tauri/src/companion/tts/mod.rs`: an
engine-agnostic `TtsSynthesisRequest { text, voice_id, settings }`, a
`TtsEngineId` enum as the closed engine vocabulary, and one submodule per
engine (`kokoro.rs`, `pocket.rs`) each exposing
`synthesize(...) -> Result<TtsAudio, AppError>`. Dispatch is a single
`match engine` in `src-tauri/src/commands/companion/voice.rs:53-73`. The
transcription direction mirrors it: `src-tauri/src/companion/stt/whisper.rs`
behind `commands/companion/stt.rs`, with the frontend seam
(`src/features/plugins/companion/useSpeechInput.ts`) selecting between the
browser engine and the local whisper engine behind one `DictationState`
interface.

## Confirmed against the technique

- **One interface, adapters behind it.** `mod.rs:115-121` defines the
  engine-agnostic request; the module header (`mod.rs:15-17`) states the
  recipe: "Adding a new engine = drop a new submodule … add a variant to
  `TtsEngineId`, wire it into `voice.rs` dispatch." Engine knowledge
  (subprocess protocols, timeouts, model paths) stays inside `kokoro.rs` /
  `pocket.rs`.
- **One validation door.** Every synthesis call passes `validate_text`
  (non-empty, `TTS_MAX_CHARS = 1200` cap — `mod.rs:52,125-138`) and
  `validate_voice_id` (charset allowlist that keeps downstream paths/URLs
  innocent, with a path-traversal test at `mod.rs:225-229`). The dispatcher
  at `voice.rs:42-43` is the door; voice import/delete commands reuse the
  same validators (`voice.rs:131,145`).
- **Absent vs broken vs ready, probed against the artifact.**
  `companion_tts_kokoro_status` reports binary and model package presence
  separately (two-step setup card); `companion_tts_pocket_status` probes
  the live service and its worker pool, and the command doc states the
  intent exactly: "a stopped service surfaces as a setup card, not a
  synthesis error" (`voice.rs:98-101`). STT-side, `whisper.rs:101-110`
  resolves the actual binary via a candidate chain (env override →
  install dir → PATH, `whisper.rs:58-74`) — `installed` is derived from
  `is_file()` on the real artifact, not from a settings flag.
- **Retired-engine normalization, layered.** ElevenLabs and Piper were
  descoped 2026-07-10. Legacy persisted state is absorbed at three layers:
  `TtsEngineId::default()` = Kokoro for callers that send no engine
  (`mod.rs:81-88`, with a regression test at `:176-180` warning the default
  is an IPC-breaking change); `credential_id` is accepted-and-ignored so
  pre-descope callers keep working (`voice.rs:9-10,37`); `TtsSettings`
  deserialization ignores the descoped ElevenLabs tuning fields, with a
  test asserting legacy payloads parse cleanly (`mod.rs:183-192`). On the
  frontend, `normalizeCompanionTtsEngine` renormalizes the persisted
  selection on read (`sub_voice/VoicePanel.tsx:23-25`).
- **Capability-shaped branching in the dispatcher.** The two engines have
  different concurrency physics and the dispatch encodes the *capability*,
  not just the name: Kokoro's one-shot sidecar reloads a ~310MB model per
  invocation, so calls take an app-side semaphore (`voice.rs:55-64`);
  Pocket is a long-lived service with its own bounded worker pool and 429
  backpressure, so no client semaphore (`voice.rs:67-72`).
- **Engine-switch integrity on the input seam.**
  `useSpeechInput.ts:20-41` force-stops the now-inactive engine when the
  user switches engines mid-capture — releasing the microphone the moment
  the adapter is deselected — with a written explanation of the leak it
  prevents. `VoicePanel.tsx:64-71` disables the playback gate on engine
  switch until the new engine reports configured, avoiding "toggle says on,
  synthesis silently errors".

## Deviations, kept against the standard

1. **Retired engines haunt the comments.** `TtsAudio.mime_type`'s doc still
   reads "`audio/mpeg` for ElevenLabs (MP3), `audio/wav` for Piper"
   (`mod.rs:110-111`) and `validate_voice_id`'s rationale names both
   descoped engines (`mod.rs:140-142`) — the vocabulary was cleaned, its
   commentary was not. Cosmetic, but it is exactly the two-copy drift the
   registry exists to prevent, in prose form.
2. **A caller branches on engine identity.**
   `commands/artist/voiceover.rs:61` rejects `engine != TtsEngineId::Kokoro`
   — engine-name branching outside the dispatch door. Defensible (the
   voiceover feature only supports the curated catalog) but the technique's
   shape would be a declared capability ("curated-catalog voices") rather
   than an identity check that silently excludes every future engine.
3. **The input direction's default adapter is the cloud-routed one.**
   `useSpeechInput.ts:8-12`: `'browser'` (Web Speech, cloud-routed on the
   Windows webview) is the default; the on-device whisper engine is opt-in.
   The disclosure lives in a docstring, not next to the engine picker.
   This is an on-device-vs-cloud deviation surfaced at the abstraction
   seam — the fallback-chain *order* inverts the technique's
   privacy-first default for capture.
4. **No shared probe shape.** Kokoro, Pocket, and whisper each expose a
   bespoke status struct (`KokoroStatus`, `PocketStatus`,
   `EngineStatus`); the Voice tab renders three hand-shaped setup cards.
   Works today at three engines; a fourth engine re-derives the
   absent/broken/ready vocabulary instead of filling in a shared one.
