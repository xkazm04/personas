---
layer: technique
subject: wizard-flows
technique: commit-boundary
status: forged
laws: [gate-sees-target, failure-not-empty-success, creation-names-reaper]
shared_with: []
---

# Commit boundary

The wizard's defining promise is deferral: everything before the final
confirm is a draft, and one act turns the draft into reality. The boundary
has three parts — the review that shows the whole, the apply that commits
it, and the reporting when the apply does not go cleanly — and a fourth
concern for the flows that cannot fully keep the promise: resources that
had to become real early.

## The review shows what will be committed — from the same source

The review step renders the assembled commitment: every answer that will
take effect, in the user's terms, grouped by the steps that collected it,
each group one jump from its step for correction. Its content is derived
from the same model and the same relevance filtering the apply will use —
the review and the apply are two consumers of one assembly, so what the
user confirms and what the system executes cannot diverge
([gate-sees-target](../../_laws.md#gate-sees-target)). A review handwritten
as a separate summary is a description of the payload, and descriptions
drift; the first time a step is added without its review line, the user is
confirming a document that omits part of the commitment.

Two disclosure rules at this altitude:

- **Derived consequences are part of the review.** If the answers imply
  effects the user did not literally type — things created alongside,
  defaults filled in, costs incurred — the review states them. Confirming
  inputs is not consenting to outcomes the surface never mentioned.
- **The review is reachable only when the commit gate is open** — every
  relevant step valid — and arriving there re-checks, because time passed
  and revisits happen. A review reachable around the validity gate is a
  confirm button on an unknown payload.

## The apply

One confirmation, one commitment:

- **Atomic where the system allows it.** The draft applies as a single
  transaction: all of it or none of it, and "none of it" leaves the draft
  intact for another attempt. The wizard collected the pieces over many
  steps precisely so they could be asserted together; an apply that
  trickles them in independently un-decides that.
- **Guarded against the double fire.** Committing is a state of the flow
  model — entered once, disabling the confirm, surviving the impatient
  second click and the enter-key repeat. If the transport can redeliver,
  the commit carries the flow instance's identity as an idempotency key,
  so a retry of the *same* commit converges instead of duplicating.
- **Terminal.** On success the flow ends: the snapshot is reaped, the
  surface shows what was created and where to live with it now — the
  handoff to the created thing's own home, not a dead-end success banner.
  A committed wizard that leaves its draft behind will eventually re-offer
  a draft of something that already exists.

## Partial failure is reported precisely

Some commitments are physically multi-part — several systems, several
records, an external call in the middle — and one part can fail after
another succeeded. When atomicity is genuinely unavailable, the obligations
move to reporting and repair
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):

- **Account for every part**: applied, failed, not attempted — by name, in
  the user's terms. "Something went wrong" over a half-applied commitment
  is the worst sentence in the subject: the user cannot retry (what would
  re-apply?), cannot repair (what exists?), and cannot walk away (half of
  it is live).
- **Make the retry safe.** Re-confirming after a partial failure re-runs
  only the failed and unattempted parts — which requires the apply to
  record per-part outcomes, not one boolean. Where a failed part had
  already-applied dependents, say what state that leaves, and prefer
  compensating (undoing the applied parts) over stranding when the
  commitment only makes sense whole.
- **Never report the whole from the first part.** Success is declared when
  every part is accounted for, not when the first write returns.

## Early real resources name their reaper

Some flows cannot defer everything: a step must create a real resource
before the boundary because only the real system can validate against it,
or because later steps consume work only the real system can produce. The
promise bends; the discipline that keeps it honest:

- **Provisional, and marked as such.** Early-created resources are
  distinguishable from committed ones everywhere they might surface, so
  an abandoned draft never masquerades as a finished commitment.
- **Every exit reaps them**
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)). Cancel,
  discard, and snapshot expiry all clean up the provisional resources;
  the commit promotes them. The leak pattern is the wizard that cleans up
  on cancel but not on expiry — the exit nobody codes because nobody
  walks it — leaving a sediment of orphaned provisionals whose ownership
  question ("is this safe to delete?") no one can answer later.
- **The count of exits is the count of cleanups.** Enumerate the ways out
  of the flow; each one either reaps or promotes, decided at design time.
