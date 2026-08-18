---
layer: technique
subject: streaming-output
technique: run-attribution
status: forged
laws: [identity-survives-reuse]
shared_with: []
---

# Run attribution

The defining race of streaming surfaces: the user stops a run and starts
another, and the old run's last events arrive *after* the new run's first.
A surface that applies whatever arrives paints two runs into one transcript —
the new answer with the old answer's tail stitched onto it, indistinguishable
from the producer having actually said that. Every other technique in this
subject assumes attribution already works; none of them can compensate when
it doesn't.

The rule: **an event carries (or is correlated to) the identity of the run
that produced it; a surface holds the identity of the run it currently owns;
an event is applied only when the two match.** Everything else in this
technique is the machinery to make that rule survive real lifecycles.

## Identity is minted at initiation, once

The run identity is created when the run is requested — before the first
event, so even the first event is attributable — and it satisfies the
standing law: it survives reordering, reuse, and restart
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). The
disqualified candidates, each with its failure attached:

- **"The currently active run"** (no identity at all) — the race above,
  guaranteed.
- **A timestamp** — collides under rapid restart, exactly the scenario that
  needs attribution most.
- **A slot or index** ("the third conversation's run") — breaks the moment
  anything is reordered, closed, or reopened.
- **The subject entity's identity** (the conversation, the persona) — the
  entity survives across runs *by design*, so it cannot distinguish them.
  Run identity is one level finer: this *attempt*, not this *topic*.

The identity travels the whole path: into the producer request (so a
cooperative producer can echo it), through the parser (stamped on every typed
event), into the live buffer, and onto the settled record. A pipeline segment
that drops the identity — a shared channel that merges runs, a callback that
closes over nothing — is where misattribution will enter.

## The surface's side: current-run gating

The surface stores the identity of the run it is rendering, updates it
synchronously at the moment a new run is adopted, and gates every application
against it. Order matters: **adopt the new identity and reset the live state
first, then request the new run** — the gap between "requested new" and
"adopted new" is where an old event slips in and survives the upcoming reset,
or worse, where the new run's first event is dropped as stale.

Stale events are **inert, not errors**: dropped silently (with at most a
debug-level count), or — when the product keeps records of superseded runs —
routed to *their own* run's record. What they never do is touch the live
surface. Inertness rather than assertion-failure matters because stale
arrivals are not bugs; they are the normal behavior of asynchronous
delivery, expected on every restart.

## Subscriber generations: the consumer has a lifecycle too

Run identity guards against the *producer's* past; the consumer needs a
parallel guard against its own. Subscriptions are torn down and re-created —
a view remounts, a connection retries, a listener re-registers — and a
callback belonging to a dead subscription can fire after its replacement is
live. The guard is a **generation counter**: each (re)subscription increments
it and captures the current value; every callback compares its captured
generation against the current one and goes inert on mismatch.

This is not redundant with run identity — the two catch different accidents:

- run identity catches *old producer, current consumer* (restart races);
- generation catches *current producer, old consumer* (a zombie subscription
  double-applying every event alongside its replacement — the symptom is
  duplicated output, not mixed output).

A surface needs both. The generation check is one integer comparison; the
bugs it prevents are among the hardest to reproduce in this domain because
they depend on teardown timing.

## Concurrent runs: attribution is what makes "one surface" scale

When multiple runs are live at once — parallel agents, background jobs, one
watched and others summarized — attribution stops being a guard and becomes
the routing key: per-run live buffers keyed by run identity, and each surface
subscribes to exactly the run it owns. The shared-singleton shortcut (one
global buffer, one "current run") silently caps the product at one live run,
and the cap is discovered by the first feature that needs two.

The per-run registry inherits the buffer discipline: bounded count, and
entries name their reaper (finalization or replacement releases them).

## Attribution at the boundaries

- **Finalization**: the settled record is written under the run identity, so
  a late terminal event from a superseded run settles *its own* record
  instead of overwriting the current run's — or, if that run's record is
  already settled, it is inert. Double-settle protection lives in
  finalization; attribution just makes sure the attempt lands on the right
  record.
- **Resume**: a resumed run is a **new run identity** that *references* its
  predecessor. Reusing the old identity re-arms every stale event of the
  original as a live one; the reference preserves continuity for display
  without corrupting the guard.
- **Persistence and replay**: events stored for replay keep their run
  identity, so a replayed stream is attributable end-to-end and can never be
  confused with a live one.
