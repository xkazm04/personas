---
layer: technique
subject: drag-drop
technique: ownership-boundaries
status: forged
laws: [one-validation-door, gate-sees-target]
shared_with: []
---

# Ownership boundaries

Every drop asserts a new arrangement: a new order, a new lane, a new
container. Before designing any of the gesture, answer one question — **which
tier is the authority over the arrangement being changed?** — because the
answer decides what a drop *is*. Skipping the question does not avoid the
decision; it makes it implicitly, and the implicit answer is always "the
interface", which is wrong exactly when it matters.

## The three postures

**Commit** — the interface owns the arrangement. Personal layouts, local
orderings, view preferences: the drop applies immediately and persistence
follows behind the gesture. Failure to persist is a background problem
(retry, then surface it), not a reason to hold the UI hostage. This is the
posture users implicitly expect, which is why the other two must be *visibly*
different, not just internally different.

**Request** — a backend authority owns the arrangement, and the interface is
allowed to propose. The drop submits a statement (see
[payload-and-identity](payload-and-identity.md)) and the surface shows a
*pending* treatment — the item in its proposed position, marked provisional —
until the authority answers. Acceptance settles it; rejection returns it
**with the reason**. The interface may be optimistic in rendering but never
in fact: nothing downstream treats the arrangement as changed until the
authority says so.

**Display-only** — the authority is elsewhere *and* the interface has no
standing to propose, or the placement is derived (computed from state the
user cannot legitimately hand-edit). Then the honest design offers **no drag
at all** on that axis. A lane that reflects a status driven by automation, an
order computed from a score — dragging there would be a gesture that either
lies (snaps back seconds later) or silently overwrites a derivation. The
craft is making non-draggability legible: no handles, no lift, no grab
cursor, so the absence reads as *designed*, not broken. Display-only on one
axis does not preclude drag on another — a board can forbid cross-lane moves
while allowing reorder within a lane the user owns.

The worst shipped variant is the **counterfeit commit**: an authority-owned
arrangement wired as if interface-owned. It demos perfectly — one user, no
automation, no latency — and in production items snap back after the
authority disagrees, users re-drag, and the surface teaches everyone that the
board lies. If the authority cannot be consulted in gesture-time, the honest
choices are request (with pending states) or display-only; never pretend.

## Validation lives at the authority's door

Two tiers evaluate every drop, and they must not be confused:

- **Gesture-time filtering** is *courtesy*: targets light up or refuse (see
  [drop-affordances](drop-affordances.md)) based on rules the interface
  knows. It exists to save the user a wasted gesture.
- **The authority's validation door** is *the law*: the single validation
  path every arrangement-write passes through — drops, but also the
  non-pointer equivalents ([keyboard-alternatives](keyboard-alternatives.md)),
  bulk operations, imports, and other clients. Rules enforced only in the
  drop handler are rules the next writer never sees.

And the door judges against **current state, not the gesture's snapshot**.
The client validated against the world as of drag-start; by drop time the
record may have changed owners, the lane may have closed, a limit may have
filled. A gate that trusts the client's staleness passes exactly the drops
that should fail — so the authority re-resolves the identities and re-checks
the rules at its own door, and the interface treats "valid when I picked it
up, refused when it landed" as a normal outcome with a normal explanation,
not an edge case.

## Rejection is a first-class flow

Under the request posture, refusal is routine — permissions, transition
rules, concurrent changes — and the surface designs for it: the item returns
to its true position, the reason appears where the user is looking, and the
pending treatment never lingers past the answer. Two failure modes to kill
in review: the *silent snap-back* (reads as a glitch; the user retries an
operation that will refuse again) and the *stranded pending* (the authority
never answered and the item floats provisional forever — every request drop
carries a timeout that resolves it to refused-with-explanation).

## Mixed boards are the norm

Real surfaces mix postures per axis and per user: reorder-within-lane may be
commit while lane-assignment is request; an operator may drag what a viewer
cannot. The posture is therefore *data the surface consumes* — derived from
authority and permission, driving handles, affordances, and drop wiring
together — not a constant baked into the component. When the posture is
data, "this lane became automated" is a configuration change; when it is
baked in, it is a rewrite.
