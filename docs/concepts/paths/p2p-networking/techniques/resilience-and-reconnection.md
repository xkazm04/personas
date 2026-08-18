---
layer: technique
subject: p2p-networking
technique: resilience-and-reconnection
status: forged
laws: [identity-survives-reuse, failure-not-empty-success, creation-names-reaper, gate-sees-target]
shared_with: []
---

# Resilience and reconnection

In a server system, disconnection is an incident; in a peer system it
is the weather. Laptops sleep mid-transfer, phones walk out of range,
interfaces flip between wired and wireless, and at any moment most
known peers are simply not there. The technique is designing for that
as the steady state: **absence downgrades, never destroys; reconnection
is a policy, not a reflex; and no part of the system assumes the mesh
is stable, symmetric, or complete.**

## Absence downgrades; identity persists

A paired peer that vanishes keeps its record, its grants, its history —
its *state* demotes (connected → stale) while its *identity* endures.
The record is keyed by the stable peer identifier, never by address:
addresses are leased, reassigned, and carried across networks, and a
peer rediscovered at a new address is the same peer, updated — not a
duplicate row with a fresher timestamp
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
The corollary discipline: cached endpoints are hints with a shelf life.
Reconnection prefers a fresh address from current discovery and falls
back to the cached one; a stale address that now belongs to a different
machine is why the authenticated handshake, not the address book,
decides who you reached.

## Reconnection is backoff, gated by signal

Redialing an absent peer in a hot loop burns radio, battery, and log
signal on a machine that is closed in a bag. The policy has three
layers:

- **Backoff with jitter** for blind retries — the schedule and its
  ceilings are the [retry & backoff](../../retry-backoff/retry-backoff.md)
  subject's machinery, applied per peer, not globally: one absent peer
  must not slow reconnection to another.
- **Signal preemption**: a positive sighting — the peer's advertisement
  heard again, an inbound packet from it — resets the schedule and
  triggers an immediate attempt. Discovery is the cheap channel;
  spending it to gate the expensive one is the whole economy of the
  design.
- **A ceiling, then rest.** After the schedule exhausts, the peer sits
  at stale and the system attempts nothing until a signal arrives or
  the user acts. Perpetual background dialing to every peer ever seen
  is how a peer feature becomes the reason the fan spins.

Both ends run this policy, which re-raises the simultaneous-dial race
on every blip — reconnection converges only because the connection
lifecycle's deterministic tie-break makes both sides pick the same
winner without coordination.

And the policy must actually be **wired**. The observed failure mode
is a subsystem that carries a retry ceiling nothing consults, a
retry counter nothing increments, and an auto-reconnect flag nothing
reads — while its own header comment promises auto-reconnect. Dead
knobs are worse than absent ones: every reader of the config, the
types, and the comment concludes the behavior exists, and the truth
(a peer that drops is gone until a human clicks) is only discoverable
by tracing who consumes each field. If reconnection is not built yet,
say so where the knobs would be; a config field is a promise
([gate-sees-target](../../_laws.md#gate-sees-target) has a cousin:
a knob must reach its behavior).

## Partial connectivity is a topology, not an error

Asymmetric visibility is ordinary: A hears B's announcements but B's
never reach A (multicast filtering is direction-blind in neither
direction); A can dial B but not vice versa (one host firewall). The
design consequences:

- **Either side may initiate.** Any flow that requires *both* sides to
  discover each other, or a specific side to dial, fails on networks
  that merely fail half the symmetry. Inbound session, outbound
  session — after the handshake they are the same session.
- **Pairwise, not transitive.** A sees B and B sees C says nothing
  about A and C. Any feature that assumes a connected clique — group
  operations, relayed presence — must be designed against pairwise
  reality or it ships with a hidden network prerequisite no user can
  diagnose.

## Interface transitions invalidate wholesale

Waking from sleep, joining a different network, a tunnel coming up or
down — these do not degrade the old sockets, they orphan them: bound to
addresses that no longer exist, on a network you are no longer on. The
honest response is wholesale: on interface change, tear down bound
listeners and rebind on the new interface set, re-announce presence,
mark every session suspect and let keepalives render verdicts quickly.
The same applies to the process's own sleep: on resume, connection
state older than the sleep is a memory, not a fact — re-verify before
trusting. Treating a network transition as a per-connection hiccup to
be retried in place is the bug; the ground moved, not the packet.

## Work for absent peers waits durably

Data destined for a peer that is not there must not pile up in memory
against its return: an unbounded in-memory queue is a leak indexed by
someone else's travel schedule, and it dies with the process, silently
([creation-names-reaper](../../_laws.md#creation-names-reaper) — a
queue with no bound and no owner has no reaper). The durable form is
the sync subject's: the *fact* of pending work lives in the store
(dirty marks, cursors —
[change-tracking-and-cursors](../../sync-replication/techniques/change-tracking-and-cursors.md)),
and reconnection simply wakes the transfer loop, which resumes from
its cursor as if the gap had been an afternoon or a month. Transfers
interrupted mid-flight resume, not restart — resumability is what makes
absence cheap, and absence being cheap is what makes the whole subject
viable.

The strongest form makes **link-up itself the recovery trigger**: the
moment a session to a peer is (re)established, each side asks the
other to replay whatever it missed for work in flight between them —
before any timer would have noticed. The request is cheap by
construction (a no-op unless unfinished work with that specific peer
exists), it runs concurrently with serving the peer so a slow or
hostile counterpart cannot delay it, and it converts every reconnect
from "wait for the next sweep" into immediate repair. Timers remain as
the floor; the link-up hook is the accelerator — the same
tick-plus-signal layering the transfer loop already uses.

## Degradation is announced, not discovered

When the subsystem is down to zero — no interface, listener dead,
discovery silent — the feature says so, in its own surface: what is
degraded, since when, and what it is doing about it (waiting for
network, retrying at a stated time). The silent version leaves an
interface that looks like a quiet network over a subsystem that is
actually off, and the user's first evidence is a transfer that never
happens
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
Peers cannot be lied to either way — they observe absence identically
whether you crashed or degraded gracefully — but the local user can be,
and this is the technique that refuses to.
