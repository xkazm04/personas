---
layer: technique
subject: fleet-orchestration
technique: session-registry
status: forged
laws: [one-authority-per-vocabulary, one-validation-door, identity-survives-reuse, creation-names-reaper]
shared_with: []
---

# Session registry

The registry is the fleet's single authoritative record: one entry per
session, one closed status vocabulary, one door for every transition. It is
the data structure everything else in the subject is built against — the
sweeper walks it, the dispatcher consults it for capacity, the durable mirror
serializes it, the harvest reads it to account for a roster. Get the registry
right and the rest of the subject is plumbing; get it wrong and every
downstream component compensates with its own private shadow copy, which is
the beginning of the end
([one authority per vocabulary](../../_laws.md#one-authority-per-vocabulary)).

## The entry

A registry entry carries, at minimum:

- **Identity** — minted at creation, opaque, never reused, never derived from
  anything that can recur (not a process id, not a timestamp, not a name).
  Everything downstream keys on it: the durable mirror, log attribution,
  result harvest, viewer attachment
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). The
  process id, when a process exists, is a *field* of the entry — a join to
  the operating-system world — never the key.
- **Status** — one value from the closed vocabulary (below).
- **Task binding** — what this session was dispatched to do, and for fleet
  runs, which dispatch roster it belongs to. Harvest is impossible without
  this: a result that cannot be traced to its dispatch is noise.
- **Resource claims** — the working directory, the declared write scope, the
  terminal or stream attachment if any, and whether the session currently
  occupies a concurrency slot. The entry is where "who owns what" is
  answered, and therefore where "what must be released on exit" is answered
  ([creation names its reaper](../../_laws.md#creation-names-reaper)).
- **Liveness bookkeeping** — last-heard-from timestamp, updated on every
  signal and every observed output; this is the field the staleness sweeper
  judges against (see [lifecycle-signals](lifecycle-signals.md)).
- **Lineage** — how the session came to exist: fresh dispatch, resume of a
  hibernated session, adoption after an orchestrator restart. Lineage is
  what makes post-hoc debugging of a fleet possible; without it, a
  resurrected session is indistinguishable from a duplicate.

## The closed vocabulary

The status set is defined in exactly one place, and it is small. A workable
minimal set:

- **starting** — dispatched, process not yet confirmed up.
- **working** — alive and producing.
- **awaiting-input** — alive, blocked on a human or an external decision.
  This state earns its place: it is the difference between "the fleet is
  busy" and "the fleet is waiting for you," which is the single most
  actionable distinction a fleet dashboard can draw.
- **idle** — alive, finished its current work, holding context, available.
- **hibernated** — no process; identity and context preserved for resume.
- **exited** — terminated and *said so*: a self-reported, orderly end.
- **failed** — terminated with a self-reported error.
- **lost** — terminated *by decree of the sweeper*: we stopped hearing from
  it and the process is gone. Never merge this with exited — one is a fact
  the session reported, the other an inference the fleet made, and
  conflating them destroys the ability to debug delivery of the signals
  themselves.

Extend the set only through its single definition, and let every consumer —
views, filters, dispatch policy, harvest classification — derive from it.
The classic failure is a monitoring layer that keeps its own parallel enum
plus a mapping function; the mapping is precisely where new states get
silently dropped ([one
authority](../../_laws.md#one-authority-per-vocabulary)).

## Transitions pass through one door

Writers never set status fields. They report *observations* — "process
confirmed up," "emitted a waiting-for-input marker," "stream closed," "sweep
found the process dead" — and one transition function, owned by the registry,
maps (current state, observation) to the next state or rejects the
combination ([one validation door](../../_laws.md#one-validation-door)).

The door earns its cost in the awkward cases, which are the common cases at
fleet scale:

- A late "finished" signal arrives for a session the sweeper already declared
  lost. The door decides — a plausible policy upgrades lost to exited and
  records the correction; whatever the choice, it is made once, in one
  place, instead of racing in two.
- A wake request arrives for a session that is not hibernated. Reject at the
  door; do not let a second process spawn under an identity that already has
  one.
- A terminal state is terminal. Exited, failed, and lost accept no outgoing
  edges except explicit, recorded resurrection paths (a lost session may be
  adopted back if it turns out to be alive; the edge exists and is named,
  rather than happening by accident).

Because the door sees every transition, it is also the natural place to
enforce resource bookkeeping — a transition into hibernated or any terminal
state releases the concurrency slot and the write-scope claim as part of the
same atomic step. Split those responsibilities and the fleet leaks slots
exactly as often as any writer forgets the second half.

## Ownership rules

The registry answers resource questions with rules, not conventions:

- **One live process per identity.** The door enforces it structurally, as
  above.
- **One writer per write scope.** Two live sessions with overlapping declared
  write scopes is a dispatch error, caught at admission (see
  [parallel-dispatch](parallel-dispatch.md)); the registry is the index that
  makes the overlap check possible.
- **Attachment is a lease, not a bond.** A viewer attaching to a session's
  terminal or stream is recorded, and detaching — or the viewer's own death —
  never affects the session's lifecycle. Work survives its observer.
- **Everything held is enumerable.** "What does this session own?" has a
  registry answer, so releasing on any exit path is a walk over the entry's
  claims, not an archaeology project.
