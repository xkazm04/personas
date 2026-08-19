---
layer: technique
subject: triage-queues
technique: bulk-triage
status: forged
laws:
  - count-carries-predicate
  - identity-survives-reuse
shared_with: []
---

# Bulk triage

Some queues accumulate runs of homogeneous items — thirty findings from one
noisy rule, a burst of duplicate incidents from one flapping monitor — and
forcing an operator to verdict them one at a time is rhythm without value:
the judgment is made once, on the pattern, and the remaining twenty-nine
keypresses are ritual. Bulk triage is the mechanism that lets one judgment
cover many items. It is also the sharpest tool in the subject, because it
multiplies mistakes by exactly the same factor it multiplies throughput.

## Selection is a set of identities

Multi-select is held as a set of item identities, never as indices or "the
current filtered range"
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). The
distinction becomes safety-critical under the queue's standing condition —
concurrent mutation. A refresh or an arrival between selection and verdict
must not silently change *what is selected*: identity-based selection keeps
covering exactly the items the operator chose; anything positional now
covers items they never saw. Two reconciliation rules complete the
contract: an item that leaves the queue (resolved elsewhere) leaves the
selection, visibly decrementing the count; an item that *arrives* never
joins a selection it predates, even when it matches the filter the operator
selected under — "select all matching X" captures the members at selection
time, not a standing subscription to X.

## The count carries its predicate

The confirmation moment is the whole safety interface of bulk triage, and
its currency is the count. "Dismiss 34 items?" is not enough when the 34
was produced by a filter the operator half-remembers: the confirmation
names the predicate — "34 items: source A, severity low, older than a
week" — so the operator confirms a *description*, not a number
([count-carries-predicate](../../_laws.md#count-carries-predicate)). A
count whose predicate is stale (the filter changed after selection, the
queue mutated) is recomputed and re-presented, never carried forward on
trust. The same law governs the *result*: "31 dismissed, 3 failed —
listed" is the honest report shape; per-item truth on partial failure is
the [verdict-writeback](verdict-writeback.md) contract, applied at batch
scale.

## The asymmetry: bulk-dismiss is not bulk-accept

The two directions of bulk verdict have different blast radii, and the
design must encode the difference rather than offering them as symmetric
buttons:

- **Bulk-dismiss** (reject, ignore, mark-not-actionable) discards items
  whose entire remaining value is the operator's attention. The cost of a
  wrong dismiss is one missed item — real, but bounded, and often
  recoverable if dismissal is a recorded state rather than deletion
  (the [queue-lifecycle](queue-lifecycle.md) resolution contract).
- **Bulk-accept** (approve, apply, execute) *does things*. A wrong member
  hidden in an accepted batch does not lose attention; it performs an
  action nobody reviewed. Twenty accepts is twenty effects, and the batch
  framing is precisely what removed the per-item reading that would have
  caught the outlier.

Consequences: bulk-dismiss can be one confirmation with a predicate-bearing
count and an undo window; bulk-accept earns friction proportional to
effect — homogeneity checks (offer it only when the batch is genuinely one
shape and one risk class), a preview of what will be performed, and, where
the items are approvals gating machine actions, the batching disciplines of
the [approval subject](../../hitl-approval/techniques/review-queues.md)
rather than an inbox shortcut. If one direction must be harder to reach
than the other, it is always accept.

## Undo beats confirm

Confirmation dialogs decay with repetition — the tenth "Dismiss 30 items?"
is clicked through unread, by the same fatigue mechanism the golden path
describes. For the reversible direction, a post-hoc undo window (the batch
reported, with one action restoring it whole) protects better than a
pre-hoc dialog, because it does not spend attention *before* the mistake is
visible. The undo must restore the items' recorded state at the owners, not
merely re-show cached rows — undo is a write-back like any other, and it
races like one: it contends against whatever state the original verdict
produced, and if another actor has decided the item in the meantime, the
undo *loses* and reports the conflict rather than overwriting the newer
decision. An undo that always wins is a worse defect than the mistake it
exists to fix. The window is also bounded on purpose — an undo offer that
stands forever invites taking back a verdict whose downstream effects have
long since been acted on. For the
irreversible direction, no undo can exist, which is one more reason
bulk-accept keeps its friction up front.
