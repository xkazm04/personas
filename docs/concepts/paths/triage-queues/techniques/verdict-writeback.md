---
layer: technique
subject: triage-queues
technique: verdict-writeback
status: forged
laws:
  - failure-not-empty-success
  - one-validation-door
shared_with: []
---

# Verdict write-back

The aggregation half of a triage queue is a read problem; the verdict half
is a write problem, and a harder one, because every write crosses back over
the normalization boundary into a specific owning system with its own
mutation semantics. The queue's credibility rests entirely on this leg: an
operator who watches a resolved item resurrect will — correctly — stop
believing anything the surface says. A decision that does not land is worse
than no queue, because it consumes the operator's judgment and then
discards it.

## The dispatch table

Each verdict is routed by the item's source tag to the mutation that its
owning system defines — resolve the incident *in the incident store*,
dismiss the finding *in the findings store*, archive the message *in the
message store*. The routing lives in one declared mapping from (source,
verdict) to operation: a dispatch table, not a scatter of conditionals. The
table is the single door through which every verdict passes
([one-validation-door](../../_laws.md#one-validation-door)), which buys
three properties at once: the set of writers is enumerable, an item whose
source has no route for a given verdict can be *detected at render time*
(the control is not offered, rather than failing on click), and adding a
source is one adapter plus one table row — the acceptance test from
[source-normalization](source-normalization.md) extended to the write path.

The dispatch carries a contract worth stating as an invariant: **every
verdict either defers, or writes, or throws — never nothing.** Under
optimistic removal, a routing branch that silently matches no case is
indistinguishable from a successful write: the item leaves the surface, the
owner still says pending, and no error exists anywhere. A fall-through that
throws is a bug the first operator hits; a fall-through that returns is a
lie every operator repeats. Keep the router a pure function with its writes
injected, so every branch — especially the ones that used to fall through —
is exercisable in a test without the whole surface mounted.

The mutation must land in the **system of record**, not in any cache the
queue reads. Marking the aggregation's copy resolved while the owner still
holds the item open is self-deception with a timer on it: the next full
refresh reads the owner, and the item returns.

## Optimistic display, honest confirmation

Triage rhythm matters — an operator working a deck at one verdict per few
seconds cannot wait synchronously on every write. The standard resolution
is optimistic removal with a confirmation obligation:

- On verdict, the item leaves the visible queue immediately and the write
  dispatches in the background. The rhythm survives.
- The removal is **reversible until confirmed**. If the write fails, the
  item returns to the queue with a visible failure notice naming the item
  and the error — never a silent reappearance the operator has to notice
  on their own, and never a silent *disappearance* where the failure is
  logged somewhere the operator will not look
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
- In-flight verdicts are tracked per item identity. Navigation away, a
  refresh, or the next verdict must not orphan an unconfirmed write; a
  refresh that arrives while a verdict is in flight must not resurrect the
  item it is about to remove — reconcile the incoming snapshot against the
  in-flight set.
- The restore returns the *operator*, not just the item. The working
  position advanced optimistically with the removal; a restored item that
  re-enters at its sorted place — behind a read head that already walked
  past it — is technically present and practically invisible. Put the
  cursor back on the restored item so the failure is the next thing the
  operator sees.

Where a verdict is *destructive and hard to reverse* in the owning system,
optimism is the wrong default; make that verdict synchronous or
two-step. The asymmetry argument is developed in
[bulk-triage](bulk-triage.md), and where the verdict is an approval that
unblocks a machine, the binding rules of the
[approval subject's review queues](../../hitl-approval/techniques/review-queues.md)
govern — an optimistic approval is a contradiction in terms.

## Partial failure is per-item truth

Any batched verdict — bulk dismiss, resolve-all-in-group — will eventually
half-succeed: three sources acknowledge, the fourth times out. The batch
result must be reported per item, and the queue's state must converge to
the truth: succeeded items stay gone, failed items return with their error.
The two dishonest simplifications are both common and both fatal — "the
batch failed" (re-showing items that were in fact resolved, teaching the
operator that resolved items resurrect) and "the batch succeeded" (hiding
items that were not resolved, which surface again later as stale
discoveries). Truth is per item; report it per item.

## Idempotence and the double verdict

Fast keyboard triage guarantees eventual double-submission: two verdicts on
the same item, a retry racing its original, a stale surface verdicting an
item another session already resolved. The write path must be idempotent at
the owner — verdicting an already-resolved item converges to resolved
rather than erroring — and the surface should disarm the common case by
locking the item's controls while its verdict is in flight (the in-flight
lock that [focus-mode](focus-mode.md) formalizes). When the owner reports
"already resolved by someone else", that is a *success* for queue purposes:
the item leaves, optionally with a note, because the operator's goal — the
item handled — is met.
