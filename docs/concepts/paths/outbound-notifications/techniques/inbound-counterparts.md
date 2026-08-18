---
layer: technique
subject: outbound-notifications
technique: inbound-counterparts
status: forged
laws: [identity-survives-reuse, derivation-names-recomputation, creation-names-reaper, one-validation-door]
shared_with: []
---

# Inbound counterparts

Some channels are billboards: a JSON endpoint, an inbox, a status feed —
you post, nothing comes back. Others are **conversations**: a chat room
where the humans you notified will reply, ask, redirect. A channel layer
that can send into a conversation but has no plan for what comes back has
built half a product and left the other half to whoever wires it under
deadline. This technique owns the mirror lane — receiving from a channel
this layer also sends to — and the one invariant without which the pair
becomes an unbounded loop.

## This is not webhook ingestion

Draw the boundary first, because the two get conflated on sight. Events
arriving *from* an external system through a receiving endpoint —
signed payloads, replay protection, verification — are their own subject.
The mirror lane is narrower and different in kind: it reads **replies in
a space this layer posts into**, correlates them to the sends that
prompted them (or ingests them as directives into the same conversation),
and answers back in-thread. It shares nothing structurally with an
ingestion endpoint except the direction of the arrow.

## Poll or push, the poller shape is the fallback that always works

Long-lived receiving connections and event-push registrations are the
right end state for chat platforms and the wrong first step: they need an
inbound endpoint or a socket, another credential shape, reconnect logic,
and platform-specific plumbing. A **poller** needs only the credential
already in the vault and a periodic tick, and survives restarts
trivially. So the durable design keeps the *dispatch path* independent of
the *fetch mechanism*: fetch-new-messages is a function whose
implementation may later be swapped for a push consumer that feeds the
same downstream. Build the poller shape properly and the push upgrade is
a transport swap, not a rewrite.

The poller shape, per (identity, channel):

- **A durable cursor** — last message id or timestamp seen — persisted
  per channel, advanced only after everything before it is safely
  recorded (the mark is a stored derivation of "what has been ingested",
  and the tick is its recomputation:
  [derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
- **A bounded fetch per tick**, sized against the target's per-route rate
  budget and written down as a constant with the arithmetic in its
  comment — the next maintainer must be able to see *why fifty*.
- **A bounded burst drain**: when more arrived between ticks than one
  fetch returns, page backward before advancing the cursor, up to a hard
  page cap that stops a pathological channel from spinning the tick;
  stragglers past the cap fall to the next tick, cursor un-advanced.
- **Author filtering** at the source: messages from automated authors —
  including this system's own bot identity — are not directives.
- **A leader-only guard** where more than one instance may run: two
  pollers reading one channel double-dispatch and double-reply.

## Reply correlation

An inbound message that triggers work needs a durable record: (channel,
message identity, the work's identity, reply status). When the work
completes, a second pass finds finished-but-unanswered records and posts
the answer *in the same thread*, recording the reply's identity so the
pass is idempotent across restarts. Two bounds live here too: replies per
tick (a restart after an outage must not fire a hundred replies into one
room in one tick) and reply size (chat platforms cap message length and
reject the whole post — truncate with headroom and an honest marker;
lose the tail, never the answer). Message identity from the platform is
the correlation key and must be stored verbatim
([identity-survives-reuse](../../_laws.md#identity-survives-reuse) — a
timestamp alone is not an id where two messages can share a tick).

## The echo guard: the one invariant

When a channel is bridged in **both** directions — messages from the room
are ingested into an internal conversation, and internal conversation is
mirrored out to the room — a loop is the default outcome: an ingested
message becomes an internal row, the outbound half mirrors internal rows,
the room receives its own message back, the poller ingests it again.
Both halves are relaying faithfully; the system is spinning.

The guard is one rule with one definition: **anything that arrived from
the channel is stamped with its origin, and origin-stamped rows are never
mirrored back, whatever the outbound flags say.** Make it a *named*
predicate with a single implementation and a single test, and check it
first — before any flag logic — so no future flag combination can
re-export an inbound row. Extend the discipline to unknown authors:
outbound mirroring should be **opt-in by author kind**, so a future
writer of internal rows has to declare itself mirror-eligible instead of
leaking into a room by default
([one-validation-door](../../_laws.md#one-validation-door), applied to
who may exit).

## The bridge: one binding, both directions

Where a channel is bidirectional, declare it **once**: one binding record
carrying the identity to act as, the credential, the remote room, and
per-direction flags (poll inbound; mirror messages out; mirror operator
directives out; mirror step events out). Both the poller and the relay
parse *the same binding through the same parser*, so a flag added for
one lane cannot be missed by the other. The bridge is a strict fork on an
explicit discriminator: a plain notification channel without the marker
must keep behaving exactly as before the bridge feature shipped — wiring
a bridge must not be able to change what an existing channel does. And
its identity is the (internal conversation, remote room) pair, not the
record it happens to be stored on: two records naming the same pair are
one bridge for cursor, rate, and health purposes.

## Reaping and identity discipline

Every poller state row, inbound-message record, and reply correlation is
keyed by channel identity and reaped when the channel is removed
([creation-names-reaper](../../_laws.md#creation-names-reaper)). And the
identity the poller *acts as* — which internal principal executes work
triggered by a room message, whose credential reads the room — is
declared on the binding, never inferred from the message: a room is a
public-ish space, and "whoever spoke last" is not an authorization.
