---
layer: technique
subject: media-playback
technique: engine-adapters
status: forged
laws: [one-authority-per-vocabulary, failure-not-empty-success]
shared_with: []
---

# Engine adapters

A product that plays media through more than one engine — a native decoder
for local files, an embedded third-party player for a licensed catalog, a
backend process that owns the audio device — faces a choice: teach every
surface about every engine, or put the engines behind one contract. The first
option metastasizes (every new engine multiplies every surface), so the
technique is the second: **one transport contract, one adapter per engine,
and honest capability declaration** — with the emphasis on *honest*, because
the failure mode of engine abstraction is not leakage but pretense.

## The contract is the floor; capabilities are the ceiling

The transport contract (owned by [transport-contract](transport-contract.md))
defines the verbs and the state vocabulary every adapter must speak. But
engines genuinely differ in what they *can* do: one seeks, one cannot; one
exposes volume, one is a licensed black box that refuses; one reports
position continuously, one only on coarse events; one can preload, one
starts cold every time.

The wrong abstraction pretends parity — every adapter implements every verb,
and the unsupported ones no-op, throw, or lie. All three are product defects:
a seek bar over a no-op seek teaches the user the controls are decorative.
The right abstraction has each adapter **declare its capabilities** as data —
can-seek, can-set-volume, reports-position, can-preload, and whatever else
the product's surfaces gate on — and surfaces consult the declaration, not
the engine's identity:

- an affordance for an unsupported verb is absent or visibly disabled with
  the reason, never present-and-inert;
- shared logic branches on capability ("if it cannot report position, drive
  the clock by extrapolation"), so adding an engine means declaring its
  shape, not editing every consumer;
- capability is declared per *adapter*, but may be refined per *source* —
  some engines can seek in one format and not another; the declaration is
  allowed to be a function of the loaded source, resolved at load time.

Branching on engine identity anywhere outside the adapter is the smell that
the declaration is incomplete: it means a consumer knows something about an
engine that the adapter failed to say out loud.

## The foreign-frame player class

One engine shape deserves its own dossier, because its constraints are
categorical: the **embedded third-party player** — a player owned by another
origin, living in a nested frame, controlled through a message bridge. Its
properties define the class:

- **everything is asynchronous and unacknowledged.** Commands are messages;
  there is no synchronous read of any property, and often no reply to a
  command at all. The adapter cannot ask "are you playing?" — it can only
  remember what the player last *announced*.
- **the adapter therefore keeps a shadow model**: the last announced state,
  position, and duration, timestamped, updated exclusively by the player's
  events. Every contract read is served from the shadow, with staleness as a
  declared property rather than a hidden one.
- **readiness is an event that may never arrive.** The frame loads, the
  script boots, the handshake completes — or any of those silently doesn't
  (blocked script, network policy, a breaking change on the provider's
  side). Every awaited transition gets a watchdog, and watchdog expiry is a
  *declared engine failure* that the source-resilience layer can act on
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)) —
  a foreign player that never says ready must cost the product seconds, not
  a hung surface.
- **the provider owns the roadmap.** The bridge's message names, event
  shapes, and undocumented behaviors change on the provider's schedule, not
  the product's. The adapter is the *only* file that speaks the bridge
  dialect; when the provider breaks it, the blast radius is one adapter.
- **it brings its own chrome and its own rules** — visible surface
  requirements, autoplay restrictions, region blocks. The adapter declares
  these as capabilities and constraints; the surface accommodates them
  knowingly instead of discovering them as bugs.

## One state vocabulary, translated at the boundary

Every engine announces state in its own dialect — numeric codes, string
enums, event names, sometimes several overlapping channels. The adapter's
core translation duty is mapping that dialect into the contract's **single
canonical state vocabulary** at the boundary, so no consumer ever sees a raw
engine state
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The mapping is total: every engine state, including the weird ones, maps to
*something* canonical, and an unrecognized engine state maps to a declared
"unknown" that is logged loudly — not silently dropped, which is how a new
provider-side state becomes an invisible stall.

## State echo: when the engine is the authority

When real playback lives outside the application — a backend process owns
the audio device, a foreign player owns the stream — the application's state
is a **mirror, not a master**. The discipline:

- commands are *requests*: the surface sends play and does not flip its own
  state to playing; it renders the echo when the authority announces it.
  Optimistic presentation is allowed only as a visibly provisional state
  (the pressed control shows busy), never as a committed fact;
- echoes are the *only* writer of mirrored state. The moment both a local
  guess and a remote echo write the same field, the product double-drives:
  state flickers when they disagree, and the disagreement is invisible when
  they happen to agree;
- echoes arrive late and out of order relative to a fast-clicking user, so
  the mirror is reconciled by *content* (the authority says what is playing,
  not just that something is), letting a stale echo about a superseded
  source be recognized and discarded rather than applied;
- driving a local engine *from* an authoritative remote state works the
  same way in reverse: the sync loop is a **reconciler**, not a command
  forwarder. It compares the authority's desired state against what the
  engine is actually doing (is the loaded source the desired one? is it
  playing when it should be?) and issues only the delta. Reconciliation
  makes the loop idempotent — a re-delivered or reordered state event
  produces no spurious reload — where blind command forwarding replays
  every echo as an audible restart.

The stale-echo filter needs source identity — which request's echo is this?
— and that identity discipline is the same one the golden path's boundary
lesson describes: claim identity at request time, validate echoes against it.

## Switching engines is a lifecycle, not an assignment

Selecting a different engine (user preference, capability need, source type)
is a two-phase handover: **tear down the outgoing adapter completely** —
stop playback, cancel its watchdogs, unsubscribe its events, release its
resources — *then* construct the incoming one. The overlap window where both
exist is where double audio and orphaned event handlers live; the handover
holds the exclusivity claim for the whole window, and a mid-handover request
targets the incoming engine or is refused, never routed to the corpse. An
adapter must be built for repeated construction and teardown within one
session — an adapter that only works once is an adapter with a hidden global.
