---
subject: voice-io
evidence:
  - src-tauri/src/companion/tts/mod.rs                              # synthesis engine abstraction: engine-id enum + per-engine submodules, engine-agnostic request, one validation door (text cap, voice-id charset), retired-engine tolerance in the settings deserializer
  - src-tauri/src/companion/stt/whisper.rs                          # on-device transcription: "no credential, no network at transcription time"; engine presence probed against the actual binary, not a flag
  - src/features/companions/athena/useLocalDictation.ts             # capture lifecycle: push-to-talk endpointing, permission-prompt race guards (pendingStart/abortStart), monotonic transcription id discarding stale results, sample-rate contract resampled client-side and validated engine-side
  - src/features/companions/athena/useSpeechInput.ts                # input-direction adapter seam: one dictation interface, two engine adapters, force-stop of the deselected engine mid-capture
  - src/features/companions/athena/sub_voice/VoicePanel.tsx         # the two pipelines as literally two independent columns in one tab; engine normalize-on-read; engine switch disables playback until the new engine reports configured
  - src/features/companions/athena/decision/parseSpokenDecision.ts  # constrained per-decision grammar: number words + digits + one alias, bounded by option count, finals only, conservative fall-through
  - src/features/onboarding/components/useTourNarration.ts          # narration that never blocks the tour: one-way coupling, generation token invalidating stale synthesis in all three teardown paths, silent degradation when voice is unconfigured
  - src/features/companions/athena/BubbleReadAloud.tsx              # read-aloud affordance: idle→synthesizing→playing→idle|error on the control itself; user stop treated as idle, not error; unmount reaps audio + blob URL
counter_evidence:
  - src/features/companions/athena/chat/athenaChatAudio.ts          # promises "two exclusive audio channels" and overlaps them in 2 of 5 executed scenarios — exclusivity guarded by the playing element, which does not exist during the synthesis gap; the stale clip wins and nothing can stop it
deviations:
  - w4-voice-io   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Voice Io - evidence

How this codebase measures against the [`voice-io`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
