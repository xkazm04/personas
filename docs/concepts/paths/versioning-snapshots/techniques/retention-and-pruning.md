---
layer: technique
subject: versioning-snapshots
technique: retention-and-pruning
status: forged
laws: [creation-names-reaper, deletion-is-not-repair]
shared_with: []
---

# Retention & pruning

Every version created is storage committed forever unless something
deletes it, so the versioning feature is not done until it names its
reaper ([creation-names-reaper](../../_laws.md#creation-names-reaper)):
what survives, what gets pruned, on what schedule, by what code. A team
that skipped this decision has still made one — retain everything — and
that default is defensible for longer than intuition suggests, but it
must be *chosen*, with the arithmetic done, not inherited from nobody
having thought about it.

## Do the arithmetic before the engineering

Version storage cost is snapshot size × creation rate × entity count.
For most entity-versioning cases (configurations, prompts, documents of
ordinary size, versioned at human save-rates), that product is small —
full snapshots at every version are affordable for years, and the honest
conclusion of the arithmetic is "retain everything, revisit at 10× the
current volume". The exotic machinery — delta chains, content-addressed
storage, compression — buys real savings only when snapshots are large or
capture is automated and frequent; adopted before the arithmetic demands
it, it trades restore simplicity (read one row) for reconstruction
pipelines (replay a chain) with no benefit to pay for the risk. If
version storage hurts at human save-rates, suspect the capture frequency
or the snapshot scope before the storage engine.

## Pruning preserves the *shape* of history

When pruning is warranted, oldest-first is the wrong rule — it evicts
exactly the states with the most invested meaning. The policy that
matches how history is actually used is **thinning**: keep everything
recent at full density, then progressively sparser survivors going back.
Recency carries detail; antiquity carries milestones.

And some versions are exempt from automatic eviction categorically:

- **Pinned** — a user said "keep this"; the pin is a promise, and a
  janitor that breaks user promises poisons trust in the whole feature.
- **Lifecycle-significant** — the currently active version (obviously),
  every version that was *ever* promoted, and the incumbent a rollback
  might still return to. Pruning the rollback target converts the next
  regression from a pointer-swap into an incident.
- **Referenced** — versions that measurements, comparisons, audit
  records, or lineage edges still point at. Deleting a version that a
  stored verdict cites destroys the evidence while keeping the claim —
  a quiet cousin of
  [deletion-is-not-repair](../../_laws.md#deletion-is-not-repair). If
  the referencing records matter, the version they cite matters.

The exemptions imply the mechanics: pruning is a *query with guards*,
not an age cutoff — and the guard list is the retention policy's real
content.

## Lineage survives the pruned node

Thinning creates holes in parent chains: v6's parent v5 is pruned, and a
naive walk up the lineage now dead-ends. Decide the repair at
design time: either **splice** (the pruned node's children re-parent to
its parent, with a "via pruned v5" annotation preserving honesty) or
**tombstone** (a minimal row survives — identity, lineage edges,
label — while the heavy snapshot content is dropped). Tombstoning is
usually the better trade: identity and history are tiny; it is the
*content* that costs, and keeping the skeleton means numbers stay
gap-explained, lineage stays walkable, and cited ids keep resolving even
after their content is gone.

## The deletion contract: does history outlive its subject?

One retention question is asked once, at schema time, and is unanswerable
later: when the *entity* is deleted, what happens to its versions? Two
defensible contracts — **cascade** (the history is meaningless without
its subject and dies with it; right for working history, wrong wherever
audit obligations attach) or **survive** (the history outlives the
entity, and then it needs an owner of its own: a registered sweep for
orphans, a retention clock, an access path that does not route through
the dead parent). The indefensible contract is the unstated one: version
rows with neither a cascade nor a named orphan-reaper are an orphan farm
([creation-names-reaper](../../_laws.md#creation-names-reaper)) — they
accumulate exactly as fast as entities are deleted, and no query ever
shows them again.

## Pruning is a lifecycle event, not a disappearance

Versions vanishing without trace read as data loss to the user who
remembers saving them. The retention policy is stated where versions are
shown ("keeping the last N, dailies beyond"), pruning is logged, and —
the checkpoint-scale rule holds at durable scale too — anything a user
explicitly kept is deleted only by a user action with the version's name
on it.

## Prohibitions

1. No versioning feature without a declared retention policy — even if
   the declaration is "retain everything, revisit at threshold X".
2. No storage sophistication (deltas, chains, dedup) before the
   arithmetic shows full snapshots failing.
3. No automatic eviction of pinned, promoted-ever, active, or
   rollback-target versions.
4. No pruning of a version still cited by measurements, audits, or
   lineage — or prune to a tombstone that keeps the citations
   resolvable.
5. No silent pruning — the policy is visible, and its actions are
   logged.
6. No version store without a declared deletion contract — cascade with
   the subject, or survive it with a named orphan-reaper.
