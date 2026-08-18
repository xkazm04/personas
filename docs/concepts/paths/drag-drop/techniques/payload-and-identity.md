---
layer: technique
subject: drag-drop
technique: payload-and-identity
status: forged
laws: [identity-survives-reuse]
shared_with: []
---

# Payload and identity

The payload is what a drag *is about*, separated from how it is drawn. Get
the payload right and drops stay correct under everything the world does
while the pointer is down; get it wrong and the implementation works exactly
until two things happen at once.

## The payload is typed and minimal

A payload declares **what kind of thing it carries and which one**:

- **kind** — a name from a closed vocabulary of draggable types. Targets
  filter on it (a lane accepts cards, not lanes; a slot accepts clips, not
  folders). Untyped payloads force every target to sniff structure, and
  structure-sniffing is how a drop handler built for one type mangles
  another.
- **identity** — the entity's stable id, minted by the system of record.
- **origin context** — just enough to interpret the drop and to restore on
  cancel: the source container, the position it left. Not the entity's full
  data.

Minimal is load-bearing. A payload that embeds a snapshot of the entity
invites the drop handler to *use* that snapshot — writing minutes-old field
values back over fresher state. The payload is a reference plus context; the
drop handler resolves the reference against current data at drop time. If the
reference no longer resolves, the drag cancels honestly (see
[drag-lifecycle](drag-lifecycle.md)) instead of resurrecting a deleted thing.

And the payload is the **authorization**, not just the cargo: the drop
handler reads the identity out of the payload it received, never out of
ambient mode state ("whatever we recorded as dragging"). Local drag flags
outlive drags that ended without their end event firing, and a stale flag
plus an unrelated drop is an operation the user never performed. The payload
arrived with the drop; it is the only witness that this drop belongs to this
drag.

## Drops are statements about identities, never indices

The moment a drag begins, the arrangement the user sees starts going stale:
another user inserts a record, a background refresh reorders, a filter
changes what is visible. Any drop encoded positionally — "move index 3 to
index 7" — is evaluated against an arrangement that may no longer exist, and
lands on whatever occupies those slots *now*. The user watched record X being
placed after record Y; the system moved slot 3 after slot 7. Under concurrent
mutation these are different operations, and the second one is wrong.

Encode every drop as identities and relations:

- reorder: *place X after Y* (or before Z) — anchored to neighbors by id;
- transfer: *move X into container C at anchor Y*;
- assignment: *set X's owner to L*.

Identity survives reordering, reuse, and restart; that is what it is for. An
id-anchored drop stays meaningful even when evaluated later, elsewhere, or
against a shifted list — the anchor records may have moved, but the statement
still says what the user meant. The degenerate anchors need declared
semantics too: dropped at the head (no predecessor), at the tail (no
successor), into an empty container. Each is a distinct, explicit case, not
an index that happens to be zero.

## Order is data — decide how it is stored

Persisted order needs a representation, and the choice shapes every reorder:

- **Dense integer ranks** are simple but make one move rewrite the positions
  of everything after it — noisy in history, contentious under concurrency.
- **Gapped or fractional ranks** let one move touch one record (assign a rank
  between the new neighbors), at the price of periodic rebalancing when gaps
  exhaust. The rebalance is part of the design: scheduled, owned, and
  invisible — not an emergency discovered when insertions start colliding.
- **An explicit linked order** (each record names its predecessor) makes
  moves minimal but every read a traversal; it earns its complexity only
  where write contention dominates.

Whichever representation, two invariants are non-negotiable. The
*comparator that turns stored ranks into a displayed sequence* is total and
deterministic — ties broken by identity — or "the order" differs between the
tier that stores it and the tier that draws it; worse, an order with ties is
*unstable*, free to reshuffle under storage-engine changes that touch no
data. And a *multi-record rank rewrite is one atomic operation*: written as
independent per-record updates, a failure partway through persists a
sequence that is neither the old order nor the new one — with duplicate
ranks the comparator was promised would not exist — while the caller sees
only "the operation failed" and assumes nothing changed. Fractional ranks
sidestep this class entirely (one move, one record); dense ranks must buy
the same safety with a transaction.

## Optimistic reorder, honest reconciliation

Placement gestures feel broken with a round-trip between release and
movement, so the interface applies the drop locally and confirms in the
background — *when it has the right to* (the commit case of
[ownership-boundaries](ownership-boundaries.md); request-shaped drops preview
instead). Optimism is a protocol, not a mood:

- **Remember enough to undo.** The pre-drop arrangement (or the inverse
  statement: *X was after W*) is retained until the authority confirms.
- **Reconcile by identity.** When the authoritative arrangement returns,
  merge it by id. Positional merging after a failed drop is the same index
  bug at the reconciliation layer.
- **Rejection reverts visibly.** The item animates back and the surface says
  why. A silent snap-back reads as a rendering glitch and teaches the user to
  re-try an operation the authority just refused.
- **One optimistic drop in flight per entity.** A second drag of the same
  item before the first confirms must either queue behind it or supersede it
  explicitly; interleaved confirmations arriving out of order otherwise
  resurrect the intermediate arrangement.

## Selection and multi-item payloads

Dragging a multi-selection carries a payload of *ids, in a declared order* —
the selection's order, not the pointer's happenstance. The drop statement
places the group relative to the anchor while preserving intra-group order,
and cancel restores every member. The temptation to implement multi-drag as N
sequential single drops produces N optimistic operations racing one another;
one payload, one statement, one reconciliation.
