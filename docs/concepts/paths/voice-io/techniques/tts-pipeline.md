---
layer: technique
subject: voice-io
technique: tts-pipeline
status: forged
laws: [identity-survives-reuse, creation-names-reaper, derivation-names-recomputation]
shared_with: []
---

# The text-to-speech pipeline

Text-to-audible-speech is a pipeline of utterances: text is segmented,
synthesized into audio, and played through a lifecycle that the user can
interrupt at any instant. The technique exists because the naive collapse —
"call the synthesis function, play the result" — is synchronous,
uninterruptible, and single-utterance, and every real product need violates
all three at once: narrations queue up faster than speech plays, users change
their mind mid-sentence, and long texts must start sounding before they
finish synthesizing.

## An utterance is an entity, not a function call

The unit of the pipeline is the **utterance**: text, a voice reference,
synthesis parameters, and an identity minted at enqueue time
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). Identity
is what makes the rest of the pipeline sane: the same text spoken twice is
two utterances; a cancelled utterance stays cancelled even if its audio
arrives afterward; a surface showing "now speaking" can point at *which*
request it is speaking, not just at whatever audio happens to be playing.
Late synthesis results are the voice-output form of the stale-event race —
audio for an utterance that was cancelled or superseded arrives after the
replacement started — and identity is the only correct filter: a result is
played only if its utterance is still the current one; anything else is
discarded silently.

The place this race is lost is the **synthesis gap**: the window between
requesting synthesis and holding playable audio. It is long — perceptual
fractions of a second to whole seconds — and the naive exclusivity guard
("pause whatever is currently playing before starting the next clip") holds
a reference to the *playing* resource, which does not exist yet for a
request still synthesizing. Two requests inside one synthesis gap therefore
both pass the guard, both play, and — because the later request usually
resolves first — the clip left standing is the *stale* one, with no
reference left that can stop it. The identity claim must be made
**synchronously, at request time, before any waiting begins**, and
re-checked after every wait before any resource is created: then the second
request wins by construction rather than by latency.

## The queue and its policies

Utterances arrive faster than speech plays — speech is slow, roughly two to
three words per second — so the pipeline is a queue with **at most one
utterance audible at a time** per listening context. What happens when a new
utterance arrives while one is playing is a *policy the enqueueing surface
chooses*, from a closed set:

- **append** — narration sequences, reading a list: order is meaning;
- **replace** — status announcements, navigation narration: only the latest
  matters, and the queue behind the current utterance is flushed;
- **drop-if-busy** — ambient/courtesy speech that is worthless late.

Mixing (two voices at once) is not on the list; overlapping synthetic speech
is unintelligible and reads as a defect. The queue also has a depth bound —
speech is so slow that an unbounded queue converts a burst of events into
minutes of backlogged narration of things no longer true; past the bound,
oldest non-playing entries are dropped by policy, not accumulated.

## Segmentation buys time-to-first-audio

Synthesis latency scales with text length, and a paragraph synthesized as one
block means seconds of silence before the first word. Long text is split at
sentence boundaries; segment one synthesizes and starts playing while segment
two synthesizes in the background — a pipeline in the literal sense. The
constraints:

- split at **sentence or clause boundaries only** — prosody resets at each
  segment start, so a mid-phrase cut is audible as a robotic hiccup;
- segments inherit the utterance's identity plus a sequence number, and play
  strictly in order; a failed middle segment stops the utterance with an
  honest failure rather than skipping a sentence silently (a narration with
  a missing sentence is *worse* than one that stops — the listener cannot
  tell content was lost);
- interruption cancels the whole utterance: audible playback halts *and*
  pending segment synthesis is abandoned, not left running to warm a cache
  nobody asked for.

## Voice identity and the catalog

A "voice" is a stable reference — engine, voice identifier, and parameters
(rate, pitch) — chosen from a **catalog** that presents what is actually
available on this installation right now. Two rules give the catalog its
integrity:

- **the stored preference is a reference, not a promise.** Users persist a
  voice choice; engines and voice sets change underneath it. Resolution of a
  stored voice reference happens through the normalization door owned by
  [engine-abstraction](engine-abstraction.md) — a retired voice degrades to
  a declared fallback with a visible note, never to a crash and never to a
  silent switch the user discovers by ear;
- **speaker identity is consistent within a context.** One narration thread
  speaks with one voice; switching voices mid-context reads as a second
  speaker arriving. Where the product deliberately uses multiple speaker
  identities (different personas, different roles), the voice-to-identity
  mapping is itself part of the catalog, so "who is speaking" is a stable,
  inspectable fact.

## The playback lifecycle

Each utterance moves through `queued → synthesizing → playing → ` one of
`completed | interrupted | failed`, and the distinctions in the terminal set
are load-bearing: *completed* means the listener heard everything;
*interrupted* means the user chose to stop (not an error, never styled as
one); *failed* means the pipeline broke and the content was **not** delivered
— and because the utterance's text still exists, failure degrades to the
text being visibly available, so synthesis failure is never content loss.

Playback owns real resources — an audio device or element, decoded buffers,
sometimes temporary files — and every one of them names its reaper
([creation-names-reaper](../../_laws.md#creation-names-reaper)): resources
are released on *every* exit from `playing`, including interruption and
failure, and including the surface unmounting mid-utterance. The leak mode
of this pipeline is precisely the exit paths nobody tested: audio that keeps
playing after its surface is gone is the single most alarming defect a voice
feature can ship, because the user's only model of it is "the app has a
voice I cannot stop".

**Stop means now.** The interrupt path runs in perceptual time: the audible
stream halts immediately, the queue is flushed per policy, and in-flight
synthesis is cancelled. A stop that lets the sentence finish converts the
stop control into a placebo, and users who have met one placebo stop will
reach for the system volume forever after. And stop must reach the
synthesis gap: a stop implemented as "pause the playing resource" is a
no-op against an utterance still synthesizing, which then *starts speaking
after the user said stop* — every path that means stop (supersede, explicit
stop, mute, navigation away, teardown) invalidates the current utterance
identity, so a synthesis resolving afterward is discarded instead of played.

**Withhold the playback handle.** The channel's public surface is
*speak / stop / status* — it never hands callers the raw playback resource
"so they can stop it themselves". Handing the resource out delegates the
identity-and-gap discipline above to every caller independently, and
callers get it wrong at a coin-flip rate; keeping the resource inside the
channel makes the overlap bug unspellable while costing callers nothing
they actually use. The measured version of this rule: a shared speech
primitive that returned the raw resource produced one correct caller and
one overlapping one *in the same product, from the same author* — the
discipline does not survive delegation.

## Caching synthesized audio

Synthesis is expensive and repeated text is common (fixed narration scripts,
recurring announcements), so caching is legitimate — under
[derivation-names-recomputation](../../_laws.md#derivation-names-recomputation):
cached audio is a derivation of `(text, voice reference, parameters, engine
version)` and that full tuple is the cache key. Any component omitted from
the key is a bug with a voice: drop the engine version and an engine upgrade
plays stale pronunciation; drop the rate and a speed change applies to new
sentences only. The cache is bounded, evictable, and rebuildable from its
inputs by construction — it is never the system of record for what can be
spoken.
