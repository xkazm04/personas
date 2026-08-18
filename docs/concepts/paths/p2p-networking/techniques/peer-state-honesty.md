---
layer: technique
subject: p2p-networking
technique: peer-state-honesty
status: forged
laws: [failure-not-empty-success, derivation-names-recomputation, count-carries-predicate]
shared_with: []
---

# Peer-state honesty

A peer list is a set of claims about machines you cannot see, on a
network that drops the very packets those claims are built from. The
technique is keeping the claims honest: **every state a peer can be
shown in is earned by specific evidence, with a specific freshness, and
the display never promotes a weak claim to a strong one.**

## The vocabulary: four states, four kinds of evidence

- **Discovered** — an advertisement was heard. Evidence: a multicast
  packet arrived, once. Claims: the device existed, was on this
  segment, within the announcement's freshness window. Does *not*
  claim: you can connect to it.
- **Reachable** — a direct probe succeeded. Evidence: a unicast
  round-trip to the peer's endpoint. Claims: the transport path works,
  as of the probe. Strictly stronger than discovered, and independently
  earned — never inferred from it.
- **Connected** — an authenticated session is live now. Evidence: the
  session object exists and its keepalives are current. The only state
  in which data moves.
- **Stale** — evidence has aged out. The peer is still *known* (paired
  peers especially are never deleted for mere absence — offline is the
  normal case), but no current claim is made. Staleness carries its
  timestamp: "last seen 3 days ago" is information; an unqualified gray
  dot is not.

Each transition names its evidence. Promotion happens only on positive
proof (heard, probed, handshaken); demotion happens on expiry or on
failed proof (probe timed out, keepalive lapsed). The state is a stored
derivation of the evidence log, and recomputing it from that log must
yield the same answer
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation))
— if a peer shows "reachable" and nothing in the record says when a
probe last succeeded, the state is decoration, not derivation.

One transition is special: **restart voids "connected", always.** A
live-session claim persisted by a previous process life is a claim
about sessions that died with the process; the first act of the
subsystem at startup is to reset every stored "connected" mark before
any new evidence arrives. A peer list that boots showing yesterday's
connections is the state vocabulary's version of a stale cache — and
uniquely convincing, because it renders in the strongest state the
vocabulary has.

The claimed-versus-proven axis also deserves its own mark. A peer heard
via discovery has *asserted* an identity; a peer that completed the
authenticated handshake has *proven* one. Displaying both identically
launders assertion into proof — the honest list carries an unverified
marker on peers whose identity rests on nothing but their own
announcement, and the pairing surface warns before any trust decision
is made against an unproven claim.

## Discovery is not reachability — in either direction

The failure modes are mundane and constant: consumer access points
isolate wireless clients (multicast passes, unicast blocked — or the
reverse); host firewalls admit outbound dials but drop inbound;
multicast dies at subnet boundaries while routing works fine across
them; power-saving radios hear announcements they are too asleep to
answer. So the two truths are collected separately and displayed
separately. The list may show a peer as discovered-but-unreachable —
that is a *useful* state, it tells the user "your devices see each
other but something between them blocks connections" — and may show a
known peer as reachable even when discovery has gone quiet, because a
probe to the last known endpoint succeeded. Rendering the union of the
two as one optimistic "online" produces the characteristic support
complaint of naive peer software: *it shows the device but won't
connect to it.* Show what you know, sourced.

## Timestamps carry their predicate

"Last seen" is a different fact depending on what saw it: heard an
advertisement, answered a probe, completed a transfer. A single
undifferentiated timestamp launders the weakest evidence into the
strongest claim
([count-carries-predicate](../../_laws.md#count-carries-predicate) —
the timestamp is a measurement, and a measurement without its
instrument is unusable). Keep the channels' marks distinct in the
record; the display may summarize, but the summary must be computed
from the honest marks, not stored in place of them.

## An empty list must say why it is empty

"No peers found" is the correct rendering of exactly one situation: the
discovery listener is running, healthy, and has heard nothing. Every
other route to an empty list — the subsystem is feature-gated off, the
setting is disabled, the socket failed to bind, the multicast join was
refused, the interface has no network — is a different fact and renders
differently
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
This is the UI edge of the same law the backend obeys: a scanner that
could not run must not report a clean scan. The peer list is precisely
such a scanner, and "your network is empty" when the truth is "my
socket is broken" sends the user debugging the wrong machine.

## Liveness of the watcher, not just the watched

The states above describe peers; one more describes the observer. The
discovery listener and the probe loop are long-running services, and
their health is part of the display's honesty — a peer list whose
underlying watcher died an hour ago is a snapshot wearing a live
interface. Surface the watcher's own state (running / degraded /
stopped, last activity time) the way any long-lived background service
owes its operator
([health checks](../../health-checks/health-checks.md) owns the probe
patterns). Where fresh state is pushed to the display and a slow poll
exists only as a staleness backstop, a failed poll renders as a visible
"this data may be stale" banner over the last known state — stale data
shown as stale beats stale data shown as current, and beats a blank.

The observer's *identity* gets the same honesty. The local signing key
lives in custody that can fail independently of everything else (a
reset key store, a migrated machine), and a subsystem that cannot
resolve its own identity must say so with a dedicated degraded flag —
not render an empty identifier into a healthy-looking display. An
identity failure disguised as a blank field sends the user searching
the network for a problem that lives in their own key custody.
