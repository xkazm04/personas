---
layer: technique
subject: media-playback
technique: playback-clock
status: forged
laws: [derivation-names-recomputation, one-authority-per-vocabulary]
shared_with: []
---

# The playback clock

Every playback surface needs to know *what time it is* — the current position
in the media — and needs to know it at wildly different fidelities in
different places: a moving needle wants every frame, a timestamp readout
wants a few updates per second, a "save my place" feature wants the value
once, on demand. The technique exists because the naive answer — store the
playhead in reactive state and let everything re-render on change — is the
single most common self-inflicted performance wound in this subject, and
because the slightly-less-naive answers (poll the engine everywhere, keep
several independent position variables) each recreate a worse version of the
same problem.

## One clock, held outside the reactive world

The rule has two halves, and both are load-bearing:

**One clock.** The current position has exactly one authoritative holder, and
every displayed or computed time derives from it. The moment two components
each track "their own" position — one polling the engine, one integrating
elapsed wall time — the product has two opinions about now, and they will be
visibly different during exactly the interesting moments (seeks, stalls, rate
changes). This is the time-domain instance of a single authority that all
consumers derive from
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).

**Outside reactive state.** The clock advances at frame rate; reactive state
exists to trigger re-render on change. Storing the former in the latter makes
every subscriber — and, in careless architectures, every ancestor of every
subscriber — re-render at the media's frame rate for the entire duration of
playback. The clock therefore lives in a **mutable reference**: a plain
holder the driving loop writes to, invisible to the reactive dependency
graph. What *does* live in reactive state is the low-frequency facts —
playing/paused, loaded item, duration — which change at human speed.

## Fan-out: consumers sample or subscribe at their own cadence

With the clock outside the reactive graph, consumers opt in at the fidelity
they need, and pay only for that fidelity:

- **Frame-rate consumers** (the needle, a highlight tracking the playhead
  through content) run their own animation-frame loop, read the reference,
  and write the result directly to their own narrow output — a transform, a
  scroll offset — without passing through the reactive layer at all. The
  frame loop lives inside the narrowest possible scope, so its cost is one
  small component, not a tree.
- **Coarse consumers** (timestamp text, a progress fraction) subscribe to a
  throttled tick — the clock owner notifies a subscriber list at a bounded
  cadence, or the consumer samples on its own slow interval. Either way the
  cadence is the consumer's choice, declared where the consumer lives.
- **On-demand consumers** (persistence, analytics, "resume from here") read
  the reference at the moment of need and store nothing continuously.

Two details make the fan-out trustworthy in practice:

- **subscription begins with a synchronous sample.** The subscribe call
  invokes the new consumer immediately with the current time, so a
  late-mounting consumer paints the truth at first render instead of a zero
  it holds until the next tick;
- **the subscription list is a resource like any other**: subscribing
  returns the unsubscribe, and a consumer that unmounts without
  unsubscribing is a leak with a callback attached.

## Who drives the clock

Two shapes, chosen by who really owns time:

- **Engine-driven:** a real engine (decoder, external player) is playing;
  its reported position is the truth. The clock's driver samples the engine
  on a modest interval or on its progress events and writes through to the
  reference. The interface may *extrapolate* between samples for smoothness
  (last known position plus elapsed wall time times rate), but extrapolation
  is presentation, never fed back as truth.
- **Application-driven:** nothing external owns time — the product is
  playing a composed timeline, a silent preview, a rehearsal cursor. The
  driver is the product's own loop: on each tick, position advances by
  elapsed wall time times rate. Wall-clock delta, not per-tick constants —
  tick cadence varies, and a clock that adds a fixed step per tick runs slow
  under load precisely when the product is struggling.

Pause, in both shapes, **freezes the clock without destroying it**: the
reference keeps its value, subscribers keep their subscriptions, and resume
continues from the held position. Teardown is the only event that ends the
clock's life.

One subtlety earned in production: the driving loop reads auxiliary flags —
looping, rate, total duration — from mutable holders shared with the
interface, and those holders must be written **only at commit points**.
Rendering systems are allowed to compute a frame speculatively and throw it
away; a flag written during provisional computation can be observed by a
clock tick *between* two attempts, feeding the loop a state the interface
never actually showed. Write shared flags after commitment, never as a side
effect of computing what to show.

## Drift and the correction policy

When both an engine time and an interface time exist, they disagree — sample
latency, extrapolation error, engine buffering all open a gap. The policy is
declared, not improvised:

- designate the authority (almost always the engine, when one is playing);
- **small error slews**: the presented clock adjusts rate slightly until the
  gap closes, so the needle never visibly jumps during normal playback;
- **large error snaps**: past a declared threshold (a seek landed, the
  engine recovered from a stall), continuity is a lie — jump to the truth
  and let the interface show the jump, because the jump is real.

The thresholds are product decisions (how much lie is invisible; how much
truth is urgent), but their *existence* is the technique: a clock with no
declared correction policy corrects by accident, differently at every call
site.

## Seek semantics

Seek looks like a write to the clock and is actually a **command with a
lifecycle**, because engines seek asynchronously:

- the surface issues the seek and may show the target position immediately —
  optimistic presentation is fine — but the clock's *authoritative* value
  moves only when the engine settles;
- while a seek is in flight, engine progress reports describe the *old*
  position and are discarded, keyed by a seek generation or target, so the
  needle does not snap back to stale truth mid-seek;
- rapid seek streams (a user scrubbing) coalesce: latest target wins,
  intermediate targets are abandoned, and only the settled final position is
  committed. A scrub that queues every intermediate seek plays a stuttering
  tour of positions the user already left.

Seeking is also the one legitimate way time moves backward. Consumers that
assume monotonic time (an animation keyed to "time since last sample", a
highlight that only searches forward) must be written against the clock's
real contract — monotonic *between* seeks, discontinuous *at* them — and the
clock's notification distinguishes "advanced" from "jumped" so consumers can
resynchronize instead of animating through the discontinuity.

## Derived time is a derivation

Everything the interface shows about time — remaining duration, progress
fraction, formatted timestamps, "chapter 3 of 7" — is derived from the clock
plus static metadata, computed at presentation time by a named function
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
None of it is stored alongside the clock; a stored progress fraction is a
second clock wearing a costume, and it drifts like one. If a derived value is
expensive (a search for the active item in a long composition), cache it
keyed by the input that invalidates it — position bucket, timeline version —
with recomputation named, never hand-maintained in parallel.
