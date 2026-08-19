---
layer: golden-path
subject: voice-io
status: forged
techniques:
  - stt-pipeline
  - tts-pipeline
  - engine-abstraction
  - spoken-intent-parsing
  - voice-ux-integration
  - on-device-vs-cloud
evidence:
  - src-tauri/src/companion/tts/mod.rs                              # synthesis engine abstraction: engine-id enum + per-engine submodules, engine-agnostic request, one validation door (text cap, voice-id charset), retired-engine tolerance in the settings deserializer
  - src-tauri/src/companion/stt/whisper.rs                          # on-device transcription: "no credential, no network at transcription time"; engine presence probed against the actual binary, not a flag
  - src/features/plugins/companion/useLocalDictation.ts             # capture lifecycle: push-to-talk endpointing, permission-prompt race guards (pendingStart/abortStart), monotonic transcription id discarding stale results, sample-rate contract resampled client-side and validated engine-side
  - src/features/plugins/companion/useSpeechInput.ts                # input-direction adapter seam: one dictation interface, two engine adapters, force-stop of the deselected engine mid-capture
  - src/features/plugins/companion/sub_voice/VoicePanel.tsx         # the two pipelines as literally two independent columns in one tab; engine normalize-on-read; engine switch disables playback until the new engine reports configured
  - src/features/plugins/companion/decision/parseSpokenDecision.ts  # constrained per-decision grammar: number words + digits + one alias, bounded by option count, finals only, conservative fall-through
  - src/features/onboarding/components/useTourNarration.ts          # narration that never blocks the tour: one-way coupling, generation token invalidating stale synthesis in all three teardown paths, silent degradation when voice is unconfigured
  - src/features/plugins/companion/BubbleReadAloud.tsx              # read-aloud affordance: idle→synthesizing→playing→idle|error on the control itself; user stop treated as idle, not error; unmount reaps audio + blob URL
counter_evidence:
  - src/features/plugins/companion/chat/athenaChatAudio.ts          # promises "two exclusive audio channels" and overlaps them in 2 of 5 executed scenarios — exclusivity guarded by the playing element, which does not exist during the synthesis gap; the stale clip wins and nothing can stop it
deviations:
  - w4-voice-io   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Voice input and output

Voice I/O is the surface you build when the product **listens** — capturing
speech and turning it into text or commands — and when it **speaks** — turning
text into audible output. It looks like one feature ("add voice") and is in
fact **two independent pipelines pointed in opposite directions**, sharing
almost nothing but a settings page:

- **Capture → transcription** (input): microphone, level metering,
  endpointing, transcription engine, transcript disposition. Its currency is
  *trust* — the user must believe the system heard them, and the system must
  never believe the transcript more than the transcript deserves.
- **Text → synthesis → playback** (output): synthesis queue, voice identity,
  playback lifecycle, interruption. Its currency is *tempo* — time to first
  audio, and the immediacy of shutting up when told to.

The two pipelines have different latency physics, different privacy physics,
and different failure physics, and the ancestral mistake of this surface is
designing them as mirror images. They are not. Output speaks the product's own
text — content the product already holds, at a sensitivity the product already
knows. Input captures **the user's voice in the user's room** — the most
sensitive sensor the product will ever touch, carrying whatever was said near
it, including things never addressed to the product at all. Every asymmetric
decision in this subject (consent posture, residency default, confirmation
requirements) flows from that asymmetry.

Both pipelines exist as a channel **over** a product that must work without
them. That is a definitional constraint, not an aspiration: voice depends on
hardware that may be absent, permissions that may be denied, engines that may
not be installed, and environments (open offices, shared rooms, muted devices)
that forbid it situationally even when everything works. A product where any
core flow *requires* voice is broken by design for a large fraction of every
session.

## When not to build voice

- **Precision-dense input** — identifiers, code, exact quantities, anything
  where one wrong character matters — is faster and safer typed. Voice input
  earns its place on low-precision, high-intent utterances: commands,
  dictated prose, choices from a small set.
- **When the spoken channel would carry the only copy of information.** If a
  value exists solely as audio the product has failed deaf users, muted
  devices, and its own logs simultaneously. Everything spoken must exist as
  text; everything heard must become text before it becomes action.
- **When you cannot show that you are listening.** Capture without a
  continuously visible indicator is surveillance-shaped regardless of intent.
  If the interface has no room for a live capture indicator, it has no room
  for a microphone.

## The engine layer is swappable, and the product outlives every engine

Both pipelines terminate in an **engine** — a transcription model or a
synthesis model, running locally or remotely. Engines are the most volatile
component in the whole subject: models are retired, services are deprecated,
a better local engine ships next quarter, a user's machine can run one engine
but not another. So the engine sits behind **one interface per direction**,
with per-engine adapters, declared capabilities, and a normalization path for
configuration that references engines that no longer exist. No surface code
ever names an engine; surfaces speak in "transcribe this capture" and "speak
this text as voice V". The [engine-abstraction](techniques/engine-abstraction.md)
technique owns the interface, the capability probing, and the
retired-engine problem.

## On-device versus cloud is a privacy decision first

Where an engine runs is usually framed as a quality/latency tradeoff. For
voice input it is a **residency decision**: does raw audio of the user's room
leave the machine? The defensible default is on-device transcription, with
cloud transcription as an explicit, disclosed, revocable opt-in — while
synthesis, which speaks the product's own text, can take the opposite default
without contradiction. The decision framework, the degradation ladder, and
the boundary with model provisioning (the download/install mechanics belong
to the sidecar-provisioning subject) live in
[on-device-vs-cloud](techniques/on-device-vs-cloud.md).

## Degradation is a designed state, never a blocked one

Voice has more legitimate "not available right now" states than almost any
other subject: no microphone, permission denied, engine not installed, model
still downloading, service unreachable, output muted, environment unsuitable.
Each is a **designed state with a designed next step** — never a dead control,
never a crash, and above all never a blocked product. The ladder is fixed:

1. full voice (the configured engines work);
2. partial voice (one direction works; the other degrades independently —
   the pipelines are independent here too);
3. no voice (everything the product does remains reachable through the
   visual/text surface, with voice affordances explaining their absence in
   one honest sentence each).

A tour that narrates must finish silently when synthesis is absent; a form
that accepts dictation must accept typing; a spoken command channel that is
down must leave every command clickable. This is the voice instance of the
degraded-state doctrine in [async-ui-states](../async-ui-states/async-ui-states.md),
and the per-affordance behavior is owned by
[voice-ux-integration](techniques/voice-ux-integration.md).

## Spoken input is untrusted input with error bars

A transcript is not what the user said; it is an **engine's guess** about what
the user said, produced from noisy audio by a statistical process, arriving
without punctuation, with homophones resolved by luck, and with numbers spelled
unpredictably. The product therefore treats transcripts the way it treats any
low-confidence input:

- transcription output is **shown before it is trusted** — the user sees what
  was heard, and dictated text lands in an editable field, not directly in a
  committed record;
- transcript-to-action crossing is gated by the **cost of being wrong**:
  reversible actions may proceed on a confident match, destructive or
  expensive actions require an explicit confirmation that echoes the
  *interpretation* (not the raw transcript) back to the user;
- only **final** transcripts cross into action; partial transcripts are
  display-only, because they revise themselves — the non-monotone-increment
  problem [streaming output](../streaming-output/streaming-output.md) warns
  about, arriving here as a matter of course.

The [stt-pipeline](techniques/stt-pipeline.md) technique owns capture through
transcript; [spoken-intent-parsing](techniques/spoken-intent-parsing.md) owns
the transcript-to-typed-command crossing and its confirmation thresholds.

## The two lifecycles

**Capture → transcription.** The input pipeline is a lifecycle the user drives
and watches:

| State | Meaning | The surface shows |
| --- | --- | --- |
| **idle** | not listening | the affordance to start, or why it cannot start |
| **arming** | permission/device acquisition in flight | that the mic is being opened — not yet hearing |
| **listening** | audio flowing | a **live level meter** and an unmistakable capture indicator |
| **transcribing** | capture ended, engine working | the captured state is safe; work in progress |
| **transcribed** | final transcript ready | the text, editable, awaiting disposition |
| **failed** | any stage broke | which stage, and what to do — silence, no-speech, and engine failure are three different facts |

The meter in **listening** is not decoration; it is the only tool a user has
to debug their own audio. A flat meter during speech says "the microphone is
not hearing you" — a diagnosis no error message delivered after the fact can
match.

**Text → synthesis → playback.** The output pipeline is a queue of utterances,
each with its own lifecycle (queued → synthesizing → playing → done /
interrupted / failed), governed by two absolutes: **at most one voice audible
at a time** within a listening context, and **stop means now** — interruption
takes effect in perceptual time (audio halts, pending synthesis cancels), not
at the next sentence boundary. A stop control that finishes its thought
teaches the user that the control is fake. The
[tts-pipeline](techniques/tts-pipeline.md) technique owns the queue, voice
identity, playback ownership, and interruption.

## Consent and indication are architecture, not copy

- Capture starts only from a **user gesture or an explicit standing opt-in**,
  never as a side effect of navigation.
- While the microphone is open, an indicator is **continuously visible** and
  the path to closing it is one action, always reachable.
- Playback begins from a gesture or a standing preference the user set; the
  platform may refuse un-gestured audio, and a refused playback surfaces a
  play affordance rather than passing as silent success.
- A **global voice mute** exists, persists, and outranks every local toggle.

## Accessibility posture

Voice features sit next to assistive technology; they must cooperate with it,
not compete:

- Synthesis is not a screen reader and must never be positioned as one; users
  running assistive audio get **one** audio narrator, and the product's
  narration yields (or is off by default) when assistive technology is
  driving.
- Everything narrated exists as visible text; everything dictated is
  reviewable as text. Voice adds a channel; it never becomes the only one.
- Capture and playback states are announced through the same non-audio
  channels as any other state: visible state, focusable controls, text
  labels — a deaf user must be able to operate the entire voice-output
  feature (start it for someone else, stop it, see that it is playing).

## The techniques

- [stt-pipeline](techniques/stt-pipeline.md) — capture, metering, endpointing,
  chunking, latency budgets, partial vs final transcripts, the three kinds of
  "nothing came back".
- [tts-pipeline](techniques/tts-pipeline.md) — the utterance queue, voice
  catalogs and speaker identity, playback lifecycle, barge-in, synthesis
  caching.
- [engine-abstraction](techniques/engine-abstraction.md) — one interface per
  direction, adapters, capability probing, retired-engine normalization.
- [spoken-intent-parsing](techniques/spoken-intent-parsing.md) — transcript to
  typed command: constrained grammars, normalization, confidence-vs-cost
  gating, confirmation affordances.
- [voice-ux-integration](techniques/voice-ux-integration.md) — read-aloud
  affordances, narration that never blocks what it narrates, the speech
  arbiter, mute and consent surfaces.
- [on-device-vs-cloud](techniques/on-device-vs-cloud.md) — residency as a
  privacy decision, the decision matrix, the degradation ladder, the
  provisioning boundary.
