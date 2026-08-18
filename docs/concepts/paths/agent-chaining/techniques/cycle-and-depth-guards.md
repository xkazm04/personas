---
layer: technique
subject: agent-chaining
technique: cycle-and-depth-guards
status: forged
laws:
  - failure-not-empty-success
  - gate-sees-target
shared_with: []
---

# Cycle and depth guards

Event-wired chaining is a self-replicating primitive handed to end users
through a drawing surface. Two arrows — A to B, B to A — drawn to mean
"these two collaborate" are, unguarded, an infinite loop where every
iteration is a paid model execution. The technique is a defense in two
layers, static and dynamic, each required because each covers the other's
blind spot.

## Layer one: feedback edges are found at wiring time

When the graph is saved, cycle detection runs over the drawn edges —
standard reachability, cheap at any plausible graph size. What happens on
detection is a product decision with exactly two defensible answers:

- **Reject** the save, naming the cycle's members — the conservative
  default, right for systems where loops have no legitimate meaning.
- **Admit as a marked feedback edge**: the edge is wired, but tagged as
  intentional feedback, excluded from any forward-flow analysis (ordering,
  progress display), and subjected to *tighter* runtime bounds than forward
  edges — because a drawn loop is now a declared loop, and declared loops
  get budgets.

What is never defensible is the third behavior most systems ship by
accident: wiring the cycle as if it were forward flow, because the
translation pass processes edges one at a time and no step ever sees the
whole graph. Cycle detection is a *whole-graph* property; it must run where
the whole graph is in hand — the wiring translation pass — not be hoped for
at the per-edge level.

The static layer's blind spot is anything dynamic: chains that route
through an agent whose outgoing edges were added after this graph was
saved, cross-graph subscriptions, an agent that participates in two
separately-acyclic graphs whose union cycles. Static analysis over one
drawing cannot see any of these. Hence layer two.

## Layer two: depth is bounded at runtime, from machinery-owned state

Every link carries its chain depth — how many handoffs deep this execution
is — and the handoff that would exceed the configured bound **does not
fire**. Rules that make the guard real rather than decorative:

- **Depth is written by the chaining machinery, not the participants**
  (see handoff-payload-contracts in this subject: provenance is
  machinery-stamped). A depth counter a link's own output could influence
  is a guard the loop can disarm. The guard must read state the guarded
  process cannot author
  ([gate-sees-target](../../_laws.md#gate-sees-target) in its sharpest
  form: a gate whose input the target controls observes nothing).
- **The bound is enforced at the handoff decision point** — the one place
  every continuation passes through — not in the agents, not in the UI, not
  in documentation asking users to be careful.
- **Exceeding the bound is a recorded stop, not a dropped event.** The
  chain ends with a typed reason — depth exceeded, at this link, bound N —
  queryable afterward
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
  A silently swallowed handoff converts "the guard fired" into "the product
  randomly stopped working," which users report as a bug in the *feature*,
  not as the loop they drew.

## Choosing the bound, and what else can break a loop

The depth bound is a product constant with a rationale, not a magic number:
it should comfortably exceed the longest chain a user legitimately draws
(look at the deepest drawn path the authoring surface permits, add
headroom) and sit far below the depth at which a runaway loop does real
financial damage. Single digits to low tens is the honest range for
model-backed links; anything higher means the bound is protecting the stack,
not the wallet.

Depth is the guard of last resort; richer loop-breakers can fire earlier
and are worth having once loops are legitimate:

- **Revisit counting**: the same agent appearing more than K times in one
  chain is a tighter, more targeted signal than raw depth — a chain of
  twelve *distinct* agents may be intended; A→B→A→B is almost never.
- **Breadth bounding**: depth bounds a chain's path *length*; nothing about
  it bounds *width*. One completion can match many edges, and each match
  branches again — a fan-out grows without bound while every individual
  path stays comfortably shallow. The breadth guard counts links already
  spawned under the chain's identity and halts the cascade at a ceiling.
  Depth and breadth are independent axes; a system that guards only one
  has guarded half the plane.
- **Budget guards**: cumulative chain cost as a ceiling, which catches
  expensive short loops that depth alone would admit. The chain identity
  that makes cost roll up per chain (chain-identity-and-rollup, this
  subject) is what makes this guard implementable at all — guards compound
  on identity.
- **Convergence checks** — stop when an iteration's output is
  substantially identical to the previous round's — are the only guard
  that can distinguish "still making progress" from "orbiting," at the cost
  of a comparison policy someone must own. An advanced option, not a
  substitute for the hard bounds.

Marked feedback edges (layer one's admit path) should carry a per-edge
iteration budget as well: "this loop may run at most N rounds" is the
user-facing, edge-local version of the global depth bound, and it turns an
accidental infinite loop into a bounded refinement cycle — which is the
legitimate thing the user usually wanted.

## Decision rules

- Cycle detection runs where the whole graph is in hand — the wiring pass;
  reject or mark-and-bound, never wire-as-forward.
- Depth lives in machinery-stamped provenance; participants cannot write it.
- One enforcement point: the handoff decision. No handoff bypasses it, and
  the check runs before any downstream cost is incurred.
- Guard trips are typed stops with the tripped bound named — visible in the
  chain's record and in the authoring surface, because the person who drew
  the loop is the person who can fix it.
- Bounds are configurable but never absent; "unlimited" is not a valid
  configuration value for a primitive that spends money per iteration.
- A configurable bound distinguishes *unset* from *corrupt*. Unset may
  legitimately mean "this guard is off" — a legible operator choice. A
  stored value that fails to parse means the operator *tried* to set a
  brake; resolving it to "off" silently drops the only brake at the moment
  someone reached for it. Corrupt guard configuration fails restrictive —
  halt the chain with a typed stop naming the corrupt value — never open.
