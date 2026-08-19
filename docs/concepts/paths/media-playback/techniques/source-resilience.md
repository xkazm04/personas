---
layer: technique
subject: media-playback
technique: source-resilience
status: forged
laws: [failure-not-empty-success, deletion-is-not-repair]
shared_with: []
---

# Source resilience

A media source is a claim that something playable exists at a reference, and
the claim decays: streams go dark, catalogs rot, endpoints move, codecs age
out of support, and some sources fail in the cruelest way — they play,
delivering silence or a frozen frame. In products that play continuously (a
station, a rotation, a playlist meant to run all evening) source failure is
not exceptional, it is *scheduled*: with enough sources and enough hours,
tonight's session contains one. The technique is the difference between a
product that absorbs that event and one that transmits it to the user raw.

The design constraint that shapes everything here: **the response is
designed before the first failure, not discovered at the failure site.**
Resilience improvised inside an error callback converges on the worst
version of every policy — infinite retries of a dead stream, hard silence
between items, the same broken source re-attempted every session forever —
because the error callback is the one place with no context about what the
user was owed.

## The failure taxonomy

Different failures deserve different responses, so the first job is naming
them. Five classes cover the field:

1. **Unreachable** — the reference cannot be fetched at all. Fast, explicit,
   and the easiest to handle: the failure announces itself.
2. **Unsupported** — fetched but undecodable: format, codec, or container
   the engine cannot play. Deterministic per (source, engine) pair — which
   means retrying is useless but *another engine* might succeed, and the
   fallback ladder should know that.
3. **Mid-stream death** — playing, then broken: the stream drops, the CDN
   hiccups, the decode errors partway. The only class where the user has
   already invested listening time, so recovery here tries hardest to
   resume in place before it abandons the source.
4. **Never-ready** — the engine accepts the source and then reports nothing
   forever. No error, no readiness; only the transport watchdog converts
   this silence into a fact
   ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
5. **Empty success** — the most deceptive class: the transport reaches
   *playing* and the user gets nothing — silent audio, black frames, a
   looping buffer. No layer below the product can detect this (the engine
   is, technically, playing); catching it requires a content-level signal
   (level metering, frame advance) or the user's skip — which is why the
   skip affordance is itself part of the resilience design, and why skips
   feed the same bookkeeping as failures.

## The blacklist

A source that failed should not be attempted again *blindly* — not this
session (the user already paid for the first failure) and, for deterministic
failures, not next session either. The blacklist is that memory, and its
design points are:

- **keyed by source identity**, not by list position — the same stream
  reached from two playlists is one blacklist entry
  (identity here is the stable reference, surviving reordering of whatever
  list contains it);
- **entries carry the failure class and count**, because policy branches on
  them: unsupported is near-permanent, unreachable deserves re-testing,
  empty-success entries seeded by user skips are weaker evidence than
  instrumented failures;
- **entries expire.** Dead now is not dead forever — streams return,
  providers fix encodings. A blacklist without expiry quietly converts
  every transient outage into a permanent catalog deletion, which is
  [deletion-is-not-repair](../../_laws.md#deletion-is-not-repair) enacted by
  automation: the failing source disappears instead of being fixed or
  re-verified. Expiry (or a periodic re-probe of a bounded sample) keeps the
  blacklist a cache of recent evidence rather than a graveyard;
- **persistence is a policy choice**: session-only blacklists forgive too
  fast (every launch replays every failure); permanent ones forget nothing.
  The defensible middle is persisted-with-expiry, tiered by failure class.

## The fallback ladder

When a source fails, what happens next is an explicit, ordered, **bounded**
ladder — typically: retry the same source (bounded, backed off, and only for
failure classes where retry can help — the schedule discipline lives with
[retry-backoff](../../retry-backoff/retry-backoff.md)); then an alternate
form of the same content (different encoding, different endpoint, different
engine for unsupported cases); then the *next* item in the product's own
sequence; then, when the ladder is exhausted, an honest resting state that
says what happened and offers the user the controls.

Two properties make a ladder trustworthy. **Bounded**: every rung has a
maximum spend (attempts, seconds) and the ladder as a whole terminates —
a resilience layer that never gives up is a product that can be stuck
"recovering" forever, which is the never-ready failure rebuilt one level up.
The bound that needs the most care is the *skip chain*: blacklist-driven
skipping of known-bad items can loop forever through a catalog that is
entirely broken. The measured fix is a **skip budget** — consecutive
automatic skips are capped at the catalog's own size, the budget replenishes
on every successful play, and when it is exhausted the next bad item is
attempted normally so the ordinary failure surface (watchdog, honest error)
fires instead of an infinite silent spin.
**Observable**: each rung reports what it is doing. Automatic recovery that
succeeds invisibly is ideal; automatic recovery that *churns* invisibly
(three sources skipped, engine swapped) gaslights the user, who pressed play
on one thing and is now hearing another with no acknowledgment.

## Transition treatment: cut, gap, or crossfade

How playback moves from a failing (or ending) source to the next one is a
product decision made once, not an accident of the failure path:

- **hard cut** — correct for spoken content and alarms; jarring for music;
- **gap** — honest but dead air is the thing continuous products exist to
  avoid; a *bounded* gap with visible state ("finding next…") is the
  acceptable form;
- **crossfade** — the outgoing source fades down while the incoming fades
  up. It requires *two* live pipelines for the overlap window, which means
  the exclusivity rule ("one audible source") is deliberately, locally
  suspended — so the crossfade owns both handles for the whole window,
  reaps the outgoing pipeline at fade-end on every path (including the
  incoming source failing mid-fade, the classic double-failure), and the
  exclusivity claim for the *incoming* source is made at fade start, per
  the golden path's boundary lesson. A crossfade that loses track of the
  outgoing handle is the canonical source of two-streams-at-once.

Two refinements from crossfades measured in production:

- **the single-pipeline variant.** When the engine can only hold one source
  at a time (a foreign player, a single decoder), true overlap is
  unavailable — the honest approximation is *fade-out → switch → fade-in*:
  fade the outgoing source down as its end approaches, cut, and fade the
  incoming source up from its start. It costs a brief quiet dip instead of
  an overlap, which the ear accepts far better than a hard cut, and it
  needs none of the double-pipeline bookkeeping;
- **while a fade runs, the fade owns the volume parameter exclusively.**
  Volume normally has a standing synchronizer (user setting pushed to the
  engine on change); an animation writing the same parameter creates two
  writers, and the synchronizer will snap the level back to the user's
  setting mid-fade. The fade takes an explicit ownership flag for its
  duration, the synchronizer yields while it is set, and ownership returns
  — with the user's true setting reapplied — when the fade lands.

Crossfade onto a *failure* has one extra wrinkle: the outgoing source may be
delivering garbage (stutter, silence) rather than music, and fading garbage
down slowly prolongs it. Failure transitions therefore prefer a fast cut of
the broken side even when the product's aesthetic transition is a slow fade.

## Preloading

Continuous products warm the next source before it is needed — resolving,
buffering, sometimes fully preparing a second pipeline. The policy points:
preload **the next item only** (a horizon of one captures most of the win;
deeper horizons multiply cost and staleness); preload results are *evidence*
(a source that fails preloading feeds the blacklist and advances the ladder
before the user ever reaches it — the cheapest failure is the one absorbed
while something else is playing); and preloaded pipelines are resources with
reapers — superseded by a seek, a skip, or a source-list edit, they are
released, not leaked as a warm pipeline for an item no longer next.
