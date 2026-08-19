---
layer: application
subject: voice-io
technique: stt-pipeline
stack: react
---

# The local dictation pipeline — where the repo meets the technique, and where it doesn't

The on-device capture→transcription pipeline is
`src/features/plugins/companion/useLocalDictation.ts`: mic capture via
`getUserMedia`, raw PCM recording through an `AudioContext` pinned (where the
platform honors it) to 16 kHz mono, client-side WAV encoding, and one
`companion_stt_transcribe` IPC round-trip to the whisper sidecar
(`src-tauri/src/companion/stt/whisper.rs` — "no credential, no network at
transcription time"). The controller above it is `useHoldToTalk.ts`
(push-to-talk shared by the footer mic and the floating orb), and the parsed
crossing to typed commands is `decision/parseSpokenDecision.ts`. The legacy
census composition (`docs/concepts/golden-paths/voice-input-and-playback.md`)
executed this code through instrumented harnesses; its findings are folded in
below.

## Confirmed against the technique

- **Explicit endpointing, correctly chosen.** Hold-to-talk: the user decides
  when the utterance ends (`useHoldToTalk.ts` drives `start()`/`stop()`
  imperatively; "the mic is only ever armed by an explicit `start()`, never
  on mount" — `:19`). Right choice for command input per the technique.
- **The permission-prompt gap is guarded in both directions.**
  `pendingStartRef` rejects re-entry during the async permission prompt (a
  second trigger would acquire a second stream and leak the first —
  `useLocalDictation.ts:168-174`); `abortStartRef` covers release/unmount
  *during* the prompt, so a late-resolving `getUserMedia` stops its own
  freshly acquired stream instead of leaving a live mic with no owner
  (`:196-201`, `:273-279`). The legacy census called this "the strongest
  async-lifecycle code in this feature."
- **Stale transcription results are inert by identity.** `transcribeIdRef`
  is a monotonic token claimed per transcription (`:144`, `:257`); a result
  or error applies only if still current (`:261`, `:265`), and `reset()`
  bumps it so an in-flight transcription cannot repopulate cleared text
  (`:284-290`). This is the technique's segment-identity rule applied to
  the single-segment case.
- **The engine's input contract is enforced, not assumed.** The 16 kHz mono
  contract is requested from the audio context, *verified against what the
  platform actually delivered*, resampled client-side when ignored
  (`resampleTo16k`, `:42-65` — some webviews ignore the requested rate),
  and hard-validated again engine-side (`validate_wav_format`). A claimed
  format checked on both sides of the boundary.
- **Batch honesty about partials.** Whisper transcribes the whole clip;
  the hook returns `interimText: ''` permanently (`:296-297`) rather than
  fabricating partials, and keeps `listening` true through the
  transcription round-trip so the consumer reads the final on the
  listening→false transition — the technique's "transcribing" lifecycle
  state, implemented as a documented contract (`:10-15`).
- **Capture teardown names its reaper.** `teardown()` disconnects the
  processor graph, stops every track, closes the context (`:146-162`), and
  runs on unmount with the in-flight-start abort (`:164-166`).

## Deviations, kept against the standard

1. **No capture-side level meter — anywhere.** The only live audio metering
   in the tree is on *playback* (`audioLevel.ts` taps synthesized speech for
   the orb glow); `createMediaStreamSource` appears exactly once in the
   frontend and feeds the recorder, not a meter. A user speaking into a
   dead or wrong-device mic gets no "it hears me" proof at the moment it
   matters — the technique's first honesty device is absent from an
   otherwise strong pipeline.
2. **The permission error is erased one layer up.** Both engines record the
   denial correctly, but `useHoldToTalk` exposes no `error` member, and its
   `stop()` takes the never-went-live branch — exactly the denial path —
   and calls `dictation.reset()`, which nulls the error in both engines.
   The two always-available surfaces (orb, footer mic) therefore show
   nothing and *erase* the evidence; 1 of 4 mic surfaces renders the error.
   Measured in the legacy census (§7.C) and registered as deferred fix
   #115. The technique's rule — the failure is surfaced only when the
   surface the user pressed shows it — is the upward lesson this defect
   bought.
3. **Denied and no-device share one bucket.** The `getUserMedia` catch
   stores `err.message` or the generic `'mic_denied'`
   (`useLocalDictation.ts:221`); "you said no" and "there is nothing to say
   yes to" are not distinguishable downstream, so no surface can offer the
   right recovery step.
4. **Empty is not yet a claim.** A capture with zero samples silently flips
   `listening` off (`:240-242`), and an empty final transcript lands as
   `finalText: ''` with no "heard audio, produced no words" distinction —
   the consumer cannot tell a no-op from an anomaly. With no level data
   captured (deviation 1), the honesty rule has nothing to stand on: the
   two gaps are one defect.
5. **Readiness is discovered by failing.** The hook's `supported` gates
   only on API presence; a missing whisper binary or model surfaces as an
   error *after* the first attempt (`:17-20`, by design — the Voice tab
   owns install status via a real artifact probe). The technique wants the
   affordance to know absent-vs-ready before the user holds the button;
   here the first hold is the probe.
