---
layer: golden-path
subject: media-playback
status: forged
techniques:
  - playback-clock
  - engine-adapters
  - transport-contract
  - source-resilience
  - timeline-scheduling
  - media-resource-lifecycle
evidence:
  - src/features/plugins/artist/sub_media_studio/hooks/useTimelinePlayback.ts   # canonical clock: ref-held time, rAF wall-clock delta drive, subscribe() with synchronous first sample, layout-effect commit-point flag sync
  - src/features/plugins/radio/components/RadioFooter.tsx                       # dual-engine reconciler: desired-state sync per engine, 8s watchdog armed per transition + disarmed on PLAYING, session blacklist seeded by fatal errors AND watchdog stalls, skip budget capped at station track count, single-pipeline crossfade with crossfadingRef volume ownership
  - src/features/plugins/radio/hooks/useRadioState.ts                           # backend-owned authoritative state echoed over events; nowPlaying refetch keyed by track identity (station id + cursor), not by event arrival
  - src/features/plugins/radio/hooks/useYouTubePlayer.ts                        # the foreign-frame engine class: message-bridge handle, numeric state/error dialects translated at the boundary, global script singleton chaining the prior ready hook, destroy-on-teardown
  - src/features/plugins/artist/sub_media_studio/hooks/useAudioWaveform.ts      # derived artifact: bounded module cache keyed by source, in-flight dedupe with retryable failure, null-on-error → synthetic fallback, never system of record
counter_evidence:
  - src/features/plugins/artist/sub_media_studio/CompositionPreview.tsx         # playback element rebinds source without identity-keyed remount — prior clip's transport state (position, rate, mute, buffers) survives under the new clip's bytes; a threshold seek-correction then papers over the symptom
  - src/features/onboarding/components/useTourNarration.ts                      # minted in-memory URLs never revoked — creation without a reaper; registered under the voice-io deviation anchor (w4-voice-io), cited here, not re-registered
deviations:
  - w7-media-playback   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Media playback

Media playback is the subject you enter when the product must **drive time**:
audio or video advancing against a real-world clock, under user transport
control, inside an application whose every other part is event-driven. The
defining tension is exactly that mismatch. Application code runs when
something happens — a click, a message, a fetch resolving. Media runs
*continuously whether or not anything happens*, sixty perceptual frames and
tens of thousands of audio samples per second, and it is the one part of the
product where a stutter of a few dozen milliseconds is directly, viscerally
perceptible to the user. Everything in this subject follows from taking that
seriously: the clock is separated from the reactive world, engines are
distrusted and boxed, sources are expected to fail, and every resource the
pipeline mints is born with its destructor named.

The subject owns *general* playback — clocks, engines, transport, source
resilience, composed timelines, resource lifecycles — whether the media is
music, ambient streams, video clips, or rendered compositions. What it does
**not** own is the speech channel: synthesizing and capturing voice is a
pipeline with its own consent, identity, and interruption physics, and it
belongs to the [voice-io](../voice-io/voice-io.md) subject. The two meet at
one boundary lesson, restated below, because a playback engineer who has not
absorbed it will re-lose the same race the voice pipeline already lost once.

## When the subject does not apply

A product that needs one sound effect, or a video that plays inside the
platform's stock controls with no application involvement, does not need any
of this machinery — fire-and-forget playback through the platform primitive
is correct and complete. The subject earns its structure when at least one of
these appears:

- **application-owned transport** — the product draws its own play/pause/
  seek surface and must therefore hold truthful playback state;
- **more than one engine** — a native decoder here, an embedded third-party
  player there, and one interface expected to drive both;
- **composition** — content assembled from parts (a playlist, a timeline of
  clips) rather than a single opaque source;
- **continuity as a feature** — playback that must survive navigation,
  source failure, or engine failure without the user losing their place.

One of these is enough. All four together is the fully-loaded form of the
subject, and the techniques below cover each load-bearing wall.

## The clock is the authority, and it does not live in render state

Every playback surface has a playhead, and the ancestral mistake of the
subject is storing it where the rest of the interface stores its data — in
reactive state. A playhead advances at frame rate; reactive state exists to
re-render on change; the combination re-renders the world sixty times per
second to move a needle one pixel. The result is a product that feels worse
*because* it is showing time accurately.

The golden path inverts the ownership. **The clock is a single authoritative
time source living outside the reactive world** — a mutable reference updated
by the driving loop — and every consumer *samples or subscribes* at the
cadence its own display deserves: a continuously-moving needle samples every
frame inside its own isolated scope; a numeric readout subscribes at a few
updates per second; application logic reads the clock on demand and stores
nothing. Reactive state keeps only what changes at human speed — playing or
paused, which item is loaded — never the number that changes at machine
speed.

The clock is also the arbiter between disagreeing times. The engine has an
opinion about the current position; the interface extrapolates its own; seeks
put the two in tension. One of them is designated authoritative and the other
corrects toward it — the [playback-clock](techniques/playback-clock.md)
technique owns the storage, the fan-out, the seek semantics, and the drift
policy.

## Engines are adapters, and the abstraction declares what each cannot do

Playback terminates in an **engine**: a native decoding element, an embedded
third-party player living in a foreign frame and speaking only through a
message bridge, a backend process that owns the audio device outright. These
have wildly different shapes — synchronous property reads versus asynchronous
event echoes, full seek support versus none, volume control versus a licensed
black box that refuses to expose one — and the second ancestral mistake is an
abstraction that pretends they are the same. Pretend-parity abstractions leak
at every gap: the surface offers a seek bar, the engine silently ignores the
seek, and the user learns the product lies.

The golden path is **one transport contract, per-engine adapters, and honest
capability declaration**: each adapter states what its engine can and cannot
do, and surfaces gate their affordances on the declared capability — a
control for an unsupported verb is absent or visibly disabled, never
decorative. Where the engine is the authority (a backend or foreign player
that owns real playback), the application holds a *shadow* of engine state,
updated by event echo, and never double-drives. The
[engine-adapters](techniques/engine-adapters.md) technique owns the contract,
the foreign-frame player class, and the state-echo discipline.

## Trust no engine: every transition gets a watchdog

Engines fail by *silence* more often than by error: the embedded player whose
ready event never fires, the stream whose buffering never completes, the
backend that stops echoing. An awaited transition with no deadline is a
surface that hangs forever with a spinner — indistinguishable, to the user,
from a crashed product. So the transport layer attaches a **watchdog to every
engine transition it awaits**: load-to-ready, play-to-playing,
seek-to-settled. On expiry the transition is *declared failed* — a distinct,
reportable outcome that feeds the same recovery machinery as an explicit
engine error ([failure-not-empty-success](../_laws.md#failure-not-empty-success)
is the law underneath: an engine that reports nothing must never read as
"still working" indefinitely). The state machine, the verbs, and the watchdog
discipline live in [transport-contract](techniques/transport-contract.md).

## Sources fail routinely; the response is designed, not discovered

A media source is a *claim* that something playable exists at a reference.
Claims go stale: streams die, endpoints move, formats outlive their decoder
support, a source plays but delivers silence. In a product that plays
continuously — a station, a playlist, an ambient channel — source failure is
not an edge case, it is a scheduled event, and handling it ad hoc at the
failure site produces the worst version of every answer (infinite retry of a
dead stream; a hard gap of silence between items; the same broken source
re-tried every session forever).

The golden path designs the policy before the first failure: a **blacklist**
that remembers unplayable sources (with an expiry — dead now is not dead
forever), a **fallback order** that is explicit and bounded, and a
**transition treatment** (hard cut, gap, or crossfade) chosen per product
rather than inherited from whatever the failure path happened to do.
[source-resilience](techniques/source-resilience.md) owns the taxonomy of
source failure, the blacklist, the fallback ladder, and crossfade mechanics.

## Composition schedules content against the clock, never against itself

When the product plays *assembled* content — clips arranged on a timeline,
items in a gapless sequence — each piece is scheduled **against the
authoritative clock**, not chained end-to-start off its predecessor.
Chaining accumulates error and dies at the first sick link; scheduling from
one clock keeps every lane (audio, video, overlays) in agreement and makes
seek a pure function of timeline position. The schedule itself is a
derivation of the editable timeline model, recomputed on edit, with a
lookahead window as the tradeoff dial between seek latency and edit
responsiveness. [timeline-scheduling](techniques/timeline-scheduling.md)
owns clip scheduling, lookahead, gap handling, and multi-lane sync.

## Every media resource names its reaper

Playback is the most resource-intensive thing most products do: decoded
buffers measured in megabytes per minute, minted in-memory resource URLs the
runtime will not release until explicitly revoked, pooled playback elements,
foreign frames, derived artifacts like waveforms and thumbnails. Every one of
these follows [creation-names-reaper](../_laws.md#creation-names-reaper): the
code that creates it states what destroys it and on which paths — including
interruption, failure, and the surface unmounting mid-playback. The signature
defect of this subject is audio that keeps playing after its surface is gone:
the user's only model of it is "the product has a voice I cannot stop", and
it is always a missed reaper on an exit path nobody tested.
[media-resource-lifecycle](techniques/media-resource-lifecycle.md) owns the
resource inventory, pooling, revocation patterns, and memory-pressure policy.

## The boundary lesson from the voice channel

The speech pipeline belongs to [voice-io](../voice-io/voice-io.md), but its
hardest-won lesson is a *general playback* truth and is restated here as
doctrine: **exclusivity is claimed at request time, not at play time.** Any
flow of the shape *request → wait → play* has a gap between asking for audio
and holding it, and a mutual-exclusion guard that inspects the *currently
playing* resource passes freely during that gap — two requests both clear the
guard, both play, and the stale one usually wins the race. The correct claim
is made synchronously when the request is made, and re-validated after every
wait, so a superseded request discards its own result instead of playing it.
The full derivation, measured in production, lives in voice-io's
[tts-pipeline](../voice-io/techniques/tts-pipeline.md) under "the synthesis
gap"; in this subject the same rule governs source switching, crossfade
arming, and any engine whose load is asynchronous — which is all of them.

## The techniques

- [playback-clock](techniques/playback-clock.md) — the authoritative time
  source: storage outside reactive state, subscription fan-out, seek
  semantics, drift correction between interface time and engine time.
- [engine-adapters](techniques/engine-adapters.md) — one transport contract,
  per-engine capability declaration, the foreign-frame player class, state
  echo when the engine owns playback.
- [transport-contract](techniques/transport-contract.md) — the verbs and
  their real semantics, the playback state machine including buffering and
  stalled, watchdogs on every awaited transition.
- [source-resilience](techniques/source-resilience.md) — the failure
  taxonomy, unplayable-source blacklists, bounded fallback, crossfade,
  preloading policy.
- [timeline-scheduling](techniques/timeline-scheduling.md) — composed
  sequences scheduled against the clock: lookahead, edits during playback,
  gaps, multi-lane sync.
- [media-resource-lifecycle](techniques/media-resource-lifecycle.md) —
  the resource inventory and its reapers: minted URLs, buffers, element
  pools, derived artifacts, memory pressure.
