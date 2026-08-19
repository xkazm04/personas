---
layer: technique
subject: p2p-networking
technique: connection-lifecycle
status: forged
laws: [creation-names-reaper, failure-not-empty-success]
shared_with: []
---

# Connection lifecycle

A peer connection is a compound resource — sockets, crypto state,
buffers, background tasks — created against a machine that may vanish
mid-handshake and a user who may change their mind mid-dial. The
technique is ownership: **every connection has an explicit state
machine, every state has a bounded exit, and every exit releases
everything the connection held**
([creation-names-reaper](../../_laws.md#creation-names-reaper)).

## Establishment is bounded and cancellable

Dialing a peer is a chain of awaits — resolve endpoint, open transport,
run the authenticated handshake, exchange hellos — and each link needs
two exits it will actually take:

- **A timeout per phase**, not one blanket timeout for the chain. A
  dial that connects instantly but hangs in handshake is a different
  diagnosis from one that never connects; a single outer timeout
  reports both as the same mush and, tuned for the slow case, holds
  resources hostage for the fast one.
- **A cancellation signal threaded through every await.** The token is
  created with the *intent* (user clicked connect; the sync loop wants
  this peer) and propagated into every step, so the user's "never
  mind", the peer's removal, the subsystem's shutdown, or the
  application's exit kills the attempt promptly. The anti-pattern is
  the orphan dial: an attempt with no token that survives its reason,
  completes minutes later, and registers a session nobody wants —
  which then holds the real reconnect out of the slot.

Establishment also needs a **dedupe set** — one in-flight attempt per
peer, so a nervous caller (a UI click racing an automatic trigger)
cannot stack dials. And the set's entries must be released by a
mechanism that fires even when the attempt's future is *abandoned*
rather than completed — a scope-exit guard, not a line of cleanup code
after the await. The failure mode of the naive version is quietly
permanent: a cancelled dial leaves its entry in the set forever, and
every future attempt to that peer is "already in progress", which reads
as the peer's fault and is actually a leak
([creation-names-reaper](../../_laws.md#creation-names-reaper) applies
to bookkeeping entries as much as to sockets).

Failure of establishment is a first-class outcome with its phase
attached — refused, unreachable, timed out in transport, rejected in
handshake, incompatible version. The dial's caller and the peer-state
display both need that distinction; "could not connect" flattened from
five causes is a support ticket, not a status
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
Handshake rejections deserve one grade more: log them with the stage
and the concrete reason, durably enough for an operator to find later —
a rejected peer is the one event that must be distinguishable after the
fact, because "connection failed" cannot tell a misconfigured device
from an impersonation attempt.

## One session per peer pair, chosen deterministically

Equals dial each other. Two devices that both notice the other will
both initiate, and without a rule you get two live sessions, each
carrying half the traffic, each half-idle, both eventually confusing
whatever logic assumes "the" connection. The fix is a symmetric,
deterministic tie-break both sides compute identically with no
communication — compare the two stable peer identifiers; the
lexically lower (or higher — any total order, applied consistently)
keeps its outbound attempt, the other yields and adopts the inbound
session. The same rule resolves the reconnect race after a network
blip, which is the common case wearing the rare case's clothes: both
sides notice the loss, both redial, and the tie-break must converge on
one session again. Locking "first one wins" without a total order is
not a rule — timing decides, and timing decides differently on each
side.

The insert into the session table, the tie-break, and the capacity
check belong in **one atomic step under one lock**. Checked separately,
each is a time-of-check race: two dials that both saw "below capacity"
overshoot the limit; a tie-break decided against a table that changed
since the read closes the wrong session. And when registration spans
two stores — an in-memory session table and a durable connected mark —
a failure writing the second rolls back the first, or observers watch
the two disagree about whether the peer is connected, each plausibly
authoritative.

## Life is supervised, because silence is ambiguous

An established session over a quiet period is indistinguishable from a
dead one: the other laptop closed its lid, the access point rebooted,
and no packet announces any of it. Supervision is the answer —
keepalives at a fixed cadence, a bounded grace period, and an honest
verdict when the grace expires: the session transitions to closed, its
resources release, the peer's state demotes. Two disciplines around
the verdict:

- **The grace period is a policy, not a hope.** It trades detection
  latency against tolerance for sleep/wake stutters; pick it on
  purpose, per the product's needs, and let the reconnection policy —
  not a longer grace — handle genuinely absent peers.
- **Local sends fail fast once the verdict lands.** Data queued to a
  session under suspicion should be bounded; data sent after the
  verdict is an error to the caller, not a silent buffer into a corpse.

## Teardown leaves nothing half-open

Every exit path — graceful close, keepalive verdict, handshake
rejection, subsystem shutdown, application quit — converges on one
teardown routine that releases the transport, drops crypto state,
cancels the session's background tasks, flushes or fails its queues,
and emits the state transition. The test of the state machine is that
**no state is terminal in name but live in resources**: a session
marked closed whose read-task still runs is a leak with a label. On
full shutdown, teardown is ordered — stop initiating, say goodbye where
the protocol supports it, close sessions, then stop the listener — so
the subsystem's death is observed by peers as departure, not as decay.

## Capacity is bounded at admission

Both directions of the lifecycle have an admission edge, and both need
limits declared before the first byte: maximum concurrent sessions,
maximum in-flight dial attempts, per-session buffer ceilings — and,
inside an established session, a per-peer inbound message rate over a
sliding window, because an authenticated peer is still remote software
that can misbehave, and one flooding peer must cost itself its session
rather than cost everyone the process. Inbound admission is the
exposed one — the listener accepts from the network, and an unbounded
accept loop is a resource faucet any segment neighbor can open. Reject
over-capacity politely (a close with a reason beats a hang) and account
rejections visibly; a peer subsystem that sheds load silently produces
the least debuggable symptom in the subject — "sometimes it just
doesn't connect".
