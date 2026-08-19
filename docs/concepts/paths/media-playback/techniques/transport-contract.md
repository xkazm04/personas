---
layer: technique
subject: media-playback
technique: transport-contract
status: forged
laws: [failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# The transport contract

The transport contract is the small language every playback surface speaks
and every engine adapter implements: the verbs, the state machine, and the
temporal discipline connecting them. It looks too obvious to design — play,
pause, what else is there? — and that is exactly why it goes wrong: each verb
has a naive reading that is false, and the states everyone forgets
(buffering, stalled, the several kinds of stopped) are the ones users
actually live in.

## Verbs are requests; states are facts

The load-bearing distinction of the whole contract: **a verb expresses
intent; the state machine records reality; the two are connected by the
engine, asynchronously, and sometimes not at all.**

- `load(source)` — begin acquiring a source. Completion means *ready to
  play*, not playing. Loading a new source implicitly unloads the old one,
  and the unload half is where resources leak.
- `play()` — request that time advance. It can be refused (platform gesture
  policies, engine not ready, device unavailable), and a refused play is a
  *reported outcome*, never a silent no-op — the surface shows an affordance
  to try again with a gesture, rather than pretending playback started.
- `pause()` — request that time stop advancing while keeping everything
  warm: position, source, readiness. Pause is cheap and reversible by
  design.
- `seek(position)` — request a new position. Asynchronous, coalescible
  (latest target wins under scrubbing), and bounded by capability — an
  engine that cannot seek declared that already, and the surface never
  offered the verb.
- `stop()` — end the playback intent entirely: position surrendered,
  resources releasable. The stop/pause distinction is a resource-lifecycle
  distinction, and collapsing them produces either paused surfaces that leak
  (pause hoarding a live stream forever) or stops that lose the user's place
  when pause was meant.
- `setRate` / `setVolume` / `mute` — parameter writes, still capability-
  gated, still echoed as facts rather than assumed.

Because verbs are requests, **button state derives from machine state, not
from the request just issued**. A play control that flips to "pause" the
instant it is pressed shows a fiction whenever the engine refuses or takes a
while; the honest sequence is pressed → busy (request in flight) → whatever
the machine actually reports. The busy affordance on the control is the
request's lifecycle; the transport state is the engine's.

## The state machine, including the states everyone forgets

The canonical vocabulary — one authority, translated to from every engine
dialect at the adapter boundary
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):

| State | Meaning | The surface owes the user |
| --- | --- | --- |
| **idle** | nothing loaded | the affordance to begin |
| **loading** | source acquisition in flight | calm progress; a way to cancel |
| **ready** | playable, not playing | duration and position honestly shown |
| **playing** | time is advancing | a moving clock — the proof of life |
| **paused** | user chose stillness | position held; instant resume |
| **buffering** | *engine* chose stillness, mid-intent | "working on it", distinct from paused |
| **stalled** | buffering that stopped progressing | escalation: the wait has stopped being normal |
| **ended** | source completed naturally | what happens next (replay, next item, rest) |
| **failed** | the intent is dead without recovery | what broke, and a designed next step |

Two distinctions carry most of the value:

**Paused versus buffering** is *whose choice the silence is*. Both are
"not playing", and a surface that renders them identically makes the user
diagnose the difference by vibes. Paused is the user's state and is serene;
buffering is the engine's state and shows work; the transition between them
must never require user action to display correctly.

**Buffering versus stalled** is a *watchdog verdict*, not an engine report.
Engines report that they are buffering; no engine reports that buffering has
failed — silence is the failure mode. The contract holds a deadline:
buffering that makes no progress within it is *declared* stalled by the
transport layer, escalating a hidden condition into a visible one
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

**Ended versus stopped versus failed** are three exits with three meanings —
natural completion (advance the sequence), user intent (rest), and breakage
(recover) — and downstream policy (what plays next, what gets blacklisted,
what gets retried) branches on which exit occurred. An engine or adapter
that collapses them poisons every policy downstream.

## Watchdogs on every awaited transition

Every transition the transport awaits carries a deadline appropriate to its
physics: load-to-ready, play-to-playing, seek-to-settled, buffering-to-
progress. The pattern is uniform:

- arm the watchdog when the request is issued;
- disarm it when the engine's echo arrives;
- on expiry, **declare the transition failed** — synthesize the failure the
  engine refused to report, transition the machine to failed (or stalled,
  for the in-playback case), and hand the event to recovery policy exactly
  as if the engine had reported it;
- every watchdog names its reaper: disarmed on success, on supersession
  (a new request replaces the awaited one), and on teardown. An orphaned
  watchdog firing after its context is gone is the transport-layer version
  of audio that will not stop.

Deadlines are tuned per transition, not shared: a seek settles in tens to
hundreds of milliseconds; a cold load of a remote stream legitimately takes
seconds. One global timeout is always wrong in one direction — trigger-happy
on loads or comatose on seeks.

## Superseding requests

Users change their mind faster than engines settle, so the contract defines
supersession for every awaited verb: a new load abandons the in-flight load
(and its watchdog, and its pending echoes); the latest seek wins the scrub;
play-then-pause-quickly resolves to paused without an audible blip if the
engine allows it. The mechanism is the request identity discipline from the
golden path's boundary lesson: each awaited request carries an identity,
claims the transport at issue time, and echoes or results arriving for a
superseded identity are discarded — the answer to "which request does this
echo belong to?" must never be "whichever is currently waiting".

## The contract is the product's floor of truth

Everything above the transport — the clock, the source-resilience policy,
the composed timeline — trusts the contract's states as facts. That trust is
what the watchdogs and the request/fact separation buy: a transport that
passes silence upward as "still playing" starves every layer above it of the
signal recovery needs. When the transport is honest, resilience is policy;
when it lies, resilience is archaeology.
